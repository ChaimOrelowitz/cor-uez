const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const supabase = require('../db/supabase');
const { requireUezAuth, requireUezAdmin } = require('../middleware/uezAuth');
const { encryptText, decryptText } = require('../utils/uezCrypto');

const router = express.Router();
router.use('/brc', require('./uezBrc'));
router.use('/brc-live', require('./uezBrcLive'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
});

const DOCUMENT_BUCKET = 'uez-documents';
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
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
      .select('id, owner_order, first_name, last_name, email, phone, ownership_percent')
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

router.use(requireUezAuth);

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
      status: 'intake_in_progress'
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
      contact_phone: body.contactPhone ?? application.contact_phone,
      updated_at: new Date().toISOString()
    };

    if (patch.full_time_employees != null && patch.full_time_employees < 0) throw new Error('Full-time employees cannot be negative');
    if (patch.part_time_employees != null && patch.part_time_employees < 0) throw new Error('Part-time employees cannot be negative');

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
    if (owners.some((owner) => !owner.email || !owner.phone || !owner.dob || !String(owner.ssn || '').replace(/\D/g, ''))) {
      throw new Error('Each owner requires email, phone, date of birth, and SSN');
    }

    const { error: deleteError } = await supabase.from('uez_owners').delete().eq('application_id', application.id);
    if (deleteError) throw deleteError;

    const { data, error } = await supabase.from('uez_owners')
      .insert(rows)
      .select('id, owner_order, first_name, last_name, email, phone, ownership_percent, created_at, updated_at')
      .order('owner_order');
    if (error) throw error;
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
    if (!ALLOWED_MIME_TYPES.has(req.file.mimetype)) {
      return res.status(400).json({ error: 'Please upload a PDF, JPG, PNG, or WebP file.' });
    }

    const documentType = String(req.body?.documentType || 'supporting').trim().toLowerCase();
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

    if (documentType === 'brc') {
      const nextStatus = application.submitted_at ? 'brc_uploaded' : application.status;
      await supabase.from('uez_applications').update({
        brc_status: 'uploaded',
        status: nextStatus,
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

router.post('/applications/:id/submit', async (req, res) => {
  try {
    const application = await getOwnedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });

    const [ownersResult, docsResult] = await Promise.all([
      supabase.from('uez_owners').select('id, ownership_percent').eq('application_id', application.id),
      supabase.from('uez_documents').select('id, document_type').eq('application_id', application.id)
    ]);

    if (ownersResult.error) throw ownersResult.error;
    if (docsResult.error) throw docsResult.error;

    if (!application.business_name_input || !application.ein || !application.address_line1) {
      return res.status(400).json({ error: 'Business name, EIN, and business address are required before submission.' });
    }

    const ownershipTotal = (ownersResult.data || []).reduce((sum, owner) => sum + Number(owner.ownership_percent || 0), 0);
    if (!(ownersResult.data || []).length || Math.abs(ownershipTotal - 100) > 0.001) {
      return res.status(400).json({ error: 'Business ownership must be complete and total 100% before submission.' });
    }

    const hasFormation = (docsResult.data || []).some((doc) => doc.document_type === 'formation');
    if (!application.is_sole_proprietorship && !hasFormation) {
      return res.status(400).json({ error: 'Please upload the Certificate of Formation or formation document before submitting.' });
    }

    const submittedAt = new Date().toISOString();
    const { data, error } = await supabase.from('uez_applications').update({
      status: 'submitted_for_review',
      submitted_at: submittedAt,
      updated_at: submittedAt
    }).eq('id', application.id).select('*').single();
    if (error) throw error;

    await addStatusEvent(
      application.id,
      'submitted_for_review',
      'Application submitted',
      'COR received your application and will review your documents and verify your Business Registration Certificate.',
      req.user.id,
      true
    );

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

router.get('/admin/applications', requireUezAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabase.from('uez_applications')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const ids = (data || []).map((row) => row.id);
    if (!ids.length) return res.json([]);

    const [ownersResult, docsResult] = await Promise.all([
      supabase.from('uez_owners').select('application_id').in('application_id', ids),
      supabase.from('uez_documents').select('application_id, document_type').in('application_id', ids)
    ]);
    if (ownersResult.error) throw ownersResult.error;
    if (docsResult.error) throw docsResult.error;

    const ownerCounts = {};
    const docCounts = {};
    const brcUploads = {};
    for (const row of ownersResult.data || []) ownerCounts[row.application_id] = (ownerCounts[row.application_id] || 0) + 1;
    for (const row of docsResult.data || []) {
      docCounts[row.application_id] = (docCounts[row.application_id] || 0) + 1;
      if (row.document_type === 'brc') brcUploads[row.application_id] = true;
    }

    res.json((data || []).map((row) => ({
      ...row,
      owner_count: ownerCounts[row.id] || 0,
      document_count: docCounts[row.id] || 0,
      has_brc_upload: Boolean(brcUploads[row.id])
    })));
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

    const [ownersResult, docsResult, eventsResult] = await Promise.all([
      supabase.from('uez_owners').select('*').eq('application_id', application.id).order('owner_order'),
      supabase.from('uez_documents').select('id, document_type, filename, source, status, metadata, created_at').eq('application_id', application.id).order('created_at'),
      supabase.from('uez_status_events').select('*').eq('application_id', application.id).order('created_at')
    ]);

    if (ownersResult.error) throw ownersResult.error;
    if (docsResult.error) throw docsResult.error;
    if (eventsResult.error) throw eventsResult.error;

    const owners = (ownersResult.data || []).map((owner) => ({
      id: owner.id,
      ownerOrder: owner.owner_order,
      firstName: owner.first_name,
      lastName: owner.last_name,
      email: owner.email,
      phone: owner.phone,
      ownershipPercent: owner.ownership_percent,
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
      statusEvents: eventsResult.data || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      status: application.submitted_at ? 'brc_confirmed' : application.status,
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
      status: 'waiting_for_brc',
      updated_at: checkedAt
    }).eq('id', application.id).select('*').single();
    if (error) throw error;

    await addStatusEvent(
      application.id,
      'waiting_for_brc',
      'Business Registration Certificate needed',
      'We could not locate your New Jersey Business Registration Certificate. Please complete NJ business/tax registration, then upload your BRC in your COR account.',
      req.user.id,
      true
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

    const { data, error } = await supabase.from('uez_applications').update({
      status,
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

    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
