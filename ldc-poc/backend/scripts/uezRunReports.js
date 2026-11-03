// Step 2: run each parameterized report the login's menus offer, the way a coordinator would by hand —
// pick the report, fill in its options, press Run — and save what comes back (PDF -> text, or CSV).
// Which report opens is decided by the portal's own runReport() code, evaluated against the page it
// returns, so we open exactly what a browser would. Letters and mailing labels are left out.
//
//   node scripts/uezRunReports.js [--org <orgId>] [--out <dir>] [--only <job-key>[,<job-key>…]]
const fs = require('fs');
const path = require('path');
const { pdfToText } = require('../services/uezPortal');
const { arg, openScriptPortal, submitPage } = require('./uezApexForm');
const { reportUrlFromPage } = require('../services/uezApexReports');

const ZONE = '19'; // overwritten with the login's own zone id from the form (single-zone users have one option)

// pageNo, menu item + value (selecting it renders the options form), options, Run request.
const JOBS = [
  { key: 'company-list-contacts', pageNo: 13, menu: ['P13_ADHOC_LIST', '1'], opts: { P13_CPNY_LIST: '1', P13_ZONES_CL: ZONE, P13_STATUS: 'B' }, request: 'SUBCPNYLSTS' },
  { key: 'not-met-25', pageNo: 13, menu: ['P13_ADHOC_LIST', '2'], opts: { P13_ZONE_ONLY: ZONE }, request: 'SUBNOT25RPT' },
  { key: 'new-to-zone-2025-26', pageNo: 13, menu: ['P13_ADHOC_LIST', '4'], opts: { P13_ZONES_CN: ZONE, P13_STATUS_CN: 'B', P13_BUS_TYPE: 'B', P13_START_DTE_CN: '01/01/2025', P13_END_DTE_CN: '11/02/2026' }, request: 'SUBCPNYNEW' },
  { key: 'sic-active-2026-11', pageNo: 13, menu: ['P13_ADHOC_LIST', '5'], opts: { P13_SIC_LIST: '1', P13_REPORT_DTE3: '2026/11/01' }, request: 'SUBSICCNTS' },
  { key: 'sic-inactive-2026-11', pageNo: 13, menu: ['P13_ADHOC_LIST', '5'], opts: { P13_SIC_LIST: '2', P13_REPORT_DTE3: '2026/11/01' }, request: 'SUBSICCNTS' },
  { key: 'investment-2026-11', pageNo: 13, menu: ['P13_ADHOC_LIST', '6'], opts: { P13_REPORT_DTE: '2026/11/01' }, request: 'SUBINVESTRPT' },
  { key: 'investment-2026-11-csv', pageNo: 13, menu: ['P13_ADHOC_LIST', '6'], opts: { P13_REPORT_DTE: '2026/11/01' }, request: 'DOWNLOAD_INV', download: true },
  { key: 'investment-2016-11', pageNo: 13, menu: ['P13_ADHOC_LIST', '6'], opts: { P13_REPORT_DTE: '2016/11/01' }, request: 'SUBINVESTRPT' },
  { key: 'tax-delinquent-zone', pageNo: 13, menu: ['P13_ADHOC_LIST', '10'], opts: { P13_ZONE_ONLY: ZONE }, request: 'SUBTAXDELINQ' },
  { key: 'tax-delinquent-zone-csv', pageNo: 13, menu: ['P13_ADHOC_LIST', '10'], opts: { P13_ZONE_ONLY: ZONE }, request: 'DOWNLOAD_TAX', download: true },
  { key: 'due-annual-2026-12', pageNo: 10, menu: ['P10_RECERT_APP_RADIO', '4'], opts: { P10_APP_TYPE: 'A', P10_SELECT_ZONE_1: ZONE, P10_APP_CERT_MM: '12' }, request: 'SUBCPNYDUE' },
  { key: 'due-recert-2026-12', pageNo: 10, menu: ['P10_RECERT_APP_RADIO', '4'], opts: { P10_APP_TYPE: 'R', P10_SELECT_ZONE_1: ZONE, P10_APP_CERT_MM: '12' }, request: 'SUBCPNYDUE' },
  { key: 'late-annual-all', pageNo: 10, menu: ['P10_RECERT_APP_RADIO', '5'], opts: { P10_APP_TYPE: 'A', P10_SELECT_ZONE_1: ZONE, P10_APP_CERT_MM_CL: '00' }, request: 'SUBCPNYLTE' },
  { key: 'app-summary-2026-ytd', pageNo: 9, menu: ['P9_SELECT_LIST', '1'], opts: { P9_START_DTE: '01/02/2026', P9_END_DTE: '10/30/2026' }, request: 'SUBAPPSUM' },
  { key: 'app-summary-2025', pageNo: 9, menu: ['P9_SELECT_LIST', '1'], opts: { P9_START_DTE: '01/03/2025', P9_END_DTE: '12/26/2025' }, request: 'SUBAPPSUM' },
  { key: 'company-list-labels', pageNo: 13, menu: ['P13_ADHOC_LIST', '1'], opts: { P13_CPNY_LIST: '2', P13_ZONES_CL: ZONE, P13_STATUS: 'A' }, request: 'SUBCPNYLSTS' },
  { key: 'company-list-mailing', pageNo: 13, menu: ['P13_ADHOC_LIST', '1'], opts: { P13_CPNY_LIST: '3', P13_ZONES_CL: ZONE, P13_STATUS: 'A' }, request: 'SUBCPNYLSTS' },
  { key: 'company-list-street', pageNo: 13, menu: ['P13_ADHOC_LIST', '1'], opts: { P13_CPNY_LIST: '4', P13_ZONES_CL: ZONE, P13_STATUS: 'A' }, request: 'SUBCPNYLSTS' },
  { key: 'late-recert-all', pageNo: 10, menu: ['P10_RECERT_APP_RADIO', '5'], opts: { P10_APP_TYPE: 'R', P10_SELECT_ZONE_1: ZONE, P10_APP_CERT_MM_CL: '00' }, request: 'SUBCPNYLTE' },
  { key: 'reminder-letters-annual-12', pageNo: 10, menu: ['P10_RECERT_APP_RADIO', '7'], opts: { P10_APP_TYPE: 'A', P10_SELECT_ZONE_1: ZONE, P10_APP_CERT_MM: '12' }, request: 'SUBMTHLTR' },
  { key: 'reminder-letters-recert-12', pageNo: 10, menu: ['P10_RECERT_APP_RADIO', '7'], opts: { P10_APP_TYPE: 'R', P10_SELECT_ZONE_1: ZONE, P10_APP_CERT_MM: '12' }, request: 'SUBMTHLTR' },
  { key: 'app-summary-week-2026-10-30', pageNo: 9, menu: ['P9_SELECT_LIST', '1'], opts: { P9_START_DTE: '10/30/2026', P9_END_DTE: '10/30/2026' }, request: 'SUBAPPSUM' },
  { key: 'app-detail-2024-11-01', pageNo: 9, menu: ['P9_SELECT_LIST', '2'], opts: { P9_FRI_PROCESSING_DTE: '11/01/2024' }, request: 'SUBAPPDTL' },
  { key: 'app-detail-2026-10-30', pageNo: 9, menu: ['P9_SELECT_LIST', '2'], opts: { P9_FRI_PROCESSING_DTE: '10/30/2026' }, request: 'SUBAPPDTL' }
];

async function main() {
  const outDir = path.resolve(arg('out', `uez-discovery-${new Date().toISOString().slice(0, 10)}`), 'runs');
  fs.mkdirSync(outDir, { recursive: true });
  const only = arg('only', null);
  const { portal, info } = await openScriptPortal();
  console.log(`Logged in as ${info.portalUser} (${info.zoneName}).`);

  const results = [];
  for (const job of JOBS.filter((j) => !only || String(only).split(',').includes(j.key))) {
    const r = { key: job.key };
    try {
      // 1. Select the report (renders its options form).
      const blank = await portal.http(`f?p=404:${job.pageNo}:${portal.session}`);
      const form = await submitPage(portal, blank, job.pageNo, { [job.menu[0]]: job.menu[1] });
      // Use the login's own zone id wherever a zone picker is offered.
      const opts = { ...job.opts };
      for (const k of Object.keys(opts)) if (opts[k] === ZONE) {
        const own = (String(form.body).match(new RegExp(`id="${k}"[\\s\\S]*?<option[^>]*value="(\\d+)"`)) || [])[1];
        if (own) opts[k] = own;
      }
      // 2. Fill in the options and press Run.
      const ran = await submitPage(portal, form, job.pageNo, { [job.menu[0]]: job.menu[1], ...opts }, job.request, { binary: true });
      const body = ran.body;
      const head = body.subarray(0, 400).toString('utf8');
      if (job.download || !/<html|<!doctype/i.test(head)) {
        const ext = /^%PDF/.test(head) ? 'pdf' : 'csv';
        fs.writeFileSync(path.join(outDir, `${job.key}.${ext}`), body);
        r.kind = ext; r.bytes = body.length;
        r.preview = body.toString('utf8').split('\n').slice(0, 6);
      } else {
        // 3. The page comes back with a report id; open the report its runReport() picks.
        const html = body.toString('utf8');
        fs.writeFileSync(path.join(outDir, `${job.key}.page.html`), html);
        const url = reportUrlFromPage(html, job.pageNo);
        const err = (html.match(/class="(?:htmldbStdErr|t-Alert-body|htmldbErrorMessage)"[^>]*>([\s\S]*?)<\//) || [])[1];
        if (!url) throw new Error(`No report opened${err ? `: ${err.replace(/<[^>]+>/g, ' ').trim()}` : ''}`);
        r.report = (url.match(/report=([^&]+)/) || [])[1];
        r.reportId = (url.match(/p_report_id=([^&]*)/) || [])[1] || '';
        const rep = await portal.http(url, { binary: true, headers: { Referer: ran.url } });
        const isPdf = rep.body.subarray(0, 5).toString().startsWith('%PDF');
        r.kind = isPdf ? 'pdf' : 'html'; r.bytes = rep.body.length;
        fs.writeFileSync(path.join(outDir, `${job.key}.${isPdf ? 'pdf' : 'html'}`), rep.body);
        if (isPdf) {
          const text = await pdfToText(rep.body);
          fs.writeFileSync(path.join(outDir, `${job.key}.txt`), text);
          r.lines = text.split('\n').length;
          r.preview = text.split('\n').filter((l) => l.trim()).slice(0, 12);
        } else {
          r.error = (rep.body.toString('utf8').match(/REP-\d+:[^<&]*/) || ['not a PDF'])[0];
        }
      }
      console.log(`  ${job.key}: ${r.report || ''} ${r.kind}, ${r.bytes} bytes${r.error ? ` — ${r.error}` : ''}`);
    } catch (e) {
      r.error = e.message;
      console.log(`  ${job.key}: ERROR ${e.message}`);
    }
    results.push(r);
  }
  await portal.logout();
  fs.writeFileSync(path.join(outDir, 'runs.json'), JSON.stringify(results, null, 2));
  console.log(`\nSaved ${results.length} runs to ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
