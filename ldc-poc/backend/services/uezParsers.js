// Parsers for UEZ portal pages and Oracle Reports text (pdftotext -layout output).
const cheerio = require('cheerio');

function clean(s) {
  const t = String(s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  return t === '-' || t === 'N/A' ? '' : t;
}

// MM/DD/YYYY -> YYYY-MM-DD (or null)
function isoDate(s) {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

function num(s) {
  const t = String(s ?? '').replace(/[$,\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function splitNamePhone(rest) {
  const t = rest.trim();
  const m = t.match(/^(.*?)\s*(\(?\d{3}\)?[-.\s]?\d{3}-\d{4}.*)$/);
  if (m) return [m[1].trim(), m[2].trim()];
  const raw = t.match(/^(.*?)\s*(\d{10,11}\b.*)$/);
  if (raw) return [raw[1].trim(), raw[2].trim()];
  return [t, ''];
}

// ---------- Business listing (page 2 interactive report) ----------
function parseListing(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('table.a-IRR-table tr').each((_, tr) => {
    const cell = (h) => clean($(tr).find(`td[headers="${h}"]`).text());
    const fileNo = cell('BSNS_FILE_NUM_ID');
    if (!fileNo) return;
    rows.push({
      file_no: fileNo,
      permit_no: cell('PRMT_NUM_ID') || null,
      name: cell('BSNS_NAME'),
      zone_name: cell('ZONE_NAME'),
      status: cell('CRNT_STTS_CODE') || null,
      cert_date: isoDate(cell('CERT_DATE')),
      last_annual_date: isoDate(cell('ANNUAL_DATE')),
      last_recert_date: isoDate(cell('RECERT_PROC_DATE')),
      extension_date: isoDate(cell('BSNS_EXTENSION_DATE')),
      email: cell('EMAIL_ADRS_TEXT').toLowerCase() || null,
      sic_code: cell('SIC CODE') || null,
      naics_code: cell('NAICS CODE') || null
    });
  });
  return rows;
}

// ---------- Business detail (page 3) ----------
function parseDetail(html) {
  const $ = cheerio.load(html);
  const span = (id) => clean($(`#${id}`).text());
  const val = (id) => clean($(`#${id}`).attr('value'));
  const field = (id) => span(id) || val(id);
  const yes = (s) => /^(Y|YES)/i.test(s);

  const employment = [];
  $('td[headers="APLCTN_STTS_CODE"]').closest('table').find('tr').each((_, tr) => {
    const c = (h) => clean($(tr).find(`td[headers="${h}"]`).text());
    if (!$(tr).find('td[headers="PRGRM_YR_CODE"]').length) return;
    const row = {
      date: isoDate(c('ANNUAL_DATE')),
      app_status: c('APLCTN_STTS_CODE') || null,
      status_detail: c('APLCTN_STTS_DTL_CODE') || null,
      program_year: c('PRGRM_YR_CODE') || null,
      ft_projected: num(c('FULL_TIME_PRJCTD_NUM')),
      ft_actual: num(c('FULL_TIME_ACTL_NUM')),
      ft_change: num(c('FULL_TIME_INCRS_DCRS_NUM')),
      new_hires: num(c('NEW_HIRES_NUM')),
      chks: num(c('CHCKS_RCVD_NUM')),
      pct_25: c('TWNTY_FIVE_PCT_CALC') || null,
      pt_projected: num(c('PART_TIME_PRJCTD_NUM')),
      pt_actual: num(c('PART_TIME_ACTL_NUM')),
      pt_change: num(c('PART_TIME_INCRS_DCRS_NUM')),
      capital_actual: num(c('ACTL_RVN_AMT')),
      capital_projected: num(c('PRJCTD_RVN_AMT')),
      uz1_qlfd: c('RDCD_TAX_CLCTD_FLG') || null,
      uz4_savings: num(c('UZ4_TAX_SVNGS_AMT')),
      uz5_savings: num(c('UZ5_TAX_SVNGS_AMT')),
      origin: c('ORIGIN') || null
    };
    if (row.app_status || row.program_year || row.date) employment.push(row);
  });

  const notes = [];
  $('td[headers="CMNT_TEXT"]').each((_, td) => {
    const tr = $(td).closest('tr');
    const text = clean($(td).text());
    if (!text) return;
    notes.push({
      text,
      important: yes(clean(tr.find('td[headers="PRIORITY_FLG"]').text())),
      by: clean(tr.find('td[headers="CRTN_ID"]').text()) || null,
      date: isoDate(tr.find('td[headers="CRTN_DATE"]').text())
    });
  });

  return {
    corp_name: field('P3_CORP_NME') || null,
    trade_name: field('P3_BSNS_NAME') || null,
    permit_no: field('P3_PERMIT_NUM') || null,
    status: field('P3_CUR_STATUS') || null,
    zone_id: num(field('P3_ZONE') || val('P3_ZONE_ID_HIDDEN')),
    business_size: field('P3_BSNS_SIZE') || null,
    fed_id: field('P3_FEDID1') || null,
    nj_tax: field('P3_NJTAX') || null,
    gfw: field('P3_GFW') || null,
    re_entry: field('P3_RE_ENTRY') || null,
    move_in: field('P3_MOVE_IN_CDE') || null,
    salutation: field('P3_SALUTATION') || null,
    req_25: field('P3_REQ_25') || null,
    met_25: field('P3_TWENTY_FIVE') || null,
    dl_25: isoDate(field('P3_DL_25')),
    street: [field('P3_BUS_STREET'), field('P3_UNIT_NUM')].filter(Boolean).join(' ') || null,
    city: field('P3_BUS_CITY') || null,
    state: field('P3_BUS_STATE') || null,
    zip: field('P3_BUS_ZIP') || null,
    block: field('P3_BLOCK') || null,
    lot: field('P3_LOT') || null,
    owner_name: clean([field('P3_CONTACT_FIRST'), field('P3_CONTACT_MID'), field('P3_CONTACT_LAST')].filter(Boolean).join(' ')) || null,
    owner_title: field('P3_CONTACT_TITLE') || null,
    phone: [field('P3_CONTACT_PHONE'), field('P3_EXT_NUM') ? `x${field('P3_EXT_NUM')}` : ''].filter(Boolean).join(' ') || null,
    email: field('P3_EMAIL').toLowerCase() || null,
    mailing_address: clean([field('P3_M_STREET'), [field('P3_M_CITY'), field('P3_M_STATE')].filter(Boolean).join(', '), field('P3_M_ZIP')].filter(Boolean).join(' ')) || null,
    nature: field('P3_NATURE_OF_BUS') || null,
    naics_desc: field('P3_NAICS_DES') || null,
    sic_desc: field('P3_SIC_DES') || null,
    began_date: isoDate(field('P3_STRT_DAY')),
    cert_date: isoDate(field('P3_CERT_DTE')),
    last_annual_date: isoDate(field('P3_ANNUAL_DATE')),
    next_annual_due: isoDate(field('P3_NEXT_ANNUAL_DUE')),
    extension_date: isoDate(field('P3_BSNS_EXT_DATE')),
    last_recert_date: isoDate(field('P3_LAST_RDATE')),
    next_recert_due: isoDate(field('P3_RDATE')),
    minority_owned: yes(field('P3_MINORITY_FLG')),
    women_owned: yes(field('P3_WOMEN_FLG')),
    entity_type: field('P3_TYPE_BUS') || null,
    new_business: yes(field('P3_NEW_BUS_FLG')),
    employment,
    state_notes: notes,
    // When the state inactivated it: the date on the latest employment row marked Inactive (app_status 'I').
    inactivated_date: (() => {
      const rows = employment.filter((r) => r.app_status === 'I' && r.date).sort((a, b) => (a.date < b.date ? 1 : -1));
      return rows[0]?.date || null;
    })(),
    portal_modified_at: val('P3_MDFD_DATE') || null,
    portal_modified_by: val('P3_MDFD_ID') || null
  };
}

// ---------- Oracle Reports: Companies Due / Companies Late ----------
const HEADER_SKIP = /^(UEZ Active|Page \d|For Zone|Report run|App\b|Type\b|-{3,}|Total number)/;

function reportRunDate(text) {
  return isoDate((text.match(/Report run on:\s*(\d{2}\/\d{2}\/\d{4})/) || [])[1]);
}

function reportTotal(text) {
  const m = text.match(/Total number of .*?:\s*(\d+)/) || text.match(/Total number of .*? is:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

function isZoneHeader(line) {
  const s = line.trim();
  return s && /^[A-Z][A-Z .'-]+$/.test(s) && s.length < 40 && !/^(AR|RCRT)$/.test(s) && !/\s{3,}/.test(s);
}

function parseDueReport(text) {
  const lines = text.split('\n');
  const r1 = /^\s*([A-Z]{2,5})\s+(\d+)\s+(.+?)\s{2,}(\d\d\/\d\d\/\d{4})\s+(\d+)\s*\/\s*(\d+)\s+(.*)$/;
  const r2 = /^\s+(\d+)\s+(.*?)\s{2,}(\d\d\/\d\d\/\d{4})\s+(-?\d+)\s*(\S*)\s*$/;
  const out = [];
  let zone = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const s = l.trim();
    if (!s || HEADER_SKIP.test(s)) continue;
    const m = l.match(r1);
    if (m) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const m2 = (lines[j] || '').match(r2);
      const [contact, phone] = splitNamePhone(m[7]);
      out.push({
        zone_name: zone,
        report_type: m[1],
        file_no: m[2],
        corp_name: clean(m[3]),
        cert_date: isoDate(m[4]),
        ft_orig: Number(m[5]),
        ft_curr: Number(m[6]),
        contact_name: clean(contact) || null,
        contact_phone: clean(phone) || null,
        permit_no: m2 ? m2[1] : null,
        trade_name: m2 ? clean(m2[2]) || null : null,
        next_due: m2 ? isoDate(m2[3]) : null,
        days_until_due: m2 ? Number(m2[4]) : null,
        contact_email: m2 && m2[5] ? m2[5].toLowerCase() : null
      });
      if (m2) i = j;
      continue;
    }
    if (isZoneHeader(l)) zone = s;
  }
  return { runDate: reportRunDate(text), total: reportTotal(text), rows: out };
}

function parseLateReport(text) {
  const lines = text.split('\n');
  const r1 = /^\s*([A-Z]{2,5})\s+(\d+)\s+(.+?)\s{2,}(\d\d\/\d\d\/\d{4})\s+(\d\d\/\d\d\/\d{4}|-|N\/A)?\s+(.*?)\s+(\d+)\s*$/;
  const r2 = /^\s+(\d+)\s+(.*?)\s{2,}(\d\d\/\d\d\/\d{4})\s+(\d+)\s+(\S*@\S*)?\s*(\d+)?\s*$/;
  const out = [];
  let zone = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const s = l.trim();
    if (!s || HEADER_SKIP.test(s)) continue;
    const m = l.match(r1);
    if (m) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const m2 = (lines[j] || '').match(r2);
      const [contact, phone] = splitNamePhone(m[6]);
      out.push({
        zone_name: zone,
        report_type: m[1],
        file_no: m[2],
        corp_name: clean(m[3]),
        cert_date: isoDate(m[4]),
        last_annual_date: isoDate(m[5]),
        contact_name: clean(contact) || null,
        contact_phone: clean(phone) || null,
        ft_orig: Number(m[7]),
        permit_no: m2 ? m2[1] : null,
        trade_name: m2 ? clean(m2[2]) || null : null,
        next_due: m2 ? isoDate(m2[3]) : null,
        days_late: m2 ? Number(m2[4]) : null,
        contact_email: m2 && m2[5] ? m2[5].toLowerCase() : null,
        ft_curr: m2 && m2[6] ? Number(m2[6]) : null
      });
      if (m2) i = j;
      continue;
    }
    if (isZoneHeader(l)) zone = s;
  }
  return { runDate: reportRunDate(text), total: reportTotal(text), rows: out };
}

// ---------- Data Download CSV (bulk export: every business, 75 columns) ----------
// RFC4180-ish CSV tokenizer: handles "quoted" fields, "" escapes, and \r\n / \r / \n.
function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let inQ = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { if (s[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function usToIso(s) {
  const iso = isoDate(s);
  // The portal uses 06/06/1966 as a "no date" sentinel.
  return iso === '1966-06-06' ? null : iso;
}
function money(s) {
  const t = String(s ?? '').replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const yn = (s) => { const t = String(s ?? '').trim().toUpperCase(); return t === 'Y' || t === 'YES' ? true : t === 'N' || t === 'NO' ? false : null; };

function parseDataDownload(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  const idx = {}; header.forEach((h, i) => { idx[h] = i; });
  const col = (r, name) => clean(r[idx[name]]);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const fileNo = col(r, 'UEZFILE#');
    if (!fileNo) continue;
    const met = col(r, '25%MET');
    const owner = [col(r, 'CONTNAME1'), col(r, 'CONTNAME2'), col(r, 'CONTNAME3')].filter(Boolean).join(' ');
    const mailing = [col(r, 'ML ADDRESS'), [col(r, 'ML CITY'), col(r, 'ML STATE')].filter(Boolean).join(', '), col(r, 'ML ZIP')].filter(Boolean).join(' ');
    const lastAnnual = usToIso(col(r, 'ANNUAL DATE'));
    out.push({
      file_no: fileNo,
      permit_no: col(r, 'PERMIT#') || null,
      status: col(r, 'STATUS') || null,
      name: col(r, 'CORPNAME') || null,
      trade_name: col(r, 'TRADENAME') || null,
      cert_date: usToIso(col(r, 'CERTDATE')),
      last_annual_date: lastAnnual,
      next_annual_due: lastAnnual ? (() => { const d = new Date(`${lastAnnual}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); })() : null,
      next_recert_due: usToIso(col(r, 'RECERTDATE')),
      last_recert_date: usToIso(col(r, 'RECERT PROC DATE')),
      req_25: col(r, '25%REQ') || null,
      met_25: met === 'NA' ? null : (met || null),
      dl_25: usToIso(col(r, '25%DL')),
      gfw: col(r, 'GFW') || null,
      re_entry: col(r, 'RE-ENTRY') || null,
      move_in: col(r, 'MOVE-IN') || null,
      salutation: col(r, 'SAL') || null,
      nj_tax: col(r, 'NJ TAX ID') || null,
      nj_reg: col(r, 'NJREG') || null,
      uz1: col(r, 'UZ1') || null,
      street: col(r, 'ST ADDRESS') || null,
      city: col(r, 'ST CITY') || null,
      state: col(r, 'ST STATE') || null,
      zip: col(r, 'ST ZIP') || null,
      owner_name: owner || null,
      owner_title: col(r, 'CONTITLE') || null,
      phone: (col(r, 'CONTACT#') || '').replace(/\s*x\s*$/i, '').trim() || null,
      fax: col(r, 'FAX') || null,
      email: (col(r, 'E-MAIL') || '').toLowerCase() || null,
      mailing_address: mailing || null,
      nature: col(r, 'NATURE') || null,
      sic_code: col(r, 'SIC') || null,
      sic_desc: col(r, 'DESCRIPTION') || null,
      naics_code: col(r, 'NAICS') || null,
      naics_desc: col(r, 'NAICS DESCRIPTION') || null,
      began_date: usToIso(col(r, 'BEGAN')),
      new_business: yn(col(r, 'NEWBUS')),
      minority_owned: yn(col(r, 'MINORITY')),
      women_owned: yn(col(r, 'WOMAN')),
      entity_type: col(r, 'TYPE') || null,
      block: col(r, 'BLK ID') || null,
      lot: col(r, 'LOT ID') || null,
      total_invest: money(col(r, 'TOTAL INVEST')),
      total_uz4: money(col(r, 'TOTAL UZ4')),
      total_uz5: money(col(r, 'TOTAL UZ5')),
      tax_status: col(r, 'TAX STATUS') || null,
      reduced_tax: col(r, 'REDUCED TAX') || null,
      ft_start: money(col(r, 'FTEMP START')),
      ft_last: money(col(r, 'FTEMP LAST')),
      pt_start: money(col(r, 'PTEMP START')),
      pt_last: money(col(r, 'PTEMP LAST')),
      inactivated_flag: col(r, 'INACTIVATED') || null,
      // Full raw record (all 75 columns) so every field is available without more migrations.
      dl_raw: Object.fromEntries(header.map((h, j) => [h, (r[j] ?? '').trim()]))
    });
  }
  return out;
}

module.exports = { parseListing, parseDetail, parseDueReport, parseLateReport, parseDataDownload, isoDate };
