const express = require('express');
const crypto = require('crypto');
const { chromium } = require('playwright');
const supabase = require('../db/supabase');
const { requireUezAdmin } = require('../middleware/uezAuth');
const { brcLookupDescriptor, parseBrcCertificateHtml } = require('../utils/uezBrc');

// Standalone, admin-authenticated take on the live/interactive BRC browser
// (mechanics copied from uezBrcLive.js) — this version is tied to a specific
// uez_applications row from the start, and adds a /save step that persists
// the captured certificate the same way uezBrc.js's admin/captured-certificate
// route does. Deliberately does not touch uezBrcLive.js or uezBrc.js.

const router = express.Router();
const BRC_FORM_URL = 'https://www1.state.nj.us/TYTR_BRC/jsp/BRCLoginJsp.jsp';
const DOCUMENT_BUCKET = 'uez-documents';
const VIEWPORT = { width: 1100, height: 850 };
const SESSION_TTL_MS = 15 * 60 * 1000;
const liveSessions = new Map();

function authSession(req) {
  const session = liveSessions.get(req.params.id);
  const token = String(req.query?.token || req.get('x-cor-live-token') || '');
  if (!session || !token || token !== session.token) return null;
  session.lastSeenAt = Date.now();
  return session;
}

async function closeBrowser(session) {
  if (session.monitor) {
    clearInterval(session.monitor);
    session.monitor = null;
  }
  if (session.browser) {
    const browser = session.browser;
    session.browser = null;
    session.page = null;
    try { await browser.close(); } catch (_) {}
  }
}

async function expireSessions() {
  const now = Date.now();
  for (const [id, session] of liveSessions.entries()) {
    if (now - session.lastSeenAt > SESSION_TTL_MS) {
      await closeBrowser(session);
      liveSessions.delete(id);
    }
  }
}
setInterval(expireSessions, 60 * 1000).unref();

async function pageHasHumanChallenge(page) {
  try {
    return await page.evaluate(() => {
      const text = String(document.body?.innerText || '');
      const html = String(document.documentElement?.innerHTML || '');
      return /verify you are human|request unsuccessful|incapsula|hcaptcha/i.test(`${text} ${html}`) ||
        Boolean(document.querySelector('iframe[src*="hcaptcha"], iframe[src*="captcha"], [class*="hcaptcha"]'));
    });
  } catch (_) {
    return false;
  }
}

async function inspectSession(session) {
  if (!session.page || ['found', 'not_found', 'error', 'closed'].includes(session.status)) return;
  if (session.inspecting) return;
  session.inspecting = true;

  try {
    const page = session.page;
    const html = await page.content();
    const parsed = parseBrcCertificateHtml(html);

    if (parsed.status === 'found') {
      session.status = 'found';
      session.result = {
        taxpayerName: parsed.taxpayerName,
        tradeName: parsed.tradeName,
        address: parsed.address,
        certificateNumber: parsed.certificateNumber,
        effectiveDate: parsed.effectiveDate,
        issuanceDate: parsed.issuanceDate
      };
      session.capturedHtml = html;
      try {
        session.documentPdf = await page.pdf({ format: 'Letter', printBackground: true });
      } catch (_) {
        session.documentPdf = null;
      }
      try {
        session.lastScreenshot = await page.screenshot({ type: 'jpeg', quality: 82 });
      } catch (_) {}
      await closeBrowser(session);
      return;
    }

    if (parsed.status === 'not_found') {
      session.status = 'not_found';
      try { session.lastScreenshot = await page.screenshot({ type: 'jpeg', quality: 82 }); } catch (_) {}
      await closeBrowser(session);
      return;
    }

    const challenged = await pageHasHumanChallenge(page);
    if (challenged) {
      session.status = 'challenge';
      session.challengeSeen = true;
      return;
    }

    const nameInput = page.locator('input[name="pinnctl"]');
    const taxInput = page.locator('input[name="pinidnum"]');
    const formReady = await nameInput.count() && await taxInput.count();

    if (formReady) {
      if (session.challengeSeen && session.status === 'challenge') session.submitted = false;
      if (!session.submitted) {
        session.status = 'submitting';
        await nameInput.fill(String(session.lookup.nameControl || '').toLowerCase());
        await taxInput.fill(String(session.lookup.njTaxId || ''));
        const submit = page.locator('input[name="submit"], input[type="submit"], button[type="submit"]').first();
        if (await submit.count()) {
          session.submitted = true;
          await submit.click({ timeout: 5000 }).catch(() => {});
          session.status = 'checking';
        } else {
          session.status = 'waiting_for_user';
        }
      }
    }
  } catch (err) {
    session.status = 'error';
    session.error = err.message;
    await closeBrowser(session);
  } finally {
    session.inspecting = false;
  }
}

async function loadApplicationForAdmin(id) {
  const { data, error } = await supabase.from('uez_applications').select('*').eq('id', id).single();
  if (error || !data) return null;
  return data;
}

async function safeStatusEvent(applicationId, status, label, message, userId, visible = true) {
  try {
    const { error } = await supabase.from('uez_status_events').insert({
      application_id: applicationId,
      status,
      label,
      message,
      visible_to_applicant: visible,
      created_by: userId || null
    });
    if (error) throw error;
  } catch (err) {
    console.error('BRC (live v2) status-event logging failed:', err.message);
  }
}

router.post('/session', requireUezAdmin, async (req, res) => {
  let browser;
  try {
    await expireSessions();
    const applicationId = String(req.body?.applicationId || '').trim();
    if (!applicationId) return res.status(400).json({ error: 'applicationId is required.' });

    const application = await loadApplicationForAdmin(applicationId);
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    const lookup = brcLookupDescriptor(application);
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(24).toString('hex');

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();

    const session = {
      id,
      token,
      applicationId: application.id,
      createdBy: req.user.id,
      browser,
      context,
      page,
      lookup,
      status: 'opening',
      result: null,
      error: null,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      submitted: false,
      challengeSeen: false,
      inspecting: false,
      capturedHtml: null,
      documentPdf: null,
      lastScreenshot: null,
      monitor: null
    };
    liveSessions.set(id, session);

    await page.goto(BRC_FORM_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    session.status = 'ready';
    await inspectSession(session);
    session.monitor = setInterval(() => inspectSession(session), 700);

    res.json({ id, token, status: session.status, lookup, viewport: VIEWPORT });
  } catch (err) {
    if (browser) try { await browser.close(); } catch (_) {}
    res.status(500).json({ error: err.message || 'Could not start NJ BRC browser.' });
  }
});

router.get('/session/:id', (req, res) => {
  const session = authSession(req);
  if (!session) return res.status(404).json({ error: 'Live BRC session not found or expired.' });
  res.json({
    id: session.id,
    status: session.status,
    lookup: session.lookup,
    result: session.result,
    error: session.error,
    viewport: VIEWPORT,
    hasDocument: Boolean(session.documentPdf || session.capturedHtml)
  });
});

router.get('/session/:id/screenshot', async (req, res) => {
  const session = authSession(req);
  if (!session) return res.status(404).send('Live BRC session not found or expired.');
  try {
    let image = session.lastScreenshot;
    if (session.page) image = await session.page.screenshot({ type: 'jpeg', quality: 82 });
    if (!image) return res.status(404).send('No browser image available.');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.send(image);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.post('/session/:id/input', async (req, res) => {
  const session = authSession(req);
  if (!session || !session.page) return res.status(404).json({ error: 'Interactive browser is no longer available.' });
  try {
    const type = String(req.body?.type || '');
    if (type === 'click') {
      const x = Math.max(0, Math.min(VIEWPORT.width, Number(req.body?.x)));
      const y = Math.max(0, Math.min(VIEWPORT.height, Number(req.body?.y)));
      await session.page.mouse.click(x, y);
    } else if (type === 'wheel') {
      await session.page.mouse.wheel(Number(req.body?.deltaX) || 0, Number(req.body?.deltaY) || 0);
    } else {
      return res.status(400).json({ error: 'Unsupported browser input.' });
    }
    setTimeout(() => inspectSession(session), 100);
    res.json({ ok: true, status: session.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/session/:id/document', (req, res) => {
  const session = authSession(req);
  if (!session) return res.status(404).send('BRC document not found.');
  if (session.documentPdf) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="BRC-${session.id}.pdf"`);
    return res.send(session.documentPdf);
  }
  if (session.capturedHtml) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(session.capturedHtml);
  }
  return res.status(404).send('BRC document not found.');
});

router.post('/session/:id/save', requireUezAdmin, async (req, res) => {
  const session = authSession(req);
  if (!session) return res.status(404).json({ error: 'Live BRC session not found or expired.' });
  if (session.status !== 'found' || !session.documentPdf || !session.result) {
    return res.status(400).json({ error: 'No confirmed BRC certificate to save yet.' });
  }

  try {
    const application = await loadApplicationForAdmin(session.applicationId);
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    const result = session.result;
    const safeCertificate = String(result.certificateNumber || 'BRC').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
    const filename = `NJ-BRC-${safeCertificate}.pdf`;
    const storagePath = `${application.applicant_user_id}/${application.id}/${Date.now()}-${crypto.randomUUID()}-${filename}`;

    const { error: storageError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .upload(storagePath, session.documentPdf, { contentType: 'application/pdf', upsert: false });
    if (storageError) throw storageError;

    const { data: document, error: documentError } = await supabase.from('uez_documents').insert({
      application_id: application.id,
      document_type: 'brc',
      storage_path: storagePath,
      filename,
      source: 'admin_upload',
      status: 'received',
      metadata: { mimeType: 'application/pdf', size: session.documentPdf.length, capturedBy: 'live_browser_v2' },
      created_by: req.user.id
    }).select('id, document_type, filename, source, status, metadata, created_at').single();
    if (documentError) throw documentError;

    const checkedAt = new Date().toISOString();
    const brcData = {
      taxpayerName: result.taxpayerName || null,
      tradeName: result.tradeName || null,
      address: result.address || null,
      certificateNumber: result.certificateNumber || null,
      effectiveDate: result.effectiveDate || null,
      issuanceDate: result.issuanceDate || null
    };
    const canonicalName = result.taxpayerName || result.tradeName || application.business_name_input;

    const { data: updated, error: updateError } = await supabase.from('uez_applications').update({
      brc_status: 'found',
      brc_checked_at: checkedAt,
      brc_registered_name: canonicalName,
      registered_business_name: canonicalName,
      brc_data: brcData,
      brc_last_error: null,
      updated_at: checkedAt
    }).eq('id', application.id).select('*').single();
    if (updateError) throw updateError;

    await safeStatusEvent(application.id, 'brc_confirmed', 'BRC confirmed', 'Your New Jersey Business Registration Certificate has been confirmed. We can continue to the next step.', req.user.id, true);
    // MyNJ/PBS credential creation stays a separate explicit admin action, same as the other BRC paths.

    await closeBrowser(session);
    liveSessions.delete(session.id);

    res.status(201).json({ application: updated, document, result: brcData });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/session/:id', async (req, res) => {
  const session = authSession(req);
  if (!session) return res.status(404).json({ error: 'Live BRC session not found.' });
  await closeBrowser(session);
  liveSessions.delete(session.id);
  res.json({ ok: true });
});

module.exports = router;
