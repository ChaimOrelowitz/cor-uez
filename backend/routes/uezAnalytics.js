const express = require('express');
const supabase = require('../db/supabase');
const { requireUezAuth, requireUezAdmin } = require('../middleware/uezAuth');

const router = express.Router();

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function newYorkDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function daysAgoDate(days) {
  return newYorkDate(new Date(Date.now() - (days * 24 * 60 * 60 * 1000)));
}

router.post('/visit', async (req, res) => {
  try {
    const sessionId = cleanText(req.body?.sessionId, 80);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
      return res.status(400).json({ error: 'Invalid visit session.' });
    }

    const payload = {
      session_id: sessionId,
      landing_path: cleanText(req.body?.path || '/', 300) || '/',
      referrer: cleanText(req.body?.referrer, 500) || null
    };

    const { error } = await supabase.from('uez_site_visits').insert(payload);
    if (error && error.code !== '23505') throw error;

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/visits', requireUezAuth, requireUezAdmin, async (_req, res) => {
  try {
    const today = newYorkDate();
    const sevenDaysAgo = daysAgoDate(6);
    const thirtyDaysAgo = daysAgoDate(29);

    const [todayResult, weekResult, monthResult, totalResult] = await Promise.all([
      supabase.from('uez_site_visits').select('id', { count: 'exact', head: true }).gte('visit_date', today),
      supabase.from('uez_site_visits').select('id', { count: 'exact', head: true }).gte('visit_date', sevenDaysAgo),
      supabase.from('uez_site_visits').select('id', { count: 'exact', head: true }).gte('visit_date', thirtyDaysAgo),
      supabase.from('uez_site_visits').select('id', { count: 'exact', head: true })
    ]);

    for (const result of [todayResult, weekResult, monthResult, totalResult]) {
      if (result.error) throw result.error;
    }

    res.json({
      today: todayResult.count || 0,
      last7Days: weekResult.count || 0,
      last30Days: monthResult.count || 0,
      total: totalResult.count || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
