// Pulls a zone's data from the state UEZ portal into Supabase.
const supabase = require('../db/supabase');
const { encryptText, decryptText } = require('../utils/uezCrypto');
const { UezPortal, PortalError, pdfToText } = require('./uezPortal');
const { parseListing, parseDetail, parseDueReport, parseLateReport } = require('./uezParsers');

const DETAIL_BATCH = Number(process.env.UEZ_DETAIL_BATCH || 400);   // detail pages per run
const DETAIL_MAX_AGE_DAYS = 7;
const running = new Set();                                            // org ids with a sync in progress

function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
const nowIso = () => new Date().toISOString();

async function must(q) { const { data, error } = await q; if (error) throw error; return data; }

async function getPortalLogin(orgId) {
  const row = await must(supabase.from('uez_zone_portal_logins').select('*').eq('org_id', orgId).maybeSingle());
  if (!row) return null;
  return { ...row, username: decryptText(row.username_enc), password: decryptText(row.password_enc) };
}

// Test a login against the portal. Returns { zoneName, portalUser } or throws PortalError.
async function testLogin(username, password) {
  const portal = new UezPortal({ username, password });
  try { return await portal.login(); } finally { await portal.logout(); }
}

async function savePortalLogin(orgId, { username, password, userId }) {
  const info = await testLogin(username, password);
  const org = await must(supabase.from('uez_zone_orgs').select('*').eq('id', orgId).single());
  if (org.zone_name && org.zone_name !== info.zoneName) {
    const err = new PortalError('wrong_zone', `That login is set to ${info.zoneName}, but this organization is ${org.zone_name}. Change the zone in the UEZ portal or use the ${org.zone_name} login.`);
    throw err;
  }
  await must(supabase.from('uez_zones').upsert({ name: info.zoneName }, { onConflict: 'name', ignoreDuplicates: true }));
  if (!org.zone_name) await must(supabase.from('uez_zone_orgs').update({ zone_name: info.zoneName }).eq('id', orgId));
  await must(supabase.from('uez_zone_portal_logins').upsert({
    org_id: orgId,
    username_enc: encryptText(username),
    password_enc: encryptText(password),
    portal_user: info.portalUser,
    status: 'ok',
    last_checked_at: nowIso(),
    last_error: null,
    updated_by: userId || null,
    updated_at: nowIso()
  }, { onConflict: 'org_id' }));
  return info;
}

const LISTING_FIELDS = ['permit_no', 'name', 'status', 'cert_date', 'last_annual_date', 'last_recert_date', 'extension_date', 'email', 'sic_code', 'naics_code'];

async function syncListing(portal, zoneName, stats) {
  const rows = parseListing(await portal.fetchListingHtml());
  if (!rows.length) throw new PortalError('layout', 'Business listing came back empty.');
  stats.listing = rows.length;

  const { count: listedBefore, error: countError } = await supabase.from('uez_zone_businesses')
    .select('file_no', { count: 'exact', head: true }).eq('zone_name', zoneName).eq('in_zone_listing', true);
  if (countError) throw countError;
  const firstSync = !listedBefore;

  const existing = new Map();
  for (const ids of chunk(rows.map((r) => r.file_no), 500)) {
    const data = await must(supabase.from('uez_zone_businesses')
      .select('file_no, status, last_annual_date, last_recert_date, in_zone_listing').in('file_no', ids));
    for (const d of data) existing.set(d.file_no, d);
  }

  const events = [];
  const upserts = rows.map((r) => {
    const prev = existing.get(r.file_no);
    if (!prev || !prev.in_zone_listing) {
      if (!firstSync) events.push({ file_no: r.file_no, zone_name: zoneName, kind: 'new_business', detail: { status: r.status, cert_date: r.cert_date } });
    } else {
      if (r.last_annual_date && r.last_annual_date !== prev.last_annual_date) events.push({ file_no: r.file_no, zone_name: zoneName, kind: 'annual_filed', detail: { date: r.last_annual_date, previous: prev.last_annual_date } });
      if (r.last_recert_date && r.last_recert_date !== prev.last_recert_date) events.push({ file_no: r.file_no, zone_name: zoneName, kind: 'recertified', detail: { date: r.last_recert_date, previous: prev.last_recert_date } });
      if (prev.status === 'A' && r.status === 'I') events.push({ file_no: r.file_no, zone_name: zoneName, kind: 'inactivated', detail: {} });
      if (prev.status === 'I' && r.status === 'A') events.push({ file_no: r.file_no, zone_name: zoneName, kind: 'reactivated', detail: {} });
    }
    const row = { file_no: r.file_no, zone_name: zoneName, in_zone_listing: true, listing_synced_at: nowIso(), updated_at: nowIso() };
    for (const f of LISTING_FIELDS) row[f] = r[f];
    return row;
  });

  for (const part of chunk(upserts, 500)) await must(supabase.from('uez_zone_businesses').upsert(part, { onConflict: 'file_no' }));
  for (const part of chunk(events, 500)) await must(supabase.from('uez_zone_business_events').insert(part));
  stats.events = events.length;
  return rows;
}

async function syncReports(portal, stats) {
  const due = parseDueReport(await pdfToText(await portal.fetchReportPdf('UEZCPNYDUEW.RDF')));
  const late = parseLateReport(await pdfToText(await portal.fetchReportPdf('UEZCPNYLATEW.RDF', '&p_user_role_id=')));
  if (due.total !== null && due.total !== due.rows.length) throw new PortalError('parse', `Companies Due: read ${due.rows.length} of ${due.total} rows.`);
  if (late.total !== null && late.total !== late.rows.length) throw new PortalError('parse', `Companies Late: read ${late.rows.length} of ${late.total} rows.`);
  stats.due_statewide = due.rows.length;
  stats.late_statewide = late.rows.length;

  const zones = [...new Set([...due.rows, ...late.rows].map((r) => r.zone_name).filter(Boolean))];
  if (zones.length) await must(supabase.from('uez_zones').upsert(zones.map((name) => ({ name })), { onConflict: 'name', ignoreDuplicates: true }));

  // Reports are statewide snapshots: clear old flags, then set current ones.
  await must(supabase.from('uez_zone_businesses').update({ on_due_report: false, on_late_report: false, report_days_late: null }).or('on_due_report.eq.true,on_late_report.eq.true'));

  const byFile = new Map();
  const base = (r) => ({
    file_no: r.file_no,
    zone_name: r.zone_name,
    permit_no: r.permit_no,
    trade_name: r.trade_name,
    cert_date: r.cert_date,
    report_type: r.report_type,
    report_next_due: r.next_due,
    ft_orig: r.ft_orig,
    ft_curr: r.ft_curr,
    report_contact_name: r.contact_name,
    report_contact_phone: r.contact_phone,
    report_contact_email: r.contact_email,
    report_synced_at: nowIso(),
    updated_at: nowIso()
  });
  for (const r of due.rows) byFile.set(r.file_no, { ...base(r), on_due_report: true, on_late_report: false, report_days_late: null });
  for (const r of late.rows) byFile.set(r.file_no, { ...(byFile.get(r.file_no) || {}), ...base(r), on_late_report: true, on_due_report: byFile.has(r.file_no), report_days_late: r.days_late });

  // Don't overwrite a better name from the zone listing; only fill name for businesses we haven't seen.
  const rows = [...byFile.values()];
  const known = new Set();
  for (const ids of chunk(rows.map((r) => r.file_no), 500)) {
    for (const d of await must(supabase.from('uez_zone_businesses').select('file_no').in('file_no', ids))) known.add(d.file_no);
  }
  const corp = new Map([...due.rows, ...late.rows].map((r) => [r.file_no, r.corp_name]));
  const insertsNew = rows.filter((r) => !known.has(r.file_no)).map((r) => ({ ...r, name: corp.get(r.file_no), status: 'A' }));
  const updatesKnown = rows.filter((r) => known.has(r.file_no));
  for (const part of chunk(insertsNew, 500)) await must(supabase.from('uez_zone_businesses').insert(part));
  for (const part of chunk(updatesKnown, 500)) await must(supabase.from('uez_zone_businesses').upsert(part, { onConflict: 'file_no' }));
}

async function syncDetails(portal, zoneName, zoneId, stats) {
  const cutoff = new Date(Date.now() - DETAIL_MAX_AGE_DAYS * 864e5).toISOString();
  const candidates = await must(supabase.from('uez_zone_businesses')
    .select('file_no, status, detail_synced_at, on_due_report, on_late_report')
    .eq('zone_name', zoneName).eq('status', 'A').eq('in_zone_listing', true)
    .or(`detail_synced_at.is.null,detail_synced_at.lt.${cutoff}`)
    .limit(5000));
  // Late and due-soon first, then never-fetched, then oldest.
  candidates.sort((a, b) => (Number(b.on_late_report) - Number(a.on_late_report))
    || (Number(b.on_due_report) - Number(a.on_due_report))
    || (a.detail_synced_at ? 1 : 0) - (b.detail_synced_at ? 1 : 0)
    || String(a.detail_synced_at).localeCompare(String(b.detail_synced_at)));

  let done = 0; let failed = 0;
  for (const c of candidates.slice(0, DETAIL_BATCH)) {
    try {
      const d = parseDetail(await portal.fetchDetailHtml(c.file_no, zoneId, c.status));
      if (d.zone_id && !zoneId) zoneId = d.zone_id;
      await must(supabase.from('uez_zone_businesses').update({
        trade_name: d.trade_name, phone: d.phone, email: d.email || undefined, owner_name: d.owner_name, owner_title: d.owner_title,
        street: d.street, city: d.city, state: d.state, zip: d.zip, block: d.block, lot: d.lot, mailing_address: d.mailing_address,
        sic_desc: d.sic_desc, naics_desc: d.naics_desc, nature: d.nature, entity_type: d.entity_type, business_size: d.business_size,
        began_date: d.began_date, minority_owned: d.minority_owned, women_owned: d.women_owned, new_business: d.new_business,
        next_annual_due: d.next_annual_due, next_recert_due: d.next_recert_due,
        employment: d.employment, state_notes: d.state_notes,
        detail_synced_at: nowIso(), updated_at: nowIso()
      }).eq('file_no', c.file_no));
      done++;
    } catch (e) {
      failed++;
      if (e.code === 'http' && failed > 10) throw e;
    }
  }
  stats.details = done;
  stats.details_failed = failed;
  stats.details_remaining = Math.max(0, candidates.length - done);
  return zoneId;
}

async function runZoneSync(orgId, trigger = 'manual') {
  if (running.has(orgId)) return { alreadyRunning: true };
  running.add(orgId);
  const org = await must(supabase.from('uez_zone_orgs').select('*').eq('id', orgId).single());
  const run = await must(supabase.from('uez_zone_sync_runs').insert({ org_id: orgId, zone_name: org.zone_name, trigger }).select('id').single());
  const stats = {};
  try {
    const login = await getPortalLogin(orgId);
    if (!login) throw new PortalError('no_login', 'No UEZ portal login saved for this organization.');
    const portal = new UezPortal({ username: login.username, password: login.password });
    try {
      const info = await portal.login();
      if (org.zone_name && info.zoneName !== org.zone_name) {
        throw new PortalError('wrong_zone', `The saved login is currently set to ${info.zoneName}, not ${org.zone_name}. Switch it back in the UEZ portal.`);
      }
      const zone = await must(supabase.from('uez_zones').select('*').eq('name', info.zoneName).maybeSingle());
      await syncListing(portal, info.zoneName, stats);
      await syncReports(portal, stats);
      const zoneId = await syncDetails(portal, info.zoneName, zone?.state_zone_id, stats);
      if (zoneId && !zone?.state_zone_id) await must(supabase.from('uez_zones').update({ state_zone_id: zoneId }).eq('name', info.zoneName));
    } finally {
      await portal.logout();
    }
    await must(supabase.from('uez_zone_portal_logins').update({ status: 'ok', last_checked_at: nowIso(), last_error: null }).eq('org_id', orgId));
    await must(supabase.from('uez_zone_sync_runs').update({ status: 'ok', stats, finished_at: nowIso() }).eq('id', run.id));
    return { ok: true, stats };
  } catch (e) {
    const message = e.message || String(e);
    if (e.code === 'bad_credentials' || e.code === 'wrong_zone') {
      await supabase.from('uez_zone_portal_logins').update({ status: 'failed', last_checked_at: nowIso(), last_error: message }).eq('org_id', orgId);
    }
    await supabase.from('uez_zone_sync_runs').update({ status: 'failed', stats, error: message, finished_at: nowIso() }).eq('id', run.id);
    return { ok: false, error: message, code: e.code };
  } finally {
    running.delete(orgId);
  }
}

// Nightly: once per day per org, between 1am and 5am Eastern.
function startZoneSyncScheduler() {
  if (process.env.UEZ_ZONE_SYNC_DISABLED === '1') return;
  const tick = async () => {
    try {
      const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date()));
      if (hour < 1 || hour >= 5) return;
      const logins = await must(supabase.from('uez_zone_portal_logins').select('org_id, status').neq('status', 'failed'));
      const since = new Date(Date.now() - 20 * 3600e3).toISOString();
      for (const l of logins) {
        const recent = await must(supabase.from('uez_zone_sync_runs').select('id').eq('org_id', l.org_id).eq('trigger', 'nightly').gte('started_at', since).limit(1));
        if (!recent.length) await runZoneSync(l.org_id, 'nightly');
      }
    } catch (e) {
      console.error('UEZ zone scheduler error:', e.message);
    }
  };
  setInterval(tick, 15 * 60 * 1000);
  setTimeout(tick, 60 * 1000);
}

function isSyncRunning(orgId) { return running.has(orgId); }

module.exports = { runZoneSync, savePortalLogin, startZoneSyncScheduler, isSyncRunning, getPortalLogin };
