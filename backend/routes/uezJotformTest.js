// Admin-only harness for testing the JotForm signup wiring (see
// backend/routes/uezJotform.js for the webhook receiver that actually
// consumes a submission). This route only creates a throwaway test
// application for an admin to point the embedded JotForm at - it never
// touches anything a real client-facing route depends on.
const express = require('express');
const supabase = require('../db/supabase');
const { requireUezAuth, requireUezAdmin } = require('../middleware/uezAuth');

const router = express.Router();

// requireUezAuth/requireUezAdmin are applied directly on this one route,
// NOT via router.use() - this router is mounted at the broad '/api/uez'
// prefix in server.js, so a blanket router.use(requireUezAuth) here would
// intercept EVERY /api/uez/* request (signup, signup-layout, home-stats,
// etc.) before it ever reached uez.js's actual routes, rejecting every
// unauthenticated client-facing call with 401 "Missing authorization
// token" - exactly what happened and broke client account creation.
router.post('/admin/jotform-test/start', requireUezAuth, requireUezAdmin, async (req, res) => {
  try {
    const payload = {
      applicant_user_id: req.user.id,
      contact_email: req.user.email || null,
      business_name_input: `JOTFORM TEST — ${new Date().toLocaleString('en-US')}`,
      status: 'in_progress'
    };
    const { data, error } = await supabase.from('uez_applications').insert(payload).select('*').single();
    if (error) throw error;
    res.status(201).json({ applicationId: data.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
