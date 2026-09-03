const crypto = require('crypto');

const VERSION = 1;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_SKEW_SECONDS = 300;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalString({ method, path, query = '', timestamp, nonce, bodyHash, authHash, davHeaders = {} }) {
  const headerKeys = ['depth','content-type','if-none-match','if-match','brief','prefer'];
  const headerLines = headerKeys.map(k => `${k}:${davHeaders[k] || ''}`).join('\n');
  return [
    `v:${VERSION}`,
    `method:${String(method || '').toUpperCase()}`,
    `path:${path || ''}`,
    `query:${query || ''}`,
    `timestamp:${timestamp}`,
    `nonce:${nonce || ''}`,
    `body_sha256:${bodyHash || ''}`,
    `authorization_sha256:${authHash || ''}`,
    headerLines,
  ].join('\n');
}

function signCanonical(canonical, secret) {
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

class NonceCache {
  constructor() { this.map = new Map(); }
  seen(nonce, now = Math.floor(Date.now() / 1000)) {
    for (const [k, exp] of this.map) if (exp <= now) this.map.delete(k);
    if (this.map.has(nonce)) return true;
    this.map.set(nonce, now + MAX_SKEW_SECONDS);
    return false;
  }
}

function verifyEnvelope({ envelope, signature, authorization, secret, nonceCache }) {
  if (!envelope || typeof envelope !== 'object') return { ok: false, status: 400, reason: 'bad envelope' };
  if (envelope.v !== VERSION) return { ok: false, status: 400, reason: 'bad version' };

  const now = Math.floor(Date.now() / 1000);
  const ts = Number(envelope.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, status: 401, reason: 'stale envelope' };
  }

  const nonce = String(envelope.nonce || '');
  if (!nonce || nonce.length > 256) return { ok: false, status: 400, reason: 'bad nonce' };

  let body;
  try { body = Buffer.from(String(envelope.body_b64 || ''), 'base64'); }
  catch { return { ok: false, status: 400, reason: 'bad body encoding' }; }
  if (body.length > MAX_BODY_BYTES) return { ok: false, status: 413, reason: 'body too large' };

  const bodyHash = sha256(body);
  const authHash = sha256(String(authorization || ''));
  if (bodyHash !== envelope.body_sha256 || authHash !== envelope.authorization_sha256) {
    return { ok: false, status: 401, reason: 'digest mismatch' };
  }

  const davHeaders = envelope.dav_headers || {};
  const canonical = canonicalString({
    method: envelope.method,
    path: envelope.path,
    query: envelope.query || '',
    timestamp: envelope.timestamp,
    nonce,
    bodyHash,
    authHash,
    davHeaders,
  });
  const expected = signCanonical(canonical, secret);
  if (!safeEqualHex(expected, String(signature || ''))) {
    return { ok: false, status: 401, reason: 'bad signature' };
  }

  if (nonceCache?.seen(nonce, now)) return { ok: false, status: 409, reason: 'replay' };

  return {
    ok: true,
    envelope: {
      method: String(envelope.method || '').toUpperCase(),
      path: String(envelope.path || ''),
      query: String(envelope.query || ''),
      davHeaders,
      body: body.toString('utf8'),
    }
  };
}

module.exports = { VERSION, MAX_BODY_BYTES, canonicalString, verifyEnvelope, NonceCache };
