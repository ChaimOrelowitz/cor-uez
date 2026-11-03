// Parsers for the statewide (all-zones) UEZ portal reports, from `pdftotext -layout` text.
// Every parser that has a state-printed total checks itself against it and throws on mismatch,
// so a layout change can never silently load wrong numbers.
const { PortalError } = require('./uezPortal');

const NJ_ZONES = [
  'ASBURY PARK', 'BAYONNE', 'BRIDGETON', 'CAMDEN', 'CARTERET', 'EAST ORANGE', 'ELIZABETH', 'GLOUCESTER CITY',
  'GUTTENBERG', 'HILLSIDE', 'IRVINGTON', 'JERSEY CITY', 'KEARNY', 'LAKEWOOD', 'LONG BRANCH', 'MILLVILLE',
  'MOUNT HOLLY', 'NEW BRUNSWICK', 'NEWARK', 'NORTH BERGEN', 'NORTH WILDWOOD', 'ORANGE', 'PASSAIC', 'PATERSON',
  'PEMBERTON', 'PERTH AMBOY', 'PHILLIPSBURG', 'PLAINFIELD', 'PLEASANTVILLE', 'ROSELLE', 'TRENTON', 'UNION CITY',
  'VINELAND', 'WEST NEW YORK', 'WEST WILDWOOD', 'WILDWOOD', 'WILDWOOD CREST'
];

const int = (s) => Number(String(s).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
const usDate = (s) => { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return null; const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; };
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const longDate = (s) => { const m = String(s || '').match(/([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})/); return m ? `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// Map a zone name as printed (typos, trailing commas, wrapped) to the canonical zone name.
function canonZone(raw) {
  const z = String(raw || '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!z) return null;
  if (NJ_ZONES.includes(z)) return z;
  const prefix = [...NJ_ZONES].sort((a, b) => b.length - a.length).find((n) => z.startsWith(`${n} `)); // "LAKEWOOD NJ"
  if (prefix) return prefix;
  let best = null; let bestD = 3;
  for (const n of NJ_ZONES) { const dd = lev(z, n); if (dd < bestD) { best = n; bestD = dd; } }
  return best || z;
}

function checkTotals(label, rows, totals, cols) {
  if (!totals) throw new PortalError('parse', `${label}: no totals row found.`);
  for (const c of cols) {
    if (totals[c] == null) continue; // the state's total overflowed its column ("*****")
    const sum = rows.reduce((s, r) => s + (r[c] || 0), 0);
    if (Math.round(sum) !== Math.round(totals[c])) throw new PortalError('parse', `${label}: ${c} adds up to ${sum}, state total is ${totals[c]}.`);
  }
}

// One numeric row per zone: "ZONE NAME   n n n ..." (ints, money, negatives). Returns { rows, totals }.
function zoneTable(text, cols, totalLabel) {
  const rows = []; let totals = null;
  // A number, or "*****" where the state's PDF ran out of column width (read as null).
  const num = String.raw`(?:-?\$?-?[\d,]+|\*+)`;
  const re = new RegExp(String.raw`^\s*([A-Z][A-Za-z .:]+?)\s{2,}((?:${num}\s+){${cols.length - 1}}${num})\s*$`);
  for (const line of text.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    const nums = m[2].trim().split(/\s+/).map((s) => (/^\*+$/.test(s) ? null : int(s)));
    const row = Object.fromEntries(cols.map((c, i) => [c, nums[i]]));
    if (totalLabel.test(m[1])) totals = row;
    else rows.push({ zone_name: canonZone(m[1]), ...row });
  }
  return { rows, totals };
}

// Application Processing Summary (UEZAPPSUMNEW / UEZAPPSUMW): per-zone activity for a period.
const APP_SUMMARY_COLS = ['cert', 'cert_total', 'ar', 'ar_cond', 'ar_total', 'rc', 'rc_cond', 'retention', 'in_lieu', 'extension', 'rc_total', 'inactivated', 'total'];
function parseAppSummary(text) {
  const { rows, totals } = zoneTable(text, APP_SUMMARY_COLS, /^TOTALS/);
  checkTotals('Application Summary', rows, totals, APP_SUMMARY_COLS);
  const range = text.match(/(\d{2}\/\d{2}\/\d{4})\s+through\s+(\d{2}\/\d{2}\/\d{4})/);
  const week = text.match(/week ending on (\d{2}\/\d{2}\/\d{4})/i);
  return { period_start: usDate(range?.[1] || week?.[1]), period_end: usDate(range?.[2] || week?.[1]), rows, totals };
}

// Investment and Employment Summary (UEZINVESTSUM): per-zone monthly snapshot.
const INVEST_COLS = ['active_businesses', 'ft_jobs', 'pt_jobs', 'new_ft_jobs', 'new_pt_jobs', 'projected_ft', 'invest_active', 'invest_inactive', 'invest_total', 'revenue_projected'];
function parseInvestment(text) {
  const { rows, totals } = zoneTable(text, INVEST_COLS, /^Total/i);
  checkTotals('Investment Summary', rows, totals, INVEST_COLS);
  return { report_date: usDate((text.match(/Report Date of\s+(\d{2}\/\d{2}\/\d{4})/i) || [])[1]), rows, totals };
}

// Participating Company Profile by SIC (UEZSICACTIVEM / UEZSICINACTM): per-zone industry counts.
const SIC_COLS = ['agriculture', 'mining', 'construction', 'manufacturing', 'transport', 'wholesale', 'retail', 'finance', 'services', 'public_admin', 'nonclass', 'total'];
function parseSic(text) {
  const { rows, totals } = zoneTable(text, SIC_COLS, /^Total/i);
  checkTotals('SIC Profile', rows, totals, SIC_COLS);
  return { report_date: usDate((text.match(/Monthly Report of:\s+(\d{2}\/\d{2}\/\d{4})/i) || [])[1]), inactive: /Inactive Companies/i.test(text), rows, totals };
}

// Application Processing Detail (UEZAPPDETL / UEZAPPDETLW): the businesses behind the summary.
const DETAIL_KIND = { CERT: 'certified', ARPT: 'annual', RCRT: 'recertified', INACT: 'inactivated' };
function parseAppDetail(text) {
  const rows = []; let zone = null; let last = null;
  const re = /^\s*(.*?)\s*\b(ARPT|CERT|RCRT|INACT)\s+([A-Z](?: [A-Z])?)\s+(\d{3,6})\s+(.+?)\s*$/;
  for (const line of text.split('\n')) {
    if (!line.trim() || /^-{10,}/.test(line.trim())) { last = null; continue; }
    if (/Urban Enterprise Zone Program|Application Processing Detail|Process(?:ed)? (?:Date|for week)|ZONE\s+TYPE|Report run/i.test(line)) { last = null; continue; }
    const m = line.match(re);
    if (m) {
      if (m[1]) zone = canonZone(m[1]);
      last = { zone_name: zone, type: m[2], kind: DETAIL_KIND[m[2]], code: m[3].replace(/\s+/g, ''), file_no: m[4], name: m[5].replace(/\s+/g, ' ') };
      rows.push(last);
    } else if (last && /^\s{20,}\S/.test(line)) {
      last.name = `${last.name} ${line.trim()}`.replace(/\s+/g, ' ');
    }
  }
  const date = text.match(/(?:Process Date|week ending):?\s+(\d{2}\/\d{2}\/\d{4})/i);
  return { week_ending: usDate(date?.[1]), rows };
}

// Companies With Tax Delinquencies — All Zones (UEZTAXDELINQW).
function parseTaxDelinquent(text) {
  const rows = [];
  const re = /^(\d{3,6})\s+(.+?)\s+([A-Z][a-z]{2} \d{2}, \d{4})\s+(\d+)\s+(\S+)\s+(\S+)\s*$/;
  const zonesLongestFirst = [...NJ_ZONES].sort((a, b) => b.length - a.length);
  for (const line of text.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    const mid = m[2].replace(/,\s*$/, '');
    let zone = zonesLongestFirst.find((z) => new RegExp(`\\s${z.replace(/ /g, '\\s+')},?$`).test(` ${mid}`));
    let name = zone ? mid.replace(new RegExp(`\\s+${zone.replace(/ /g, '\\s+')},?$`), '') : mid;
    if (!zone) { const parts = mid.split(/\s{2,}/); zone = canonZone(parts.pop()); name = parts.join(' '); }
    rows.push({ file_no: m[1], name: name.replace(/\s+/g, ' ').trim(), zone_name: zone, last_filed: longDate(m[3]), days_delinquent: Number(m[4]), nj_tax: m[5], detail_code: m[6] });
  }
  const total = Number((text.match(/Total number of businesses with tax delinquencies:\s*(\d+)/i) || [])[1]);
  if (Number.isFinite(total) && total !== rows.length) throw new PortalError('parse', `Tax Delinquencies: read ${rows.length} of ${total} rows.`);
  return { rows };
}

// Incomplete Online Application Report (UEZINCOMPAPPS), all zones.
function parseIncompleteApps(text) {
  const rows = []; let zone = null; let last = null; let zoneLine = null;
  const re = /^(.*?)\s*\b(AR|RCRT|CERT)\s+(\d{3,6})?\s+(.+?)\s+(\d{2}\/\d{2}\/\d{2})\s+(.+?)\s+(\d{3}-\d{3}-\d{4})?\s*(\S+@\S+)?\s*$/;
  for (const line of text.split('\n')) {
    if (!line.trim() || /Urban Enterprise Zone Program|Incomplete Online Application|Report run|ZONE\s+TYPE/i.test(line)) continue;
    if (/^-{10,}/.test(line.trim())) { last = null; zoneLine = null; continue; }
    const m = line.match(re);
    if (m) {
      if (m[1].trim()) { zone = canonZone(m[1]); zoneLine = m[1].trim(); }
      last = { zone_name: zone, type: m[2], file_no: m[3] || null, name: m[4].replace(/\s+/g, ' ').trim(), started: usDate(m[5]), contact_name: m[6].trim(), contact_phone: m[7] || null, contact_email: m[8] || null };
      rows.push(last);
    } else if (/^[A-Z][A-Z ]*$/.test(line.trim()) && /^\S/.test(line) && zoneLine) {
      // Wrapped zone name ("GLOUCESTER" / "CITY").
      zone = canonZone(`${zoneLine} ${line.trim()}`);
      for (const r of rows) if (r.zone_name && canonZone(zoneLine) === r.zone_name && r === last) r.zone_name = zone;
      zoneLine = null;
    } else if (last && /^\s{15,}\S/.test(line)) {
      last.name = `${last.name} ${line.trim()}`;
    }
  }
  // The state's total counts filed applications only; new certification applications have no file # yet.
  const total = Number((text.match(/Total Incomplete Applications:\s*(\d+)/i) || [])[1]);
  const filed = rows.filter((r) => r.file_no).length;
  if (Number.isFinite(total) && total !== filed) throw new PortalError('parse', `Incomplete Applications: read ${filed} of ${total} rows.`);
  return { rows };
}

module.exports = { NJ_ZONES, canonZone, parseAppSummary, parseInvestment, parseSic, parseAppDetail, parseTaxDelinquent, parseIncompleteApps, APP_SUMMARY_COLS, INVEST_COLS, SIC_COLS };
