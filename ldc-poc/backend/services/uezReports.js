// Reports engine. Each report is a displayable, sortable table built from data we already
// hold (own-zone roster from the Data Download; cross-zone businesses from the statewide
// Due/Late reports). The frontend renders the table and generates the CSV client-side.
const supabase = require('../db/supabase');
const { deadlineFor } = require('./uezDeadline');

const COLS = 'file_no, zone_name, name, trade_name, status, cert_date, last_annual_date, last_recert_date, next_annual_due, next_recert_due, report_type, report_next_due, report_days_late, on_due_report, on_late_report, owner_name, phone, email, report_contact_name, report_contact_phone, report_contact_email, street, city, state, zip, mailing_address, sic_code, sic_desc, naics_code, naics_desc, total_invest, total_uz4, total_uz5, ft_last, tax_status, reduced_tax, req_25, met_25, new_business, dl_25, new_business';

async function fetchAll(build, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < pageSize) return out;
  }
}

const contact = (b) => ({
  contact_name: b.owner_name || b.report_contact_name || '',
  contact_phone: b.phone || b.report_contact_phone || '',
  contact_email: b.email || b.report_contact_email || ''
});
const addr = (b) => (b.street ? `${b.street}, ${b.city || ''} ${b.zip || ''}`.trim() : '');

async function zoneRows(zone) {
  const raw = await fetchAll(() => supabase.from('uez_zone_businesses').select(COLS).eq('zone_name', zone));
  return raw.map((b) => ({ ...b, ...deadlineFor(b), ...contact(b) }));
}
async function statewideRows() {
  const raw = await fetchAll(() => supabase.from('uez_zone_businesses').select(COLS).or('on_due_report.eq.true,on_late_report.eq.true'));
  return raw.map((b) => ({ ...b, ...deadlineFor(b), ...contact(b) }));
}

// Column helpers
const C = (key, label, type) => ({ key, label, ...(type ? { type } : {}) });
const CONTACT_COLS = [C('contact_name', 'Contact'), C('contact_phone', 'Phone'), C('contact_email', 'Email')];

// ---- Report catalog ----
// Each: { key, label, group, scope, build: async(zone) => ({columns, rows}) }
const REPORTS = [
  {
    key: 'all_businesses', label: 'All businesses', group: 'Your zone', scope: 'zone',
    build: async (zone) => ({
      columns: [C('file_no', 'File #'), C('name', 'Business'), C('status_label', 'State'), C('internal_label', 'Status'), ...CONTACT_COLS, C('address', 'Address'), C('industry', 'Industry')],
      rows: (await zoneRows(zone)).map((b) => row(b))
    })
  },
  {
    key: 'mailing_labels', label: 'Mailing labels', group: 'Your zone', scope: 'zone',
    build: async (zone) => ({
      columns: [C('name', 'Business'), C('contact_name', 'Attn'), C('mailing', 'Mailing address')],
      rows: (await zoneRows(zone)).filter((b) => b.status !== 'I').map((b) => ({ name: b.trade_name || b.name, contact_name: b.contact_name, mailing: b.mailing_address || addr(b) }))
    })
  },
  {
    key: 'companies_due', label: 'Companies due', group: 'Your zone', scope: 'zone',
    build: async (zone) => ({
      columns: [C('file_no', 'File #'), C('name', 'Business'), C('type', 'Type'), C('deadline', 'Due', 'date'), C('days', 'Days', 'num'), ...CONTACT_COLS],
      rows: (await zoneRows(zone)).filter((b) => b.status !== 'I' && ['due_30', 'due_60', 'due_90'].includes(b.bucket)).sort((a, c) => (a.days ?? 0) - (c.days ?? 0)).map(dueRow)
    })
  },
  {
    key: 'companies_overdue', label: 'Companies overdue', group: 'Your zone', scope: 'zone',
    build: async (zone) => ({
      columns: [C('file_no', 'File #'), C('name', 'Business'), C('type', 'Type'), C('deadline', 'Was due', 'date'), C('days', 'Days late', 'num'), ...CONTACT_COLS],
      rows: (await zoneRows(zone)).filter((b) => b.status !== 'I' && b.bucket === 'late').sort((a, c) => (a.days ?? 0) - (c.days ?? 0)).map((b) => ({ ...dueRow(b), days: b.days != null ? Math.abs(b.days) : '' }))
    })
  },
  {
    key: 'not_met_25', label: 'Companies 25% not met', group: 'Your zone', scope: 'zone',
    build: async (zone) => ({
      columns: [C('file_no', 'File #'), C('name', 'Business'), C('req_25', '25% req'), C('met_25', '25% met'), C('dl_25', 'Deadline', 'date'), ...CONTACT_COLS],
      rows: (await zoneRows(zone)).filter((b) => b.status !== 'I' && String(b.req_25).toUpperCase() === 'Y' && String(b.met_25 || '').toUpperCase() !== 'Y')
        .map((b) => ({ file_no: b.file_no, name: b.trade_name || b.name, req_25: b.req_25, met_25: b.met_25 || '—', dl_25: b.dl_25 || '', ...contactOut(b) }))
    })
  },
  {
    key: 'investment_summary', label: 'Investment & summary', group: 'Your zone', scope: 'zone',
    build: async (zone) => ({
      columns: [C('file_no', 'File #'), C('name', 'Business'), C('status_label', 'State'), C('ft_last', 'Full-time', 'num'), C('total_invest', 'Investment', 'money'), C('total_uz4', 'UZ4 savings', 'money'), C('total_uz5', 'UZ5 savings', 'money')],
      rows: (await zoneRows(zone)).map((b) => ({ file_no: b.file_no, name: b.trade_name || b.name, status_label: b.status === 'I' ? 'Inactive' : 'Active', ft_last: b.ft_last, total_invest: b.total_invest, total_uz4: b.total_uz4, total_uz5: b.total_uz5 }))
        .sort((a, c) => (c.total_invest || 0) - (a.total_invest || 0))
    })
  },
  {
    key: 'tax_delinquencies', label: 'Tax delinquencies', group: 'Your zone', scope: 'zone',
    build: async (zone) => ({
      columns: [C('file_no', 'File #'), C('name', 'Business'), C('tax_status', 'Tax status'), C('reduced_tax', 'Reduced tax'), ...CONTACT_COLS],
      rows: (await zoneRows(zone)).filter((b) => b.tax_status && !/good standing/i.test(b.tax_status))
        .map((b) => ({ file_no: b.file_no, name: b.trade_name || b.name, tax_status: b.tax_status, reduced_tax: b.reduced_tax || '', ...contactOut(b) }))
    })
  },
  {
    key: 'new_to_zone', label: 'New to zone', group: 'Your zone', scope: 'zone',
    build: async (zone) => {
      const events = await fetchAll(() => supabase.from('uez_zone_business_events').select('file_no, detected_at, uez_zone_businesses(name, trade_name, cert_date, owner_name, phone, email)').eq('zone_name', zone).eq('kind', 'new_business').order('detected_at', { ascending: false }));
      return {
        columns: [C('detected_at', 'Detected', 'date'), C('file_no', 'File #'), C('name', 'Business'), C('cert_date', 'Certified', 'date'), C('contact_name', 'Contact'), C('contact_phone', 'Phone')],
        rows: events.map((e) => { const b = e.uez_zone_businesses || {}; return { detected_at: e.detected_at, file_no: e.file_no, name: b.trade_name || b.name, cert_date: b.cert_date || '', contact_name: b.owner_name || '', contact_phone: b.phone || '' }; })
      };
    }
  },
  // ---- Cross-zone (statewide) ----
  {
    key: 'statewide_due', label: 'Companies due — all zones', group: 'All zones', scope: 'statewide',
    build: async () => ({
      columns: [C('zone_name', 'Zone'), C('file_no', 'File #'), C('name', 'Business'), C('type', 'Type'), C('deadline', 'Due', 'date'), ...CONTACT_COLS],
      rows: (await statewideRows()).filter((b) => b.on_due_report).sort((a, c) => String(a.zone_name).localeCompare(String(c.zone_name)) || (a.days ?? 0) - (c.days ?? 0))
        .map((b) => ({ zone_name: b.zone_name, file_no: b.file_no, name: b.trade_name || b.name, type: b.report_type === 'RCRT' ? 'Recert' : 'Annual', deadline: b.report_next_due || b.deadline || '', ...contactOut(b) }))
    })
  },
  {
    key: 'statewide_late', label: 'Companies late — all zones', group: 'All zones', scope: 'statewide',
    build: async () => ({
      columns: [C('zone_name', 'Zone'), C('file_no', 'File #'), C('name', 'Business'), C('type', 'Type'), C('days_late', 'Days late', 'num'), ...CONTACT_COLS],
      rows: (await statewideRows()).filter((b) => b.on_late_report).sort((a, c) => String(a.zone_name).localeCompare(String(c.zone_name)) || (c.report_days_late ?? 0) - (a.report_days_late ?? 0))
        .map((b) => ({ zone_name: b.zone_name, file_no: b.file_no, name: b.trade_name || b.name, type: b.report_type === 'RCRT' ? 'Recert' : 'Annual', days_late: b.report_days_late ?? '', ...contactOut(b) }))
    })
  }
];

const INTERNAL_LABEL = { current: 'Current', upcoming: 'Upcoming', due_soon: 'Due soon', overdue: 'Overdue', inactive: 'Inactive' };
function contactOut(b) { return { contact_name: b.contact_name, contact_phone: b.contact_phone, contact_email: b.contact_email }; }
function row(b) {
  return {
    file_no: b.file_no, name: b.trade_name || b.name,
    status_label: b.status === 'I' ? 'Inactive' : 'Active',
    internal_label: INTERNAL_LABEL[b.internal_status] || '',
    ...contactOut(b),
    address: addr(b), industry: b.naics_desc || b.sic_desc || ''
  };
}
function dueRow(b) {
  return { file_no: b.file_no, name: b.trade_name || b.name, type: b.deadline_type === 'RCRT' ? 'Recert' : 'Annual', deadline: b.deadline || '', days: b.days, ...contactOut(b) };
}

function listReports() { return REPORTS.map((r) => ({ key: r.key, label: r.label, group: r.group, scope: r.scope })); }
async function buildReport(org, key) {
  const r = REPORTS.find((x) => x.key === key);
  if (!r) return null;
  const data = await r.build(org.zone_name);
  return { key: r.key, label: r.label, scope: r.scope, ...data };
}

module.exports = { listReports, buildReport };
