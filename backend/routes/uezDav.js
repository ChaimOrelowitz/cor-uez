'use strict';
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const supabase = require('../db/supabase');

const PRINCIPAL_PATH    = '/carddav/principals/admin/';
const ADDRESSBOOK_HOME  = '/carddav/addressbooks/';
const ADDRESSBOOK_PATH  = '/carddav/addressbooks/uez/';
const ADDRESSBOOK_NAME  = 'UEZ Signups';

function requireBasicAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="UEZ CardDAV"');
    return res.status(401).end('Unauthorized');
  }
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) {
    res.set('WWW-Authenticate', 'Basic realm="UEZ CardDAV"');
    return res.status(401).end('Unauthorized');
  }
  const username = decoded.slice(0, colon);
  const password = decoded.slice(colon + 1);
  const wantUser = process.env.DAV_USERNAME;
  const wantPass = process.env.DAV_PASSWORD;
  if (!wantUser || !wantPass || username !== wantUser || password !== wantPass) {
    res.set('WWW-Authenticate', 'Basic realm="UEZ CardDAV"');
    return res.status(401).end('Unauthorized');
  }
  next();
}

function readBody(req, res, next) {
  if (req.method !== 'PROPFIND' && req.method !== 'REPORT') return next();
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => { req.davBody = Buffer.concat(chunks).toString('utf8'); next(); });
  req.on('error', next);
}

const WRITE_METHODS = new Set(['PUT','DELETE','MKCOL','PROPPATCH','COPY','MOVE','LOCK','UNLOCK']);
function rejectMutations(req, res, next) {
  if (WRITE_METHODS.has(req.method)) {
    res.set('Allow', 'OPTIONS, GET, HEAD, PROPFIND, REPORT');
    return res.status(405).end('Method Not Allowed — this address book is read-only.');
  }
  next();
}

function escapeVCardText(str) {
  if (str == null) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function escapeXml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizePhone(raw) {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return null;
}

function computeETag(app, owner) {
  const parts = [
    app.id,
    owner?.first_name || '',
    owner?.last_name || '',
    owner?.email || '',
    owner?.phone || '',
    app.business_name_input || '',
    app.registered_business_name || '',
    owner?.address_line1 || '',
    owner?.address_line2 || '',
    owner?.city || '',
    owner?.state || '',
    owner?.zip || '',
  ];
  return crypto.createHash('sha256').update(parts.join('\x00')).digest('hex').slice(0, 24);
}

const CRLF = '\r\n';

function buildVCard(app, owner) {
  const lines = [];
  const push = s => lines.push(s);

  push('BEGIN:VCARD');
  push('VERSION:3.0');
  push('PRODID:-//COR Solutions//UEZ Signups//EN');
  push(`UID:uez-app-${app.id}`);

  const first = owner?.first_name || '';
  const last = owner?.last_name || '';
  const fn = [first, last].filter(Boolean).join(' ') || app.business_name_input || 'Unknown';

  push(`FN:${escapeVCardText(fn)}`);
  push(`N:${escapeVCardText(last)};${escapeVCardText(first)};;;`);

  const phone = normalizePhone(owner?.phone);
  if (phone) push(`TEL;TYPE=CELL,VOICE:${phone}`);

  const email = owner?.email || '';
  if (email && /^\S+@\S+\.\S+$/.test(email)) {
    push(`EMAIL;TYPE=INTERNET:${email}`);
  }

  const street = owner?.address_line1 || '';
  const street2 = owner?.address_line2 || '';
  const city = owner?.city || '';
  const state = owner?.state || '';
  const zip = owner?.zip || '';
  const streetFull = [street, street2].filter(Boolean).join(' ');
  if (streetFull || city || state || zip) {
    push(
      `ADR;TYPE=HOME:;;${escapeVCardText(streetFull)};` +
      `${escapeVCardText(city)};${escapeVCardText(state)};${escapeVCardText(zip)};US`
    );
  }

  const org = app.registered_business_name || app.business_name_input || '';
  if (org) push(`ORG:${escapeVCardText(org)}`);

  push('END:VCARD');
  return lines.join(CRLF) + CRLF;
}

async function fetchContacts() {
  const { data: apps, error: appErr } = await supabase
    .from('uez_applications')
    .select('id, business_name_input, registered_business_name, status')
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false });
  if (appErr) throw appErr;
  if (!apps?.length) return [];

  const appIds = apps.map(a => a.id);
  const { data: owners, error: owErr } = await supabase
    .from('uez_owners')
    .select('id, application_id, owner_order, first_name, last_name, email, phone, address_line1, address_line2, city, state, zip')
    .in('application_id', appIds)
    .order('owner_order', { ascending: true });
  if (owErr) throw owErr;

  const primary = {};
  for (const o of owners || []) {
    if (!primary[o.application_id]) primary[o.application_id] = o;
  }

  return apps.map(app => {
    const owner = primary[app.id] || null;
    const etag = computeETag(app, owner);
    return {
      app,
      owner,
      etag,
      href: `${ADDRESSBOOK_PATH}uez-app-${app.id}.vcf`,
      filename: `uez-app-${app.id}.vcf`,
    };
  });
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>';
const NS = 'xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"';

function xmlMultiStatus(inner) {
  return `${XML_HEAD}\n<multistatus ${NS}>\n${inner}</multistatus>`;
}

function xmlResponse(href, props, status = 'HTTP/1.1 200 OK') {
  return (
    `<response>\n` +
    `<href>${escapeXml(href)}</href>\n` +
    `<propstat>\n<prop>\n${props}</prop>\n` +
    `<status>${status}</status>\n</propstat>\n` +
    `</response>\n`
  );
}

function sendXml(res, body) {
  res.status(207).set('Content-Type', 'application/xml; charset=utf-8').send(body);
}

router.use(requireBasicAuth);
router.use(readBody);
router.use(rejectMutations);

router.options('*', (_req, res) => {
  res.set({
    DAV: '1, 3, addressbook',
    Allow: 'OPTIONS, GET, HEAD, PROPFIND, REPORT',
    'MS-Author-Via': 'DAV',
    'Content-Length': '0',
  }).status(200).end();
});

router.all(['', '/'], (req, res) => {
  if (req.method === 'PROPFIND') {
    return sendXml(res, xmlMultiStatus(
      xmlResponse('/carddav/',
        `<current-user-principal><href>${escapeXml(PRINCIPAL_PATH)}</href></current-user-principal>\n` +
        `<principal-URL><href>${escapeXml(PRINCIPAL_PATH)}</href></principal-URL>\n` +
        `<resourcetype><collection/></resourcetype>\n` +
        `<displayname>UEZ CardDAV</displayname>\n`
      )
    ));
  }
  res.set({ DAV: '1, 3, addressbook', 'MS-Author-Via': 'DAV' }).send('UEZ CardDAV OK');
});

router.all(['/principals/:name', '/principals/:name/'], (req, res) => {
  if (req.method !== 'PROPFIND') return res.status(405).end('Method Not Allowed');
  sendXml(res, xmlMultiStatus(
    xmlResponse(PRINCIPAL_PATH,
      `<displayname>UEZ Admin</displayname>\n` +
      `<current-user-principal><href>${escapeXml(PRINCIPAL_PATH)}</href></current-user-principal>\n` +
      `<principal-URL><href>${escapeXml(PRINCIPAL_PATH)}</href></principal-URL>\n` +
      `<C:addressbook-home-set><href>${escapeXml(ADDRESSBOOK_HOME)}</href></C:addressbook-home-set>\n` +
      `<resourcetype><collection/><principal/></resourcetype>\n`
    )
  ));
});

router.all(['/addressbooks', '/addressbooks/'], (req, res) => {
  if (req.method !== 'PROPFIND') return res.status(405).end('Method Not Allowed');
  sendXml(res, xmlMultiStatus(
    xmlResponse(ADDRESSBOOK_HOME,
      `<resourcetype><collection/></resourcetype>\n` +
      `<displayname>UEZ Address Books</displayname>\n`
    ) +
    xmlResponse(ADDRESSBOOK_PATH,
      `<resourcetype><collection/><C:addressbook/></resourcetype>\n` +
      `<displayname>${escapeXml(ADDRESSBOOK_NAME)}</displayname>\n` +
      `<C:supported-address-data><C:address-data-type content-type="text/vcard" version="3.0"/></C:supported-address-data>\n` +
      `<supported-report-set>` +
      `<supported-report><report><C:addressbook-multiget/></report></supported-report>` +
      `<supported-report><report><C:addressbook-query/></report></supported-report>` +
      `</supported-report-set>\n` +
      `<current-user-privilege-set><privilege><read/></privilege></current-user-privilege-set>\n`
    )
  ));
});

router.all(['/addressbooks/uez', '/addressbooks/uez/'], async (req, res) => {
  if (req.method === 'PROPFIND') {
    try {
      const contacts = await fetchContacts();
      const collRow = xmlResponse(ADDRESSBOOK_PATH,
        `<resourcetype><collection/><C:addressbook/></resourcetype>\n` +
        `<displayname>${escapeXml(ADDRESSBOOK_NAME)}</displayname>\n`
      );
      const contactRows = contacts.map(({ href, etag }) =>
        xmlResponse(href,
          `<getetag>${escapeXml('"' + etag + '"')}</getetag>\n` +
          `<getcontenttype>text/vcard; charset=utf-8</getcontenttype>\n` +
          `<resourcetype/>\n`
        )
      ).join('');
      return sendXml(res, xmlMultiStatus(collRow + contactRows));
    } catch (err) {
      return res.status(500).end(err.message);
    }
  }

  if (req.method === 'REPORT') {
    try {
      const contacts = await fetchContacts();
      const body = req.davBody || '';
      const isMultiget = body.includes('addressbook-multiget');
      let targets = contacts;
      if (isMultiget) {
        const hrefRx = /<(?:[A-Za-z]+:)?href>([^<]+)<\/(?:[A-Za-z]+:)?href>/g;
        const wanted = new Set([...body.matchAll(hrefRx)].map(m => m[1].trim()));
        if (wanted.size) targets = contacts.filter(c => wanted.has(c.href));
      }

      const rows = targets.map(({ app, owner, href, etag }) => {
        const vcard = buildVCard(app, owner);
        return xmlResponse(href,
          `<getetag>${escapeXml('"' + etag + '"')}</getetag>\n` +
          `<C:address-data>${escapeXml(vcard)}</C:address-data>\n`
        );
      }).join('');
      return sendXml(res, xmlMultiStatus(rows));
    } catch (err) {
      return res.status(500).end(err.message);
    }
  }

  res.status(405).end('Method Not Allowed');
});

router.all('/addressbooks/uez/:filename', async (req, res) => {
  const { filename } = req.params;
  if (!filename.endsWith('.vcf')) return res.status(404).end('Not Found');
  const appId = filename.slice('uez-app-'.length, -'.vcf'.length);
  if (!appId) return res.status(404).end('Not Found');

  try {
    const { data: app, error: appErr } = await supabase
      .from('uez_applications')
      .select('id, business_name_input, registered_business_name, status')
      .eq('id', appId)
      .neq('status', 'cancelled')
      .maybeSingle();
    if (appErr) throw appErr;
    if (!app) return res.status(404).end('Not Found');

    const { data: owners, error: owErr } = await supabase
      .from('uez_owners')
      .select('first_name, last_name, email, phone, address_line1, address_line2, city, state, zip')
      .eq('application_id', appId)
      .order('owner_order', { ascending: true })
      .limit(1);
    if (owErr) throw owErr;

    const owner = owners?.[0] || null;
    const etag = computeETag(app, owner);
    const vcard = buildVCard(app, owner);

    res.set('ETag', `"${etag}"`);
    res.set('Content-Type', 'text/vcard; charset=utf-8');
    if (req.method === 'HEAD') return res.set('Content-Length', Buffer.byteLength(vcard)).status(200).end();
    if (req.method === 'GET') return res.status(200).send(vcard);
    res.status(405).end('Method Not Allowed');
  } catch (err) {
    res.status(500).end(err.message);
  }
});

module.exports = router;
