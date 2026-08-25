const express = require('express');
const supabase = require('../db/supabase');
const { requireUezAuth, requireUezAdmin } = require('../middleware/uezAuth');
const { brcLookupDescriptor, lookupBrc } = require('../utils/uezBrc');

const router = express.Router();

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
    res.json(data);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
