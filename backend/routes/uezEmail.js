const express = require('express');
const supabase = require('../db/supabase');
const { requireUezAuth, requireUezAdmin } = require('../middleware/uezAuth');
const { decryptCredential } = require('../services/uezMyNj');
const {
  getTemplates,
  updateTemplate,
  renderApplicationEmail,
  sendApplicationEmail,
  ensureTemplateExists
} = require('../services/uezEmail');

// Default content for templates that are wired in code but not yet in the DB.
// ensureTemplateExists inserts only when the row is missing — after first use
// the row is editable via Email Settings like any other template.
const TEMPLATE_DEFAULTS = {
  submission_received: {
    display_name: 'Application received',
    subject: 'We received your UEZ application',
    body: `Hi {{first_name}},

Great news — we've received your UEZ application and created your account.

You can log in to your applicant portal at any time to check your application status and respond to any requests from our team.

Our team will review your application and be in touch with next steps. If you have any questions in the meantime, feel free to reach out.

Best,
The COR UEZ Team`,
    sort_order: 1
  },
  pbs_existing_account: {
    display_name: 'Existing PBS/MyNJ account — submit credentials',
    subject: 'Action needed: submit your MyNJ/PBS login credentials',
    body: `Hi {{first_name}},

We're moving forward with your UEZ application and need your MyNJ/PBS login credentials to proceed.

It looks like you may already have a PBS account. Please click the link below to check whether your browser remembers your login:

https://my.nj.gov/aui/Login?goto=https://www-njlib.nj.gov/NJ_PREMIER_EBIZ/OEGController?actionToPerform=login

Once you've confirmed your username and password, please enter them in your applicant portal so we can continue processing your application.

If you have any trouble, feel free to reach out and we'll help you get sorted.

Best,
The COR UEZ Team`,
    sort_order: 15
  },
  brc_wrong_address: {
    display_name: 'BRC address not in UEZ',
    subject: 'Action needed: update your registered business address',
    body: `Hi {{first_name}},

Thank you for starting your UEZ application. We looked up your Business Registration Certificate (BRC) and found that the address on file — {{brc_address}} — is not located within the UEZ zone.

To move forward, please update your registered business address with the NJ Division of Revenue to reflect your UEZ-eligible location, then let us know when it's been updated.

If you have any questions, feel free to reach out.

Best,
The COR UEZ Team`,
    sort_order: 20
  }
};

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

    if (TEMPLATE_DEFAULTS[req.params.key]) {
      await ensureTemplateExists(req.params.key, TEMPLATE_DEFAULTS[req.params.key]);
    }

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

    if (TEMPLATE_DEFAULTS[req.params.key]) {
      await ensureTemplateExists(req.params.key, TEMPLATE_DEFAULTS[req.params.key]);
    }

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
