// Read side of the statewide (all-zones) data for the "All zones" page.
const supabase = require('../db/supabase');

async function must(q) { const { data, error } = await q; if (error) throw error; return data; }
async function fetchAll(build, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const data = await must(build().range(from, from + pageSize - 1));
    out.push(...data);
    if (data.length < pageSize) return out;
  }
}
const DAY = 864e5;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (isoDate, n) => iso(new Date(`${isoDate}T12:00:00Z`).getTime() + n * DAY);
const addMonths = (isoDate, n) => { const d = new Date(`${isoDate}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return iso(d); };

const ACTIVITY = ['cert', 'annual', 'recert', 'inactivated', 'total'];
function blank() { return { cert: 0, annual: 0, recert: 0, inactivated: 0, total: 0 }; }
function addWeek(acc, r) {
  acc.cert += r.cert_total || 0; acc.annual += r.ar_total || 0; acc.recert += r.rc_total || 0;
  acc.inactivated += r.inactivated || 0; acc.total += r.total || 0;
  return acc;
}

async function coverage() {
  const [first, last, month] = await Promise.all([
    must(supabase.from('uez_state_weekly').select('week_ending').order('week_ending', { ascending: true }).limit(1)),
    must(supabase.from('uez_state_weekly').select('week_ending').order('week_ending', { ascending: false }).limit(1)),
    must(supabase.from('uez_state_monthly').select('report_date').not('active_businesses', 'is', null).order('report_date', { ascending: false }).limit(1))
  ]);
  return { first_week: first[0]?.week_ending || null, last_week: last[0]?.week_ending || null, latest_month: month[0]?.report_date || null };
}

// Leaderboard for a date range, with the previous period of the same length for comparison.
async function overview({ from, to, ownZone }) {
  const cov = await coverage();
  to = to || cov.last_week || iso(Date.now());
  from = from || addDays(to, -6);
  const span = Math.round((new Date(to) - new Date(from)) / DAY) + 1;
  const prevTo = addDays(from, -1); const prevFrom = addDays(prevTo, -(span - 1));

  const [weeks, prevWeeks, current, dueLate] = await Promise.all([
    fetchAll(() => supabase.from('uez_state_weekly').select('week_ending, zone_name, cert_total, ar_total, rc_total, inactivated, total').gte('week_ending', from).lte('week_ending', to)),
    fetchAll(() => supabase.from('uez_state_weekly').select('week_ending, zone_name, cert_total, ar_total, rc_total, inactivated, total').gte('week_ending', prevFrom).lte('week_ending', prevTo)),
    fetchAll(() => supabase.from('uez_state_current').select('kind, zone_name')),
    fetchAll(() => supabase.from('uez_zone_businesses').select('zone_name, on_due_report, on_late_report').or('on_due_report.eq.true,on_late_report.eq.true'))
  ]);

  let latest = cov.latest_month; let monthly = []; let yearAgo = [];
  if (latest) {
    [monthly, yearAgo] = await Promise.all([
      must(supabase.from('uez_state_monthly').select('*').eq('report_date', latest)),
      must(supabase.from('uez_state_monthly').select('zone_name, active_businesses, ft_jobs, invest_total').eq('report_date', addMonths(latest, -12)))
    ]);
  }

  const zones = new Map();
  const z = (name) => {
    if (!zones.has(name)) zones.set(name, { zone: name, ...blank(), prev: blank(), tax_delinquent: 0, incomplete_apps: 0, due_60: 0, late: 0 });
    return zones.get(name);
  };
  for (const r of weeks) addWeek(z(r.zone_name), r);
  for (const r of prevWeeks) addWeek(z(r.zone_name).prev, r);
  for (const c of current) { const s = z(c.zone_name); if (c.kind === 'tax_delinquent') s.tax_delinquent++; else if (c.kind === 'incomplete_app') s.incomplete_apps++; }
  for (const b of dueLate) { if (!b.zone_name) continue; const s = z(b.zone_name); if (b.on_due_report) s.due_60++; if (b.on_late_report) s.late++; }
  const ago = new Map(yearAgo.map((r) => [r.zone_name, r]));
  for (const m of monthly) {
    const s = z(m.zone_name); const a = ago.get(m.zone_name);
    Object.assign(s, {
      active_businesses: m.active_businesses, ft_jobs: m.ft_jobs, pt_jobs: m.pt_jobs, new_ft_jobs: m.new_ft_jobs,
      invest_total: m.invest_total, invest_active: m.invest_active, sic_active: m.sic_active,
      active_yoy: a ? m.active_businesses - a.active_businesses : null,
      ft_yoy: a ? m.ft_jobs - a.ft_jobs : null,
      invest_yoy: a ? m.invest_total - a.invest_total : null
    });
  }
  const list = [...zones.values()].filter((s) => s.zone && (s.total || s.active_businesses || s.prev.total));
  for (const s of list) { s.net = s.cert - s.inactivated; s.prev.net = s.prev.cert - s.prev.inactivated; }

  const totals = { ...blank(), net: 0, active_businesses: 0, ft_jobs: 0, invest_total: 0, tax_delinquent: 0, incomplete_apps: 0, due_60: 0, late: 0 };
  for (const s of list) for (const k of Object.keys(totals)) totals[k] += s[k] || 0;

  // Trend for the range: weekly buckets, or monthly when the range is longer than ~6 months.
  const monthlyBuckets = span > 190;
  const bucket = (w) => (monthlyBuckets ? `${w.slice(0, 7)}-01` : w);
  const trendMap = new Map();
  for (const r of weeks) {
    const k = bucket(r.week_ending);
    if (!trendMap.has(k)) trendMap.set(k, { period: k, state: 0, mine: 0, zones: new Set() });
    const t = trendMap.get(k); t.state += r.cert_total || 0; t.zones.add(r.zone_name);
    if (r.zone_name === ownZone) t.mine += r.cert_total || 0;
  }
  const trend = [...trendMap.values()].sort((a, b) => (a.period < b.period ? -1 : 1))
    .map((t) => ({ period: t.period, state: t.state, mine: t.mine, avg: t.zones.size ? t.state / t.zones.size : 0 }));

  return { range: { from, to }, prev: { from: prevFrom, to: prevTo }, bucket: monthlyBuckets ? 'month' : 'week', coverage: cov, latest_month: latest, zones: list, totals, trend };
}

// One zone's profile: long-run growth, recent weekly activity, industry mix and current lists.
async function zoneProfile(zone, ownZone) {
  const cov = await coverage();
  const since = cov.last_week ? addDays(cov.last_week, -7 * 103) : addDays(iso(Date.now()), -730);
  const [monthly, weekly, activity, current, stateLatest] = await Promise.all([
    fetchAll(() => supabase.from('uez_state_monthly').select('report_date, active_businesses, ft_jobs, pt_jobs, new_ft_jobs, invest_total, sic_active').eq('zone_name', zone).order('report_date')),
    fetchAll(() => supabase.from('uez_state_weekly').select('week_ending, cert_total, ar_total, rc_total, inactivated, total').eq('zone_name', zone).gte('week_ending', since).order('week_ending')),
    must(supabase.from('uez_state_activity').select('week_ending, kind, code, file_no, name').eq('zone_name', zone).order('week_ending', { ascending: false }).limit(400)),
    fetchAll(() => supabase.from('uez_state_current').select('kind, file_no, name, detail').eq('zone_name', zone)),
    cov.latest_month ? must(supabase.from('uez_state_monthly').select('sic_active').eq('report_date', cov.latest_month)) : []
  ]);
  const own = zone === ownZone;
  const stateMix = {};
  for (const r of stateLatest) for (const [k, v] of Object.entries(r.sic_active || {})) stateMix[k] = (stateMix[k] || 0) + v;
  return {
    zone, own, coverage: cov,
    monthly: monthly.filter((m) => m.active_businesses != null || m.sic_active),
    weekly,
    activity,
    tax_delinquent: current.filter((c) => c.kind === 'tax_delinquent').map((c) => ({ file_no: c.file_no, name: c.name, days: c.detail?.days_delinquent, last_filed: c.detail?.last_filed })),
    // Contacts on incomplete applications are shown for your own zone only.
    incomplete_apps: current.filter((c) => c.kind === 'incomplete_app').map((c) => ({
      file_no: c.file_no, name: c.name, type: c.detail?.type, started: c.detail?.started,
      ...(own ? { contact_name: c.detail?.contact_name, contact_phone: c.detail?.contact_phone, contact_email: c.detail?.contact_email } : {})
    })),
    state_sic: stateMix
  };
}

// "What's happening across NJ": the businesses behind the last N processed weeks.
async function feed({ weeks = 1 }) {
  const cov = await coverage();
  if (!cov.last_week) return { weeks: [], rows: [] };
  const from = addDays(cov.last_week, -7 * (Math.min(Math.max(Number(weeks) || 1, 1), 8) - 1));
  const rows = await fetchAll(() => supabase.from('uez_state_activity').select('week_ending, zone_name, kind, code, file_no, name').gte('week_ending', from).order('week_ending', { ascending: false }));
  return { from, to: cov.last_week, rows };
}

module.exports = { overview, zoneProfile, feed, ACTIVITY };
