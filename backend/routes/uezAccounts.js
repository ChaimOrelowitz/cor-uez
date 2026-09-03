const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const { requireUezAdmin } = require('../middleware/uezAuth');

// GET /api/uez/admin/accounts — list all auth users
router.get('/admin/accounts', requireUezAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;
    // Enrich with application data where available
    const emails = (data.users || []).map((u) => u.email).filter(Boolean);
    const { data: apps } = await supabase
      .from('uez_applications')
      .select('id, business_name_input, contact_email, status')
      .in('contact_email', emails);
    const appByEmail = {};
    for (const a of apps || []) appByEmail[a.contact_email] = a;

    const users = (data.users || []).map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      banned: u.banned_until ? new Date(u.banned_until) > new Date() : false,
      banned_until: u.banned_until || null,
      application: appByEmail[u.email] || null,
    }));
    res.json(users);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/uez/admin/accounts/:userId
router.delete('/admin/accounts/:userId', requireUezAdmin, async (req, res) => {
  try {
    const { error } = await supabase.auth.admin.deleteUser(req.params.userId);
    if (error) throw error;
    res.json({ ok: true });
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
    // Get user email
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
