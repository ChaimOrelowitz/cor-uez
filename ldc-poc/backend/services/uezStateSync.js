// Loads the portal's statewide (all-zones) reports into the uez_state_* tables.
// Weekly: Application Processing Summary + Detail per Friday processing date.
// Monthly: Investment & Employment Summary + industry (SIC) profile, active and inactive.
// Current: tax delinquencies and incomplete applications, replaced each run.
// Every load is recorded in uez_state_sync_log so the nightly run and backfill skip done periods.
const supabase = require('../db/supabase');
const { pdfToText } = require('./uezPortal');
const { runPortalReport } = require('./uezApexReports');
const P = require('./uezStateParsers');

async function must(q) { const { data, error } = await q; if (error) throw error; return data; }
function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
const nowIso = () => new Date().toISOString();
const iso = (d) => d.toISOString().slice(0, 10);
const us = (isoDate) => `${isoDate.slice(5, 7)}/${isoDate.slice(8, 10)}/${isoDate.slice(0, 4)}`;
const slash = (isoDate) => isoDate.replace(/-/g, '/');

// Earliest periods the portal's dropdowns offer.
const FIRST_MONTH = { investment: '2006-03-01', sic_active: '2010-04-01', sic_inactive: '2010-04-01' };

// Fridays (state processing days) from `from` to `to`, newest first.
function fridays(from, to = iso(new Date())) {
  const d = new Date(`${to}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 2) % 7)); // back to the last Friday
  const out = [];
  for (; iso(d) >= from; d.setUTCDate(d.getUTCDate() - 7)) out.push(iso(d));
  return out;
}

// First-of-month report dates from `from` to `to`, newest first.
function monthStarts(from, to = iso(new Date())) {
  const d = new Date(`${to.slice(0, 7)}-01T12:00:00Z`);
  const out = [];
  for (; iso(d) >= from; d.setUTCMonth(d.getUTCMonth() - 1)) out.push(iso(d));
  return out;
}

async function doneSet(kind) {
  const rows = await must(supabase.from('uez_state_sync_log').select('period').eq('kind', kind).eq('status', 'ok'));
  return new Set(rows.map((r) => r.period));
}

async function logRun(kind, period, status, rows, error = null) {
  await must(supabase.from('uez_state_sync_log').upsert({ kind, period, status, rows, error, synced_at: nowIso() }, { onConflict: 'kind,period' }));
}

async function upsert(table, rows, onConflict) {
  for (const part of chunk(rows, 500)) await must(supabase.from(table).upsert(part, { onConflict }));
}

// One Friday: per-zone counts plus the businesses behind them, cross-checked against each other.
async function loadWeek(portal, friday) {
  const sumRep = await runPortalReport(portal, { pageNo: 9, menu: ['P9_SELECT_LIST', '1'], opts: { P9_START_DTE: us(friday), P9_END_DTE: us(friday) }, request: 'SUBAPPSUM' });
  const sum = P.parseAppSummary(sumRep.text);
  await upsert('uez_state_weekly', sum.rows.map((r) => ({ week_ending: friday, ...r, synced_at: nowIso() })), 'week_ending,zone_name');
  await logRun('weekly', friday, 'ok', sum.rows.length);

  const detRep = await runPortalReport(portal, { pageNo: 9, menu: ['P9_SELECT_LIST', '2'], opts: { P9_FRI_PROCESSING_DTE: us(friday) }, request: 'SUBAPPDTL' });
  const det = P.parseAppDetail(detRep.text);
  const byKey = new Map(det.rows.map((r) => [`${r.file_no}|${r.kind}`, { week_ending: friday, zone_name: r.zone_name, file_no: r.file_no, kind: r.kind, code: r.code, name: r.name, synced_at: nowIso() }]));
  await must(supabase.from('uez_state_activity').delete().eq('week_ending', friday));
  await upsert('uez_state_activity', [...byKey.values()], 'week_ending,file_no,kind');
  // Detail should add up to the summary; note (don't fail) if the state's two reports disagree.
  const t = sum.totals;
  const k = (kind) => det.rows.filter((r) => r.kind === kind).length;
  const off = [['certified', t.cert_total], ['annual', t.ar_total], ['recertified', t.rc_total], ['inactivated', t.inactivated]].filter(([kind, n]) => k(kind) !== n);
  await logRun('activity', friday, 'ok', byKey.size, off.length ? `detail vs summary: ${off.map(([kind, n]) => `${kind} ${k(kind)}/${n}`).join(', ')}` : null);
  return { zones: sum.rows.length, businesses: byKey.size };
}

async function loadInvestment(portal, month) {
  const rep = await runPortalReport(portal, { pageNo: 13, menu: ['P13_ADHOC_LIST', '6'], opts: { P13_REPORT_DTE: slash(month) }, request: 'SUBINVESTRPT' });
  const inv = P.parseInvestment(rep.text);
  await upsert('uez_state_monthly', inv.rows.map((r) => ({ report_date: month, ...r, synced_at: nowIso() })), 'report_date,zone_name');
  await logRun('investment', month, 'ok', inv.rows.length);
  return inv.rows.length;
}

async function loadSic(portal, month, inactive) {
  const rep = await runPortalReport(portal, { pageNo: 13, menu: ['P13_ADHOC_LIST', '5'], opts: { P13_SIC_LIST: inactive ? '2' : '1', P13_REPORT_DTE3: slash(month) }, request: 'SUBSICCNTS' });
  const sic = P.parseSic(rep.text);
  const col = inactive ? 'sic_inactive' : 'sic_active';
  await upsert('uez_state_monthly', sic.rows.map(({ zone_name, ...counts }) => ({ report_date: month, zone_name, [col]: counts, synced_at: nowIso() })), 'report_date,zone_name');
  await logRun(col, month, 'ok', sic.rows.length);
  return sic.rows.length;
}

async function replaceCurrent(kind, items) {
  await must(supabase.from('uez_state_current').delete().eq('kind', kind));
  const byKey = new Map(items.map((i) => [i.item_key, { kind, ...i, synced_at: nowIso() }]));
  await upsert('uez_state_current', [...byKey.values()], 'kind,item_key');
  return byKey.size;
}

async function loadCurrent(portal) {
  const tax = P.parseTaxDelinquent(await pdfToText(await portal.fetchReportPdf('UEZTAXDELINQW.RDF')));
  const nTax = await replaceCurrent('tax_delinquent', tax.rows.map(({ file_no, name, zone_name, ...detail }) => ({ item_key: file_no, file_no, name, zone_name, detail })));
  const inc = P.parseIncompleteApps(await pdfToText(await portal.fetchReportPdf('UEZINCOMPAPPS.RDF')));
  const nInc = await replaceCurrent('incomplete_app', inc.rows.map(({ file_no, name, zone_name, ...detail }) => ({ item_key: file_no || `${zone_name}|${name}`, file_no, name, zone_name, detail })));
  await logRun('current', iso(new Date()), 'ok', nTax + nInc);
  return { tax_delinquent: nTax, incomplete_apps: nInc };
}

// Nightly: today's current lists, the last two Fridays (refreshed — the latest may not have been
// processed yet), and this month's / last month's snapshots if not loaded. About 6–10 reports.
async function syncStatewide(portal, stats) {
  const out = {};
  const today = iso(new Date());
  if (!(await doneSet('current')).has(today)) out.current = await loadCurrent(portal);
  const weeksDone = await doneSet('activity');
  for (const [i, f] of fridays(iso(new Date(Date.now() - 21 * 864e5))).entries()) {
    if (i < 2 || !weeksDone.has(f)) out[`week_${f}`] = await loadWeek(portal, f);
  }
  for (const kind of ['investment', 'sic_active', 'sic_inactive']) {
    const done = await doneSet(kind);
    for (const m of monthStarts(iso(new Date(Date.now() - 40 * 864e5)))) {
      if (done.has(m)) continue;
      out[`${kind}_${m}`] = kind === 'investment' ? await loadInvestment(portal, m) : await loadSic(portal, m, kind === 'sic_inactive');
    }
  }
  if (stats) stats.statewide = out;
  return out;
}

module.exports = { syncStatewide, loadWeek, loadInvestment, loadSic, loadCurrent, logRun, doneSet, fridays, monthStarts, FIRST_MONTH };
