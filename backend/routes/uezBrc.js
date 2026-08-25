const express = require('express');
const crypto = require('crypto');
const { chromium } = require('playwright');
const supabase = require('../db/supabase');
const { requireUezAuth, requireUezAdmin } = require('../middleware/uezAuth');
const { brcLookupDescriptor, lookupBrc } = require('../utils/uezBrc');
const { ensureMyNjCredentials } = require('../services/uezMyNj');

const router = express.Router();
const BRC_FORM_URL = 'https://www1.state.nj.us/TYTR_BRC/jsp/BRCLoginJsp.jsp';
const browserCaptureSessions = new Map();

function pruneBrowserSessions() {
  const cutoff = Date.now() - (30 * 60 * 1000);
  for (const [id, session] of browserCaptureSessions.entries()) {
    if (session.createdAt < cutoff) browserCaptureSessions.delete(id);
  }
}

function browserSessionForRequest(req) {
  const session = browserCaptureSessions.get(req.params.id);
  const token = String(req.query?.token || req.get('x-cor-capture-token') || '');
  if (!session || !token || token !== session.token) return null;
  return session;
}

router.post('/browser-session', (req, res) => {
  try {
    pruneBrowserSessions();
    const businessName = String(req.body?.businessName || '').trim();
    const ein = String(req.body?.ein || '').trim();
    const lookup = brcLookupDescriptor({ business_name_input: businessName, ein });
    const captureId = crypto.randomUUID();
    const token = crypto.randomBytes(24).toString('hex');
    const createdAt = Date.now();

    browserCaptureSessions.set(captureId, {
      captureId,
      token,
      status: 'pending',
      createdAt,
      lookup,
      result: null,
      capturedHtml: null
    });

    const helperPayload = Buffer.from(JSON.stringify({
      captureId,
      token,
      lookup,
      apiBase: `${req.protocol}://${req.get('host')}`
    })).toString('base64url');

    res.json({
      captureId,
      token,
      lookup,
      status: 'pending',
      checkerUrl: `${BRC_FORM_URL}#corBrc=${helperPayload}`
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/browser-session/:id', (req, res) => {
  const session = browserSessionForRequest(req);
  if (!session) return res.status(404).json({ error: 'BRC capture session not found or expired.' });
  res.json({
    captureId: session.captureId,
    status: session.status,
    lookup: session.lookup,
    result: session.result,
    hasCapturedDocument: Boolean(session.capturedHtml)
  });
});

router.post('/browser-session/:id/result', (req, res) => {
  const session = browserSessionForRequest(req);
  if (!session) return res.status(404).json({ error: 'BRC capture session not found or expired.' });

  const outcome = String(req.body?.outcome || '').trim();
  if (!['challenge', 'found', 'not_found', 'error'].includes(outcome)) {
    return res.status(400).json({ error: 'Invalid BRC capture outcome.' });
  }

  if (outcome === 'challenge') {
    session.status = 'challenge';
    return res.json({ ok: true, status: session.status });
  }

  if (outcome === 'not_found') {
    session.status = 'not_found';
    session.result = null;
    session.capturedHtml = null;
    return res.json({ ok: true, status: session.status });
  }

  if (outcome === 'error') {
    session.status = 'error';
    session.result = { message: String(req.body?.message || 'Browser helper could not read the NJ result.') };
    return res.json({ ok: true, status: session.status });
  }

  const result = req.body?.result || {};
  session.status = 'found';
  session.result = {
    taxpayerName: result.taxpayerName || null,
    tradeName: result.tradeName || null,
    address: result.address || null,
    certificateNumber: result.certificateNumber || null,
    effectiveDate: result.effectiveDate || null,
    issuanceDate: result.issuanceDate || null
  };
  session.capturedHtml = typeof req.body?.html === 'string' ? req.body.html.slice(0, 1500000) : null;

  res.json({ ok: true, status: session.status });
});

router.get('/browser-session/:id/document', (req, res) => {
  const session = browserSessionForRequest(req);
  if (!session || !session.capturedHtml) return res.status(404).send('Captured BRC document not found.');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="BRC-${session.captureId}.html"`);
  res.send(session.capturedHtml);
});

router.post('/test', async (req, res) => {
  try {
    const businessName = String(req.body?.businessName || '').trim();
    const ein = String(req.body?.ein || '').trim();
    const result = await lookupBrc({ business_name_input: businessName, ein });

    const base = {
      engine: result.engine || 'unknown',
      lookup: result.lookup,
      finalUrl: result.finalUrl || null
    };

    if (result.status === 'found') {
      return res.json({
        ...base,
        outcome: 'found',
        result: {
          taxpayerName: result.taxpayerName,
          tradeName: result.tradeName,
          address: result.address,
          certificateNumber: result.certificateNumber,
          effectiveDate: result.effectiveDate,
          issuanceDate: result.issuanceDate
        },
        certificatePdfBase64: result.certificatePdfBase64 || null
      });
    }

    if (result.status === 'not_found') return res.json({ ...base, outcome: 'not_found' });
    if (result.status === 'challenge_required') return res.json({ ...base, outcome: 'manual_verification_required' });
    if (result.status === 'browser_error') {
      return res.status(502).json({ ...base, outcome: 'browser_error', error: result.text || 'Headless browser failed.' });
    }

    return res.status(502).json({
      ...base,
      outcome: 'error',
      error: result.text || 'NJ returned an unexpected BRC response.'
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.use(requireUezAuth);

async function ownedApplication(id, user) {
  let query = supabase.from('uez_applications').select('*').eq('id', id);
  if (user.role !== 'admin') query = query.eq('applicant_user_id', user.id);
  const { data, error } = await query.single();
  if (error || !data) return null;
  return data;
}

async function addStatusEvent(applicationId, status, label, message, userId, visible = true) {
  const { error } = await supabase.from('uez_status_events').insert({ application_id: applicationId, status, label, message, visible_to_applicant: visible, created_by: userId });
  if (error) throw error;
}

router.post('/:id/admin/captured-certificate', requireUezAdmin, async (req, res) => {
  let browser;
  try {
    const application = await ownedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    const html = String(req.body?.html || '');
    let result = req.body?.result || {};
    if (!result || !result.certificateNumber) {
      const parsed = parseBrcCertificateHtml(html);
      if (parsed.status === 'found' && parsed.certificateNumber) {
        result = { ...parsed, ...result, certificateNumber: parsed.certificateNumber };
      }
    }
    if (!html || html.length > 1500000 || !result.certificateNumber) {
      return res.status(400).json({ error: 'The captured BRC certificate was incomplete.' });
    }

    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.route('**/*', (route) => {
      if (route.request().resourceType() === 'document') route.continue();
      else route.abort();
    });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const pdf = await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0.35in', right: '0.35in', bottom: '0.35in', left: '0.35in' } });

    const safeCertificate = String(result.certificateNumber).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
    const filename = `NJ-BRC-${safeCertificate}.pdf`;
    const storagePath = `${application.applicant_user_id}/${application.id}/${Date.now()}-${crypto.randomUUID()}-${filename}`;
    const { error: storageError } = await supabase.storage.from('uez-documents').upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false });
    if (storageError) throw storageError;

    const { data: document, error: documentError } = await supabase.from('uez_documents').insert({
      application_id: application.id,
      document_type: 'brc',
      storage_path: storagePath,
      filename,
      source: 'admin_upload',
      status: 'received',
      metadata: { mimeType: 'application/pdf', size: pdf.length, capturedBy: 'chrome_extension' },
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
      brc_status: 'found', brc_checked_at: checkedAt, brc_registered_name: canonicalName,
      registered_business_name: canonicalName, brc_data: brcData, brc_last_error: null,
      status: 'brc_confirmed', updated_at: checkedAt
    }).eq('id', application.id).select('*').single();
    if (updateError) throw updateError;
    await addStatusEvent(application.id, 'brc_confirmed', 'BRC confirmed', 'Your New Jersey Business Registration Certificate has been confirmed. We can continue to the next step.', req.user.id, true);
    await ensureMyNjCredentials(updated, req.user.id);
    res.status(201).json({ application: updated, document, result: brcData });
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

router.post('/:id/request-check', async (req, res) => {
  try {
    const application = await ownedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    const lookup = brcLookupDescriptor(application);
    const startedAt = new Date().toISOString();
    await supabase.from('uez_applications').update({ brc_status: 'checking', brc_name_control: lookup.nameControl, brc_nj_tax_id: lookup.njTaxId, brc_last_error: null, status: 'brc_checking', updated_at: startedAt }).eq('id', application.id);

    const result = await lookupBrc(application);
    const checkedAt = new Date().toISOString();

    if (result.status === 'found') {
      const brcData = { taxpayerName: result.taxpayerName, tradeName: result.tradeName, address: result.address, certificateNumber: result.certificateNumber, effectiveDate: result.effectiveDate, issuanceDate: result.issuanceDate };
      const canonicalName = result.taxpayerName || result.tradeName || application.business_name_input;
      const { data, error } = await supabase.from('uez_applications').update({ brc_status: 'found', brc_checked_at: checkedAt, brc_registered_name: canonicalName, registered_business_name: canonicalName, brc_data: brcData, brc_last_error: null, status: 'brc_confirmed', updated_at: checkedAt }).eq('id', application.id).select('*').single();
      if (error) throw error;
      await addStatusEvent(application.id, 'brc_confirmed', 'BRC confirmed', 'Your New Jersey Business Registration Certificate has been confirmed. We can continue to the next step.', req.user.id, true);
      await ensureMyNjCredentials(data, req.user.id);
      return res.json({ application: data, result: brcData, outcome: 'found' });
    }

    if (result.status === 'not_found') {
      const { data, error } = await supabase.from('uez_applications').update({ brc_status: 'not_found', brc_checked_at: checkedAt, brc_last_error: null, status: 'waiting_for_brc', updated_at: checkedAt }).eq('id', application.id).select('*').single();
      if (error) throw error;
      await addStatusEvent(application.id, 'waiting_for_brc', 'BRC needed', 'We could not find a current New Jersey Business Registration Certificate. Please register for one, then return here and tell us when it is complete.', req.user.id, true);
      return res.json({ application: data, outcome: 'not_found' });
    }

    if (result.status === 'challenge_required') {
      const { data, error } = await supabase.from('uez_applications').update({ brc_status: 'manual_verification_required', brc_checked_at: checkedAt, brc_last_error: 'NJ BRC service requested browser verification.', status: 'brc_manual_verification', updated_at: checkedAt }).eq('id', application.id).select('*').single();
      if (error) throw error;
      await addStatusEvent(application.id, 'brc_manual_verification', 'BRC verification pending', 'The New Jersey BRC service requires a quick manual verification before we can confirm your certificate.', req.user.id, true);
      return res.json({ application: data, outcome: 'manual_verification_required' });
    }

    const message = result.text || `Unexpected NJ BRC response (${result.httpStatus || 'unknown status'})`;
    const { data, error } = await supabase.from('uez_applications').update({ brc_status: 'lookup_error', brc_checked_at: checkedAt, brc_last_error: message, status: 'brc_check_error', updated_at: checkedAt }).eq('id', application.id).select('*').single();
    if (error) throw error;
    return res.status(502).json({ application: data, outcome: 'error', error: 'We could not verify the BRC right now.' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/i-registered', async (req, res) => {
  try {
    const application = await ownedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    const { data, error } = await supabase.from('uez_applications').update({ brc_status: 'recheck_requested', status: 'brc_recheck_requested', updated_at: new Date().toISOString() }).eq('id', application.id).select('*').single();
    if (error) throw error;
    await addStatusEvent(application.id, 'brc_recheck_requested', 'BRC recheck requested', 'Thanks — we’ll check again for your Business Registration Certificate.', req.user.id, true);
    res.json(data);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/admin/not-found', requireUezAdmin, async (req, res) => {
  try {
    const application = await ownedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    const checkedAt = new Date().toISOString();
    const { data, error } = await supabase.from('uez_applications').update({ brc_status: 'not_found', brc_checked_at: checkedAt, status: 'waiting_for_brc', updated_at: checkedAt }).eq('id', application.id).select('*').single();
    if (error) throw error;
    await addStatusEvent(application.id, 'waiting_for_brc', 'BRC needed', 'We could not find a current New Jersey Business Registration Certificate. Please register for one, then return here and tell us when it is complete.', req.user.id, true);
    res.json(data);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/admin/found', requireUezAdmin, async (req, res) => {
  try {
    const application = await ownedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    const checkedAt = new Date().toISOString();
    const { data, error } = await supabase.from('uez_applications').update({ brc_status: 'found', brc_checked_at: checkedAt, brc_registered_name: req.body?.registeredBusinessName || application.brc_registered_name, registered_business_name: req.body?.registeredBusinessName || application.registered_business_name, brc_storage_path: req.body?.storagePath || application.brc_storage_path, status: 'brc_confirmed', updated_at: checkedAt }).eq('id', application.id).select('*').single();
    if (error) throw error;
    await addStatusEvent(application.id, 'brc_confirmed', 'BRC confirmed', 'Your New Jersey Business Registration Certificate has been confirmed. We can continue to the next step.', req.user.id, true);
    await ensureMyNjCredentials(data, req.user.id);
    res.json(data);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
