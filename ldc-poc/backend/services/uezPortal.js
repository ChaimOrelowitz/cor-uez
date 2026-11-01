// Client for the NJ DCA Urban Enterprise Zone portal (Oracle APEX app 404 + Oracle Reports).
// Logs in directly at portal03 (no myNJ needed) and pulls zone data.

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = 'https://portal03.nj.gov';
const APEX = `${BASE}/ords_apex_oit`;
const REPORTS = `${BASE}/reports/rwservlet?prod_dca_uez_rpt`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

class PortalError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function inputValue(html, id) {
  const re = new RegExp(`<input[^>]*id="${id}"[^>]*>`, 'i');
  const tag = (html.match(re) || [])[0];
  if (!tag) return null;
  const v = tag.match(/value="([^"]*)"/i);
  return v ? decodeEntities(v[1]) : '';
}

function checksumFor(html, item) {
  const m = html.match(new RegExp(`<input type="hidden" data-for="${item}" value="([^"]*)"`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

class UezPortal {
  // cookies: optional [{ name, value, domain }] (e.g. the myNJ session from a headless browser)
  constructor({ username, password, cookies = [], delayMs = 400 }) {
    this.username = username;
    this.password = password;
    this.delayMs = delayMs;
    this.cookies = new Map(); // key `${domain}|${name}` -> { name, value, domain }
    for (const c of cookies) this.setCookie(c.name, c.value, c.domain);
    this.session = null;
  }

  setCookie(name, value, domain) {
    const d = String(domain || '').replace(/^\./, '').toLowerCase();
    this.cookies.set(`${d}|${name}`, { name, value, domain: d });
  }

  cookieHeader(url) {
    const host = new URL(url).hostname.toLowerCase();
    return [...this.cookies.values()]
      .filter((c) => host === c.domain || host.endsWith(`.${c.domain}`))
      .map((c) => `${c.name}=${c.value}`).join('; ');
  }

  storeCookies(res, url) {
    const host = new URL(url).hostname;
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const c of list) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      if (i <= 0) continue;
      const domainAttr = attrs.map((a) => a.trim()).find((a) => /^domain=/i.test(a));
      this.setCookie(pair.slice(0, i).trim(), pair.slice(i + 1).trim(), domainAttr ? domainAttr.split('=')[1] : host);
    }
  }

  async http(url, { method = 'GET', body, headers = {}, binary = false } = {}) {
    let current = url.startsWith('http') ? url : `${APEX}/${url.replace(/^\//, '')}`;
    let opts = { method, body };
    for (let hop = 0; hop < 10; hop++) {
      let res;
      try {
        res = await fetch(current, {
          method: opts.method,
          body: opts.body,
          redirect: 'manual',
          headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', Cookie: this.cookieHeader(current), ...headers },
          signal: AbortSignal.timeout(60000)
        });
      } catch (err) {
        throw new PortalError('http', `Network error reaching ${new URL(current).host}: ${err.cause?.code || err.cause?.message || err.message}`);
      }
      this.storeCookies(res, current);
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location'), current).toString();
        opts = { method: 'GET', body: undefined };
        headers = {};
        continue;
      }
      if (!res.ok) {
        const raw = await res.text().catch(() => '');
        if (/can't identify you|log in to myNJ/i.test(raw)) throw new PortalError('mynj_session', 'The UEZ portal requires a myNJ login first (myNJ session missing or expired).');
        const snippet = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
        throw new PortalError('http', `Portal returned HTTP ${res.status} for ${current.replace(/:\d{6,}/g, ':…')}${snippet ? ` | ${snippet}` : ''}`);
      }
      const payload = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      return { url: current, body: payload, contentType: res.headers.get('content-type') || '' };
    }
    throw new PortalError('http', 'Too many redirects');
  }

  async login() {
    const page = await this.http('f?p=404:LOGIN');
    const html = page.body;
    if (/can't identify you|log in to myNJ/i.test(html) && !html.includes('P101_USERNAME')) {
      throw new PortalError('mynj_session', 'The UEZ portal requires a myNJ login first.');
    }
    const instance = inputValue(html, 'pInstance');
    const salt = inputValue(html, 'pSalt');
    const submissionId = inputValue(html, 'pPageSubmissionId');
    const stepId = inputValue(html, 'pFlowStepId') || '101';
    const protectedItems = inputValue(html, 'pPageItemsProtected');
    if (!instance || !salt) throw new PortalError('layout', 'UEZ login page did not load as expected.');

    const items = [
      { n: 'P101_USERNAME', v: this.username },
      { n: 'P101_PASSWORD', v: this.password }
    ];
    const ipwCk = checksumFor(html, 'P101_IPW');
    if (html.includes('id="P101_IPW"')) items.push({ n: 'P101_IPW', v: '', ...(ipwCk ? { ck: ipwCk } : {}) });

    const pJson = { salt, pageItems: { itemsToSubmit: items, protected: protectedItems, rowVersion: '', formRegionChecksums: [] } };
    const form = new URLSearchParams({
      p_json: JSON.stringify(pJson),
      p_flow_id: '404',
      p_flow_step_id: stepId,
      p_instance: instance,
      p_page_submission_id: submissionId,
      p_request: 'LOGIN',
      p_reload_on_submit: 'A'
    });

    const res = await this.http(`wwv_flow.accept?p_context=404:${stepId}:${instance}`, {
      method: 'POST',
      body: form.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, Referer: page.url }
    });

    if (/Invalid User Name, Password or Account/i.test(res.body) || /P101_PASSWORD/.test(res.body)) {
      throw new PortalError('bad_credentials', 'UEZ portal rejected the username or password.');
    }
    const zone = (res.body.match(/Your Zone is <B>([^<]+)<\/B>/i) || [])[1];
    const user = (res.body.match(/You are logged in as <B>([^<]+)<\/B>/i) || [])[1];
    const session = (res.url.match(/f\?p=404:\d+:(\d+)/) || [])[1] || inputValue(res.body, 'pInstance');
    if (!session || !zone) throw new PortalError('layout', 'Logged in, but the UEZ main menu did not look as expected.');
    this.session = session;
    this.zoneName = zone.trim();
    this.portalUser = (user || this.username).trim();
    return { zoneName: this.zoneName, portalUser: this.portalUser };
  }

  // Full "UEZ Business Information" listing for the logged-in zone (active + inactive).
  async fetchListingHtml() {
    if (!this.session) await this.login();
    const page = await this.http(`f?p=404:2:${this.session}`);
    const html = page.body;
    const ir = html.match(/interactiveReport\(\{"regionId":"(R\d+)"/);
    if (!ir) throw new PortalError('layout', 'Business listing page did not contain the report.');
    const regionId = ir[1];
    const ajaxId = JSON.parse(`"${(html.slice(ir.index).match(/"ajaxIdentifier":"((?:[^"\\]|\\.)*)"/) || [])[1] || ''}"`);
    const worksheetId = inputValue(html, `${regionId}_worksheet_id`);
    const reportId = inputValue(html, `${regionId}_report_id`);
    const salt = inputValue(html, 'pSalt');
    if (!ajaxId || !worksheetId) throw new PortalError('layout', 'Could not find the listing report settings.');

    const form = new URLSearchParams();
    form.append('p_flow_id', '404');
    form.append('p_flow_step_id', '2');
    form.append('p_instance', this.session);
    form.append('p_debug', '');
    form.append('p_request', `PLUGIN=${ajaxId}`);
    form.append('p_widget_name', 'worksheet');
    form.append('p_widget_mod', 'PULL');
    form.append('p_widget_num_return', '100000');
    form.append('x01', worksheetId);
    form.append('x02', reportId);
    for (const f of ['column_search_current_column', 'search_field', 'row_select']) form.append('f01', `${regionId}_${f}`);
    form.append('f02', ''); form.append('f02', ''); form.append('f02', '100000');
    form.append('p_json', JSON.stringify({ pageItems: null, salt }));

    const res = await this.http(`wwv_flow.ajax?p_context=404:2:${this.session}`, {
      method: 'POST',
      body: form.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'text/html, */*; q=0.01',
        Origin: BASE,
        Referer: page.url
      }
    });
    return res.body;
  }

  // Bulk "Data Download" CSV from the Reports page (every business, all fields).
  // Replicates the APEX page-13 submit (request SUBDOWNLD), same mechanism as login().
  async fetchDataDownloadCsv(status = 'B') {
    if (!this.session) await this.login();
    const page = await this.http(`f?p=404:13:${this.session}`);
    const html = page.body;
    const instance = inputValue(html, 'pInstance') || this.session;
    const salt = inputValue(html, 'pSalt');
    const submissionId = inputValue(html, 'pPageSubmissionId');
    const protectedItems = inputValue(html, 'pPageItemsProtected');
    if (!salt) throw new PortalError('layout', 'Reports page did not load as expected.');
    // Zone value (single-zone users have exactly one option).
    const zoneSel = (html.match(/id="P13_ZONE_DL"[\s\S]*?<\/select>/i) || [])[0] || '';
    const zoneVal = (zoneSel.match(/<option[^>]*value="(\d+)"/i) || [])[1] || '';

    const item = (n, v) => { const ck = checksumFor(html, n); return { n, v, ...(ck ? { ck } : {}) }; };
    const items = [
      item('P13_DATA_DOWNLOAD', '1'),
      item('P13_ZONE_DL', zoneVal),
      item('P13_STATUS_DL', status),
      item('P13_ADHOC_LIST', '0')
    ];
    const pJson = { salt, pageItems: { itemsToSubmit: items, protected: protectedItems, rowVersion: '', formRegionChecksums: [] } };
    const form = new URLSearchParams({
      p_json: JSON.stringify(pJson),
      p_flow_id: '404',
      p_flow_step_id: '13',
      p_instance: instance,
      p_page_submission_id: submissionId,
      p_request: 'SUBDOWNLD',
      p_reload_on_submit: 'A'
    });
    const res = await this.http(`wwv_flow.accept?p_context=404:13:${instance}`, {
      method: 'POST',
      body: form.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, Referer: page.url, Accept: 'text/csv,*/*' }
    });
    if (!/UEZFILE#/i.test(res.body)) {
      const snippet = String(res.body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      throw new PortalError('layout', `Data Download did not return the CSV. Got: ${snippet}`);
    }
    return res.body;
  }

  async fetchDetailHtml(fileNo, zoneId, status = 'A') {
    if (!this.session) await this.login();
    const res = await this.http(`f?p=404:3:${this.session}:::2:P3_FILE_NUM,P3_ZONE_ID_HIDDEN,CURR_STATUS:${encodeURIComponent(fileNo)},${encodeURIComponent(zoneId || '')},${encodeURIComponent(status)}`);
    if (!res.body.includes('P3_CORP_NME')) throw new PortalError('layout', `Detail page for file ${fileNo} did not load.`);
    return res.body;
  }

  // Oracle Reports PDFs. "W" variants are statewide (all zones).
  async fetchReportPdf(report, params = '') {
    if (!this.session) await this.login();
    const res = await this.http(`${REPORTS}&report=${report}${params}`, {
      binary: true,
      headers: { Referer: `${APEX}/f?p=404:1:${this.session}` }
    });
    if (!res.body.subarray(0, 5).toString().startsWith('%PDF')) {
      throw new PortalError('report', `Report ${report} did not return a PDF.`);
    }
    return res.body;
  }

  async logout() {
    if (!this.session) return;
    try { await this.http(`apex_authentication.logout?p_app_id=404&p_session_id=${this.session}`); } catch (_) {}
    this.session = null;
  }
}

function pdfToText(buffer) {
  return new Promise((resolve, reject) => {
    const file = path.join(os.tmpdir(), `uez-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    fs.writeFileSync(file, buffer);
    execFile('pdftotext', ['-layout', file, '-'], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      fs.unlink(file, () => {});
      if (err) return reject(new PortalError('pdf', `Could not read report PDF: ${err.message}`));
      resolve(stdout);
    });
  });
}

module.exports = { UezPortal, PortalError, pdfToText, decodeEntities, UA };
