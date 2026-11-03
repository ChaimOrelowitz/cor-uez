// Records the network traffic of a real browser session on the UEZ portal: myNJ -> UEZ login ->
// business listing -> run a statewide report from the Reports page and from Weekly Processing.
// Writes <out>/trace.har plus <out>/requests.json (every request, its type, status and size).
//
//   node scripts/uezNetTrace.js [--org <orgId>] [--out <dir>]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const supabase = require('../db/supabase');
const { UA } = require('../services/uezPortal');
const { getPortalLogin } = require('../services/uezZoneSync');
const { arg } = require('./uezApexForm');

const APEX = 'https://portal03.nj.gov/ords_apex_oit';

async function main() {
  const outDir = path.resolve(arg('out', `uez-discovery-${new Date().toISOString().slice(0, 10)}`), 'nettrace');
  fs.mkdirSync(outDir, { recursive: true });
  let orgId = arg('org', null);
  if (!orgId) orgId = (await supabase.from('uez_zone_portal_logins').select('org_id').eq('status', 'ok').limit(1)).data?.[0]?.org_id;
  const creds = await getPortalLogin(orgId);

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    userAgent: UA, locale: 'en-US', timezoneId: 'America/New_York', viewport: { width: 1280, height: 860 },
    recordHar: { path: path.join(outDir, 'trace.har'), content: 'embed' }, acceptDownloads: true
  });
  await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

  const log = [];
  let step = 'start';
  context.on('response', async (res) => {
    const req = res.request();
    const len = Number((await res.headerValue('content-length').catch(() => null)) || 0);
    log.push({ step, method: req.method(), type: req.resourceType(), status: res.status(), contentType: res.headers()['content-type'] || '', bytes: len, url: req.url(), post: req.method() === 'POST' ? (req.postData() || '').slice(0, 600) : undefined });
  });
  const page = await context.newPage();
  const mark = (s) => { step = s; console.log(`- ${s}`); };

  if (creds.mynjUsername) {
    mark('mynj-login');
    await page.goto('https://my.nj.gov/aui/Login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#IDToken1', { timeout: 45000 });
    await page.fill('#IDToken1', creds.mynjUsername);
    await page.fill('#IDToken2', creds.mynjPassword);
    await Promise.all([page.waitForNavigation({ timeout: 30000 }).catch(() => null), page.click('input[name="Login.Submit"]').catch(() => {})]);
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  }

  mark('uez-login');
  await page.goto(`${APEX}/f?p=404:LOGIN`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#P101_USERNAME', creds.username);
  await page.fill('#P101_PASSWORD', creds.password);
  await Promise.all([page.waitForNavigation({ timeout: 30000 }), page.evaluate(() => apex.submit('LOGIN'))]);
  await page.waitForLoadState('networkidle').catch(() => {});
  const session = (page.url().match(/f\?p=404:\d+:(\d+)/) || [])[1];
  if (!session) throw new Error(`Login did not reach the main menu: ${page.url()}`);

  mark('business-listing');
  await page.goto(`${APEX}/f?p=404:2:${session}`, { waitUntil: 'networkidle' });
  // Page forward once so the interactive report's data call shows up.
  await page.locator('.a-IRR-button--pagination, a.a-IRR-pagination-next, button[aria-label="Next"]').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});

  mark('reports-investment');
  await page.goto(`${APEX}/f?p=404:13:${session}`, { waitUntil: 'networkidle' });
  await Promise.all([page.waitForNavigation().catch(() => null), page.selectOption('#P13_ADHOC_LIST', '6')]);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.selectOption('#P13_REPORT_DTE', '2026/11/01');
  const popup = context.waitForEvent('page', { timeout: 60000 }).catch(() => null);
  await Promise.all([page.waitForNavigation().catch(() => null), page.evaluate(() => apex.submit({ request: 'SUBINVESTRPT' }))]);
  const rep = await popup;
  if (rep) await rep.waitForLoadState('load', { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);

  mark('weekly-app-summary');
  await page.goto(`${APEX}/f?p=404:9:${session}`, { waitUntil: 'networkidle' });
  await Promise.all([page.waitForNavigation().catch(() => null), page.selectOption('#P9_SELECT_LIST', '1')]);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.fill('#P9_START_DTE', '10/02/2026');
  await page.fill('#P9_END_DTE', '10/30/2026');
  const popup2 = context.waitForEvent('page', { timeout: 60000 }).catch(() => null);
  await Promise.all([page.waitForNavigation().catch(() => null), page.evaluate(() => apex.submit({ request: 'SUBAPPSUM' }))]);
  const rep2 = await popup2;
  if (rep2) await rep2.waitForLoadState('load', { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);

  mark('logout');
  await page.goto(`${APEX}/apex_authentication.logout?p_app_id=404&p_session_id=${session}`).catch(() => {});
  await context.close();
  await browser.close();
  // Never keep the credentials in the saved request bodies.
  const scrub = (s) => s && [creds.username, creds.password, creds.mynjUsername, creds.mynjPassword].filter(Boolean)
    .reduce((t, v) => t.split(v).join('***').split(encodeURIComponent(v)).join('***'), s);
  for (const r of log) r.post = scrub(r.post);
  fs.writeFileSync(path.join(outDir, 'requests.json'), JSON.stringify(log, null, 2));
  const har = path.join(outDir, 'trace.har');
  fs.writeFileSync(har, scrub(fs.readFileSync(har, 'utf8')));
  console.log(`\n${log.length} requests recorded -> ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
