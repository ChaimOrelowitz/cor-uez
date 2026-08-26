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

router.post('/admin/applications/:id/send/:key', requireUezAdmin, async (req, res) => {
  try {
    const application = await applicationForId(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    let extra = req.body?.extra && typeof req.body.extra === 'object' ? { ...req.body.extra } : {};
    if (req.params.key === 'pbs_account_created') {
      extra = { ...extra, ...(await credentialVars(application.id)) };
    }

    const result = await sendApplicationEmail(application, req.params.key, {
      mode: 'manual',
      extra
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
