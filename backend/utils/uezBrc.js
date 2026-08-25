const { chromium } = require('playwright');

const BRC_LOOKUP_URL = 'https://www1.state.nj.us/TYTR_BRC/servlet/common/BRCLogin';
const BRC_REFERER = 'https://www1.state.nj.us/TYTR_BRC/jsp/BRCLoginJsp.jsp';

function normalizeEin(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 9);
}

function buildNjTaxId(ein) {
  const normalized = normalizeEin(ein);
  if (normalized.length !== 9) throw new Error('A valid 9-digit EIN is required for the BRC lookup.');
  return `${normalized}000`;
}

function buildNameControl(businessName) {
  const normalized = String(businessName || '').trim().toUpperCase().replace(/[^A-Z0-9&-]/g, '');
  if (!normalized) throw new Error('Business name is required for the BRC lookup.');
  return normalized.slice(0, 4).padEnd(4, '-');
}

function brcLookupDescriptor(application) {
  if (!application) throw new Error('Application is required');
  const businessName = application.registered_business_name || application.business_name_input || null;
  return {
    businessName,
    nameControl: buildNameControl(businessName),
    ein: normalizeEin(application.ein),
    njTaxId: buildNjTaxId(application.ein)
  };
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function htmlToText(html) {
  return decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function between(text, startLabel, endLabel) {
  const start = text.indexOf(startLabel);
  if (start < 0) return null;
  const from = start + startLabel.length;
  const end = endLabel ? text.indexOf(endLabel, from) : text.length;
  return text.slice(from, end < 0 ? text.length : end).trim() || null;
}

function parseBrcCertificateHtml(html) {
  const raw = String(html || '');
  if (
    /Request unsuccessful\. Incapsula incident ID/i.test(raw) ||
    /_Incapsula_Resource/i.test(raw) ||
    /hcaptcha/i.test(raw) ||
    /captcha/i.test(raw)
  ) return { status: 'challenge_required' };

  const text = htmlToText(raw);
  if (/There was no match on the fields entered\./i.test(text)) return { status: 'not_found' };
  if (!/BUSINESS REGISTRATION CERTIFICATE/i.test(text) || !/Certificate Number:/i.test(text)) {
    return { status: 'unrecognized_response', text: text.slice(0, 1000) };
  }

  return {
    status: 'found',
    taxpayerName: between(text, 'Taxpayer Name:', 'Trade Name:'),
    tradeName: between(text, 'Trade Name:', 'Address:'),
    address: between(text, 'Address:', 'Certificate Number:'),
    certificateNumber: between(text, 'Certificate Number:', 'Effective Date:'),
    effectiveDate: between(text, 'Effective Date:', 'Date of Issuance:'),
    issuanceDate: between(text, 'Date of Issuance:', 'For Office Use Only:')
  };
}

async function lookupBrc(application) {
  const lookup = brcLookupDescriptor(application);
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1280, height: 900 }
    });
    const page = await context.newPage();

    await page.goto(BRC_REFERER, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(1200);

    let html = await page.content();
    let parsed = parseBrcCertificateHtml(html);
    if (parsed.status === 'challenge_required') {
      return { engine: 'playwright', httpStatus: null, finalUrl: page.url(), lookup, ...parsed, html };
    }

    const nameInput = page.locator('input[name="pinnctl"]');
    const idInput = page.locator('input[name="pinidnum"]');
    if ((await nameInput.count()) === 0 || (await idInput.count()) === 0) {
      return {
        engine: 'playwright',
        httpStatus: null,
        finalUrl: page.url(),
        lookup,
        status: 'unrecognized_response',
        text: htmlToText(html).slice(0, 1000),
        html
      };
    }

    await nameInput.fill(lookup.nameControl.toLowerCase());
    await idInput.fill(lookup.njTaxId);

    const corpInput = page.locator('input[name="pincorpid"]');
    const casinoInput = page.locator('input[name="pincasinoid"]');
    if (await corpInput.count()) await corpInput.fill('');
    if (await casinoInput.count()) await casinoInput.fill('');

    const submit = page.locator('input[type="submit"], button[type="submit"]').first();
    if ((await submit.count()) === 0) throw new Error('NJ BRC submit button was not found.');

    const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
    const navigationPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
    await submit.click();

    const popup = await popupPromise;
    await navigationPromise;
    const resultPage = popup || page;
    await resultPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => null);
    await resultPage.waitForTimeout(1500);

    html = await resultPage.content();
    parsed = parseBrcCertificateHtml(html);

    let certificatePdfBase64 = null;
    if (parsed.status === 'found') {
      const pdf = await resultPage.pdf({
        format: 'Letter',
        printBackground: true,
        margin: { top: '0.35in', right: '0.35in', bottom: '0.35in', left: '0.35in' }
      });
      certificatePdfBase64 = pdf.toString('base64');
    }

    return {
      engine: 'playwright',
      httpStatus: null,
      finalUrl: resultPage.url(),
      lookup,
      ...parsed,
      certificatePdfBase64,
      html
    };
  } catch (error) {
    return {
      engine: 'playwright',
      lookup,
      status: 'browser_error',
      text: error.message
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = {
  BRC_LOOKUP_URL,
  normalizeEin,
  buildNjTaxId,
  buildNameControl,
  brcLookupDescriptor,
  parseBrcCertificateHtml,
  lookupBrc
};
