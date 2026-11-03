// Step 1 of running the portal's parameterized reports: for every report option the login's menus offer,
// select it (exactly what the dropdown's onchange does — a page submit with no request) and save the
// options form the portal renders back. Nothing is run yet; this maps what each report asks for.
//
//   node scripts/uezReportForms.js [--org <orgId>] [--out <dir>]
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { arg, clean, openScriptPortal, submitPage } = require('./uezApexForm');

function describeForm(html, pageNo) {
  const $ = cheerio.load(html);
  const label = (id) => clean($(`label[for="${id}"]`).first().text()) || clean($(`#${id}`).closest('tr').find('td').first().text()).slice(0, 80);
  const fields = $(`[id^="P${pageNo}_"]`).filter((_, el) => ['input', 'select', 'textarea'].includes(el.tagName)).map((_, el) => {
    const id = $(el).attr('id');
    const type = el.tagName === 'select' ? 'select' : ($(el).attr('type') || el.tagName);
    const f = { id, name: $(el).attr('name'), type, label: label(id), value: $(el).attr('value') || '' };
    if (type === 'select') f.options = $(el).find('option').map((__, o) => ({ value: $(o).attr('value') || '', text: clean($(o).text()), selected: $(o).is('[selected]') })).get();
    return f;
  }).get();
  const actions = [...new Set([...html.matchAll(/(?:doSubmit|apex\.submit)\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]))];
  const reportId = (html.match(/p_report_id=(\d+)/) || [])[1] || null;
  const errors = $('.htmldbStdErr, .t-Alert--warning, .apex-page-error, #apex_error, .htmldbErrorMessage').map((_, el) => clean($(el).text())).get().filter(Boolean);
  return { fields, actions, reportId, errors };
}

async function main() {
  const outDir = path.resolve(arg('out', `uez-discovery-${new Date().toISOString().slice(0, 10)}`), 'forms');
  fs.mkdirSync(outDir, { recursive: true });
  const { portal, info } = await openScriptPortal();
  console.log(`Logged in as ${info.portalUser} (${info.zoneName}).`);

  // Menus the login is offered: page 13 selects, page 10 radio, page 9 select.
  const menus = [
    { pageNo: 13, item: 'P13_ADHOC_LIST' },
    { pageNo: 10, item: 'P10_RECERT_APP_RADIO' },
    { pageNo: 9, item: 'P9_SELECT_LIST' }
  ];
  const results = [];
  for (const { pageNo, item } of menus) {
    const first = await portal.http(`f?p=404:${pageNo}:${portal.session}`);
    const $ = cheerio.load(first.body);
    const opts = $(`[name="${item}"]`).toArray().flatMap((el) => (el.tagName === 'select'
      ? $(el).find('option').map((_, o) => ({ value: $(o).attr('value'), text: clean($(o).text()) })).get()
      : [{ value: $(el).attr('value'), text: label$($, el) }])).filter((o) => o.value && o.value !== '0');
    for (const o of opts) {
      try {
        const page = await portal.http(`f?p=404:${pageNo}:${portal.session}`);
        const res = await submitPage(portal, page, pageNo, { [item]: o.value });
        const file = `p${pageNo}-${item}-${o.value}.html`;
        fs.writeFileSync(path.join(outDir, file), res.body);
        const form = describeForm(res.body, pageNo);
        results.push({ pageNo, item, value: o.value, text: o.text, file, ...form });
        console.log(`  page ${pageNo} ${o.text}: ${form.fields.length} fields, actions [${form.actions.join(', ')}]${form.errors.length ? ` ERR ${form.errors.join(' | ')}` : ''}`);
      } catch (e) {
        results.push({ pageNo, item, value: o.value, text: o.text, error: e.message });
        console.log(`  page ${pageNo} ${o.text}: ERROR ${e.message}`);
      }
    }
  }
  await portal.logout();
  fs.writeFileSync(path.join(outDir, 'forms.json'), JSON.stringify(results, null, 2));
  console.log(`\nSaved ${results.length} forms to ${outDir}`);
}

function label$($, el) {
  const id = $(el).attr('id');
  return clean($(`label[for="${id}"]`).text()) || $(el).attr('value');
}

main().catch((e) => { console.error(e); process.exit(1); });
