// Zone dashboard API (/api/uez/zone). Any member can READ every zone (DCA allows cross-zone visibility);
// outreach (logging contact, notes) is limited to the member's own zone.
const express = require('express');
const supabase = require('../db/supabase');
const { requireUezAuth } = require('../middleware/uezAuth');
const { runZoneSync, savePortalLogin, isSyncRunning } = require('../services/uezZoneSync');

const router = express.Router();
router.use(requireUezAuth);

async function must(q) { const { data, error } = await q; if (error) throw error; return data; }
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error('uez zone route error:', e);
  res.status(e.status || 500).json({ error: e.message || 'Something went wrong.' });
});
const httpError = (status, message) => Object.assign(new Error(message), { status });

async function fetchAll(build, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const data = await must(build().range(from, from + pageSize - 1));
    out.push(...data);
    if (data.length < pageSize) return out;
  }
}

const isPlatformAdmin = (req) => req.user.role === 'admin';

async function myOrgs(req) {
  if (isPlatformAdmin(req)) {
    const orgs = await must(supabase.from('uez_zone_orgs').select('*').order('name'));
    return orgs.map((o) => ({ ...o, role: 'admin' }));
  }
  const rows = await must(supabase.from('uez_zone_members').select('role, uez_zone_orgs(*)').eq('user_id', req.user.id));
  return rows.filter((r) => r.uez_zone_orgs).map((r) => ({ ...r.uez_zone_orgs, role: r.role }));
}

// Loads req.org from :orgId and checks membership.
async function loadOrg(req) {
  const org = (await myOrgs(req)).find((o) => o.id === req.params.orgId);
  if (!org) throw httpError(403, 'You are not a member of this organization.');
  req.org = org;
  return org;
}

// ---------- Deadline math ----------
const DAY = 864e5;
function today() { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); }
function parse(d) { return d ? new Date(`${d}T00:00:00Z`) : null; }
function iso(d) { return d ? d.toISOString().slice(0, 10) : null; }

// Estimate when detail pages haven't synced: reports are due on the certification anniversary.
// The first one is a year after certification, and an anniversary already covered by an early filing is skipped.
function nextAnniversary(b, from) {
  const c = parse(b.cert_date);
  if (!c) return null;
  const d = new Date(Date.UTC(from.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate()));
  if (d < from) d.setUTCFullYear(d.getUTCFullYear() + 1);
  while (d <= c) d.setUTCFullYear(d.getUTCFullYear() + 1);
  const filed = [parse(b.last_annual_date), parse(b.last_recert_date)].filter(Boolean).sort((x, y) => y - x)[0];
  if (filed && (d - filed) / DAY < 300) d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

function deadlineFor(b, now = today()) {
  if (b.status === 'I') return { bucket: 'inactive', deadline: null, deadline_type: null, days: null };
  let deadline = null; let type = null; let source = null;
  if (b.on_late_report || b.on_due_report) {
    deadline = parse(b.report_next_due); type = b.report_type; source = 'state_report';
  } else {
    const a = parse(b.next_annual_due); const r = parse(b.next_recert_due);
    if (a || r) {
      if (r && (!a || r <= a)) { deadline = r; type = 'RCRT'; } else { deadline = a; type = 'AR'; }
      source = 'detail';
    } else {
      deadline = nextAnniversary(b, now); type = 'AR'; source = 'estimate';
    }
  }
  const days = deadline ? Math.round((deadline - now) / DAY) : null;
  let bucket = 'ok';
  if (b.on_late_report || (days !== null && days < 0)) bucket = 'late';
  else if (days !== null && days <= 30) bucket = 'due_30';
  else if ((days !== null && days <= 60) || b.on_due_report) bucket = 'due_60';
  else if (days !== null && days <= 90) bucket = 'due_90';
  return {
    bucket,
    deadline: iso(deadline),
    deadline_type: type,
    deadline_source: source,
    days: b.on_late_report && b.report_days_late != null ? -b.report_days_late : days
  };
}

const LIST_COLUMNS = 'file_no, zone_name, permit_no, name, trade_name, status, cert_date, last_annual_date, last_recert_date, next_annual_due, next_recert_due, email, phone, owner_name, street, sic_code, naics_code, naics_desc, report_type, report_next_due, report_days_late, on_due_report, on_late_report, ft_orig, ft_curr, report_contact_name, report_contact_phone, report_contact_email, in_zone_listing, detail_synced_at';

function shape(b, ownZone) {
  return {
    ...b,
    ...deadlineFor(b),
    contact_name: b.owner_name || b.report_contact_name || null,
    contact_phone: b.phone || b.report_contact_phone || null,
    contact_email: b.email || b.report_contact_email || null,
    can_contact: b.zone_name === ownZone
  };
}

// ---------- Routes ----------
router.get('/me', wrap(async (req, res) => {
  res.json({ email: req.user.email, isPlatformAdmin: isPlatformAdmin(req), orgs: await myOrgs(req) });
}));

router.get('/orgs/:orgId/status', wrap(async (req, res) => {
  const org = await loadOrg(req);
  const login = await must(supabase.from('uez_zone_portal_logins')
    .select('portal_user, status, last_checked_at, last_error, updated_at').eq('org_id', org.id).maybeSingle());
  const runs = await must(supabase.from('uez_zone_sync_runs').select('*').eq('org_id', org.id).order('started_at', { ascending: false }).limit(5));
  const zones = await must(supabase.from('uez_zones').select('name').order('name'));
  res.json({ org, login, runs, syncing: isSyncRunning(org.id), zones: zones.map((z) => z.name) });
}));

router.put('/orgs/:orgId/portal-login', wrap(async (req, res) => {
  const org = await loadOrg(req);
  if (org.role !== 'admin') throw httpError(403, 'Only your organization admin can change the portal login.');
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) throw httpError(400, 'Enter the UEZ portal username and password.');
  try {
    const info = await savePortalLogin(org.id, { username, password, userId: req.user.id });
    runZoneSync(org.id, 'connect').catch((e) => console.error('initial sync failed', e));
    res.json({ ok: true, ...info });
  } catch (e) {
    const messages = {
      bad_credentials: 'The UEZ portal rejected that username or password.',
      layout: 'Reached the UEZ portal, but the page looked different than expected. Tell COR Solutions.',
      http: 'Could not reach the UEZ portal right now. Try again in a few minutes.'
    };
    throw httpError(e.code ? 400 : 500, messages[e.code] || e.message);
  }
}));

router.post('/orgs/:orgId/sync', wrap(async (req, res) => {
  const org = await loadOrg(req);
  if (isSyncRunning(org.id)) return res.status(202).json({ started: false, syncing: true });
  runZoneSync(org.id, 'manual').catch((e) => console.error('manual sync failed', e));
  res.status(202).json({ started: true, syncing: true });
}));

router.get('/orgs/:orgId/businesses', wrap(async (req, res) => {
  const org = await loadOrg(req);
  const zone = String(req.query.zone || org.zone_name || '').toUpperCase();
  if (!zone) return res.json({ zone: null, businesses: [] });
  const rows = await fetchAll(() => supabase.from('uez_zone_businesses').select(LIST_COLUMNS).eq('zone_name', zone).order('file_no'));

  let lastTouch = new Map();
  if (zone === org.zone_name && rows.length) {
    const touches = await fetchAll(() => supabase.from('uez_zone_outreach').select('file_no, created_at, channel, outcome, follow_up_on')
      .eq('org_id', org.id).order('created_at', { ascending: false }));
    for (const t of touches) if (!lastTouch.has(t.file_no)) lastTouch.set(t.file_no, t);
  }
  res.json({
    zone,
    own_zone: zone === org.zone_name,
    has_full_roster: rows.some((r) => r.in_zone_listing),
    businesses: rows.map((b) => ({ ...shape(b, org.zone_name), last_outreach: lastTouch.get(b.file_no) || null }))
  });
}));

router.get('/orgs/:orgId/businesses/:fileNo', wrap(async (req, res) => {
  const org = await loadOrg(req);
  const b = await must(supabase.from('uez_zone_businesses').select('*').eq('file_no', req.params.fileNo).maybeSingle());
  if (!b) throw httpError(404, 'Business not found.');
  const own = b.zone_name === org.zone_name;
  const events = await must(supabase.from('uez_zone_business_events').select('*').eq('file_no', b.file_no).order('detected_at', { ascending: false }).limit(50));
  const outreach = own
    ? await must(supabase.from('uez_zone_outreach').select('*').eq('file_no', b.file_no).eq('org_id', org.id).order('created_at', { ascending: false }))
    : [];
  res.json({ business: shape(b, org.zone_name), events, outreach });
}));

const CHANNELS = new Set(['call', 'email', 'text', 'visit', 'note']);
router.post('/orgs/:orgId/businesses/:fileNo/outreach', wrap(async (req, res) => {
  const org = await loadOrg(req);
  const b = await must(supabase.from('uez_zone_businesses').select('file_no, zone_name').eq('file_no', req.params.fileNo).maybeSingle());
  if (!b) throw httpError(404, 'Business not found.');
  if (b.zone_name !== org.zone_name) throw httpError(403, `This business is in ${b.zone_name}. You can only reach out to businesses in ${org.zone_name}.`);
  const channel = String(req.body.channel || 'note');
  if (!CHANNELS.has(channel)) throw httpError(400, 'Unknown outreach type.');
  const row = await must(supabase.from('uez_zone_outreach').insert({
    file_no: b.file_no,
    org_id: org.id,
    user_id: req.user.id,
    user_email: req.user.email,
    channel,
    outcome: req.body.outcome || null,
    note: String(req.body.note || '').slice(0, 4000) || null,
    follow_up_on: req.body.follow_up_on || null
  }).select('*').single());
  res.json(row);
}));

router.get('/orgs/:orgId/activity', wrap(async (req, res) => {
  const org = await loadOrg(req);
  const events = await must(supabase.from('uez_zone_business_events').select('*, uez_zone_businesses(name)')
    .eq('zone_name', org.zone_name).order('detected_at', { ascending: false }).limit(100));
  res.json({ events });
}));

// Statewide comparison: per-zone counts only (no outreach content leaves a zone).
router.get('/orgs/:orgId/statewide', wrap(async (req, res) => {
  await loadOrg(req);
  const rows = await fetchAll(() => supabase.from('uez_zone_businesses')
    .select('zone_name, status, on_due_report, on_late_report, report_type, report_next_due, ft_curr, ft_orig, in_zone_listing'));
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const touches = await fetchAll(() => supabase.from('uez_zone_outreach').select('file_no, uez_zone_orgs(zone_name)').gte('created_at', since));

  const zones = new Map();
  const z = (name) => {
    if (!zones.has(name)) zones.set(name, { zone: name, due_60: 0, due_ar: 0, due_rcrt: 0, late: 0, due_jobs: 0, active: null, inactive: null, outreach_30d: 0 });
    return zones.get(name);
  };
  for (const r of rows) {
    const s = z(r.zone_name);
    if (r.on_due_report) { s.due_60++; if (r.report_type === 'RCRT') s.due_rcrt++; else s.due_ar++; s.due_jobs += r.ft_curr || 0; }
    if (r.on_late_report) s.late++;
    if (r.in_zone_listing) {
      if (r.status === 'A') s.active = (s.active || 0) + 1;
      if (r.status === 'I') s.inactive = (s.inactive || 0) + 1;
    }
  }
  for (const t of touches) { const name = t.uez_zone_orgs?.zone_name; if (name) z(name).outreach_30d++; }
  const list = [...zones.values()].map((s) => ({ ...s, late_rate: s.due_60 + s.late ? s.late / (s.due_60 + s.late) : 0 }));
  list.sort((a, b) => b.due_60 - a.due_60);
  const last = await must(supabase.from('uez_zone_businesses').select('report_synced_at').not('report_synced_at', 'is', null).order('report_synced_at', { ascending: false }).limit(1));
  res.json({ zones: list, as_of: last[0]?.report_synced_at || null });
}));

// ---------- Platform admin (COR) ----------
router.get('/admin/orgs', wrap(async (req, res) => {
  if (!isPlatformAdmin(req)) throw httpError(403, 'Admin access required');
  const orgs = await must(supabase.from('uez_zone_orgs').select('*, uez_zone_members(user_id, role), uez_zone_portal_logins(status, last_checked_at)').order('name'));
  res.json({ orgs });
}));

router.post('/admin/orgs', wrap(async (req, res) => {
  if (!isPlatformAdmin(req)) throw httpError(403, 'Admin access required');
  const name = String(req.body.name || '').trim();
  if (!name) throw httpError(400, 'Organization name is required.');
  res.json(await must(supabase.from('uez_zone_orgs').insert({ name }).select('*').single()));
}));

// Adds a member by email; sends a Supabase invite if they don't have an account yet.
router.post('/admin/orgs/:orgId/members', wrap(async (req, res) => {
  if (!isPlatformAdmin(req)) throw httpError(403, 'Admin access required');
  const email = String(req.body.email || '').trim().toLowerCase();
  const role = req.body.role === 'admin' ? 'admin' : 'staff';
  if (!email) throw httpError(400, 'Email is required.');
  let userId = null;
  for (let page = 1; page < 50 && !userId; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    userId = data.users.find((u) => (u.email || '').toLowerCase() === email)?.id || null;
    if (data.users.length < 200) break;
  }
  let invited = false;
  if (!userId) {
    const redirectTo = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/`;
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error) throw error;
    userId = data.user.id;
    invited = true;
  }
  await must(supabase.from('uez_zone_members').upsert({ org_id: req.params.orgId, user_id: userId, role }, { onConflict: 'org_id,user_id' }));
  res.json({ ok: true, invited, userId });
}));

module.exports = router;
module.exports.deadlineFor = deadlineFor;
