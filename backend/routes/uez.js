const express = require('express');
const supabase = require('../db/supabase');
const { requireUezAuth, requireUezAdmin } = require('../middleware/uezAuth');
const { encryptText } = require('../utils/uezCrypto');

const router = express.Router();
router.use('/brc', require('./uezBrc'));

function normalizeEin(value) { return String(value || '').replace(/\D/g, '').slice(0, 9); }
function assertOwnership(owners) {
  if (!Array.isArray(owners) || owners.length === 0) throw new Error('At least one owner is required');
  const total = owners.reduce((sum, owner) => sum + (Number(owner.ownershipPercent) || 0), 0);
  if (Math.abs(total - 100) > 0.001) throw new Error(`Ownership percentages must total exactly 100%; received ${total}%`);
}

async function getOwnedApplication(applicationId, user) {
  let query = supabase.from('uez_applications').select('*').eq('id', applicationId);
  if (user.role !== 'admin') query = query.eq('applicant_user_id', user.id);
  const { data, error } = await query.single();
  if (error || !data) return null;
  return data;
}

router.use(requireUezAuth);

router.get('/me', async (req, res) => {
  try {
    const { data, error } = await supabase.from('uez_applications').select('*').eq('applicant_user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/applications', async (req, res) => {
  try {
    const body = req.body || {};
    const payload = {
      applicant_user_id: req.user.id,
      contact_email: body.contactEmail || req.user.email || null,
      contact_phone: body.contactPhone || null,
      business_name_input: body.businessName || null,
      address_line1: body.addressLine1 || body.address || null,
      address_line2: body.addressLine2 || null,
      city: body.city || null,
      state: body.state || 'NJ',
      zip: body.zip || null,
      zone_identifier: body.zoneIdentifier || null,
      zone_name: body.zoneName || null,
      zone_eligible: body.zoneEligible === true,
      program_code: body.programCode || null,
      status: 'intake_in_progress'
    };
    const { data, error } = await supabase.from('uez_applications').insert(payload).select('*').single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.patch('/applications/:id/business', async (req, res) => {
  try {
    const application = await getOwnedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    const body = req.body || {};
    const ein = normalizeEin(body.ein);
    const patch = {
      business_name_input: body.businessName ?? application.business_name_input,
      business_description: body.businessDescription ?? application.business_description,
      ein: ein || application.ein,
      year_founded: body.yearFounded === '' || body.yearFounded == null ? application.year_founded : Number(body.yearFounded),
      is_sole_proprietorship: body.isSoleProprietorship == null ? application.is_sole_proprietorship : body.isSoleProprietorship === true,
      full_time_employees: body.fullTimeEmployees === '' || body.fullTimeEmployees == null ? application.full_time_employees : Number(body.fullTimeEmployees),
      part_time_employees: body.partTimeEmployees === '' || body.partTimeEmployees == null ? application.part_time_employees : Number(body.partTimeEmployees),
      contact_phone: body.contactPhone ?? application.contact_phone,
      updated_at: new Date().toISOString()
    };
    if (patch.full_time_employees != null && patch.full_time_employees < 0) throw new Error('Full-time employees cannot be negative');
    if (patch.part_time_employees != null && patch.part_time_employees < 0) throw new Error('Part-time employees cannot be negative');
    const { data, error } = await supabase.from('uez_applications').update(patch).eq('id', application.id).select('*').single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/applications/:id/owners', async (req, res) => {
  try {
    const application = await getOwnedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    const owners = req.body?.owners || [];
    assertOwnership(owners);
    const rows = owners.map((owner, index) => ({
      application_id: application.id,
      owner_order: index + 1,
      first_name: String(owner.firstName || '').trim(),
      last_name: String(owner.lastName || '').trim(),
      email: owner.email || null,
      phone: owner.phone || null,
      ownership_percent: Number(owner.ownershipPercent),
      address_line1: owner.addressLine1 || null,
      address_line2: owner.addressLine2 || null,
      city: owner.city || null,
      state: owner.state || null,
      zip: owner.zip || null,
      dob_enc: encryptText(owner.dob),
      ssn_enc: encryptText(String(owner.ssn || '').replace(/\D/g, '')),
      updated_at: new Date().toISOString()
    }));
    if (rows.some((row) => !row.first_name || !row.last_name)) throw new Error('Each owner requires a first and last name');
    const { error: deleteError } = await supabase.from('uez_owners').delete().eq('application_id', application.id);
    if (deleteError) throw deleteError;
    const { data, error } = await supabase.from('uez_owners').insert(rows).select('id, owner_order, first_name, last_name, email, phone, ownership_percent, created_at, updated_at').order('owner_order');
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/applications/:id', async (req, res) => {
  try {
    const application = await getOwnedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    const [ownersResult, docsResult, eventsResult, paymentsResult] = await Promise.all([
      supabase.from('uez_owners').select('id, owner_order, first_name, last_name, email, phone, ownership_percent').eq('application_id', application.id).order('owner_order'),
      supabase.from('uez_documents').select('id, document_type, filename, source, status, created_at').eq('application_id', application.id).order('created_at'),
      supabase.from('uez_status_events').select('id, status, label, message, visible_to_applicant, created_at').eq('application_id', application.id).order('created_at'),
      supabase.from('uez_payments').select('id, amount, payment_date, payment_method, status, refund_amount, refunded_at, created_at').eq('application_id', application.id).order('created_at')
    ]);
    if (ownersResult.error) throw ownersResult.error;
    if (docsResult.error) throw docsResult.error;
    if (eventsResult.error) throw eventsResult.error;
    if (paymentsResult.error) throw paymentsResult.error;
    res.json({ application, owners: ownersResult.data || [], documents: docsResult.data || [], statusEvents: (eventsResult.data || []).filter((event) => req.user.role === 'admin' || event.visible_to_applicant), payments: paymentsResult.data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/applications', requireUezAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabase.from('uez_applications').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
