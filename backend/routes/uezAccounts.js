const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const { requireUezAdmin } = require('../middleware/uezAuth');

const DOCUMENT_BUCKET = 'uez-documents';

// GET /api/uez/admin/accounts — list all auth users
router.get('/admin/accounts', requireUezAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;

    const userIds = (data.users || []).map((u) => u.id);
    const { data: apps } = await supabase
      .from('uez_applications')
      .select('id, business_name_input, applicant_user_id, status')
      .in('applicant_user_id', userIds);
    const appByUserId = {};
    for (const a of apps || []) appByUserId[a.applicant_user_id] = a;

    const users = (data.users || []).map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      banned: u.banned_until ? new Date(u.banned_until) > new Date() : false,
      banned_until: u.banned_until || null,
      application: appByUserId[u.id] || null,
    }));
    res.json(users);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/uez/admin/accounts/:userId — wipe everything: docs, storage, application, auth account
router.delete('/admin/accounts/:userId', requireUezAdmin, async (req, res) => {
  const userId = req.params.userId;
  try {
    // 1. Find their application(s)
    const { data: applications } = await supabase
      .from('uez_applications')
      .select('id')
      .eq('applicant_user_id', userId);

    for (const app of applications || []) {
      // 2. Get all document storage paths
      const { data: documents } = await supabase
        .from('uez_documents')
        .select('storage_path')
        .eq('application_id', app.id);

      const storagePaths = (documents || []).map((d) => d.storage_path).filter(Boolean);
      if (storagePaths.length) {
        await supabase.storage.from(DOCUMENT_BUCKET).remove(storagePaths);
      }

      // 3. Delete the application row (FK cascades owners, notes, process_steps, credentials, payments, emails)
      await supabase.from('uez_applications').delete().eq('id', app.id);
    }

    // 4. Delete the auth account
    const { error: authErr } = await supabase.auth.admin.deleteUser(userId);
    if (authErr) throw authErr;

    res.json({ ok: true, applications_deleted: (applications || []).length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/uez/admin/accounts/:userId/lock
router.post('/admin/accounts/:userId/lock', requireUezAdmin, async (req, res) => {
  try {
    const { error } = await supabase.auth.admin.updateUserById(req.params.userId, {
      ban_duration: '876000h', // ~100 years
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/uez/admin/accounts/:userId/unlock
router.post('/admin/accounts/:userId/unlock', requireUezAdmin, async (req, res) => {
  try {
    const { error } = await supabase.auth.admin.updateUserById(req.params.userId, {
      ban_duration: 'none',
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/uez/admin/accounts/:userId/reset-password
router.post('/admin/accounts/:userId/reset-password', requireUezAdmin, async (req, res) => {
  try {
    const { data: user, error: userErr } = await supabase.auth.admin.getUserById(req.params.userId);
    if (userErr || !user?.user?.email) throw userErr || new Error('User not found');
    const { error } = await supabase.auth.resetPasswordForEmail(user.user.email, {
      redirectTo: `${process.env.FRONTEND_URL || 'https://cor-uez.vercel.app'}/account-recovery`,
    });
    if (error) throw error;
    res.json({ ok: true, email: user.user.email });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
