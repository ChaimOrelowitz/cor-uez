// Zone dashboard API (/api/uez/zone). Any member can READ every zone (DCA allows cross-zone visibility);
// outreach (logging contact, notes) is limited to the member's own zone.
const express = require('express');
const supabase = require('../db/supabase');
const { requireUezAuth } = require('../middleware/uezAuth');
const { runZoneSync, savePortalLogin, isSyncRunning, runInactiveBackfill, runDetailBackfill, isBackfilling } = require('../services/uezZoneSync');
const { reminderEmail, sendBusinessEmail, sendViaResend, loadTemplates, previewTemplate, DEFAULT_TEMPLATES, MERGE_FIELDS } = require('../services/uezEmail');
const { createInvite, loginStatusMap } = require('../services/uezBusinessLogin');

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

// ---------- Deadline math (shared) ----------
const { DAY, deadlineFor, isFirstTimer } = require('../services/uezDeadline');

const LIST_COLUMNS = 'file_no, zone_name, permit_no, name, trade_name, status, cert_date, last_annual_date, last_recert_date, next_annual_due, next_recert_due, email, phone, owner_name, street, sic_code, naics_code, naics_desc, report_type, report_next_due, report_days_late, on_due_report, on_late_report, ft_orig, ft_curr, report_contact_name, report_contact_phone, report_contact_email, new_business, in_zone_listing, detail_synced_at';

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
  const mynjUsername = String(req.body.mynjUsername || '').trim();
  const mynjPassword = String(req.body.mynjPassword || '');
  if (!mynjUsername || !mynjPassword) throw httpError(400, 'Enter the myNJ login ID and password.');
  if (!username || !password) throw httpError(400, 'Enter the UEZ portal username and password.');
  try {
    const info = await savePortalLogin(org.id, { mynjUsername, mynjPassword, username, password, userId: req.user.id });
    runZoneSync(org.id, 'connect').catch((e) => console.error('initial sync failed', e));
    res.json({ ok: true, ...info });
  } catch (e) {
    const messages = {
      bad_credentials: 'The UEZ portal rejected that username or password.',
      bad_mynj: 'myNJ rejected that login ID or password.',
      blocked: 'myNJ\'s bot protection blocked the server login.',
      mynj_session: 'Logged into myNJ, but the UEZ portal did not accept it.',
      layout: 'Reached the UEZ portal, but the page looked different than expected. Tell COR Solutions.',
      http: 'Could not reach the UEZ portal right now. Try again in a few minutes.'
    };
    console.error('portal login test failed:', e.code, e.message);
    const friendly = messages[e.code] || 'Something went wrong talking to the UEZ portal.';
    throw httpError(e.code ? 400 : 500, `${friendly} (Details: ${e.message})`);
  }
}));

router.post('/orgs/:orgId/sync', wrap(async (req, res) => {
  const org = await loadOrg(req);
  if (isSyncRunning(org.id)) return res.status(202).json({ started: false, syncing: true });
  runZoneSync(org.id, 'manual').catch((e) => console.error('manual sync failed', e));
  res.status(202).json({ started: true, syncing: true });
}));

// One-time historical backfill of inactive businesses' inactivation dates.
router.post('/orgs/:orgId/backfill-inactive', wrap(async (req, res) => {
  const org = await loadOrg(req);
  if (org.role !== 'admin') throw httpError(403, 'Admin only.');
  if (isBackfilling(org.id)) return res.status(202).json({ started: false, running: true });
  runInactiveBackfill(org.id).catch((e) => console.error('backfill failed', e));
  res.status(202).json({ started: true, running: true });
}));

// Load full detail profiles for every business in the zone listing (active + inactive).
router.post('/orgs/:orgId/backfill-details', wrap(async (req, res) => {
  const org = await loadOrg(req);
  if (org.role !== 'admin') throw httpError(403, 'Admin only.');
  if (isBackfilling(org.id)) return res.status(202).json({ started: false, running: true });
  runDetailBackfill(org.id).catch((e) => console.error('detail backfill failed', e));
  res.status(202).json({ started: true, running: true });
}));

router.get('/orgs/:orgId/backfill-details/status', wrap(async (req, res) => {
  const org = await loadOrg(req);
  const countOf = async (q) => { const { count, error } = await q; if (error) throw error; return count || 0; };
  const total = await countOf(supabase.from('uez_zone_businesses').select('file_no', { count: 'exact', head: true }).eq('zone_name', org.zone_name).eq('in_zone_listing', true));
  const done = await countOf(supabase.from('uez_zone_businesses').select('file_no', { count: 'exact', head: true }).eq('zone_name', org.zone_name).eq('in_zone_listing', true).not('detail_synced_at', 'is', null));
  res.json({ running: isBackfilling(org.id), total, done });
}));

router.get('/orgs/:orgId/backfill-inactive/status', wrap(async (req, res) => {
  const org = await loadOrg(req);
  const countOf = async (q) => { const { count, error } = await q; if (error) throw error; return count || 0; };
  const total = await countOf(supabase.from('uez_zone_businesses').select('file_no', { count: 'exact', head: true }).eq('zone_name', org.zone_name).eq('status', 'I'));
  const done = await countOf(supabase.from('uez_zone_businesses').select('file_no', { count: 'exact', head: true }).eq('zone_name', org.zone_name).eq('status', 'I').not('detail_synced_at', 'is', null));
  const withDate = await countOf(supabase.from('uez_zone_businesses').select('file_no', { count: 'exact', head: true }).eq('zone_name', org.zone_name).eq('status', 'I').not('inactivated_date', 'is', null));
  res.json({ running: isBackfilling(org.id), total, done, with_date: withDate });
}));

router.get('/orgs/:orgId/businesses', wrap(async (req, res) => {
  const org = await loadOrg(req);
  const zone = String(req.query.zone || org.zone_name || '').toUpperCase();
  if (!zone) return res.json({ zone: null, businesses: [] });
  const rows = await fetchAll(() => supabase.from('uez_zone_businesses').select(LIST_COLUMNS).eq('zone_name', zone).order('file_no'));

  let lastTouch = new Map();
  let logins = new Map();
  if (zone === org.zone_name && rows.length) {
    const touches = await fetchAll(() => supabase.from('uez_zone_outreach').select('file_no, created_at, channel, outcome, follow_up_on')
      .eq('org_id', org.id).order('created_at', { ascending: false }));
    for (const t of touches) if (!lastTouch.has(t.file_no)) lastTouch.set(t.file_no, t);
    logins = await loginStatusMap(org.id);
  }
  res.json({
    zone,
    own_zone: zone === org.zone_name,
    has_full_roster: rows.some((r) => r.in_zone_listing),
    businesses: rows.map((b) => ({ ...shape(b, org.zone_name), last_outreach: lastTouch.get(b.file_no) || null, login_status: logins.get(b.file_no)?.status || null }))
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
  let login = null;
  if (own) {
    const row = await must(supabase.from('uez_zone_business_logins')
      .select('status, last_verified_at, invited_to, submitted_at, updated_at').eq('file_no', b.file_no).eq('org_id', org.id).maybeSingle());
    login = row || null; // never includes credentials
  }
  res.json({ business: shape(b, org.zone_name), events, outreach, login });
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

// ---------- Home summary (Concept A) ----------
function startOfMonthIso() { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); }

router.get('/orgs/:orgId/home', wrap(async (req, res) => {
  const org = await loadOrg(req);
  const zone = org.zone_name;
  if (!zone) return res.json({ zone: null });
  const rows = await fetchAll(() => supabase.from('uez_zone_businesses').select(LIST_COLUMNS).eq('zone_name', zone));
  const touches = await fetchAll(() => supabase.from('uez_zone_outreach').select('file_no, created_at, outcome, channel, follow_up_on').eq('org_id', org.id).order('created_at', { ascending: false }));
  const lastTouch = new Map();
  for (const t of touches) if (!lastTouch.has(t.file_no)) lastTouch.set(t.file_no, t);

  const shaped = rows.map((b) => ({ ...shape(b, zone), last_outreach: lastTouch.get(b.file_no) || null }));
  const active = shaped.filter((b) => b.status !== 'I');
  const counts = { late: 0, due_30: 0, due_60: 0, due_90: 0, ok: 0 };
  for (const b of active) counts[b.bucket] = (counts[b.bucket] || 0) + 1;

  const today = new Date().toISOString().slice(0, 10);

  // How many reminders have actually gone out per business (from the email log).
  const sent = new Map();
  const emailLog = await fetchAll(() => supabase.from('uez_zone_email_log').select('file_no, kind').eq('org_id', org.id).like('kind', 'reminder%'));
  for (const e of emailLog) if (e.file_no) sent.set(e.file_no, (sent.get(e.file_no) || 0) + 1);

  const row = (b) => ({
    file_no: b.file_no, name: b.trade_name || b.name, deadline_type: b.deadline_type, deadline: b.deadline, days: b.days,
    other: b.other, contact_name: b.contact_name, contact_phone: b.contact_phone, contact_email: b.contact_email,
    last_outreach: b.last_outreach, has_email: !!b.contact_email, first_timer: isFirstTimer(b), reminders_sent: sent.get(b.file_no) || 0
  });

  // THE worklist: next UEZ filing due within 14 days, most pressing first. That's Moshe's day.
  const callThisWeek = active
    .filter((b) => b.days != null && b.days >= 0 && b.days <= 14)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
    .map(row);

  // Just missed the deadline (1–90 days late, not yet on the state's late list) — call these now, they're savable.
  const recentlyOverdue = active
    .filter((b) => b.days != null && b.days < 0 && b.days >= -90 && !b.on_late_report)
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0)) // freshest miss first
    .map(row);

  // Long overdue (90+ days, or on the state's late report) — mostly closed, cleanup.
  const longOverdue = active
    .filter((b) => b.on_late_report || (b.days != null && b.days < -90))
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
    .map(row);

  const monthStart = startOfMonthIso();
  const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
  const thirtyAgo = new Date(Date.now() - 30 * DAY).toISOString();
  const windowStart = monthStart < thirtyAgo ? monthStart : thirtyAgo;
  const events = await must(supabase.from('uez_zone_business_events')
    .select('kind, file_no, detected_at, uez_zone_businesses(name, trade_name)')
    .eq('zone_name', zone).gte('detected_at', windowStart).order('detected_at', { ascending: false }));
  const recerts = events.filter((e) => e.kind === 'recertified' && e.detected_at >= monthStart);
  // Signups: rolling 30 days (not calendar month).
  const newBiz = events.filter((e) => e.kind === 'new_business' && e.detected_at >= thirtyAgo);
  const recentActivity = await must(supabase.from('uez_zone_business_events')
    .select('kind, file_no, detected_at, uez_zone_businesses(name, trade_name)')
    .eq('zone_name', zone).order('detected_at', { ascending: false }).limit(8));

  // Businesses the state inactivated in the last 30 days (from the real inactivation date).
  const thirtyAgoDate = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const lostRows = await must(supabase.from('uez_zone_businesses')
    .select('file_no, name, trade_name, inactivated_date')
    .eq('zone_name', zone).gte('inactivated_date', thirtyAgoDate).order('inactivated_date', { ascending: false }).limit(50));
  const lostRecently = lostRows.map((b) => ({ file_no: b.file_no, name: b.trade_name || b.name, detected_at: b.inactivated_date }));

  // Emails the platform processed this week (sent, or logged in test mode) — proof it's working.
  const weekEmails = await fetchAll(() => supabase.from('uez_zone_email_log').select('id, kind').eq('org_id', org.id).gte('created_at', weekAgo));
  const remindersThisWeek = weekEmails.filter((e) => String(e.kind).startsWith('reminder')).length;

  // Retention: active businesses currently in good standing (not overdue).
  const retentionRate = active.length ? Math.round(((active.length - counts.late) / active.length) * 100) : null;

  const last = await must(supabase.from('uez_zone_sync_runs').select('finished_at, status, stats').eq('org_id', org.id).eq('status', 'ok').order('started_at', { ascending: false }).limit(1));
  res.json({
    zone,
    active_count: active.length,
    counts,
    call_this_week: callThisWeek,
    recently_overdue: recentlyOverdue,
    long_overdue: longOverdue,
    due_30: counts.due_30,
    signups_this_month: newBiz.length,
    recertified_this_month: recerts.length,
    recert_names: recerts.slice(0, 12).map((e) => e.uez_zone_businesses?.trade_name || e.uez_zone_businesses?.name).filter(Boolean),
    reminders_this_week: remindersThisWeek,
    retention_rate: retentionRate,
    lost_recently: lostRecently,
    follow_ups_due: active.filter((b) => b.last_outreach?.follow_up_on && b.last_outreach.follow_up_on <= today).length,
    recent_activity: recentActivity,
    last_synced: last[0]?.finished_at || null
  });
}));

// ---------- Stats board (overall activity over time) ----------
router.get('/orgs/:orgId/stats', wrap(async (req, res) => {
  const org = await loadOrg(req);
  const zone = org.zone_name;
  if (!zone) return res.json({ zone: null });
  const now = new Date();
  const thirtyAgo = new Date(now - 30 * DAY).toISOString();
  const sevenAgo = new Date(now - 7 * DAY).toISOString();
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
  // Go back 13 months so we always have 12 full calendar months behind us.
  const monthsBack = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1)).toISOString();
  const fetchStart = monthsBack < yearStart ? monthsBack : yearStart;

  const events = await fetchAll(() => supabase.from('uez_zone_business_events')
    .select('kind, detected_at').eq('zone_name', zone).gte('detected_at', fetchStart));
  const emails = await fetchAll(() => supabase.from('uez_zone_email_log')
    .select('kind, created_at').eq('org_id', org.id).gte('created_at', fetchStart).like('kind', 'reminder%'));

  // Count a set of timestamps in each window.
  const windows = (stamps) => ({
    rolling_30: stamps.filter((t) => t >= thirtyAgo).length,
    rolling_7: stamps.filter((t) => t >= sevenAgo).length,
    ytd: stamps.filter((t) => t >= yearStart).length
  });
  const stampsFor = (pred) => events.filter(pred).map((e) => e.detected_at);
  const recertStamps = stampsFor((e) => e.kind === 'recertified');
  const annualStamps = stampsFor((e) => e.kind === 'annual_filed');
  const signupStamps = stampsFor((e) => e.kind === 'new_business');
  const inactivStamps = stampsFor((e) => e.kind === 'inactivated');
  const filingStamps = [...recertStamps, ...annualStamps];
  const reminderStamps = emails.map((e) => e.created_at);

  // 12-month calendar series (oldest → newest) for filings, signups, recerts.
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const lo = d.toISOString(), hi = next.toISOString();
    const inM = (stamps) => stamps.filter((t) => t >= lo && t < hi).length;
    months.push({
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
      filings: inM(filingStamps), signups: inM(signupStamps), recerts: inM(recertStamps)
    });
  }

  res.json({
    zone,
    metrics: {
      filings: windows(filingStamps),
      recerts: windows(recertStamps),
      annuals: windows(annualStamps),
      signups: windows(signupStamps),
      inactivations: windows(inactivStamps),
      reminders: windows(reminderStamps)
    },
    months
  });
}));

// ---------- Zone settings (email identity) ----------
const SETTINGS_FIELDS = ['from_name', 'reply_to', 'signature', 'recert_video_url', 'pbs_login_url', 'send_thankyou', 'email_live', 'test_recipient'];

router.get('/orgs/:orgId/settings', wrap(async (req, res) => {
  const org = await loadOrg(req);
  const row = await must(supabase.from('uez_zone_orgs').select(`id, name, zone_name, ${SETTINGS_FIELDS.join(', ')}, reminder_days`).eq('id', org.id).single());
  res.json({ settings: row, can_edit: org.role === 'admin', resend_configured: !!process.env.RESEND_API_KEY });
}));

router.put('/orgs/:orgId/settings', wrap(async (req, res) => {
  const org = await loadOrg(req);
  if (org.role !== 'admin') throw httpError(403, 'Only your organization admin can change settings.');
  const patch = {};
  for (const f of SETTINGS_FIELDS) if (f in req.body) patch[f] = req.body[f] === '' ? null : req.body[f];
  if ('reminder_days' in req.body && Array.isArray(req.body.reminder_days)) {
    patch.reminder_days = req.body.reminder_days.map(Number).filter((n) => n > 0 && n < 400);
  }
  const row = await must(supabase.from('uez_zone_orgs').update(patch).eq('id', org.id).select(`id, name, zone_name, ${SETTINGS_FIELDS.join(', ')}, reminder_days`).single());
  res.json({ settings: row });
}));

// ---------- Editable email templates ----------
const TEMPLATE_KINDS = ['reminder_ar', 'reminder_recert', 'thankyou'];

router.get('/orgs/:orgId/templates', wrap(async (req, res) => {
  const org = await loadOrg(req);
  const settings = await must(supabase.from('uez_zone_orgs').select('*').eq('id', org.id).single());
  const stored = await loadTemplates(org.id);
  const templates = TEMPLATE_KINDS.map((kind) => {
    const t = stored[kind] || DEFAULT_TEMPLATES[kind];
    const preview = previewTemplate(kind, { ...settings, templates: stored });
    return { kind, subject: t.subject, body: t.body, is_default: !stored[kind], preview };
  });
  res.json({ templates, merge_fields: MERGE_FIELDS, can_edit: org.role === 'admin', defaults: DEFAULT_TEMPLATES });
}));

router.put('/orgs/:orgId/templates/:kind', wrap(async (req, res) => {
  const org = await loadOrg(req);
  if (org.role !== 'admin') throw httpError(403, 'Only your organization admin can edit templates.');
  const kind = req.params.kind;
  if (!TEMPLATE_KINDS.includes(kind)) throw httpError(400, 'Unknown template.');
  const subject = String(req.body.subject || '').trim();
  const body = String(req.body.body || '').trim();
  if (!subject || !body) throw httpError(400, 'Subject and body are required.');
  await must(supabase.from('uez_zone_email_templates').upsert({ org_id: org.id, kind, subject, body, updated_at: new Date().toISOString(), updated_by: req.user.id }, { onConflict: 'org_id,kind' }));
  const settings = await must(supabase.from('uez_zone_orgs').select('*').eq('id', org.id).single());
  const preview = previewTemplate(kind, { ...settings, templates: await loadTemplates(org.id) });
  res.json({ ok: true, preview });
}));

router.delete('/orgs/:orgId/templates/:kind', wrap(async (req, res) => {
  const org = await loadOrg(req);
  if (org.role !== 'admin') throw httpError(403, 'Admin only.');
  await must(supabase.from('uez_zone_email_templates').delete().eq('org_id', org.id).eq('kind', req.params.kind));
  res.json({ ok: true });
}));

// ---------- My profile ----------
router.get('/me/profile', wrap(async (req, res) => {
  const row = await must(supabase.from('uez_zone_members').select('org_id, role, first_name, last_name, phone, email').eq('user_id', req.user.id));
  res.json({ email: req.user.email, memberships: row });
}));

router.put('/me/profile', wrap(async (req, res) => {
  const patch = {};
  for (const f of ['first_name', 'last_name', 'phone']) if (f in req.body) patch[f] = String(req.body[f] || '').slice(0, 120) || null;
  patch.email = req.user.email;
  await must(supabase.from('uez_zone_members').update(patch).eq('user_id', req.user.id));
  res.json({ ok: true });
}));

// ---------- Send a reminder now ----------
router.post('/orgs/:orgId/businesses/:fileNo/send-reminder', wrap(async (req, res) => {
  const org = await loadOrg(req);
  const settings = await must(supabase.from('uez_zone_orgs').select('*').eq('id', org.id).single());
  const b = await must(supabase.from('uez_zone_businesses').select('*').eq('file_no', req.params.fileNo).maybeSingle());
  if (!b) throw httpError(404, 'Business not found.');
  if (b.zone_name !== org.zone_name) throw httpError(403, `This business is in ${b.zone_name}. You can only email businesses in ${org.zone_name}.`);
  const biz = shape(b, org.zone_name);
  settings.templates = await loadTemplates(org.id);
  const built = reminderEmail(biz, settings);
  const sender = { user_id: req.user.id, email: req.user.email };
  const result = await sendBusinessEmail({ org: settings, biz, built, sender });
  if (result.status === 'failed') throw httpError(400, result.error);
  // Log it on the outreach timeline too.
  await supabase.from('uez_zone_outreach').insert({
    file_no: b.file_no, org_id: org.id, user_id: req.user.id, user_email: req.user.email,
    channel: 'email', outcome: result.status === 'sent' ? 'reminder_sent' : 'reminder_test',
    note: `${built.kind === 'reminder_recert' ? 'Recert' : 'Annual'} reminder ${result.status === 'sent' ? 'emailed' : 'tested'} → ${result.to}`
  });
  res.json(result);
}));

// ---------- Request a business's PBS login (sends the capture link) ----------
router.post('/orgs/:orgId/businesses/:fileNo/request-login', wrap(async (req, res) => {
  const org = await loadOrg(req);
  const settings = await must(supabase.from('uez_zone_orgs').select('*').eq('id', org.id).single());
  const result = await createInvite({ org: settings, fileNo: req.params.fileNo, userId: req.user.id, userEmail: req.user.email });
  // Log it on the outreach timeline so the office has a record.
  await supabase.from('uez_zone_outreach').insert({
    file_no: req.params.fileNo, org_id: org.id, user_id: req.user.id, user_email: req.user.email,
    channel: 'email', outcome: 'login_invite', note: `Sent assisted-recert login link → ${result.to}`
  });
  res.json(result);
}));

// ---------- Send a test email to yourself ----------
router.post('/orgs/:orgId/test-email', wrap(async (req, res) => {
  const org = await loadOrg(req);
  const settings = await must(supabase.from('uez_zone_orgs').select('*').eq('id', org.id).single());
  const to = String(req.body.to || req.user.email || '').trim();
  if (!to) throw httpError(400, 'No email address to send the test to.');
  try {
    const id = await sendViaResend({
      to,
      subject: `EZMinder test — ${settings.from_name || org.name}`,
      html: `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1e2733">This is a test email from EZMinder for <strong>${(settings.from_name || org.name).replace(/[<>&]/g, '')}</strong>. If you can read this, sending works. Replies go to ${settings.reply_to || req.user.email}.</div>`,
      fromName: settings.from_name || org.name,
      replyTo: settings.reply_to || req.user.email
    });
    await supabase.from('uez_zone_email_log').insert({ org_id: org.id, kind: 'test', to_email: to, subject: 'EZMinder test', status: 'sent', provider_id: id, sent_by: req.user.id });
    res.json({ ok: true, to, id });
  } catch (e) {
    await supabase.from('uez_zone_email_log').insert({ org_id: org.id, kind: 'test', to_email: to, subject: 'EZMinder test', status: 'failed', error: e.message, sent_by: req.user.id });
    throw httpError(400, e.message);
  }
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
