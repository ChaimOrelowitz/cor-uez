const express = require('express');
const supabase = require('../db/supabase');
const { requireUezAuth, requireUezAdmin } = require('../middleware/uezAuth');
const { decryptCredential } = require('../services/uezMyNj');
const {
  getTemplates,
  updateTemplate,
  sendApplicationEmail
} = require('../services/uezEmail');

const router = express.Router();
const DOCUMENT_BUCKET = 'uez-documents';
router.use(requireUezAuth);

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

router.post('/admin/applications/:id/send/:key', requireUezAdmin, async (req, res) => {
  try {
    const application = await applicationForId(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    let extra = req.body?.extra && typeof req.body.extra === 'object' ? { ...req.body.extra } : {};
    if (req.params.key === 'pbs_account_created') {
      extra = { ...extra, ...(await credentialVars(application.id)) };
    }

    const attachments = [];
    if (req.params.key === 'tax_issue') {
      const screenshot = await latestTaxIssueAttachment(application.id);
      if (screenshot) attachments.push(screenshot);
    }

    const result = await sendApplicationEmail(application, req.params.key, {
      mode: 'manual',
      extra,
      attachments
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
