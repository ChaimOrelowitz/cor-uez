const express = require('express');
const router = express.Router();
const { verifyEnvelope, NonceCache, MAX_BODY_BYTES } = require('../utils/davEnvelope');

const nonceCache = new NonceCache();
const READ_METHODS = new Set(['OPTIONS', 'PROPFIND', 'REPORT', 'GET', 'HEAD']);
const WRITE_METHODS = new Set(['PUT','POST','DELETE','PATCH','PROPPATCH','MKCOL','MKCALENDAR','COPY','MOVE','LOCK','UNLOCK','ACL','BIND','REBIND','UNBIND']);

router.use(express.json({ limit: '512kb' }));

router.post('/', async (req, res) => {
  const secret = process.env.DAV_BRIDGE_SECRET;
  if (!secret) return res.status(503).type('text/plain').send('Service not configured');

  const signature = req.headers['x-dav-signature'];
  const authorization = req.headers['x-dav-authorization'] || '';
  const verified = verifyEnvelope({
    envelope: req.body,
    signature,
    authorization,
    secret,
    nonceCache,
  });

  if (!verified.ok) return res.status(verified.status).type('text/plain').send('Bridge rejected');

  const { method, path, query, davHeaders, body } = verified.envelope;
  if (WRITE_METHODS.has(method)) return res.status(403).type('text/plain').send('Bridge rejected');
  if (!READ_METHODS.has(method)) return res.status(405).type('text/plain').send('Bridge rejected');
  if (!(path === '/dav' || path === '/dav/' || path.startsWith('/dav/') || path === '/.well-known/carddav' || path === '/.well-known/carddav/')) {
    return res.status(403).type('text/plain').send('Bridge rejected');
  }
  if (Buffer.byteLength(body || '', 'utf8') > MAX_BODY_BYTES) return res.status(413).type('text/plain').send('Bridge rejected');

  const port = process.env.PORT || 4000;
  const qs = query ? `?${query}` : '';
  const headers = { ...davHeaders, authorization };
  if (body) headers['content-length'] = Buffer.byteLength(body, 'utf8').toString();

  try {
    const upstream = await fetch(`http://127.0.0.1:${port}${path}${qs}`, {
      method,
      headers,
      body: method === 'PROPFIND' || method === 'REPORT' ? body : undefined,
      redirect: 'manual',
    });

    const arrayBuffer = await upstream.arrayBuffer();
    const outHeaders = {};
    for (const [k, v] of upstream.headers.entries()) {
      if (['connection', 'keep-alive', 'transfer-encoding', 'content-encoding'].includes(k.toLowerCase())) continue;
      outHeaders[k] = v;
    }

    return res.status(200).json({
      status: upstream.status,
      headers: outHeaders,
      body_b64: Buffer.from(arrayBuffer).toString('base64'),
    });
  } catch (err) {
    console.error('[dav-bridge] internal relay failed');
    return res.status(502).type('text/plain').send('Bridge unavailable');
  }
});

router.all('*', (_req, res) => res.status(405).type('text/plain').send('Method Not Allowed'));

module.exports = router;
