// Receives JotForm's webhook POST for the test client JotForm
// (jotform.com/build/262516524276055) and writes the submission into the
// same uez_applications/uez_owners/uez_documents tables the real signup
// wizard uses, so a test run shows up in the normal admin Case Workspace.
//
// Mounted directly on the Express app (see backend/server.js), NOT nested
// under uez.js's JWT-protected router - JotForm has no way to send a user
// JWT, so this is verified by a shared-secret token in the URL instead
// (same "public route, custom verification" shape as backend/routes/davBridge.js).
//
// This is intentionally a lighter-weight version of the real submit route's
// validation (backend/routes/uez.js, POST /applications/:id/submit) - just
// enough to prove the JotForm -> our pipeline plumbing actually works. It
// deliberately does NOT import/modify anything in uez.js, so there is zero
// risk to the live client wizard.
const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const supabase = require('../db/supabase');
const { encryptText } = require('../utils/uezCrypto');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const DOCUMENT_BUCKET = 'uez-documents';
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

// Field-name contract - the exact "Name" property set on each field in the
// JotForm builder (confirmed against the form's page source). Deliberately
// keyed by Name, never by the auto-generated q<N> position, since JotForm
// renumbers those every time the form is edited - only the Name is stable.
// If the form gets rebuilt/renamed, update this map, not the parsing logic.
const FIELDS = {
  applicationId: 'q47_applicationId',
  businessName: 'q4_companyName',
  ein: 'q5_ein',
  hasDba: 'q6_doesThe',
  dbaName: 'q7_dbaName',
  businessDescription: 'q8_inA96',
  yearFounded: 'q9_yearFounded',
  fullTimeEmployees: 'q11_howMany',
  partTimeEmployees: 'q12_howMany95',
  isSoleProprietorship: 'q39_iAm',
  hasBrc: 'q44_didYou',
  formationUpload: 'q38_certificateOf98',
  brcUpload: 'q43_businessRegistration102'
};

// Two fixed owner field-sets (not a repeating widget - confirmed from the
// page source). Owner 2's block is simply left blank if there's only one owner.
const OWNER_FIELD_SETS = [
  { title: 'q15_ownerTitle', name: 'q16_ownerName', address: 'q18_ownerHome', ssn: 'q19_ownerSsn', dob: 'q20_ownerDob', phone: 'q21_cell71', percent: 'q22_percentageOf' },
  { title: 'q24_positionTitle24', name: 'q25_owner2', address: 'q27_address80', ssn: 'q28_ownerSsn2', dob: 'q29_owner285', phone: 'q30_cell70', percent: 'q31_owner273' }
];

// NOTE: this test form has no "Owner email" field at all - flagged for the
// real Phase-2 form, which will need one (the production submit route
// requires a valid email per owner). Stored as null here.

function safeFilename(value) {
  const cleaned = String(value || 'document')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned.slice(0, 120) || 'document';
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function getValue(answers, name) {
  const value = answers[name];
  if (Array.isArray(value)) return value[0] ?? '';
  if (value && typeof value === 'object') return '';
  return value ?? '';
}

// JotForm's rawRequest may represent a bracket-suffixed field name
// (e.g. "q16_ownerName[first]") as either a nested object
// ({q16_ownerName: {first: ...}}) or a flat bracket key - handle both,
// since this hasn't been confirmed against a real submission yet.
function getSubValue(answers, name, subkey) {
  const nested = answers[name];
  if (nested && typeof nested === 'object' && !Array.isArray(nested) && nested[subkey] !== undefined) {
    return nested[subkey];
  }
  const flat = answers[`${name}[${subkey}]`];
  return flat !== undefined ? flat : '';
}

function isChecked(answers, name, expected = 'Yes') {
  const value = answers[name];
  if (Array.isArray(value)) return value.includes(expected);
  return value === expected;
}

function getFileUrls(answers, name) {
  const value = answers[name];
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') return value.split(/[|,]\s*/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function parseOwner(answers, set) {
  const firstName = String(getSubValue(answers, set.name, 'first') || '').trim();
  const lastName = String(getSubValue(answers, set.name, 'last') || '').trim();
  if (!firstName && !lastName) return null; // owner slot left blank
  const month = digits(getSubValue(answers, set.dob, 'month'));
  const day = digits(getSubValue(answers, set.dob, 'day'));
  const year = digits(getSubValue(answers, set.dob, 'year'));
  const ssnDigits = digits(getValue(answers, set.ssn));
  return {
    honorific_title: String(getValue(answers, set.title) || '').trim(),
    first_name: firstName,
    last_name: lastName,
    email: null,
    phone: digits(getSubValue(answers, set.phone, 'full')) || null,
    ownership_percent: Number(getValue(answers, set.percent)) || 0,
    position_title: 'Owner',
    address_line1: String(getSubValue(answers, set.address, 'addr_line1') || '').trim() || null,
    address_line2: String(getSubValue(answers, set.address, 'addr_line2') || '').trim() || null,
    city: String(getSubValue(answers, set.address, 'city') || '').trim() || null,
    state: String(getSubValue(answers, set.address, 'state') || '').trim().toUpperCase() || null,
    zip: String(getSubValue(answers, set.address, 'postal') || '').trim() || null,
    dob_enc: (month && day && year) ? encryptText(`${month}/${day}/${year}`) : null,
    ssn_enc: ssnDigits ? encryptText(ssnDigits) : null
  };
}

router.post('/:secretToken', upload.any(), async (req, res) => {
  try {
    const secret = process.env.JOTFORM_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: 'JOTFORM_WEBHOOK_SECRET is not configured' });
    const provided = Buffer.from(String(req.params.secretToken || ''));
    const expected = Buffer.from(secret);
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      return res.status(404).end();
    }

    const raw = req.body?.rawRequest;
    if (!raw) return res.status(400).json({ error: 'Missing rawRequest in webhook payload' });
    const answers = typeof raw === 'string' ? JSON.parse(raw) : raw;

    const applicationId = String(getValue(answers, FIELDS.applicationId) || '').trim();
    if (!applicationId) return res.status(400).json({ error: 'Missing applicationId - is the hidden field prefilled?' });

    const { data: application, error: appError } = await supabase.from('uez_applications')
      .select('*').eq('id', applicationId).maybeSingle();
    if (appError) throw appError;
    if (!application) return res.status(404).json({ error: `No application found for id ${applicationId}` });

    // Idempotency - JotForm can retry a delivery.
    if (application.submitted_at) {
      return res.json({ ok: true, alreadyProcessed: true });
    }

    // 1. Business fields
    const ein = digits(getValue(answers, FIELDS.ein)).slice(0, 9);
    const isSoleProp = isChecked(answers, FIELDS.isSoleProprietorship);
    const hasDba = getValue(answers, FIELDS.hasDba) === 'Yes';
    const { error: businessError } = await supabase.from('uez_applications').update({
      business_name_input: String(getValue(answers, FIELDS.businessName) || '').trim() || null,
      business_description: String(getValue(answers, FIELDS.businessDescription) || '').trim() || null,
      ein: ein || null,
      year_founded: Number(getValue(answers, FIELDS.yearFounded)) || null,
      is_sole_proprietorship: isSoleProp,
      full_time_employees: Number(getValue(answers, FIELDS.fullTimeEmployees)) || 0,
      part_time_employees: Number(getValue(answers, FIELDS.partTimeEmployees)) || 0,
      has_dba: hasDba,
      dba_name: hasDba ? (String(getValue(answers, FIELDS.dbaName) || '').trim() || null) : null,
      updated_at: new Date().toISOString()
    }).eq('id', application.id);
    if (businessError) throw businessError;

    // 2. Owners - replace all, same semantics as the real owners route
    const owners = OWNER_FIELD_SETS.map((set) => parseOwner(answers, set)).filter(Boolean);
    if (owners.length) {
      const { error: deleteError } = await supabase.from('uez_owners').delete().eq('application_id', application.id);
      if (deleteError) throw deleteError;
      const rows = owners.map((owner, index) => ({ ...owner, application_id: application.id, owner_order: index + 1 }));
      const { error: insertError } = await supabase.from('uez_owners').insert(rows);
      if (insertError) throw insertError;
      if (rows[0]?.phone) {
        await supabase.from('uez_applications').update({ contact_phone: rows[0].phone }).eq('id', application.id);
      }
    }

    // 3. Documents - JotForm's file-upload answers are CDN URLs, not bytes;
    // fetch each one server-side and store it the same way the real upload
    // route does (same bucket/path convention, same uez_documents shape).
    async function storeDocument(documentType, url) {
      if (!url) return;
      try {
        const response = await fetch(url);
        if (!response.ok) { console.warn(`[jotform-webhook] could not fetch ${documentType} from JotForm: ${response.status}`); return; }
        const buffer = Buffer.from(await response.arrayBuffer());
        const mimetype = response.headers.get('content-type') || 'application/octet-stream';
        if (!ALLOWED_MIME_TYPES.has(mimetype)) { console.warn(`[jotform-webhook] ${documentType} has disallowed type ${mimetype}, skipping`); return; }
        const originalname = decodeURIComponent(url.split('/').pop() || `${documentType}.pdf`);
        const storagePath = `${application.applicant_user_id}/${application.id}/${Date.now()}-${crypto.randomUUID()}-${safeFilename(originalname)}`;
        const { error: storageError } = await supabase.storage.from(DOCUMENT_BUCKET).upload(storagePath, buffer, { contentType: mimetype, upsert: false });
        if (storageError) throw storageError;
        const { error: docError } = await supabase.from('uez_documents').insert({
          application_id: application.id,
          document_type: documentType,
          storage_path: storagePath,
          filename: originalname,
          source: 'jotform_webhook',
          status: 'received',
          metadata: { mimeType: mimetype, size: buffer.length }
        });
        if (docError) throw docError;
      } catch (err) {
        console.error(`[jotform-webhook] failed to store ${documentType}:`, err.message);
      }
    }

    if (!isSoleProp) {
      await storeDocument('formation', getFileUrls(answers, FIELDS.formationUpload)[0]);
    }

    const hasBrc = getValue(answers, FIELDS.hasBrc) === 'Yes';
    if (hasBrc) {
      await storeDocument('brc', getFileUrls(answers, FIELDS.brcUpload)[0]);
      await supabase.from('uez_applications').update({ brc_status: 'uploaded' }).eq('id', application.id);
    } else {
      await supabase.from('uez_applications').update({ brc_status: 'client_created' }).eq('id', application.id);
    }

    // 4. Mark submitted. Lighter-weight than the real submit route's full
    // validation checklist on purpose - this is a wiring test, not
    // compliance-critical intake.
    const submittedAt = new Date().toISOString();
    await supabase.from('uez_applications').update({
      status: 'in_progress',
      submitted_at: submittedAt,
      updated_at: submittedAt
    }).eq('id', application.id);

    res.json({ ok: true });
  } catch (err) {
    console.error('[jotform-webhook] failed:', err);
    // A real 4xx/5xx here (rather than always-200) is deliberate for this
    // test-only route: JotForm's own webhook log then shows the failure,
    // which is exactly the debugging signal we want while proving this out.
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
