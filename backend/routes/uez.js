const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const supabase = require('../db/supabase');
const { requireUezAuth, requireUezAdmin } = require('../middleware/uezAuth');
const { encryptText, decryptText } = require('../utils/uezCrypto');
const { decryptCredential, ensureMyNjCredentials } = require('../services/uezMyNj');
const { safeSendApplicationEmail } = require('../services/uezEmail');

const router = express.Router();
router.use('/brc', require('./uezBrc'));
router.use('/brc-live', require('./uezBrcLive'));
router.use('/email', require('./uezEmail'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
});

const DOCUMENT_BUCKET = 'uez-documents';

const DEFAULT_SIGNUP_LAYOUT = {
  account: ['email', 'password'],
  business: ['businessName', 'businessDescription', 'ein', 'yearFounded', 'hasDba', 'dbaName', 'fullTimeEmployees', 'partTimeEmployees'],
  ownerCore: ['title', 'firstName', 'lastName', 'email', 'phone', 'dob', 'ssn', 'ownershipPercent'],
  ownerAddress: ['addressLine1', 'addressLine2', 'city', 'state', 'zip'],
  documents: ['formation', 'soleProp', 'supporting']
};

function validateSignupLayout(layout) {
  const clean = {};
  for (const [group, defaults] of Object.entries(DEFAULT_SIGNUP_LAYOUT)) {
    const received = Array.isArray(layout?.[group]) ? layout[group] : defaults;
    if (received.length !== defaults.length || new Set(received).size !== defaults.length || received.some((key) => !defaults.includes(key))) {
      throw new Error(`Invalid signup layout for ${group}. Fields can only be reordered within their existing page.`);
    }
    clean[group] = received;
  }
  return clean;
}
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'message/rfc822'
]);

function normalizeEin(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 9);
}

function assertOwnership(owners) {
  if (!Array.isArray(owners) || owners.length === 0) throw new Error('At least one owner is required');
  const total = owners.reduce((sum, owner) => sum + (Number(owner.ownershipPercent) || 0), 0);
  if (Math.abs(total - 100) > 0.001) throw new Error(`Ownership percentages must total exactly 100%; received ${total}%`);
}

function safeFilename(value) {
  const cleaned = String(value || 'document')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned.slice(0, 120) || 'document';
}

async function getOwnedApplication(applicationId, user) {
  let query = supabase.from('uez_applications').select('*').eq('id', applicationId);
  if (user.role !== 'admin') query = query.eq('applicant_user_id', user.id);
  const { data, error } = await query.single();
  if (error || !data) return null;
  return data;
}

async function addStatusEvent(applicationId, status, label, message, userId, visible = true) {
  const { error } = await supabase.from('uez_status_events').insert({
    application_id: applicationId,
    status,
    label,
    message,
    visible_to_applicant: visible,
    created_by: userId || null
  });
  if (error) throw error;
}

async function getApplicationBundle(application, user) {
  const [ownersResult, docsResult, eventsResult, paymentsResult] = await Promise.all([
    supabase.from('uez_owners')
      .select('id, owner_order, honorific_title, first_name, last_name, email, phone, ownership_percent, position_title, address_line1, address_line2, city, state, zip')
      .eq('application_id', application.id)
      .order('owner_order'),
    supabase.from('uez_documents')
      .select('id, document_type, filename, source, status, metadata, created_at')
      .eq('application_id', application.id)
      .order('created_at'),
    supabase.from('uez_status_events')
      .select('id, status, label, message, visible_to_applicant, created_at')
      .eq('application_id', application.id)
      .order('created_at'),
    supabase.from('uez_payments')
      .select('id, amount, payment_date, payment_method, status, refund_amount, refunded_at, created_at')
      .eq('application_id', application.id)
      .order('created_at')
  ]);

  if (ownersResult.error) throw ownersResult.error;
  if (docsResult.error) throw docsResult.error;
  if (eventsResult.error) throw eventsResult.error;
  if (paymentsResult.error) throw paymentsResult.error;

  return {
    application,
    owners: ownersResult.data || [],
    documents: docsResult.data || [],
    statusEvents: (eventsResult.data || []).filter((event) => user.role === 'admin' || event.visible_to_applicant),
    payments: paymentsResult.data || []
  };
}

router.post('/signup', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (error) throw error;
    res.status(201).json({ id: data.user?.id || null, email });
  } catch (err) {
    const message = /already|registered|exists/i.test(err.message || '') ? 'An account already exists for this email. Sign in instead.' : err.message;
    res.status(400).json({ error: message });
  }
});

router.get('/signup-layout', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('uez_signup_layout').select('layout').eq('id', 'default').maybeSingle();
    if (error) throw error;
    res.json({ layout: validateSignupLayout(data?.layout || DEFAULT_SIGNUP_LAYOUT) });
  } catch (err) {
    res.json({ layout: DEFAULT_SIGNUP_LAYOUT });
  }
});

router.use(requireUezAuth);


router.put('/admin/signup-layout', requireUezAdmin, async (req, res) => {
  try {
    const layout = validateSignupLayout(req.body?.layout);
    const { data, error } = await supabase.from('uez_signup_layout')
      .upsert({ id: 'default', layout, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('layout, updated_at').single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/admin/signup-layout/reset', requireUezAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabase.from('uez_signup_layout')
      .upsert({ id: 'default', layout: DEFAULT_SIGNUP_LAYOUT, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('layout, updated_at').single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/whoami', (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, role: req.user.role });
});

router.get('/me', async (req, res) => {
  try {
    const { data, error } = await supabase.from('uez_applications')
      .select('*')
      .eq('applicant_user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
      grant_amount_requested: body.programCode === 'lakewood_technology_grant' ? 5000 : null,
      status: 'in_progress'
    };

    const { data, error } = await supabase.from('uez_applications').insert(payload).select('*').single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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
      is_sole_proprietorship: body.isSoleProprietorship == null
        ? application.is_sole_proprietorship
        : body.isSoleProprietorship === true,
      full_time_employees: body.fullTimeEmployees === '' || body.fullTimeEmployees == null
        ? application.full_time_employees
        : Number(body.fullTimeEmployees),
      part_time_employees: body.partTimeEmployees === '' || body.partTimeEmployees == null
        ? application.part_time_employees
        : Number(body.partTimeEmployees),
      has_dba: body.hasDba == null ? application.has_dba : body.hasDba === true,
      dba_name: body.hasDba === true ? (String(body.dbaName || '').trim() || null) : (body.hasDba === false ? null : application.dba_name),
      grant_amount_requested: application.grant_amount_requested ?? (application.program_code === 'lakewood_technology_grant' ? 5000 : null),
      contact_phone: body.contactPhone ?? application.contact_phone,
      updated_at: new Date().toISOString()
    };

    if (!String(patch.business_name_input || '').trim()) throw new Error('Business name is required.');
    if (!String(patch.business_description || '').trim()) throw new Error('Business description is required.');
    if (normalizeEin(patch.ein).length !== 9) throw new Error('A 9-digit EIN is required.');
    if (!Number.isInteger(patch.year_founded) || String(patch.year_founded).length !== 4) throw new Error('A 4-digit year founded is required.');
    if (typeof patch.is_sole_proprietorship !== 'boolean') throw new Error('Please answer whether the business is a sole proprietorship.');
    if (!Number.isInteger(patch.full_time_employees) || patch.full_time_employees < 0) throw new Error('Full-time employees is required and cannot be negative.');
    if (!Number.isInteger(patch.part_time_employees) || patch.part_time_employees < 0) throw new Error('Part-time employees is required and cannot be negative.');
    if (typeof patch.has_dba !== 'boolean') throw new Error('Please answer whether the business has a DBA.');
    if (patch.has_dba === true && !patch.dba_name) throw new Error('DBA name is required when the business has a DBA.');

    const { data, error } = await supabase.from('uez_applications')
      .update(patch)
      .eq('id', application.id)
      .select('*')
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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
      honorific_title: String(owner.title || '').trim(),
      first_name: String(owner.firstName || '').trim(),
      last_name: String(owner.lastName || '').trim(),
      email: owner.email || null,
      phone: owner.phone || null,
      ownership_percent: Number(owner.ownershipPercent),
      position_title: String(owner.positionTitle || (owners.length === 1 ? 'Owner' : 'Partner')).trim(),
      address_line1: owner.addressLine1 || null,
      address_line2: owner.addressLine2 || null,
      city: owner.city || null,
      state: owner.state || null,
      zip: owner.zip || null,
      dob_enc: encryptText(owner.dob),
      ssn_enc: encryptText(String(owner.ssn || '').replace(/\D/g, '')),
      updated_at: new Date().toISOString()
    }));

    if (req.user.role !== 'admin' && rows.some((row) => !row.honorific_title)) throw new Error('Each owner requires a title.');
    if (rows.some((row) => !row.first_name || !row.last_name)) throw new Error('Each owner requires a first and last name.');
    if (owners.some((owner) => !/^\S+@\S+\.\S+$/.test(String(owner.email || '').trim()))) {
      throw new Error('Each owner requires a valid email address.');
    }
    if (owners.some((owner) => String(owner.phone || '').replace(/\D/g, '').length !== 10)) {
      throw new Error('Each owner requires a 10-digit phone number.');
    }
    if (owners.some((owner) => !String(owner.dob || '').trim())) {
      throw new Error('Each owner requires a date of birth.');
    }
    if (owners.some((owner) => String(owner.ssn || '').replace(/\D/g, '').length !== 9)) {
      throw new Error('Each owner requires a 9-digit SSN.');
    }
    if (owners.some((owner) => !(Number(owner.ownershipPercent) > 0))) {
      throw new Error('Each owner requires an ownership percentage greater than zero.');
    }
    if (owners.some((owner) => !String(owner.addressLine1 || '').trim() || !String(owner.city || '').trim() || !/^[A-Za-z]{2}$/.test(String(owner.state || '').trim()) || !/^\d{5}$/.test(String(owner.zip || '').trim()))) {
      throw new Error('Each owner requires a complete home address: street, city, 2-letter state, and 5-digit ZIP. Address Line 2 is optional.');
    }

    const { error: deleteError } = await supabase.from('uez_owners').delete().eq('application_id', application.id);
    if (deleteError) throw deleteError;

    const { data, error } = await supabase.from('uez_owners')
      .insert(rows)
      .select('id, owner_order, honorific_title, first_name, last_name, email, phone, ownership_percent, position_title, address_line1, address_line2, city, state, zip, created_at, updated_at')
      .order('owner_order');
    if (error) throw error;

    const primaryPhone = rows[0]?.phone || null;
    if (primaryPhone && primaryPhone !== application.contact_phone) {
      const { error: phoneError } = await supabase.from('uez_applications')
        .update({ contact_phone: primaryPhone, updated_at: new Date().toISOString() })
        .eq('id', application.id);
      if (phoneError) throw phoneError;
    }

    res.json(data || []);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/applications/:id/documents', upload.single('file'), async (req, res) => {
  try {
    const application = await getOwnedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (!req.file) return res.status(400).json({ error: 'Choose a document to upload.' });
    const isEmailFile = /\.eml$/i.test(req.file.originalname) && ['message/rfc822', 'application/octet-stream'].includes(req.file.mimetype);
    if (!ALLOWED_MIME_TYPES.has(req.file.mimetype) && !isEmailFile) {
      return res.status(400).json({ error: 'Please upload a PDF, email file, JPG, PNG, or WebP file.' });
    }

    const documentType = String(req.body?.documentType || 'supporting').trim().toLowerCase();
    if (documentType === 'brc' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'COR handles the Business Registration Certificate lookup for you.' });
    }
    if (documentType === 'tax_clearance' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only a UEZ admin can add the tax-clearance letter.' });
    }
    const storagePath = `${application.applicant_user_id}/${application.id}/${Date.now()}-${crypto.randomUUID()}-${safeFilename(req.file.originalname)}`;

    const { error: storageError } = await supabase.storage.from(DOCUMENT_BUCKET).upload(storagePath, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: false
    });
    if (storageError) throw storageError;

    const { data, error } = await supabase.from('uez_documents').insert({
      application_id: application.id,
      document_type: documentType,
      storage_path: storagePath,
      filename: req.file.originalname,
      source: req.user.role === 'admin' ? 'admin_upload' : 'applicant_upload',
      status: 'received',
      metadata: {
        mimeType: req.file.mimetype,
        size: req.file.size
      },
      created_by: req.user.id
    }).select('id, document_type, filename, source, status, metadata, created_at').single();

    if (error) throw error;

    if (documentType === 'formation') {
      await supabase.from('uez_applications').update({ formation_review_status: 'not_reviewed', updated_at: new Date().toISOString() }).eq('id', application.id);
      await addStatusEvent(
        application.id,
        'formation_uploaded',
        'Certificate of Formation uploaded',
        'Certificate of Formation uploaded and awaiting review.',
        req.user.id,
        true
      );
    }

    if (documentType === 'brc') {
      await supabase.from('uez_applications').update({
        brc_status: 'uploaded',
        updated_at: new Date().toISOString()
      }).eq('id', application.id);

      await addStatusEvent(
        application.id,
        'brc_uploaded',
        'BRC uploaded',
        'We received your Business Registration Certificate. COR will review it and continue your application.',
        req.user.id,
        true
      );
    }

    if (documentType === 'uez_approval_email') {
      const now = new Date().toISOString();
      const { error: appError } = await supabase.from('uez_applications').update({
        pbs_status: 'uez_approval_uploaded',
        uez_application_submitted: true,
        uez_application_status: 'applied',
        uez_approval_review_status: 'not_reviewed',
        updated_at: now
      }).eq('id', application.id);
      if (appError) throw appError;

      await addStatusEvent(
        application.id,
        'uez_approval_uploaded',
        'UEZ approval email uploaded',
        'We received your Notice of Certification Application Approved email. COR will verify it and continue your application.',
        req.user.id,
        true
      );
    }

    if (documentType === 'tax_clearance') {
      await supabase.from('uez_applications').update({ tax_clearance_good: true, updated_at: new Date().toISOString() }).eq('id', application.id);
      await addStatusEvent(
        application.id,
        'tax_clearance_received',
        'Tax-clearance letter received',
        'COR retrieved the New Jersey tax-clearance letter and added it to your UEZ application.',
        req.user.id,
        true
      );
    }

    res.status(201).json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/applications/:id/documents/:documentId/url', async (req, res) => {
  try {
    const application = await getOwnedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });

    const { data: doc, error } = await supabase.from('uez_documents')
      .select('id, application_id, storage_path, filename')
      .eq('id', req.params.documentId)
      .eq('application_id', application.id)
      .single();
    if (error || !doc) return res.status(404).json({ error: 'Document not found' });

    const { data, error: signedError } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(doc.storage_path, 600);
    if (signedError) throw signedError;
    res.json({ url: data.signedUrl, filename: doc.filename });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/applications/:id/documents/:documentId', async (req, res) => {
  try {
    const application = await getOwnedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });

    const { data: doc, error: docError } = await supabase.from('uez_documents')
      .select('*')
      .eq('id', req.params.documentId)
      .eq('application_id', application.id)
      .single();
    if (docError || !doc) return res.status(404).json({ error: 'Document not found' });

    if (doc.storage_path) {
      await supabase.storage.from(DOCUMENT_BUCKET).remove([doc.storage_path]).catch(() => {});
    }

    const { error: deleteError } = await supabase.from('uez_documents').delete().eq('id', doc.id);
    if (deleteError) throw deleteError;

    if (doc.document_type === 'formation') {
      await supabase.from('uez_applications').update({ formation_review_status: 'not_reviewed', updated_at: new Date().toISOString() }).eq('id', application.id);
    }

    if (doc.document_type === 'uez_approval_email') {
      await supabase.from('uez_applications').update({
        uez_approval_review_status: 'not_reviewed',
        uez_application_status: application.uez_application_status === 'approved' ? 'applied' : application.uez_application_status,
        updated_at: new Date().toISOString()
      }).eq('id', application.id);
    }

    if (doc.document_type === 'brc' && req.user.role === 'admin') {
      await supabase.from('uez_applications').update({
        brc_status: 'pending',
        updated_at: new Date().toISOString()
      }).eq('id', application.id);
    }

    res.json({ ok: true, id: doc.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/applications/:id/submit', async (req, res) => {
  try {
    const application = await getOwnedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });

    const [ownersResult, docsResult] = await Promise.all([
      supabase.from('uez_owners').select('*').eq('application_id', application.id),
      supabase.from('uez_documents').select('id, document_type').eq('application_id', application.id)
    ]);

    if (ownersResult.error) throw ownersResult.error;
    if (docsResult.error) throw docsResult.error;

    if (!String(application.contact_email || '').trim()) return res.status(400).json({ error: 'Contact email is required before submission.' });
    if (!String(application.address_line1 || '').trim()) return res.status(400).json({ error: 'Business address is required before submission.' });
    if (!String(application.business_name_input || '').trim()) return res.status(400).json({ error: 'Business name is required before submission.' });
    if (!String(application.business_description || '').trim()) return res.status(400).json({ error: 'Business description is required before submission.' });
    if (normalizeEin(application.ein).length !== 9) return res.status(400).json({ error: 'A 9-digit EIN is required before submission.' });
    if (!Number.isInteger(application.year_founded) || String(application.year_founded).length !== 4) return res.status(400).json({ error: 'Year founded is required before submission.' });
    if (typeof application.is_sole_proprietorship !== 'boolean') return res.status(400).json({ error: 'Sole proprietorship answer is required before submission.' });
    if (!Number.isInteger(application.full_time_employees) || application.full_time_employees < 0) return res.status(400).json({ error: 'Full-time employees is required before submission.' });
    if (!Number.isInteger(application.part_time_employees) || application.part_time_employees < 0) return res.status(400).json({ error: 'Part-time employees is required before submission.' });
    if (application.has_dba == null) return res.status(400).json({ error: 'Please answer whether the business has a DBA before submission.' });
    if (application.has_dba && !String(application.dba_name || '').trim()) return res.status(400).json({ error: 'Please enter the DBA name before submission.' });
    if (!String(application.contact_phone || '').trim()) return res.status(400).json({ error: 'Primary owner phone is required before submission.' });

    const submittedOwners = ownersResult.data || [];
    const ownershipTotal = submittedOwners.reduce((sum, owner) => sum + Number(owner.ownership_percent || 0), 0);
    if (!submittedOwners.length || Math.abs(ownershipTotal - 100) > 0.001) {
      return res.status(400).json({ error: 'Business ownership must be complete and total 100% before submission.' });
    }
    if (submittedOwners.some((owner) => !String(owner.honorific_title || '').trim() || !String(owner.first_name || '').trim() || !String(owner.last_name || '').trim() || !String(owner.email || '').trim() || !String(owner.phone || '').trim() || !owner.dob_enc || !owner.ssn_enc || !(Number(owner.ownership_percent) > 0) || !String(owner.address_line1 || '').trim() || !String(owner.city || '').trim() || !String(owner.state || '').trim() || !String(owner.zip || '').trim())) {
      return res.status(400).json({ error: 'Every owner field is required before submission except Address Line 2.' });
    }

    const hasFormation = (docsResult.data || []).some((doc) => doc.document_type === 'formation');
    if (!application.is_sole_proprietorship && !hasFormation) {
      return res.status(400).json({ error: 'Please upload the Certificate of Formation or formation document before submitting.' });
    }

    const submittedAt = new Date().toISOString();
    const { data, error } = await supabase.from('uez_applications').update({
      status: 'in_progress',
      submitted_at: submittedAt,
      updated_at: submittedAt
    }).eq('id', application.id).select('*').single();
    if (error) throw error;

    await addStatusEvent(
      application.id,
      'submitted_for_review',
      'Application submitted',
      'COR received your application and will begin processing after payment is confirmed.',
      req.user.id,
      true
    );
    await safeSendApplicationEmail(data, 'submission_received', {
      dedupeKey: `submission_received:${application.id}`
    });

    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/applications/:id', async (req, res) => {
  try {
    const application = await getOwnedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    res.json(await getApplicationBundle(application, req.user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/applications/:id/credentials/mynj', async (req, res) => {
  try {
    const application = await getOwnedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });

    const { data, error } = await supabase.from('uez_credentials')
      .select('*')
      .eq('application_id', application.id)
      .eq('provider', 'mynj')
      .maybeSingle();
    if (error) throw error;
    res.setHeader('Cache-Control', 'no-store');
    res.json(data ? { exists: true, credentials: decryptCredential(data) } : { exists: false, credentials: null });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/admin/applications/:id/credentials/mynj', requireUezAdmin, async (req, res) => {
  try {
    const { data: application, error: appError } = await supabase.from('uez_applications')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (appError || !application) return res.status(404).json({ error: 'Application not found' });
    if (application.brc_status !== 'found') {
      return res.status(400).json({ error: 'Confirm the BRC before creating MyNJ credentials.' });
    }

    const result = await ensureMyNjCredentials(application, req.user.id);

    res.setHeader('Cache-Control', 'no-store');
    res.status(result.created ? 201 : 200).json({ exists: true, credentials: result.credentials });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/admin/applications/:id/credentials/mynj', requireUezAdmin, async (req, res) => {
  try {
    const { data: application, error: appError } = await supabase.from('uez_applications')
      .select('id')
      .eq('id', req.params.id)
      .single();
    if (appError || !application) return res.status(404).json({ error: 'Application not found' });

    const body = req.body || {};
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const challengeQuestion = String(body.challengeQuestion || '').trim();
    const challengeAnswer = String(body.challengeAnswer || '');
    if (!username || !password || !challengeQuestion || !challengeAnswer) {
      return res.status(400).json({ error: 'Username, password, challenge question, and challenge answer are all required.' });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase.from('uez_credentials').update({
      username_enc: encryptText(username),
      password_enc: encryptText(password),
      challenge_question_enc: encryptText(challengeQuestion),
      challenge_answer_enc: encryptText(challengeAnswer),
      updated_at: now
    }).eq('application_id', application.id).eq('provider', 'mynj').select('*').single();
    if (error || !data) throw error || new Error('MyNJ credentials have not been created yet.');

    res.setHeader('Cache-Control', 'no-store');
    res.json({ exists: true, credentials: decryptCredential(data) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/admin/applications/:id/pbs-account-created', requireUezAdmin, async (req, res) => {
  try {
    const { data: application, error: appError } = await supabase.from('uez_applications')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (appError || !application) return res.status(404).json({ error: 'Application not found' });

    const { data: credential, error: credentialError } = await supabase.from('uez_credentials')
      .select('*')
      .eq('application_id', application.id)
      .eq('provider', 'mynj')
      .maybeSingle();
    if (credentialError) throw credentialError;
    if (!credential) return res.status(400).json({ error: 'MyNJ account information must exist before marking the PBS account created.' });

    const now = new Date().toISOString();
    const { data, error } = await supabase.from('uez_applications').update({
      pbs_status: 'account_created',
      pbs_account_created: true,
      updated_at: now
    }).eq('id', application.id).select('*').single();
    if (error) throw error;

    if (!application.pbs_account_created && application.pbs_status !== 'account_created') {
      await addStatusEvent(
        application.id,
        'waiting_for_uez_approval',
        'PBS account created',
        "Your PBS account is ready. Upload the 'Notice of Certification Application Approved' email from UEZdonotreply@dca.nj.gov when you receive it.",
        req.user.id,
        true
      );
      const credentials = decryptCredential(credential);
      await safeSendApplicationEmail(data, 'pbs_account_created', {
        dedupeKey: `pbs_account_created:${application.id}`,
        extra: {
          pbs_username: credentials.username,
          pbs_password: credentials.password,
          challenge_question: credentials.challengeQuestion,
          challenge_answer: credentials.challengeAnswer
        }
      });
    }

    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/admin/applications/:id/documents/:documentId/review', requireUezAdmin, async (req, res) => {
  try {
    const decision = String(req.body?.decision || '').trim().toLowerCase();
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'Review decision must be approved or rejected.' });
    }

    const { data: application, error: appError } = await supabase.from('uez_applications')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (appError || !application) return res.status(404).json({ error: 'Application not found' });

    const { data: document, error: docError } = await supabase.from('uez_documents')
      .select('id, document_type, filename')
      .eq('id', req.params.documentId)
      .eq('application_id', application.id)
      .single();
    if (docError || !document) return res.status(404).json({ error: 'Document not found' });

    const now = new Date().toISOString();
    let patch = { updated_at: now };
    let eventStatus;
    let eventLabel;

    if (document.document_type === 'formation') {
      patch.formation_review_status = decision;
      eventStatus = decision === 'approved' ? 'formation_approved' : 'formation_rejected';
      eventLabel = decision === 'approved' ? 'Certificate of Formation approved' : 'Certificate of Formation needs replacement';
    } else if (document.document_type === 'uez_approval_email') {
      patch.uez_approval_review_status = decision;
      patch.uez_application_status = decision === 'approved' ? 'approved' : 'applied';
      patch.uez_application_submitted = true;
      eventStatus = decision === 'approved' ? 'uez_approval_approved' : 'uez_approval_rejected';
      eventLabel = decision === 'approved' ? 'UEZ approval confirmed' : 'UEZ approval document needs replacement';
    } else {
      return res.status(400).json({ error: 'This document does not require admin review.' });
    }

    const { data: updated, error: updateError } = await supabase.from('uez_applications')
      .update(patch)
      .eq('id', application.id)
      .select('*')
      .single();
    if (updateError) throw updateError;

    await addStatusEvent(
      application.id,
      eventStatus,
      eventLabel,
      decision === 'approved'
        ? `${document.filename} was reviewed and accepted.`
        : `${document.filename} needs to be replaced.`,
      req.user.id,
      true
    );
    if (document.document_type === 'formation' && decision === 'rejected') {
      await safeSendApplicationEmail(updated, 'formation_rejected', {
        dedupeKey: `formation_rejected:${application.id}:${document.id}`
      });
    }

    res.json({ application: updated, document, decision });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/admin/applications/:id/process-flags', requireUezAdmin, async (req, res) => {
  try {
    const { data: application, error: appError } = await supabase.from('uez_applications')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (appError || !application) return res.status(404).json({ error: 'Application not found' });

    const body = req.body || {};
    const patch = { updated_at: new Date().toISOString() };
    if (typeof body.pbsAccountCreated === 'boolean') {
      patch.pbs_account_created = body.pbsAccountCreated;
      patch.pbs_status = body.pbsAccountCreated ? 'account_created' : null;
    }
    if (typeof body.taxClearanceGood === 'boolean') patch.tax_clearance_good = body.taxClearanceGood;
    if (['not_started', 'applied', 'approved'].includes(body.uezApplicationStatus)) {
      patch.uez_application_status = body.uezApplicationStatus;
      patch.uez_application_submitted = body.uezApplicationStatus !== 'not_started';
    }
    if (['not_reviewed', 'approved', 'rejected'].includes(body.formationReviewStatus)) {
      patch.formation_review_status = body.formationReviewStatus;
    }
    if (['not_reviewed', 'approved', 'rejected'].includes(body.uezApprovalReviewStatus)) {
      patch.uez_approval_review_status = body.uezApprovalReviewStatus;
      if (body.uezApprovalReviewStatus === 'approved') {
        patch.uez_application_status = 'approved';
        patch.uez_application_submitted = true;
      } else if (body.uezApprovalReviewStatus === 'rejected') {
        patch.uez_application_status = 'applied';
        patch.uez_application_submitted = true;
      }
    }

    if (Object.keys(patch).length === 1) return res.status(400).json({ error: 'No process status was supplied.' });
    const { data, error } = await supabase.from('uez_applications').update(patch).eq('id', application.id).select('*').single();
    if (error) throw error;
    if (body.uezApplicationStatus === 'applied' && application.uez_application_status !== 'applied') {
      await safeSendApplicationEmail(data, 'uez_application_submitted', {
        dedupeKey: `uez_application_submitted:${application.id}`
      });
    }
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/applications/:id/payment-reported', async (req, res) => {
  try {
    const application = await getOwnedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });

    const { data: existing, error: existingError } = await supabase.from('uez_payments')
      .select('*')
      .eq('application_id', application.id)
      .in('status', ['client_reported', 'paid'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return res.json(existing);

    const { data, error } = await supabase.from('uez_payments').insert({
      application_id: application.id,
      amount: Number(application.payment_expected_amount || 500),
      status: 'client_reported',
      notes: 'Applicant reported that payment was sent.',
      recorded_by: req.user.id
    }).select('*').single();
    if (error) throw error;
    await addStatusEvent(application.id, 'payment_reported', 'Payment reported', 'You told COR that your payment was sent. We will verify receipt.', req.user.id, true);
    res.status(201).json(data);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/admin/applications/:id/payment', requireUezAdmin, async (req, res) => {
  try {
    const { data: application, error: appError } = await supabase.from('uez_applications').select('*').eq('id', req.params.id).single();
    if (appError || !application) return res.status(404).json({ error: 'Application not found' });

    const amount = Number(req.body?.amount ?? application.payment_expected_amount ?? 500);
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Enter a valid payment amount.' });
    const status = req.body?.status === 'client_reported' ? 'client_reported' : 'paid';
    const paymentDate = status === 'paid' ? (req.body?.paymentDate || new Date().toISOString().slice(0, 10)) : null;
    const method = String(req.body?.paymentMethod || '').trim() || null;
    const reference = String(req.body?.reference || '').trim() || null;
    const notes = String(req.body?.notes || '').trim() || null;

    const { data: existing, error: existingError } = await supabase.from('uez_payments')
      .select('*').eq('application_id', application.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existingError) throw existingError;

    let result;
    if (existing) {
      const { data, error } = await supabase.from('uez_payments').update({
        amount, status, payment_date: paymentDate, payment_method: method, reference, notes, recorded_by: req.user.id
      }).eq('id', existing.id).select('*').single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase.from('uez_payments').insert({
        application_id: application.id, amount, status, payment_date: paymentDate,
        payment_method: method, reference, notes, recorded_by: req.user.id
      }).select('*').single();
      if (error) throw error;
      result = data;
    }

    if (status === 'paid') {
      await addStatusEvent(application.id, 'payment_recorded', 'Client payment recorded', 'COR confirmed that your payment was received.', req.user.id, true);
      if (existing?.status !== 'paid') {
        await safeSendApplicationEmail(application, 'payment_received', {
          dedupeKey: `payment_received:${application.id}`
        });
      }
    }
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/admin/applications', requireUezAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabase.from('uez_applications')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const ids = (data || []).map((row) => row.id);
    if (!ids.length) return res.json([]);

    const [ownersResult, docsResult, paymentsResult] = await Promise.all([
      supabase.from('uez_owners').select('application_id').in('application_id', ids),
      supabase.from('uez_documents').select('application_id, document_type, created_at').in('application_id', ids),
      supabase.from('uez_payments').select('application_id, status, amount, payment_date, created_at').in('application_id', ids).order('created_at')
    ]);
    if (ownersResult.error) throw ownersResult.error;
    if (docsResult.error) throw docsResult.error;
    if (paymentsResult.error) throw paymentsResult.error;

    const ownerCounts = {};
    const docCounts = {};
    const docTypes = {};
    const latestPayments = {};
    for (const row of ownersResult.data || []) ownerCounts[row.application_id] = (ownerCounts[row.application_id] || 0) + 1;
    for (const row of docsResult.data || []) {
      docCounts[row.application_id] = (docCounts[row.application_id] || 0) + 1;
      if (!docTypes[row.application_id]) docTypes[row.application_id] = new Set();
      docTypes[row.application_id].add(row.document_type);
    }
    for (const row of paymentsResult.data || []) latestPayments[row.application_id] = row;

    res.json((data || []).map((row) => {
      const types = docTypes[row.id] || new Set();
      const formationReady = row.is_sole_proprietorship || (types.has('formation') && row.formation_review_status === 'approved');
      const readyCount = (formationReady ? 1 : 0)
        + (types.has('brc') ? 1 : 0)
        + (types.has('uez_approval_email') && row.uez_approval_review_status === 'approved' ? 1 : 0)
        + (types.has('tax_clearance') ? 1 : 0)
        + (types.has('ldc_application') ? 1 : 0);
      return {
        ...row,
        owner_count: ownerCounts[row.id] || 0,
        document_count: docCounts[row.id] || 0,
        document_types: [...types],
        required_document_ready_count: readyCount,
        payment_status: latestPayments[row.id]?.status || null,
        payment_amount: latestPayments[row.id]?.amount || null
      };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/applications/:id', requireUezAdmin, async (req, res) => {
  try {
    const { data: application, error: appError } = await supabase.from('uez_applications')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (appError || !application) return res.status(404).json({ error: 'Application not found' });

    const [ownersResult, docsResult, eventsResult, paymentsResult] = await Promise.all([
      supabase.from('uez_owners').select('*').eq('application_id', application.id).order('owner_order'),
      supabase.from('uez_documents').select('id, document_type, filename, source, status, metadata, created_at').eq('application_id', application.id).order('created_at'),
      supabase.from('uez_status_events').select('*').eq('application_id', application.id).order('created_at'),
      supabase.from('uez_payments').select('id, amount, payment_date, payment_method, reference, notes, status, refund_amount, refunded_at, created_at').eq('application_id', application.id).order('created_at')
    ]);

    if (ownersResult.error) throw ownersResult.error;
    if (docsResult.error) throw docsResult.error;
    if (eventsResult.error) throw eventsResult.error;
    if (paymentsResult.error) throw paymentsResult.error;

    const owners = (ownersResult.data || []).map((owner) => ({
      id: owner.id,
      ownerOrder: owner.owner_order,
      title: owner.honorific_title,
      firstName: owner.first_name,
      lastName: owner.last_name,
      email: owner.email,
      phone: owner.phone,
      ownershipPercent: owner.ownership_percent,
      positionTitle: owner.position_title || ((ownersResult.data || []).length === 1 ? 'Owner' : 'Partner'),
      addressLine1: owner.address_line1,
      addressLine2: owner.address_line2,
      city: owner.city,
      state: owner.state,
      zip: owner.zip,
      dob: decryptText(owner.dob_enc),
      ssn: decryptText(owner.ssn_enc)
    }));

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      application,
      owners,
      documents: docsResult.data || [],
      statusEvents: eventsResult.data || [],
      payments: paymentsResult.data || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/admin/applications/:id', requireUezAdmin, async (req, res) => {
  try {
    const { data: application, error: appError } = await supabase.from('uez_applications')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (appError || !application) return res.status(404).json({ error: 'Application not found' });

    const body = req.body || {};
    const ein = normalizeEin(body.ein);
    const yearFounded = body.yearFounded === '' || body.yearFounded == null ? null : Number(body.yearFounded);
    const fullTimeEmployees = body.fullTimeEmployees === '' || body.fullTimeEmployees == null ? null : Number(body.fullTimeEmployees);
    const partTimeEmployees = body.partTimeEmployees === '' || body.partTimeEmployees == null ? null : Number(body.partTimeEmployees);
    const grantAmountRequested = body.grantAmountRequested === '' || body.grantAmountRequested == null ? null : Number(body.grantAmountRequested);

    if (!String(body.businessName || '').trim()) return res.status(400).json({ error: 'Business name is required.' });
    if (ein.length !== 9) return res.status(400).json({ error: 'Enter a valid 9-digit EIN.' });
    if (!String(body.contactEmail || '').trim()) return res.status(400).json({ error: 'Contact email is required.' });
    if (yearFounded != null && (!Number.isInteger(yearFounded) || yearFounded < 1800 || yearFounded > new Date().getFullYear())) {
      return res.status(400).json({ error: 'Enter a valid year founded.' });
    }
    if (fullTimeEmployees != null && (!Number.isInteger(fullTimeEmployees) || fullTimeEmployees < 0)) {
      return res.status(400).json({ error: 'Full-time employees must be zero or greater.' });
    }
    if (partTimeEmployees != null && (!Number.isInteger(partTimeEmployees) || partTimeEmployees < 0)) {
      return res.status(400).json({ error: 'Part-time employees must be zero or greater.' });
    }
    if (body.hasDba !== true && body.hasDba !== false) return res.status(400).json({ error: 'DBA selection is required.' });
    if (body.hasDba === true && !String(body.dbaName || '').trim()) return res.status(400).json({ error: 'DBA name is required when the business has a DBA.' });
    if (grantAmountRequested != null && (!Number.isFinite(grantAmountRequested) || grantAmountRequested < 0)) return res.status(400).json({ error: 'Grant amount must be zero or greater.' });

    const patch = {
      contact_email: String(body.contactEmail).trim().toLowerCase(),
      contact_phone: String(body.contactPhone || '').trim() || null,
      business_name_input: String(body.businessName).trim(),
      registered_business_name: String(body.registeredBusinessName || '').trim() || null,
      ein,
      business_description: String(body.businessDescription || '').trim() || null,
      year_founded: yearFounded,
      is_sole_proprietorship: body.isSoleProprietorship === true,
      full_time_employees: fullTimeEmployees,
      part_time_employees: partTimeEmployees,
      has_dba: body.hasDba === true,
      dba_name: body.hasDba === true ? String(body.dbaName || '').trim() : null,
      grant_amount_requested: grantAmountRequested ?? (application.program_code === 'lakewood_technology_grant' ? 5000 : application.grant_amount_requested),
      address_line1: String(body.addressLine1 || '').trim() || null,
      address_line2: String(body.addressLine2 || '').trim() || null,
      city: String(body.city || '').trim() || null,
      state: String(body.state || 'NJ').trim().toUpperCase().slice(0, 2) || 'NJ',
      zip: String(body.zip || '').trim() || null,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase.from('uez_applications')
      .update(patch)
      .eq('id', application.id)
      .select('*')
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/admin/applications/:id', requireUezAdmin, async (req, res) => {
  try {
    const { data: application, error: appError } = await supabase.from('uez_applications')
      .select('id, business_name_input')
      .eq('id', req.params.id)
      .single();
    if (appError || !application) return res.status(404).json({ error: 'Application not found' });

    const { data: documents, error: docsError } = await supabase.from('uez_documents')
      .select('storage_path')
      .eq('application_id', application.id);
    if (docsError) throw docsError;

    const storagePaths = (documents || []).map((doc) => doc.storage_path).filter(Boolean);
    if (storagePaths.length) {
      const { error: storageError } = await supabase.storage.from(DOCUMENT_BUCKET).remove(storagePaths);
      if (storageError) throw storageError;
    }

    const { error } = await supabase.from('uez_applications').delete().eq('id', application.id);
    if (error) throw error;
    res.json({ ok: true, id: application.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/admin/applications/:id/brc-found', requireUezAdmin, async (req, res) => {
  try {
    const { data: application, error: appError } = await supabase.from('uez_applications')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (appError || !application) return res.status(404).json({ error: 'Application not found' });

    const body = req.body || {};
    const registeredBusinessName = String(body.registeredBusinessName || application.business_name_input || '').trim();
    if (!registeredBusinessName) return res.status(400).json({ error: 'Enter the official registered business name.' });

    const brcData = {
      taxpayerName: registeredBusinessName,
      tradeName: body.tradeName || null,
      address: body.address || null,
      certificateNumber: body.certificateNumber || null,
      effectiveDate: body.effectiveDate || null,
      issuanceDate: body.issuanceDate || null
    };

    const checkedAt = new Date().toISOString();
    const { data, error } = await supabase.from('uez_applications').update({
      brc_status: 'found',
      brc_checked_at: checkedAt,
      brc_registered_name: registeredBusinessName,
      registered_business_name: registeredBusinessName,
      brc_data: brcData,
      brc_last_error: null,
      updated_at: checkedAt
    }).eq('id', application.id).select('*').single();
    if (error) throw error;

    await addStatusEvent(
      application.id,
      'brc_confirmed',
      'BRC confirmed',
      'COR confirmed your New Jersey Business Registration Certificate and is continuing your application.',
      req.user.id,
      true
    );

    await ensureMyNjCredentials(data, req.user.id);

    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/admin/applications/:id/brc-not-found', requireUezAdmin, async (req, res) => {
  try {
    const { data: application, error: appError } = await supabase.from('uez_applications')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (appError || !application) return res.status(404).json({ error: 'Application not found' });

    const checkedAt = new Date().toISOString();
    const { data, error } = await supabase.from('uez_applications').update({
      brc_status: 'not_found',
      brc_checked_at: checkedAt,
      brc_last_error: null,
      updated_at: checkedAt
    }).eq('id', application.id).select('*').single();
    if (error) throw error;
    await safeSendApplicationEmail(data, 'brc_not_found', { dedupeKey: `brc_not_found:${application.id}` });

    await addStatusEvent(
      application.id,
      'waiting_for_brc',
      'BRC follow-up in progress',
      'COR is handling the New Jersey Business Registration Certificate follow-up.',
      req.user.id,
      false
    );

    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/admin/applications/:id/status', requireUezAdmin, async (req, res) => {
  try {
    const status = String(req.body?.status || '').trim();
    if (!status) return res.status(400).json({ error: 'Status is required.' });

    const { data: application, error: appError } = await supabase.from('uez_applications')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (appError || !application) return res.status(404).json({ error: 'Application not found' });

    const overallStatus = ['grant_submitted', 'applied'].includes(status)
      ? 'applied'
      : application.status === 'applied' ? 'applied' : 'in_progress';

    const { data, error } = await supabase.from('uez_applications').update({
      status: overallStatus,
      updated_at: new Date().toISOString()
    }).eq('id', application.id).select('*').single();
    if (error) throw error;

    await addStatusEvent(
      application.id,
      status,
      req.body?.label || 'Application updated',
      req.body?.message || 'COR updated your application.',
      req.user.id,
      req.body?.visibleToApplicant !== false
    );
    if (status === 'grant_submitted') {
      await safeSendApplicationEmail(data, 'grant_submitted', {
        dedupeKey: `grant_submitted:${application.id}`
      });
    }

    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
