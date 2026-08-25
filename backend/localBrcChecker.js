const http = require('http');
const crypto = require('crypto');
const { chromium } = require('playwright');
const { brcLookupDescriptor, parseBrcCertificateHtml } = require('./utils/uezBrc');

const HOST = '127.0.0.1';
const PORT = Number(process.env.BRC_CHECKER_PORT || 4318);
const NJ_FORM_URL = 'https://www1.state.nj.us/TYTR_BRC/jsp/BRCLoginJsp.jsp';
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

const server = http.createServer(async (req, res) => {
  const origin = String(req.headers.origin || '');
  res.allowedOrigin = allowedOrigin(origin) ? origin : 'https://cor-uez.vercel.app';

  if (req.method === 'OPTIONS') {
    if (!allowedOrigin(origin)) return send(res, 403, { error: 'Origin not allowed.' });
    return send(res, 204, {});
  }

  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, service: 'COR UEZ local BRC checker' });
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
  console.log(`COR UEZ BRC checker is ready at http://${HOST}:${PORT}`);
  console.log('Leave this window open while running BRC checks from the UEZ admin page.');
});
