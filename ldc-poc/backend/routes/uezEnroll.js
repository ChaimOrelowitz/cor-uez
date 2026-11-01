// Public enrollment endpoints (no auth) — a business captures its PBS/myNJ login via a
// one-time emailed link. Token-gated; never returns credentials.
const express = require('express');
const { getInvite, submitInvite } = require('../services/uezBusinessLogin');

const router = express.Router();
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error('enroll route error:', e);
  res.status(e.status || 500).json({ error: e.message || 'Something went wrong.' });
});

router.get('/:token', wrap(async (req, res) => {
  const info = await getInvite(req.params.token);
  if (!info) return res.status(404).json({ error: 'This link is not valid.' });
  res.json(info);
}));

router.post('/:token', wrap(async (req, res) => {
  const result = await submitInvite(req.params.token, { username: req.body.username, password: req.body.password });
  res.json(result);
}));

module.exports = router;
