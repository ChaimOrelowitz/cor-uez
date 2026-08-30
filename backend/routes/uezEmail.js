const express = require('express');
const supabase = require('../db/supabase');
const { requireUezAuth, requireUezAdmin } = require('../middleware/uezAuth');
const { decryptCredential } = require('../services/uezMyNj');
const {
  getTemplates,
  updateTemplate,
  renderApplicationEmail,
  sendApplicationEmail
} = require('../services/uezEmail');

const router = express.Router();
const DOCUMENT_BUCKET = 'uez-documents';
router.use(requireUezAuth);

// Internal-only ("every time an email is sent there is a log and timestamp") —
// this is in addition to the uez_email_log row sendApplicationEmail already
// writes; this is what makes the send show up in the admin Activity panel.
async function addEmailActivity(applicationId, { label, message, userId, metadata }) {
  await supabase.from('uez_status_events').insert({
    application_id: applicationId,
    status: 'admin_email_sent',
    label,
    message,
    visible_to_applicant: false,
    created_by: userId || null,
    metadata: metadata || {}
  });
}

router.get('/admin/templates', requireUezAdmin, async (_req, res) => {
  try {
    res.json(await getTemplates());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/admin/templates/:key', requireUezAdmin, async (req, res) => {
  try {
    res.json(await updateTemplate(req.params.key, req.body || {}, req.user.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

async function applicationForId(id) {
  const { data, error } = await supabase.from('uez_applications').select('*').eq('id', id).single();
  if (error || !data) return null;
  return data;
}

async function credentialVars(applicationId) {
  const { data, error } = await supabase.from('uez_credentials')
    .select('*').eq('application_id', applicationId).eq('provider', 'mynj').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('MyNJ / PBS credentials have not been created yet.');
  const credentials = decryptCredential(data);
  return {
    pbs_username: credentials.username,
    pbs_password: credentials.password,
    challenge_question: credentials.challengeQuestion,
    challenge_answer: credentials.challengeAnswer
  };
}


async function latestTaxIssueAttachment(applicationId) {
  const { data: document, error } = await supabase.from('uez_documents')
    .select('storage_path, filename, created_at')
    .eq('application_id', applicationId)
    .eq('document_type', 'tax_clearance_issue')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!document?.storage_path) return null;

  const { data: file, error: downloadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .download(document.storage_path);
  if (downloadError) throw downloadError;
  const bytes = Buffer.from(await file.arrayBuffer());
  return {
    filename: document.filename || 'NJ-Tax-Clearance-Issue.png',
    content: bytes.toString('base64')
  };
}

// Per-template auto-filled variables/attachments, shared by preview and send so
// what you're shown is exactly what would go out.
async function autoExtrasForTemplate(templateKey, applicationId, { strict } = {}) {
  let extra = {};
  if (templateKey === 'pbs_account_created') {
    try {
      extra = { ...extra, ...(await credentialVars(applicationId)) };
    } catch (err) {
      if (strict) throw err;
      // Preview should still render with the credential placeholders blank rather
      // than fail outright if credentials haven't been created yet.
    }
  }

  const attachments = [];
  if (templateKey === 'tax_issue') {
    const screenshot = await latestTaxIssueAttachment(applicationId);
    if (screenshot) attachments.push(screenshot);
  }

  return { extra, attachments };
}

// Render-only preview — shows exactly what "Send" would send, without sending it.
router.get('/admin/applications/:id/preview/:key', requireUezAdmin, async (req, res) => {
  try {
    const application = await applicationForId(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    const { extra, attachments } = await autoExtrasForTemplate(req.params.key, application.id, { strict: false });
    const rendered = await renderApplicationEmail(application, req.params.key, { extra });

    res.json({
      recipient: rendered.recipient,
      subject: rendered.subject,
      body: rendered.body,
      attachments: attachments.map((item) => ({
        filename: item.filename,
        contentType: /\.(png|jpe?g|webp)$/i.test(item.filename) ? `image/${item.filename.split('.').pop().toLowerCase().replace('jpg', 'jpeg')}` : 'application/octet-stream',
        size: Buffer.byteLength(item.content, 'base64')
      }))
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/admin/applications/:id/send/:key', requireUezAdmin, async (req, res) => {
  try {
    const application = await applicationForId(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    const bodyExtra = req.body?.extra && typeof req.body.extra === 'object' ? { ...req.body.extra } : {};
    const { extra: autoExtra, attachments } = await autoExtrasForTemplate(req.params.key, application.id, { strict: true });
    const extra = { ...autoExtra, ...bodyExtra };

    const result = await sendApplicationEmail(application, req.params.key, {
      mode: 'manual',
      extra,
      attachments,
      overrideSubject: typeof req.body?.subject === 'string' ? req.body.subject : undefined,
      overrideBody: typeof req.body?.body === 'string' ? req.body.body : undefined
    });

    await addEmailActivity(application.id, {
      label: result.sent ? `Email sent: ${req.params.key}` : `Email not sent: ${req.params.key}`,
      message: result.sent
        ? `Sent to ${result.log?.recipient || application.contact_email}.`
        : (result.error || (result.skipped ? `Skipped (${result.reason}).` : 'Send failed.')),
      userId: req.user.id,
      // Lets the admin case page link straight to this send in the Resend
      // dashboard (resend.com/emails/{id}) instead of just noting it happened.
      metadata: result.sent && result.log?.provider_message_id ? { providerMessageId: result.log.provider_message_id } : {}
    }).catch(() => {});

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
