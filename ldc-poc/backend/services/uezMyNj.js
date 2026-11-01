// myNJ login in a real headless Chrome (myNJ is behind Imperva bot protection, so plain HTTP is blocked).
// Returns the .nj.gov session cookies so the fast HTTP client can use the UEZ portal.
const { PortalError, UA } = require('./uezPortal');

const MYNJ_LOGIN = 'https://my.nj.gov/aui/Login';
const UEZ_LOGIN = 'https://portal03.nj.gov/ords_apex_oit/f?p=404:LOGIN';

function visibleText(html) {
  return String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function myNjLogin(username, password) {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (_) {
    throw new PortalError('setup', 'Headless browser is not installed on the server.');
  }
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] });
  try {
    const context = await browser.newContext({ userAgent: UA, locale: 'en-US', timezoneId: 'America/New_York', viewport: { width: 1280, height: 860 } });
    await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    const page = await context.newPage();

    await page.goto(MYNJ_LOGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Imperva may show a JS challenge first; wait for the real form.
    try {
      await page.waitForSelector('#IDToken1', { timeout: 45000 });
    } catch (_) {
      throw new PortalError('blocked', `myNJ login page did not load (bot check?). Page said: ${visibleText(await page.content()).slice(0, 200)}`);
    }
    await page.fill('#IDToken1', username);
    await page.fill('#IDToken2', password);
    // The "Log In" button calls the page's own subOnce('Login'); fall back to submitting the form directly.
    let nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    await page.click('input[name="Login.Submit"]').catch(() => {});
    if (!(await nav)) {
      try {
        nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
        await page.evaluate(() => document.forms.Login && document.forms.Login.submit());
        await nav;
      } catch (_) { /* already navigating */ }
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    const afterLogin = visibleText(await page.content());
    if (/unable to log you on|Invalid ID or Password/i.test(afterLogin)) {
      throw new PortalError('bad_mynj', 'myNJ rejected that login ID or password.');
    }
    if (/won't be able to log in for a few minutes|locked/i.test(afterLogin)) {
      throw new PortalError('bad_mynj', 'myNJ has temporarily locked this login after failed attempts. Wait a few minutes.');
    }

    // Open the UEZ app through the SSO gate so portal03 gets its session too.
    await page.goto(UEZ_LOGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const uezPage = await page.content();
    if (!uezPage.includes('P101_USERNAME') && !/Your Zone is/i.test(uezPage)) {
      const txt = visibleText(uezPage);
      if (/can't identify you|log in to myNJ/i.test(txt)) {
        throw new PortalError('mynj_session', `Logged into myNJ, but the UEZ portal still asked for myNJ. After login myNJ showed: ${afterLogin.slice(0, 160)}`);
      }
      throw new PortalError('layout', `UEZ login page did not appear after myNJ login. Page said: ${txt.slice(0, 200)}`);
    }

    return (await context.cookies()).filter((c) => /(^|\.)nj\.gov$/.test(c.domain.replace(/^\./, '')) || c.domain.endsWith('.nj.gov'));
  } finally {
    await browser.close().catch(() => {});
  }
}

// Verify a BUSINESS's own myNJ login (how they get into PBS to recertify).
// Unlike myNjLogin, this doesn't require the UEZ coordinator app — it just confirms
// myNJ accepts the credentials. Returns { ok: true } or throws PortalError.
async function verifyBusinessMyNj(username, password) {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (_) {
    throw new PortalError('setup', 'Headless browser is not installed on the server.');
  }
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] });
  try {
    const context = await browser.newContext({ userAgent: UA, locale: 'en-US', timezoneId: 'America/New_York', viewport: { width: 1280, height: 860 } });
    await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    const page = await context.newPage();

    await page.goto(MYNJ_LOGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
      await page.waitForSelector('#IDToken1', { timeout: 45000 });
    } catch (_) {
      throw new PortalError('blocked', 'myNJ login page did not load (bot check).');
    }
    await page.fill('#IDToken1', username);
    await page.fill('#IDToken2', password);
    let nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    await page.click('input[name="Login.Submit"]').catch(() => {});
    if (!(await nav)) {
      try {
        nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
        await page.evaluate(() => document.forms.Login && document.forms.Login.submit());
        await nav;
      } catch (_) { /* already navigating */ }
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    const after = visibleText(await page.content());
    if (/unable to log you on|Invalid ID or Password/i.test(after)) {
      throw new PortalError('bad_mynj', 'myNJ rejected that login ID or password.');
    }
    if (/won't be able to log in for a few minutes|locked/i.test(after)) {
      throw new PortalError('bad_mynj', 'myNJ temporarily locked this login after failed attempts. Wait a few minutes.');
    }
    // Success means we left the login form.
    if (await page.$('#IDToken1')) {
      throw new PortalError('bad_mynj', 'myNJ did not accept that login. Double-check the ID and password.');
    }
    return { ok: true };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { myNjLogin, verifyBusinessMyNj };
