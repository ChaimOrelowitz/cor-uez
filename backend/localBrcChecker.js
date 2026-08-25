const http = require('http');
const crypto = require('crypto');
const { chromium } = require('playwright');
const { brcLookupDescriptor, parseBrcCertificateHtml } = require('./utils/uezBrc');

const HOST = '127.0.0.1';
const PORT = Number(process.env.BRC_CHECKER_PORT || 4318);
const NJ_FORM_URL = 'https://www1.state.nj.us/TYTR_BRC/jsp/BRCLoginJsp.jsp';
const NJ_TAX_REVENUE_URL = 'https://www1.nj.gov/TYTR_ACE_App/servlet/common/portalRequest';
const NJ_PBS_HOME_URL = 'https://www16.state.nj.us/NJ_PREMIER_EBIZ/jsp/home.jsp';
const JOB_TIMEOUT_MS = 25 * 60 * 1000;
const jobs = new Map();

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': res.allowedOrigin || 'https://cor-uez.vercel.app',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Private-Network': 'true',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function allowedOrigin(origin) {
  return origin === 'https://cor-uez.vercel.app' ||
    origin === 'https://uez.corsolutions.io' ||
    /^https:\/\/cor-uez-[a-z0-9-]+\.vercel\.app$/i.test(origin || '') ||
    /^http:\/\/localhost:\d+$/i.test(origin || '');
}

function allowedApiBase(value) {
  const normalized = String(value || '').replace(/\/$/, '');
  if (normalized === 'https://cor-uez-api.onrender.com') return normalized;
  if (/^http:\/\/localhost:\d+$/i.test(normalized)) return normalized;
  throw new Error('The checker only connects to the COR UEZ API.');
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

async function apiRequest(job, path, options = {}) {
  const headers = {
    Authorization: `Bearer ${job.accessToken}`,
    ...(options.headers || {})
  };
  const response = await fetch(`${job.apiBase}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `UEZ returned ${response.status}.`);
  return data;
}

async function uploadBrc(job, pdf, result) {
  const certificate = String(result.certificateNumber || job.applicationId).replace(/[^a-zA-Z0-9_-]/g, '-');
  const body = new FormData();
  body.append('documentType', 'brc');
  body.append('file', new Blob([pdf], { type: 'application/pdf' }), `NJ-BRC-${certificate}.pdf`);

  await apiRequest(job, `/api/uez/applications/${job.applicationId}/documents`, {
    method: 'POST',
    body
  });

  await apiRequest(job, `/api/uez/admin/applications/${job.applicationId}/brc-found`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      registeredBusinessName: result.taxpayerName || job.businessName,
      tradeName: result.tradeName || '',
      address: result.address || '',
      certificateNumber: result.certificateNumber || '',
      effectiveDate: result.effectiveDate || '',
      issuanceDate: result.issuanceDate || ''
    })
  });
}

async function uploadTaxClearance(job, pdf, suggestedFilename) {
  const safeBusinessName = String(job.businessName || job.applicationId)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || job.applicationId;
  const originalName = String(suggestedFilename || 'Tax-Clearance.pdf');
  const filename = /\.pdf$/i.test(originalName) ? originalName : `NJ-Tax-Clearance-${safeBusinessName}.pdf`;
  const body = new FormData();
  body.append('documentType', 'tax_clearance');
  body.append('file', new Blob([pdf], { type: 'application/pdf' }), filename);

  await apiRequest(job, `/api/uez/applications/${job.applicationId}/documents`, {
    method: 'POST',
    body
  });
}

async function getMyNjCredentials(job) {
  const result = await apiRequest(job, `/api/uez/applications/${job.applicationId}/credentials/mynj`);
  if (!result.exists || !result.credentials?.username || !result.credentials?.password) {
    throw new Error('MyNJ / PBS login information is missing for this application.');
  }
  return result.credentials;
}

async function downloadToBuffer(download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('New Jersey did not provide a downloadable tax-clearance file.');
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('The downloaded tax-clearance file was not a PDF. Try the download again.');
  }
  return buffer;
}

async function markNotFound(job) {
  await apiRequest(job, `/api/uez/admin/applications/${job.applicationId}/brc-not-found`, {
    method: 'POST'
  });
}

async function findResult(context) {
  for (const page of context.pages()) {
    const html = await page.content().catch(() => '');
    const parsed = parseBrcCertificateHtml(html);
    if (parsed.status === 'found' || parsed.status === 'not_found') return { page, parsed };
  }
  return null;
}

async function fillAndSubmit(page, lookup) {
  const nameInput = page.locator('input[name="pinnctl"]');
  const taxInput = page.locator('input[name="pinidnum"]');
  if (!(await nameInput.count()) || !(await taxInput.count())) return false;

  await nameInput.fill(String(lookup.nameControl || '').toLowerCase());
  await taxInput.fill(String(lookup.njTaxId || ''));
  const submit = page.locator('input[name="submit"], input[type="submit"], button[type="submit"]').first();
  if (!(await submit.count())) return false;
  await submit.click();
  return true;
}

async function runJob(job) {
  let browser;
  try {
    job.status = 'opening';
    browser = await chromium.launch({
      headless: false,
      args: ['--disable-dev-shm-usage']
    });
    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1200, height: 900 },
      acceptDownloads: true
    });
    const page = await context.newPage();
    job.status = 'waiting_for_nj';
    await page.goto(NJ_FORM_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

    let submitted = false;
    const deadline = Date.now() + JOB_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const outcome = await findResult(context);
      if (outcome?.parsed.status === 'found') {
        job.status = 'saving_pdf';
        const pdf = await outcome.page.pdf({
          format: 'Letter',
          printBackground: true,
          margin: { top: '0.35in', right: '0.35in', bottom: '0.35in', left: '0.35in' }
        });
        job.status = 'uploading';
        await uploadBrc(job, pdf, outcome.parsed);
        job.result = outcome.parsed;
        job.status = 'complete';
        return;
      }

      if (outcome?.parsed.status === 'not_found') {
        job.status = 'saving_not_found';
        await markNotFound(job);
        job.status = 'not_found';
        return;
      }

      if (!submitted) {
        for (const candidate of context.pages()) {
          if (await fillAndSubmit(candidate, job.lookup).catch(() => false)) {
            submitted = true;
            job.status = 'checking';
            break;
          }
        }
      } else {
        job.status = 'waiting_for_verification';
      }

      await new Promise((resolve) => setTimeout(resolve, 900));
    }

    throw new Error('The NJ check timed out. Start it again when you are ready.');
  } catch (err) {
    job.status = 'error';
    job.error = err.message || 'The BRC check failed.';
  } finally {
    job.accessToken = null;
    if (browser) await browser.close().catch(() => {});
  }
}

async function runTaxClearanceJob(job) {
  let browser;
  try {
    job.status = 'loading_pbs_credentials';
    const credentials = await getMyNjCredentials(job);
    job.status = 'opening_tax_clearance';
    browser = await chromium.launch({
      headless: false,
      args: ['--disable-dev-shm-usage']
    });
    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1200, height: 900 },
      acceptDownloads: true
    });

    let resolveDownload;
    let rejectDownload;
    let captured = false;
    const downloadPromise = new Promise((resolve, reject) => {
      resolveDownload = resolve;
      rejectDownload = reject;
    });
    const watchPage = (page) => {
      page.on('download', async (download) => {
        if (captured) return;
        captured = true;
        try {
          const pdf = await downloadToBuffer(download);
          resolveDownload({ pdf, filename: download.suggestedFilename() });
        } catch (err) {
          rejectDownload(err);
        }
      });
    };
    context.on('page', watchPage);

    const page = await context.newPage();
    watchPage(page);
    job.status = 'waiting_for_pbs';
    await page.goto(NJ_PBS_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

    let loginOpened = false;
    let loginSubmitted = false;
    let taxCenterOpened = false;
    let incentiveClicked = false;
    let downloadClicked = false;
    const workflowDeadline = Date.now() + JOB_TIMEOUT_MS;

    while (Date.now() < workflowDeadline && !captured) {
      for (const candidate of context.pages()) {
        const loginLink = candidate.locator('a[href*="my.nj.gov/aui/Login"]');
        if (!loginOpened && !loginSubmitted && await loginLink.count()) {
          job.status = 'opening_mynj_login';
          await loginLink.first().click();
          loginOpened = true;
          continue;
        }

        const username = candidate.locator('input[name="IDToken1"]');
        const password = candidate.locator('input[name="IDToken2"]');
        if (!loginSubmitted && await username.count() && await password.count()) {
          job.status = 'signing_in_to_pbs';
          await username.fill(credentials.username);
          await password.fill(credentials.password);
          const loginButton = candidate.locator('input[type="submit"], button[type="submit"]').first();
          if (!await loginButton.count()) throw new Error('The MyNJ login button could not be found.');
          await loginButton.click();
          loginSubmitted = true;
          job.status = 'waiting_for_pbs_home';
          continue;
        }

        const taxCenterLink = candidate.locator('a[href*="TYTR_ACE_App/servlet/common/portalRequest"]')
          .or(candidate.getByText('Tax & Revenue Center', { exact: true })).first();
        if (!taxCenterOpened && await taxCenterLink.count()) {
          job.status = 'opening_tax_revenue_center';
          await taxCenterLink.click();
          taxCenterOpened = true;
          continue;
        }

        const incentiveButton = candidate.locator('input[name="Submit"][value="Business Incentive Tax Clearance"]');
        if (!incentiveClicked && await incentiveButton.count()) {
          job.status = 'opening_business_incentive_clearance';
          await incentiveButton.click();
          incentiveClicked = true;
          job.status = 'waiting_for_human_verification';
          continue;
        }

        const department = candidate.locator('select[name="ClearanceDept"]');
        const downloadButton = candidate.locator('input[name="Submit"][value="Download Clearance Letter"]');
        if (!downloadClicked && await department.count() && await downloadButton.count()) {
          job.status = 'requesting_tax_clearance_pdf';
          await department.selectOption({ label: 'New Jersey Department of Community Affairs' });
          await downloadButton.click();
          downloadClicked = true;
          job.status = 'waiting_for_tax_clearance_download';
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    credentials.username = null;
    credentials.password = null;
    credentials.challengeAnswer = null;
    if (!captured) throw new Error('The tax-clearance session timed out. Start it again when you are ready.');

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('The tax-clearance download timed out. Start it again when you are ready.')), 60000);
    });
    const downloaded = await Promise.race([downloadPromise, timeoutPromise]);
    job.status = 'uploading_tax_clearance';
    await uploadTaxClearance(job, downloaded.pdf, downloaded.filename);
    job.result = { filename: downloaded.filename };
    job.status = 'complete';
  } catch (err) {
    job.status = 'error';
    job.error = err.message || 'The tax-clearance download failed.';
  } finally {
    job.accessToken = null;
    if (browser) await browser.close().catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  const origin = String(req.headers.origin || '');
  res.allowedOrigin = allowedOrigin(origin) ? origin : 'https://cor-uez.vercel.app';

  if (req.method === 'OPTIONS') {
    if (!allowedOrigin(origin)) return send(res, 403, { error: 'Origin not allowed.' });
    return send(res, 204, {});
  }

  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, service: 'COR UEZ local document checker' });
  }

  if (req.method === 'POST' && req.url === '/tax-clearance') {
    try {
      if (!allowedOrigin(origin)) return send(res, 403, { error: 'Open the checker from the COR UEZ admin site.' });
      if ([...jobs.values()].some((job) => !['complete', 'not_found', 'error'].includes(job.status))) {
        return send(res, 409, { error: 'A UEZ document check is already running on this computer.' });
      }

      const body = await readJson(req);
      const applicationId = String(body.applicationId || '').trim();
      const businessName = String(body.businessName || '').trim();
      const accessToken = String(body.accessToken || '');
      if (!applicationId || !businessName || !accessToken) throw new Error('The selected UEZ application is incomplete.');

      const id = crypto.randomUUID();
      const job = {
        id,
        type: 'tax_clearance',
        applicationId,
        businessName,
        apiBase: allowedApiBase(body.apiBase),
        accessToken,
        status: 'queued',
        error: null,
        result: null,
        createdAt: Date.now()
      };
      jobs.set(id, job);
      runTaxClearanceJob(job);
      return send(res, 202, { id, status: job.status });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  if (req.method === 'POST' && req.url === '/check') {
    try {
      if (!allowedOrigin(origin)) return send(res, 403, { error: 'Open the checker from the COR UEZ admin site.' });
      if ([...jobs.values()].some((job) => !['complete', 'not_found', 'error'].includes(job.status))) {
        return send(res, 409, { error: 'A BRC check is already running on this computer.' });
      }

      const body = await readJson(req);
      const applicationId = String(body.applicationId || '').trim();
      const businessName = String(body.businessName || '').trim();
      const ein = String(body.ein || '').trim();
      const accessToken = String(body.accessToken || '');
      if (!applicationId || !businessName || !ein || !accessToken) throw new Error('The selected UEZ application is incomplete.');

      const lookup = brcLookupDescriptor({ business_name_input: businessName, ein });
      const id = crypto.randomUUID();
      const job = {
        id,
        applicationId,
        businessName,
        lookup,
        apiBase: allowedApiBase(body.apiBase),
        accessToken,
        status: 'queued',
        error: null,
        result: null,
        createdAt: Date.now()
      };
      jobs.set(id, job);
      runJob(job);
      return send(res, 202, { id, status: job.status, lookup });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  const match = req.method === 'GET' && req.url.match(/^\/jobs\/([a-f0-9-]+)$/i);
  if (match) {
    const job = jobs.get(match[1]);
    if (!job) return send(res, 404, { error: 'BRC check not found.' });
    return send(res, 200, {
      id: job.id,
      status: job.status,
      error: job.error,
      result: job.result,
      lookup: job.lookup
    });
  }

  return send(res, 404, { error: 'Not found.' });
});

server.listen(PORT, HOST, () => {
  console.log(`COR UEZ local document checker is ready at http://${HOST}:${PORT}`);
  console.log('Leave this window open while running BRC or tax-clearance checks from the UEZ admin page.');
});
