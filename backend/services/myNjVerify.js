// Checks that a business's own myNJ login actually works, by signing in for
// real in headless Chromium (myNJ sits behind Imperva bot protection, so
// plain HTTP gets a bot-check page). Ported from EZminder's working sign-in.
//
// verifyMyNjLogin() never throws. It always resolves to { code, question? }:
//   ok               myNJ accepted the login
//   bad_mynj         wrong Login ID or password          (applicant must fix)
//   mynj_locked      myNJ temporarily locked the login   (wait; NEVER retry automatically)
//   needs_challenge  myNJ asked a security question and we have no answer
//   bad_challenge    the security answer was wrong
//   blocked          bot check, login form never appeared  (our side)
//   http / layout    timeout or network error / page changed (our side)
//   setup            Chromium missing or failed to start     (our side)
//   busy             too many checks running right now       (our side)
// Text from state pages never leaves this file except the applicant's own
// security question (so they know which one to answer).

const MYNJ_LOGIN_URL = process.env.MYNJ_LOGIN_URL || 'https://my.nj.gov/aui/Login';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const BROWSER_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'];
const CONTEXT_OPTS = { userAgent: UA, locale: 'en-US', timezoneId: 'America/New_York', viewport: { width: 1280, height: 860 } };
const MAX_BROWSERS = Math.max(1, Number(process.env.UEZ_MAX_BROWSERS) || 2);
const MAX_ROUNDS = 3;

const USER_FIXABLE_CODES = new Set(['bad_mynj', 'mynj_locked', 'needs_challenge', 'bad_challenge']);

function visibleText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pure page classifier, run on the HTML myNJ returns after a submit.
// Order matters: bad password, locked, challenge, plain form, ok.
function classifyMyNjPage(html) {
  const text = visibleText(html);
  const hasToken1 = /\bIDToken1\b/.test(html);
  const hasToken2 = /\bIDToken2\b/.test(html);
  if (/unable to log you on|Invalid ID or Password/i.test(text)) return 'bad_password';
  if (/won't be able to log in for a few minutes|locked/i.test(text)) return 'locked';
  if (hasToken1 && !hasToken2 && /challenge|security question|secret question|answer/i.test(text)) return 'challenge';
  if (hasToken1) return 'login_form';
  return 'ok';
}

// One small server-wide limit on Chromium: a person is waiting on screen, so
// when every slot is taken we answer "busy" right away instead of queueing.
let browsersInUse = 0;
function takeBrowserSlot() {
  if (browsersInUse >= MAX_BROWSERS) return false;
  browsersInUse += 1;
  return true;
}
function releaseBrowserSlot() { browsersInUse = Math.max(0, browsersInUse - 1); }

async function submitLoginForm(page) {
  let nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
  await page.click('input[name="Login.Submit"], input[type="submit"], button[type="submit"]').catch(() => {});
  if (!(await nav)) {
    nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    await page.evaluate(() => document.forms.Login && document.forms.Login.submit()).catch(() => {});
    await nav;
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
}

// The applicant's own security question, if the page labels it clearly.
async function readChallengeQuestion(page) {
  const label = await page.evaluate(() => {
    const field = document.querySelector('#IDToken1');
    const byFor = field && document.querySelector(`label[for="${field.id}"]`);
    return (byFor && byFor.innerText) || '';
  }).catch(() => '');
  const question = String(label || '').replace(/\s+/g, ' ').trim();
  return question && question.length <= 200 && question.endsWith('?') ? question : null;
}

async function verifyMyNjLogin({ username, password, challengeAnswer } = {}) {
  if (!username || !password) return { code: 'bad_mynj' };
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (_) { return { code: 'setup' }; }
  if (!takeBrowserSlot()) return { code: 'busy' };

  let browser;
  try {
    try {
      browser = await chromium.launch({ args: BROWSER_ARGS });
    } catch (_) {
      return { code: 'setup' };
    }
    const context = await browser.newContext(CONTEXT_OPTS);
    await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    const page = await context.newPage();

    await page.goto(MYNJ_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
      await page.waitForSelector('#IDToken1', { timeout: 45000 });
    } catch (_) {
      return { code: 'blocked' };
    }
    await page.fill('#IDToken1', username);
    await page.fill('#IDToken2', password);
    await submitLoginForm(page);

    let answered = false;
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const result = classifyMyNjPage(await page.content());
      if (result === 'ok') return { code: 'ok' };
      if (result === 'locked') return { code: 'mynj_locked' };
      if (result === 'bad_password') return { code: answered ? 'bad_challenge' : 'bad_mynj' };
      if (result === 'login_form') return { code: answered ? 'bad_challenge' : 'bad_mynj' };
      // challenge
      if (answered) return { code: 'bad_challenge', question: await readChallengeQuestion(page) };
      if (!challengeAnswer) return { code: 'needs_challenge', question: await readChallengeQuestion(page) };
      await page.fill('#IDToken1', challengeAnswer);
      await submitLoginForm(page);
      answered = true;
    }
    return { code: 'layout' };
  } catch (err) {
    // Playwright errors carry selectors/URLs/call logs - reduce to a fixed code.
    return { code: /timeout|net::|ECONN|ENOTFOUND|EAI_AGAIN/i.test(String(err?.message || '')) ? 'http' : 'layout' };
  } finally {
    if (browser) await browser.close().catch(() => {});
    releaseBrowserSlot();
  }
}

// Plain-English messages for the applicant, one per code.
const MYNJ_CHECK_MESSAGES = {
  bad_mynj: "MyNJ didn't accept that username and password. Double-check them and try again.",
  mynj_locked: "MyNJ has temporarily locked this login after too many tries. Wait a few minutes, then try again.",
  needs_challenge: 'MyNJ asked one of your security questions. Enter the answer to finish checking your login.',
  bad_challenge: "MyNJ didn't accept that security answer. Check it and try again.",
};

module.exports = { verifyMyNjLogin, classifyMyNjPage, visibleText, USER_FIXABLE_CODES, MYNJ_CHECK_MESSAGES };
