'use strict';
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const supabase = require('../db/supabase');

const ROOT = '/carddav';
const PRINCIPAL_PATH = `${ROOT}/principals/admin/`;
const ADDRESSBOOK_HOME = `${ROOT}/addressbooks/`;
const ADDRESSBOOK_PATH = `${ROOT}/addressbooks/uez/`;
const ADDRESSBOOK_NAME = 'UEZ Signups';
const VCARD_TYPE = 'text/vcard; charset=utf-8';
const CRLF = '\r\n';

const NS =
  'xmlns:D="DAV:" ' +
  'xmlns:C="urn:ietf:params:xml:ns:carddav" ' +
  'xmlns:CS="http://calendarserver.org/ns/"';

const PREFIX = {
  'getctag': 'CS',
  'addressbook-home-set': 'C',
  'address-data': 'C',
  'addressbook-description': 'C',
  'supported-address-data': 'C',
  'max-resource-size': 'C',
};

const WRITE_METHODS = new Set([
  'PUT','POST','DELETE','PATCH','PROPPATCH','MKCOL','MKCALENDAR',
  'COPY','MOVE','LOCK','UNLOCK','ACL','BIND','REBIND','UNBIND'
]);

const ALLOW = 'OPTIONS, HEAD, GET, PROPFIND, REPORT';

// ── transport/security headers ──────────────────────────────────────────────
router.use((_req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'DAV': '1, 3, addressbook',
    'MS-Author-Via': 'DAV',
  });
  next();
});

function requireBasicAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="UEZ CardDAV", charset="UTF-8"');
    return res.status(401).type('text/plain').send('Unauthorized');
  }

  let decoded = '';
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); }
  catch { decoded = ''; }

  const colon = decoded.indexOf(':');
  if (colon < 0) {
    res.set('WWW-Authenticate', 'Basic realm="UEZ CardDAV", charset="UTF-8"');
    return res.status(401).type('text/plain').send('Unauthorized');
  }

  const username = decoded.slice(0, colon);
  const password = decoded.slice(colon + 1);
  const wantUser = process.env.DAV_USERNAME;
  const wantPass = process.env.DAV_PASSWORD;

  if (!wantUser || !wantPass || username !== wantUser || password !== wantPass) {
    res.set('WWW-Authenticate', 'Basic realm="UEZ CardDAV", charset="UTF-8"');
    return res.status(401).type('text/plain').send('Unauthorized');
  }
  next();
}

function readBody(req, _res, next) {
  if (req.method !== 'PROPFIND' && req.method !== 'REPORT') return next();
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    req.davBody = Buffer.concat(chunks).toString('utf8');
    next();
  });
  req.on('error', next);
}

function rejectWrites(req, res, next) {
  if (!WRITE_METHODS.has(req.method)) return next();
  res.set('Allow', ALLOW);
  return res.status(403).type('text/plain').send('Read-only');
}

router.use(requireBasicAuth);
router.use(readBody);
router.use(rejectWrites);

// ── escaping / vCard ────────────────────────────────────────────────────────
function escapeVCardText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function fold(line) {
  const buf = Buffer.from(line, 'utf8');
  if (buf.length <= 75) return line;

  const out = [];
  let start = 0;
  let limit = 75;
  while (start < buf.length) {
    let end = Math.min(start + limit, buf.length);
    while (end > start && end < buf.length && (buf[end] & 0xc0) === 0x80) end--;
    out.push((out.length ? ' ' : '') + buf.slice(start, end).toString('utf8'));
    start = end;
    limit = 74;
  }
  return out.join(CRLF);
}

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return null;
}

function buildVCard(app, owner) {
  const first = owner?.first_name || '';
  const last = owner?.last_name || '';
  const display = [first, last].filter(Boolean).join(' ') || app.business_name_input || 'Unknown';

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'PRODID:-//COR Solutions//UEZ Signups//EN',
    `UID:${escapeVCardText(`uez-app-${app.id}`)}`,
    `N:${escapeVCardText(last)};${escapeVCardText(first)};;;`,
    `FN:${escapeVCardText(display)}`,
  ];

  const org = app.registered_business_name || app.business_name_input || '';
  if (org) lines.push(`ORG:${escapeVCardText(org)}`);

  const phone = normalizePhone(owner?.phone);
  if (phone) lines.push(`TEL;TYPE=CELL,VOICE:${phone}`);

  const email = owner?.email || '';
  if (email && /^\S+@\S+\.\S+$/.test(email)) {
    lines.push(`EMAIL;TYPE=INTERNET:${escapeVCardText(email)}`);
  }

  const street = [owner?.address_line1, owner?.address_line2].filter(Boolean).join(' ');
  const city = owner?.city || '';
  const state = owner?.state || '';
  const zip = owner?.zip || '';
  if (street || city || state || zip) {
    lines.push(
      `ADR;TYPE=HOME:;;${escapeVCardText(street)};${escapeVCardText(city)};` +
      `${escapeVCardText(state)};${escapeVCardText(zip)};US`
    );
  }

  lines.push('END:VCARD');
  return lines.map(fold).join(CRLF) + CRLF;
}

const hash = value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
const etagFor = body => `"${hash(body).slice(0, 32)}"`;

// ── data ────────────────────────────────────────────────────────────────────
async function fetchContacts() {
  const { data: apps, error: appErr } = await supabase
    .from('uez_applications')
    .select('id, business_name_input, registered_business_name, status')
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false });
  if (appErr) throw appErr;
  if (!apps?.length) return [];

  const appIds = apps.map(a => a.id);
  const { data: owners, error: ownerErr } = await supabase
    .from('uez_owners')
    .select('id, application_id, owner_order, first_name, last_name, email, phone, address_line1, address_line2, city, state, zip')
    .in('application_id', appIds)
    .order('owner_order', { ascending: true });
  if (ownerErr) throw ownerErr;

  const primary = new Map();
  for (const owner of owners || []) {
    if (!primary.has(owner.application_id)) primary.set(owner.application_id, owner);
  }

  return apps.map(app => {
    const owner = primary.get(app.id) || null;
    const body = buildVCard(app, owner);
    const filename = `uez-app-${app.id}.vcf`;
    return {
      app,
      owner,
      body,
      filename,
      href: `${ADDRESSBOOK_PATH}${encodeURIComponent(filename)}`,
      etag: etagFor(body),
      display: [owner?.first_name, owner?.last_name].filter(Boolean).join(' ') || app.business_name_input || 'Unknown',
    };
  });
}

function collectionTag(cards) {
  const material = ['schema:2', ...cards.map(c => `${c.filename}:${c.etag}`).sort()].join('\n');
  return hash(material).slice(0, 32);
}

const syncToken = ctag => `https://corsolutions.io/ns/uez-carddav/${ctag}`;

// ── XML/property helpers ────────────────────────────────────────────────────
function xmlEsc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tagFor(name) {
  return `${PREFIX[name] || 'D'}:${name}`;
}

function propStat(props, status) {
  const body = Object.entries(props).map(([name, inner]) => {
    const tag = tagFor(name);
    return inner === '' || inner == null ? `<${tag}/>` : `<${tag}>${inner}</${tag}>`;
  }).join('');
  return `<D:propstat><D:prop>${body}</D:prop><D:status>HTTP/1.1 ${status}</D:status></D:propstat>`;
}

function responseXml(href, found, missing = {}) {
  let body = `<D:href>${xmlEsc(href)}</D:href>`;
  if (Object.keys(found).length) body += propStat(found, '200 OK');
  if (Object.keys(missing).length) body += propStat(missing, '404 Not Found');
  return `<D:response>${body}</D:response>`;
}

function multistatus(responses, extra = '') {
  return `<?xml version="1.0" encoding="utf-8"?><D:multistatus ${NS}>${responses.join('')}${extra}</D:multistatus>`;
}

function sendMulti(res, responses, extra = '') {
  return res.status(207).type('application/xml; charset=utf-8').send(multistatus(responses, extra));
}

function requestedProps(body) {
  const xml = typeof body === 'string' ? body : '';
  if (!xml.trim()) return null;
  if (/<[\w-]*:?allprop\s*\/?>/i.test(xml)) return null;

  const block = xml.match(/<[\w-]*:?prop[\s>][\s\S]*?<\/[\w-]*:?prop\s*>/i);
  if (!block) return null;

  const names = [];
  const re = /<([\w-]+:)?([\w-]+)(\s[^>]*)?\/?>/g;
  let m;
  while ((m = re.exec(block[0]))) {
    const name = m[2].toLowerCase();
    if (name !== 'prop') names.push(name);
  }
  return names.length ? [...new Set(names)] : null;
}

function splitProps(available, requested) {
  if (!requested) return { found: available, missing: {} };
  const found = {};
  const missing = {};
  for (const name of requested) {
    if (name in available) found[name] = available[name];
    else missing[name] = '';
  }
  return { found, missing };
}

const PRIVILEGES =
  '<D:privilege><D:read/></D:privilege>' +
  '<D:privilege><D:read-current-user-privilege-set/></D:privilege>';

const SUPPORTED_REPORTS =
  '<D:supported-report><D:report><C:addressbook-multiget/></D:report></D:supported-report>' +
  '<D:supported-report><D:report><C:addressbook-query/></D:report></D:supported-report>' +
  '<D:supported-report><D:report><D:sync-collection/></D:report></D:supported-report>';

function commonProps() {
  return {
    'current-user-principal': `<D:href>${PRINCIPAL_PATH}</D:href>`,
    'principal-url': `<D:href>${PRINCIPAL_PATH}</D:href>`,
    'owner': `<D:href>${PRINCIPAL_PATH}</D:href>`,
    'current-user-privilege-set': PRIVILEGES,
  };
}

function rootProps() {
  return {
    ...commonProps(),
    'resourcetype': '<D:collection/>',
    'displayname': 'UEZ CardDAV',
  };
}

function principalProps() {
  return {
    ...commonProps(),
    'resourcetype': '<D:collection/><D:principal/>',
    'displayname': 'UEZ Admin',
    'addressbook-home-set': `<D:href>${ADDRESSBOOK_HOME}</D:href>`,
  };
}

function homeProps() {
  return {
    ...commonProps(),
    'resourcetype': '<D:collection/>',
    'displayname': 'UEZ Address Books',
  };
}

function bookProps(ctag) {
  return {
    ...commonProps(),
    'resourcetype': '<D:collection/><C:addressbook/>',
    'displayname': ADDRESSBOOK_NAME,
    'addressbook-description': 'COR Solutions UEZ signup contacts',
    'getctag': xmlEsc(ctag),
    'supported-report-set': SUPPORTED_REPORTS,
    'supported-address-data': '<C:address-data-type content-type="text/vcard" version="3.0"/>',
    'max-resource-size': '102400',
  };
}

function cardProps(card) {
  return {
    ...commonProps(),
    'resourcetype': '',
    'getetag': xmlEsc(card.etag),
    'getcontenttype': VCARD_TYPE,
    'getcontentlength': String(Buffer.byteLength(card.body, 'utf8')),
    'displayname': xmlEsc(card.display),
    'address-data': xmlEsc(card.body),
  };
}

function xmlEntityDecode(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function multigetHrefs(body) {
  const hrefs = [];
  const re = /<(?:[A-Za-z_][\w.-]*:)?href\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?href>/gi;
  let m;
  while ((m = re.exec(String(body || '')))) {
    const href = xmlEntityDecode(m[1]).trim();
    if (href) hrefs.push(href);
  }
  return hrefs;
}

function tokenIn(body) {
  const m = String(body || '').match(/<[\w-]*:?sync-token\s*>([\s\S]*?)<\/[\w-]*:?sync-token\s*>/i);
  return m ? xmlEntityDecode(m[1]).trim() : null;
}

// ── OPTIONS ─────────────────────────────────────────────────────────────────
router.options('*', (_req, res) => {
  res.set('Allow', ALLOW);
  res.status(200).end();
});

// ── root discovery ──────────────────────────────────────────────────────────
router.all(['', '/'], (req, res) => {
  if (req.method === 'PROPFIND') {
    const requested = requestedProps(req.davBody);
    const p = splitProps(rootProps(), requested);
    return sendMulti(res, [responseXml(`${ROOT}/`, p.found, p.missing)]);
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.status(200).type('text/plain').send(req.method === 'HEAD' ? '' : 'UEZ CardDAV OK');
  }

  res.set('Allow', ALLOW);
  return res.status(405).type('text/plain').send('Method Not Allowed');
});

// ── principal ───────────────────────────────────────────────────────────────
router.all(['/principals/:name', '/principals/:name/'], (req, res) => {
  if (req.method !== 'PROPFIND') {
    res.set('Allow', ALLOW);
    return res.status(405).type('text/plain').send('Method Not Allowed');
  }

  const requested = requestedProps(req.davBody);
  const p = splitProps(principalProps(), requested);
  return sendMulti(res, [responseXml(PRINCIPAL_PATH, p.found, p.missing)]);
});

// ── address-book home ───────────────────────────────────────────────────────
router.all(['/addressbooks', '/addressbooks/'], async (req, res) => {
  if (req.method !== 'PROPFIND') {
    res.set('Allow', ALLOW);
    return res.status(405).type('text/plain').send('Method Not Allowed');
  }

  try {
    const requested = requestedProps(req.davBody);
    const depth = String(req.headers.depth ?? '0').trim();
    const responses = [];

    const home = splitProps(homeProps(), requested);
    responses.push(responseXml(ADDRESSBOOK_HOME, home.found, home.missing));

    if (depth !== '0') {
      const cards = await fetchContacts();
      const ctag = collectionTag(cards);
      const book = splitProps(bookProps(ctag), requested);
      responses.push(responseXml(ADDRESSBOOK_PATH, book.found, book.missing));
    }

    return sendMulti(res, responses);
  } catch (err) {
    console.error('[carddav] home PROPFIND failed', err.message);
    return res.status(500).type('text/plain').send('Server error');
  }
});

// ── address book ────────────────────────────────────────────────────────────
router.all(['/addressbooks/uez', '/addressbooks/uez/'], async (req, res) => {
  try {
    const cards = await fetchContacts();
    const ctag = collectionTag(cards);
    const requested = requestedProps(req.davBody);

    if (req.method === 'PROPFIND') {
      const depth = String(req.headers.depth ?? '0').trim();
      const responses = [];

      const self = splitProps(bookProps(ctag), requested);
      responses.push(responseXml(ADDRESSBOOK_PATH, self.found, self.missing));

      if (depth !== '0') {
        for (const card of cards) {
          const p = splitProps(cardProps(card), requested);
          responses.push(responseXml(card.href, p.found, p.missing));
        }
      }

      return sendMulti(res, responses);
    }

    if (req.method === 'REPORT') {
      const body = req.davBody || '';

      if (/<[\w-]*:?sync-collection[\s>]/i.test(body)) {
        const current = syncToken(ctag);
        const given = tokenIn(body);

        if (given && given !== current) {
          return res.status(403).type('application/xml; charset=utf-8').send(
            `<?xml version="1.0" encoding="utf-8"?><D:error ${NS}><D:valid-sync-token/></D:error>`
          );
        }

        const responses = given === current ? [] : cards.map(card => {
          const p = splitProps(cardProps(card), requested);
          return responseXml(card.href, p.found, p.missing);
        });
        return sendMulti(res, responses, `<D:sync-token>${xmlEsc(current)}</D:sync-token>`);
      }

      let targets = cards;
      if (/<[\w-]*:?addressbook-multiget[\s>]/i.test(body)) {
        const wanted = new Set(multigetHrefs(body));
        targets = cards.filter(card => wanted.has(card.href));
      }

      const responses = targets.map(card => {
        const p = splitProps(cardProps(card), requested);
        return responseXml(card.href, p.found, p.missing);
      });
      return sendMulti(res, responses);
    }

    res.set('Allow', ALLOW);
    return res.status(405).type('text/plain').send('Method Not Allowed');
  } catch (err) {
    console.error('[carddav] book request failed', err.message);
    return res.status(500).type('text/plain').send('Server error');
  }
});

// ── individual card ─────────────────────────────────────────────────────────
router.all('/addressbooks/uez/:filename', async (req, res) => {
  try {
    const cards = await fetchContacts();
    const card = cards.find(c => c.filename === req.params.filename);
    if (!card) return res.status(404).type('text/plain').send('Not Found');

    if (req.method === 'PROPFIND') {
      const requested = requestedProps(req.davBody);
      const p = splitProps(cardProps(card), requested);
      return sendMulti(res, [responseXml(card.href, p.found, p.missing)]);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (req.headers['if-none-match'] === card.etag) {
        return res.status(304).set('ETag', card.etag).end();
      }

      res.set({
        'Content-Type': VCARD_TYPE,
        'ETag': card.etag,
      });
      if (req.method === 'HEAD') {
        res.set('Content-Length', String(Buffer.byteLength(card.body, 'utf8')));
        return res.status(200).end();
      }
      return res.status(200).send(card.body);
    }

    res.set('Allow', ALLOW);
    return res.status(405).type('text/plain').send('Method Not Allowed');
  } catch (err) {
    console.error('[carddav] card request failed', err.message);
    return res.status(500).type('text/plain').send('Server error');
  }
});

module.exports = router;
