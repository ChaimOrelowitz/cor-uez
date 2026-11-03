// Discovery crawl of the state UEZ portal: maps every page, report and data source a zone login can see.
// Read-only: after login it only issues GETs, never clicks buttons or submits forms, and skips any link
// that carries an APEX request or looks like an action. Each APEX page is visited once (not per business).
//
//   node scripts/uezDiscover.js [--org <orgId>] [--out <dir>] [--max-pages 120] [--no-reports]
//
// Writes <out>/summary.md, <out>/summary.json, raw pages under <out>/pages and reports under <out>/reports.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const supabase = require('../db/supabase');
const { UezPortal, pdfToText, decodeEntities } = require('../services/uezPortal');
const { myNjLogin } = require('../services/uezMyNj');
const { getPortalLogin } = require('../services/uezZoneSync');

const BASE = 'https://portal03.nj.gov';
const APEX = `${BASE}/ords_apex_oit`;
const UNSAFE = /logout|delete|remove|save|submit|update|insert|create|apply|approve|reject|cancel|reset|send|upload|process/i;

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const clean = (s) => decodeEntities(String(s || '')).replace(/\s+/g, ' ').trim();

// f?p=APP:PAGE:SESSION:REQUEST:DEBUG:CLEARCACHE:ITEMS:VALUES
function parseFp(url) {
  const m = String(url).match(/f\?p=([^&#"'\s]*)/i);
  if (!m) return null;
  const [app, page, , request, , clearCache, items, values] = decodeURIComponent(m[1]).split(':');
  return { app, page, request: request || '', clearCache: clearCache || '', items: items || '', values: values || '' };
}

function extractLinks(html) {
  const found = new Set();
  const add = (u) => { if (u) found.add(decodeEntities(u).replace(/\\u0026/g, '&').replace(/\\\//g, '/')); };
  for (const m of html.matchAll(/href="([^"]+)"/gi)) if (!/^javascript:/i.test(m[1])) add(m[1]);
  for (const m of html.matchAll(/(f\?p=\d+:[^"'\s<>)\\]+)/gi)) add(m[1]);
  for (const m of html.matchAll(/((?:https?:\/\/[^"'\s<>]+)?\/reports\/rwservlet\?[^"'\s<>)\\]+)/gi)) add(m[1]);
  return [...found];
}

function describePage(html) {
  const $ = cheerio.load(html);
  const title = clean($('title').first().text());
  const headings = [...new Set($('h1, h2, h3, .t-Region-title, .t-Breadcrumb-label').map((_, el) => clean($(el).text())).get().filter(Boolean))];
  const label = (id) => clean($(`label[for="${id}"]`).first().text());
  const fields = $('input, select, textarea').map((_, el) => {
    const id = $(el).attr('id') || $(el).attr('name') || '';
    const type = el.tagName === 'select' ? 'select' : ($(el).attr('type') || el.tagName);
    if (!id || type === 'hidden' || /^(pSalt|pInstance|pPageSubmissionId|pPageItemsProtected|pFlowId|pFlowStepId|pPageChecksum)$/.test(id)) return null;
    const f = { id, type, label: label(id) };
    if (type === 'select') f.options = $(el).find('option').map((__, o) => ({ value: $(o).attr('value') || '', text: clean($(o).text()) })).get();
    else if ($(el).attr('value')) f.value = clean($(el).attr('value')).slice(0, 80);
    return f;
  }).get().filter(Boolean);
  const buttons = [...new Set($('button, input[type="button"], input[type="submit"], a.t-Button').map((_, el) => clean($(el).text() || $(el).attr('value') || $(el).attr('title'))).get().filter(Boolean))];
  const tables = $('table').map((_, t) => {
    const head = $(t).find('th').map((__, th) => clean($(th).text())).get().filter(Boolean);
    if (!head.length) return null;
    const rows = $(t).find('tr').filter((__, tr) => $(tr).find('td').length > 0);
    const sample = rows.slice(0, 3).map((__, tr) => [$(tr).find('td').map((___, td) => clean($(td).text()).slice(0, 60)).get()]).get();
    return { headers: head.slice(0, 40), rowCount: rows.length, sample };
  }).get().filter(Boolean);
  const reportNames = [...new Set([...html.matchAll(/report=([A-Z0-9_$]+\.RDF)/gi)].map((m) => m[1].toUpperCase()))];
  return { title, headings, fields, buttons, tables, reportNames };
}

async function main() {
  const outDir = path.resolve(arg('out', `uez-discovery-${new Date().toISOString().slice(0, 10)}`));
  const maxPages = Number(arg('max-pages', 120));
  const fetchReports = !arg('no-reports', false);
  fs.mkdirSync(path.join(outDir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'reports'), { recursive: true });

  let orgId = arg('org', null);
  if (!orgId) {
    const { data, error } = await supabase.from('uez_zone_portal_logins').select('org_id').eq('status', 'ok').limit(1);
    if (error) throw error;
    orgId = data?.[0]?.org_id;
  }
  if (!orgId) throw new Error('No saved portal login found. Pass --org <orgId>.');
  const creds = await getPortalLogin(orgId);
  if (!creds) throw new Error(`Org ${orgId} has no saved portal login.`);

  const cookies = creds.mynjUsername ? await myNjLogin(creds.mynjUsername, creds.mynjPassword) : [];
  const portal = new UezPortal({ username: creds.username, password: creds.password, cookies, delayMs: 600 });
  const info = await portal.login();
  console.log(`Logged in as ${info.portalUser} (${info.zoneName}). Crawling…`);

  const pages = new Map();        // page id -> description
  const otherLinks = new Set();   // links outside app 404 (recorded, not followed)
  const skipped = new Set();      // links not followed for safety
  const reports = new Map();      // report URL (no session) -> { name, url }
  const queue = [{ page: '1', url: `f?p=404:1:${portal.session}`, from: 'start' }];

  const consider = (link, from) => {
    if (/rwservlet/i.test(link)) {
      const url = link.startsWith('http') ? link : new URL(link, `${APEX}/`).toString();
      const name = (url.match(/report=([^&]+)/i) || [])[1] || url;
      const key = url.replace(/[?&](?:p_session|session)[^&]*/gi, '');
      if (!reports.has(key)) reports.set(key, { name: decodeURIComponent(name).toUpperCase(), url, from });
      return;
    }
    const fp = parseFp(link);
    if (!fp) {
      if (/^https?:/i.test(link) && !/portal03\.nj\.gov\/ords_apex_oit\/(?:r\/|wwv_flow|apex_|i\/|f\?)/i.test(link) && !/\.(css|js|png|gif|jpg|svg|ico|woff2?)(\?|$)/i.test(link)) otherLinks.add(link);
      return;
    }
    if (fp.app !== '404') { otherLinks.add(link); return; }
    if (fp.request || UNSAFE.test(fp.page) || /^(101|LOGIN)$/i.test(fp.page)) { skipped.add(`${fp.page}${fp.request ? ` (request ${fp.request})` : ''}`); return; }
    if (pages.has(fp.page) || queue.some((q) => q.page === fp.page)) return;
    const tail = [fp.request, '', fp.clearCache, fp.items, fp.values].join(':').replace(/:+$/, '');
    queue.push({ page: fp.page, url: `f?p=404:${fp.page}:${portal.session}${tail ? `:${tail}` : ''}`, from });
  };

  while (queue.length && pages.size < maxPages) {
    const { page, url, from } = queue.shift();
    try {
      const res = await portal.http(url);
      const html = String(res.body);
      fs.writeFileSync(path.join(outDir, 'pages', `page-${page}.html`), html);
      const d = describePage(html);
      pages.set(page, { page, from, ...d });
      console.log(`  page ${page}: ${d.title || d.headings[0] || '(untitled)'}`);
      for (const link of extractLinks(html)) consider(link, `page ${page}`);
    } catch (e) {
      pages.set(page, { page, from, error: e.message });
      console.log(`  page ${page}: ERROR ${e.message}`);
    }
  }

  if (fetchReports) {
    for (const r of reports.values()) {
      const safeName = r.name.replace(/[^A-Z0-9_.-]/gi, '_');
      try {
        const res = await portal.http(r.url, { binary: true, headers: { Referer: `${APEX}/f?p=404:1:${portal.session}` } });
        const isPdf = res.body.subarray(0, 5).toString().startsWith('%PDF');
        fs.writeFileSync(path.join(outDir, 'reports', `${safeName}${isPdf ? '.pdf' : '.html'}`), res.body);
        r.kind = isPdf ? 'pdf' : (res.contentType || 'unknown');
        r.bytes = res.body.length;
        if (isPdf) {
          try {
            const text = await pdfToText(res.body);
            fs.writeFileSync(path.join(outDir, 'reports', `${safeName}.txt`), text);
            r.preview = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).slice(0, 25);
          } catch (e) { r.preview = [`(pdftotext unavailable: ${e.message})`]; }
        } else {
          r.preview = clean(res.body.toString('utf8').replace(/<[^>]+>/g, ' ')).slice(0, 400).split('\n');
        }
        console.log(`  report ${r.name}: ${r.kind}, ${r.bytes} bytes`);
      } catch (e) {
        r.error = e.message;
        console.log(`  report ${r.name}: ERROR ${e.message}`);
      }
    }
  }
  await portal.logout();

  const summary = { zone: info.zoneName, user: info.portalUser, crawledAt: new Date().toISOString(), pages: [...pages.values()], reports: [...reports.values()].map(({ url, ...r }) => ({ ...r, url: url.replace(/(session[^&]*=)[^&]+/gi, '$1…') })), otherLinks: [...otherLinks], skipped: [...skipped] };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

  const md = [`# UEZ portal discovery — ${info.zoneName}`, `Logged in as ${info.portalUser}, ${summary.crawledAt}. ${pages.size} pages, ${reports.size} reports.`, ''];
  for (const p of summary.pages) {
    md.push(`## Page ${p.page} — ${p.title || p.headings?.[0] || '(untitled)'}`, `_found via ${p.from}_`);
    if (p.error) { md.push(`**Error:** ${p.error}`, ''); continue; }
    if (p.headings.length) md.push(`- **Sections:** ${p.headings.join(' · ')}`);
    if (p.buttons.length) md.push(`- **Buttons (not clicked):** ${p.buttons.join(' · ')}`);
    for (const f of p.fields) {
      const opts = f.options ? `: ${f.options.slice(0, 30).map((o) => `${o.text}${o.value && o.value !== o.text ? ` [${o.value}]` : ''}`).join(', ')}${f.options.length > 30 ? ` … (+${f.options.length - 30})` : ''}` : '';
      md.push(`- field \`${f.id}\` (${f.type})${f.label ? ` "${f.label}"` : ''}${opts}`);
    }
    for (const t of p.tables) md.push(`- table (${t.rowCount} rows): ${t.headers.join(' | ')}`, ...t.sample.map((r) => `    - ${r.join(' | ')}`));
    if (p.reportNames.length) md.push(`- **Reports referenced:** ${p.reportNames.join(', ')}`);
    md.push('');
  }
  md.push('## Oracle Reports');
  for (const r of summary.reports) {
    md.push(`### ${r.name}`, `_found on ${r.from}_ — ${r.error ? `ERROR ${r.error}` : `${r.kind}, ${r.bytes} bytes`}`);
    if (r.preview) md.push('```', ...r.preview, '```');
  }
  md.push('', '## Links outside the app (not followed)', ...summary.otherLinks.map((l) => `- ${l}`));
  md.push('', '## Skipped for safety', ...summary.skipped.map((l) => `- ${l}`));
  fs.writeFileSync(path.join(outDir, 'summary.md'), md.join('\n'));
  console.log(`\nDone. ${pages.size} pages, ${reports.size} reports. See ${path.join(outDir, 'summary.md')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
