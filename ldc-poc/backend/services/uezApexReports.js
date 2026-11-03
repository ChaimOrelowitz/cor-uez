// Runs the UEZ portal's parameterized Oracle Reports the way a coordinator does by hand:
// pick the report (page submit), fill in its options and press Run (page submit with the Run
// request), then open the report the page's own runReport() code picks. Returns the PDF or CSV.
const cheerio = require('cheerio');
const { PortalError, pdfToText } = require('./uezPortal');

const BASE = 'https://portal03.nj.gov';

// Current values of every page item (P<page>_*) as the browser would submit them, with checksums.
function pageItems(html, pageNo) {
  const $ = cheerio.load(html);
  const items = new Map();
  $(`[name^="P${pageNo}_"]`).each((_, el) => {
    const name = $(el).attr('name');
    const type = ($(el).attr('type') || el.tagName).toLowerCase();
    if (type === 'radio' || type === 'checkbox') {
      if (!items.has(name)) items.set(name, '');
      if ($(el).is('[checked]')) items.set(name, $(el).attr('value') || '');
    } else if (el.tagName === 'select') {
      items.set(name, $(el).find('option[selected]').attr('value') ?? $(el).find('option').first().attr('value') ?? '');
    } else {
      items.set(name, $(el).attr('value') || $(el).text() || '');
    }
  });
  const ck = (n) => $(`input[type="hidden"][data-for="${n}"]`).attr('value');
  return { $, items, ck };
}

async function submitPage(portal, page, pageNo, overrides, request = '', { binary = false } = {}) {
  const { $, items, ck } = pageItems(String(page.body), pageNo);
  for (const [k, v] of Object.entries(overrides)) items.set(k, v);
  const val = (id) => $(`#${id}`).attr('value') || '';
  const pJson = {
    salt: val('pSalt'),
    pageItems: {
      itemsToSubmit: [...items].map(([n, v]) => ({ n, v, ...(ck(n) ? { ck: ck(n) } : {}) })),
      protected: val('pPageItemsProtected'), rowVersion: '', formRegionChecksums: []
    }
  };
  const instance = val('pInstance') || portal.session;
  const form = new URLSearchParams({
    p_json: JSON.stringify(pJson), p_flow_id: '404', p_flow_step_id: String(pageNo), p_instance: instance,
    p_page_submission_id: val('pPageSubmissionId'), p_request: request, p_reload_on_submit: 'A'
  });
  return portal.http(`wwv_flow.accept?p_context=404:${pageNo}:${instance}`, {
    method: 'POST', body: form.toString(), binary,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, Referer: page.url }
  });
}

// Evaluate the page's own runReport() with $v/$x/window.open shims; returns the URL it would open.
function reportUrlFromPage(html, pageNo) {
  const start = html.indexOf('function runReport');
  if (start === -1) return null;
  let depth = 0; let end = -1;
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  if (end === -1) return null;
  const { items } = pageItems(html, pageNo);
  let opened = null;
  const $v = (id) => items.get(id) ?? '';
  const $x = () => ({ value: '' });
  const window = { open: (u) => { opened = u; return {}; } };
  // eslint-disable-next-line no-new-func
  new Function('$v', '$x', 'window', `${html.slice(start, end).replace(/&amp;/g, '&')}; return runReport();`)($v, $x, window);
  return opened;
}

// job: { pageNo, menu: [item, value], opts: {item: value}, request, download? }
// Returns { kind: 'pdf'|'csv', body: Buffer, text?: string, report?: string }.
async function runPortalReport(portal, job) {
  if (!portal.session) await portal.login();
  const blank = await portal.http(`f?p=404:${job.pageNo}:${portal.session}`);
  const form = await submitPage(portal, blank, job.pageNo, { [job.menu[0]]: job.menu[1] });
  const ran = await submitPage(portal, form, job.pageNo, { [job.menu[0]]: job.menu[1], ...job.opts }, job.request, { binary: true });
  const head = ran.body.subarray(0, 400).toString('utf8');
  if (job.download || !/<html|<!doctype/i.test(head)) {
    return { kind: /^%PDF/.test(head) ? 'pdf' : 'csv', body: ran.body };
  }
  const html = ran.body.toString('utf8');
  const url = reportUrlFromPage(html, job.pageNo);
  if (!url) throw new PortalError('report', `Report ${job.request} did not open.`);
  const rep = await portal.http(url, { binary: true, headers: { Referer: ran.url } });
  if (!rep.body.subarray(0, 5).toString().startsWith('%PDF')) {
    const err = (rep.body.toString('utf8').match(/REP-\d+:[^<&]*/) || ['not a PDF'])[0];
    throw new PortalError('report', `Report ${job.request} failed: ${err}`);
  }
  return { kind: 'pdf', body: rep.body, text: await pdfToText(rep.body), report: (url.match(/report=([^&]+)/) || [])[1] };
}

module.exports = { pageItems, submitPage, reportUrlFromPage, runPortalReport };
