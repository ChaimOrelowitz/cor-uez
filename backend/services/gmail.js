// Gmail as the email channel: sends go out from the Workspace mailbox (as the
// GMAIL_SENDER alias) so they land in Sent, and every message to/from a client
// address is mirrored into uez_messages so each case has its full email
// history in-app. Auth is a single offline refresh token (see .env:
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN / GMAIL_SENDER).
const crypto = require('crypto');
const supabase = require('../db/supabase');

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const BUCKET = 'uez-documents';
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const SMALL_INLINE_BYTES = 15 * 1024; // signature logos etc. — not worth showing
const SYNC_MIN_INTERVAL_MS = 60 * 1000;
const FROM_NAME = process.env.GMAIL_FROM_NAME || 'COR Solutions';

function gmailConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    && process.env.GOOGLE_REFRESH_TOKEN && process.env.GMAIL_SENDER);
}

let tokenCache = { token: null, expiresAt: 0 };
async function accessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60 * 1000) return tokenCache.token;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`Google sign-in failed: ${payload.error_description || payload.error || response.status}`);
  }
  tokenCache = { token: payload.access_token, expiresAt: Date.now() + (payload.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

async function gapi(path, { method = 'GET', query, body } = {}) {
  const url = new URL(`${API}${path}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
    else if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(`Gmail ${method} ${path} failed: ${payload?.error?.message || response.status}`);
    err.status = response.status;
    throw err;
  }
  return payload;
}

// The mailbox itself plus every "Send mail as" alias — mail from any of these
// is ours (outbound); these are never treated as a client address.
let ownCache = { set: null, at: 0 };
async function ownAddresses() {
  if (ownCache.set && Date.now() - ownCache.at < 60 * 60 * 1000) return ownCache.set;
  const [profile, sendAs] = await Promise.all([gapi('/profile'), gapi('/settings/sendAs')]);
  const set = new Set([profile.emailAddress, ...(sendAs.sendAs || []).map((a) => a.sendAsEmail)]
    .filter(Boolean).map((e) => e.toLowerCase()));
  set.add(String(process.env.GMAIL_SENDER).toLowerCase());
  ownCache = { set, at: Date.now(), mailbox: profile.emailAddress };
  return set;
}

async function mailboxAddress() {
  await ownAddresses();
  return ownCache.mailbox;
}

// ---------- MIME ----------

function encodeHeader(value) {
  const text = String(value || '');
  return /[^\x20-\x7e]/.test(text) ? `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=` : text;
}

function wrap76(b64) {
  return b64.replace(/.{1,76}/g, '$&\r\n');
}

function mimeTypeFor(filename) {
  const ext = String(filename || '').split('.').pop().toLowerCase();
  return {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }[ext] || 'application/octet-stream';
}

function safeFilename(name) {
  return String(name || 'attachment').replace(/["\r\n\\]/g, '_');
}

function buildMime({ to, subject, text, html, attachments = [], inReplyTo, references }) {
  const mixed = `mixed_${crypto.randomBytes(12).toString('hex')}`;
  const alt = `alt_${crypto.randomBytes(12).toString('hex')}`;
  const headers = [
    `From: ${encodeHeader(FROM_NAME)} <${process.env.GMAIL_SENDER}>`,
    `To: ${(Array.isArray(to) ? to : [to]).join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${references || inReplyTo}`] : []),
    `Content-Type: multipart/mixed; boundary="${mixed}"`
  ];
  const parts = [
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(text || '', 'utf8').toString('base64')),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(html || '', 'utf8').toString('base64')),
    `--${alt}--`
  ];
  for (const item of attachments) {
    const filename = safeFilename(item.filename);
    parts.push(
      `--${mixed}`,
      `Content-Type: ${item.contentType || mimeTypeFor(filename)}; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(String(item.content || '').replace(/\s/g, ''))
    );
  }
  parts.push(`--${mixed}--`, '');
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

// attachments: [{ filename, content (base64), contentType? }]
async function sendGmail({ to, subject, text, html, attachments, threadId, inReplyTo, references }) {
  const raw = Buffer.from(buildMime({ to, subject, text, html, attachments, inReplyTo, references }), 'utf8').toString('base64url');
  const sent = await gapi('/messages/send', { method: 'POST', body: { raw, ...(threadId ? { threadId } : {}) } });
  return { id: sent.id, threadId: sent.threadId };
}

// ---------- Parsing ----------

function headerValue(headers, name) {
  const hit = (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase());
  return hit ? hit.value : '';
}

// "Jane Doe" <jane@x.com>, bob@y.com, "Last, First" <f@z.com>
function parseAddressList(value) {
  const out = [];
  let current = '';
  let inQuotes = false;
  let depth = 0;
  for (const ch of String(value || '')) {
    if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes && ch === '<') depth += 1;
    if (!inQuotes && ch === '>') depth -= 1;
    if (ch === ',' && !inQuotes && depth <= 0) { out.push(current); current = ''; continue; }
    current += ch;
  }
  out.push(current);
  return out.map((item) => {
    const trimmed = item.trim();
    if (!trimmed) return null;
    const angle = trimmed.match(/<([^>]+)>/);
    const email = (angle ? angle[1] : trimmed).trim().toLowerCase();
    if (!/@/.test(email)) return null;
    const name = angle ? trimmed.slice(0, angle.index).trim().replace(/^"|"$/g, '') : '';
    return { email, name };
  }).filter(Boolean);
}

function decodeBody(data) {
  return data ? Buffer.from(data, 'base64url').toString('utf8') : '';
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function walkParts(part, acc = { text: '', html: '', attachments: [] }) {
  if (!part) return acc;
  const disposition = headerValue(part.headers, 'Content-Disposition');
  const contentId = headerValue(part.headers, 'Content-ID').replace(/[<>]/g, '');
  if (part.filename) {
    acc.attachments.push({
      filename: part.filename,
      mimeType: part.mimeType,
      size: part.body?.size || 0,
      attachmentId: part.body?.attachmentId || null,
      data: part.body?.data || null,
      inline: /^inline/i.test(disposition) || Boolean(contentId && !/^attachment/i.test(disposition)),
      contentId: contentId || null
    });
  } else if (part.mimeType === 'text/plain' && !acc.text) {
    acc.text = decodeBody(part.body?.data);
  } else if (part.mimeType === 'text/html' && !acc.html) {
    acc.html = decodeBody(part.body?.data);
  }
  (part.parts || []).forEach((child) => walkParts(child, acc));
  return acc;
}

// ---------- Case matching ----------

async function buildCaseIndex() {
  const [apps, owners] = await Promise.all([
    supabase.from('uez_applications').select('id, contact_email'),
    supabase.from('uez_owners').select('application_id, email')
  ]);
  if (apps.error) throw apps.error;
  if (owners.error) throw owners.error;
  const own = await ownAddresses();
  const index = new Map();
  const add = (email, applicationId) => {
    const key = String(email || '').trim().toLowerCase();
    if (!key || !key.includes('@') || own.has(key)) return;
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(applicationId);
  };
  (apps.data || []).forEach((a) => add(a.contact_email, a.id));
  (owners.data || []).forEach((o) => add(o.email, o.application_id));
  return index;
}

function isMissingTable(err) {
  const text = `${err?.code || ''} ${err?.message || ''}`;
  return /42P01|PGRST205|does not exist|Could not find the table/i.test(text);
}

// ---------- Import ----------

async function storeAttachments(messageId, list) {
  const stored = [];
  for (let i = 0; i < list.length; i += 1) {
    const att = list[i];
    if (att.inline && att.size < SMALL_INLINE_BYTES) continue;
    const entry = { filename: att.filename, mimeType: att.mimeType, size: att.size, contentId: att.contentId, inline: att.inline, storagePath: null };
    if (att.size <= MAX_ATTACHMENT_BYTES) {
      try {
        const data = att.data || (await gapi(`/messages/${messageId}/attachments/${att.attachmentId}`)).data;
        const path = `messages/${messageId}/${i}-${String(att.filename).replace(/[^\w.\-]+/g, '_').slice(-120)}`;
        const { error } = await supabase.storage.from(BUCKET)
          .upload(path, Buffer.from(data, 'base64url'), { contentType: att.mimeType || 'application/octet-stream', upsert: true });
        if (error) throw error;
        entry.storagePath = path;
      } catch (err) {
        console.warn(`Gmail attachment ${att.filename} on ${messageId} not stored:`, err.message);
      }
    }
    stored.push(entry);
  }
  return stored;
}

// Imports one Gmail message into every case whose client address is on it.
// options.applicationId forces a case (a send from inside the app), and
// options.templateKey tags which template it was.
async function importMessage(messageId, caseIndex, options = {}) {
  const meta = await gapi(`/messages/${messageId}`, {
    query: { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc'] }
  });
  const labels = meta.labelIds || [];
  if (labels.some((l) => ['DRAFT', 'SPAM', 'TRASH', 'CHAT'].includes(l))) return 0;

  const own = await ownAddresses();
  const from = parseAddressList(headerValue(meta.payload?.headers, 'From'))[0] || null;
  const to = parseAddressList(headerValue(meta.payload?.headers, 'To'));
  const cc = parseAddressList(headerValue(meta.payload?.headers, 'Cc'));

  const targets = new Set(options.applicationId ? [options.applicationId] : []);
  [from, ...to, ...cc].filter(Boolean).forEach((p) => (caseIndex.get(p.email) || []).forEach((id) => targets.add(id)));
  if (!targets.size) return 0;

  const { data: existing, error: existingError } = await supabase.from('uez_messages')
    .select('application_id').eq('gmail_message_id', messageId);
  if (existingError) throw existingError;
  const have = new Set((existing || []).map((r) => r.application_id));
  const missing = [...targets].filter((id) => !have.has(id));
  if (!missing.length) return 0;

  const full = await gapi(`/messages/${messageId}`, { query: { format: 'full' } });
  const headers = full.payload?.headers || [];
  const parts = walkParts(full.payload);
  const attachments = await storeAttachments(messageId, parts.attachments);
  const outbound = Boolean(from && own.has(from.email));

  const rows = missing.map((applicationId) => ({
    application_id: applicationId,
    channel: 'email',
    direction: outbound ? 'outbound' : 'inbound',
    provider: 'gmail',
    gmail_message_id: messageId,
    gmail_thread_id: full.threadId,
    rfc_message_id: headerValue(headers, 'Message-ID') || headerValue(headers, 'Message-Id') || null,
    from_address: from?.email || null,
    from_name: from?.name || null,
    to_addresses: to.map((p) => p.email),
    cc_addresses: cc.map((p) => p.email),
    subject: headerValue(headers, 'Subject') || '',
    snippet: full.snippet || '',
    body_text: (parts.text || htmlToText(parts.html)).slice(0, 200000),
    attachments,
    template_key: applicationId === options.applicationId ? (options.templateKey || null) : null,
    sent_at: new Date(Number(full.internalDate) || Date.now()).toISOString()
  }));
  const { error } = await supabase.from('uez_messages')
    .upsert(rows, { onConflict: 'application_id,gmail_message_id', ignoreDuplicates: true });
  if (error) throw error;
  return rows.length;
}

async function importIds(ids, caseIndex) {
  let imported = 0;
  const queue = [...new Set(ids)];
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        imported += await importMessage(id, caseIndex);
      } catch (err) {
        if (isMissingTable(err)) throw err;
        if (err.status !== 404) console.warn(`Gmail import ${id} failed:`, err.message);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return imported;
}

async function listMessageIds(q, limit = 2000) {
  const ids = [];
  let pageToken;
  do {
    const page = await gapi('/messages', { query: { q, maxResults: 500, pageToken } });
    (page.messages || []).forEach((m) => ids.push(m.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < limit);
  return ids;
}

// ---------- Sync ----------

async function backfillNewAddresses(caseIndex) {
  const { data, error } = await supabase.from('uez_gmail_backfill').select('email');
  if (error) throw error;
  const done = new Set((data || []).map((r) => r.email));
  const pending = [...caseIndex.keys()].filter((e) => !done.has(e));
  let imported = 0;
  for (const email of pending) {
    const ids = await listMessageIds(`{from:${email} to:${email} cc:${email}} -in:chats`);
    const count = await importIds(ids, caseIndex);
    imported += count;
    const { error: markError } = await supabase.from('uez_gmail_backfill')
      .upsert({ email, message_count: ids.length, backfilled_at: new Date().toISOString() });
    if (markError) throw markError;
  }
  return { addresses: pending.length, imported };
}

async function incrementalSync(caseIndex) {
  const { data: state, error } = await supabase.from('uez_gmail_sync').select('*').eq('id', 'default').maybeSingle();
  if (error) throw error;

  const saveCursor = (historyId) => supabase.from('uez_gmail_sync')
    .upsert({ id: 'default', history_id: String(historyId), last_synced_at: new Date().toISOString() })
    .then(({ error: e }) => { if (e) throw e; });

  if (!state?.history_id) {
    const profile = await gapi('/profile');
    await saveCursor(profile.historyId);
    return 0;
  }

  const ids = [];
  let latest = state.history_id;
  let pageToken;
  try {
    do {
      const page = await gapi('/history', {
        query: { startHistoryId: state.history_id, historyTypes: 'messageAdded', maxResults: 500, pageToken }
      });
      (page.history || []).forEach((h) => (h.messagesAdded || []).forEach((m) => ids.push(m.message.id)));
      latest = page.historyId || latest;
      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch (err) {
    if (err.status !== 404) throw err;
    // Cursor too old (Gmail keeps about a week): rescan recent mail, restart.
    const profile = await gapi('/profile');
    const recent = await listMessageIds('newer_than:10d -in:chats', 5000);
    const imported = await importIds(recent, caseIndex);
    await saveCursor(profile.historyId);
    return imported;
  }
  const imported = await importIds(ids, caseIndex);
  await saveCursor(latest);
  return imported;
}

let syncPromise = null;
let lastSyncAt = 0;
let warnedMissingTables = false;

async function runSync() {
  const caseIndex = await buildCaseIndex();
  // Cursor first, so mail arriving during a long first backfill isn't missed.
  const fresh = await incrementalSync(caseIndex);
  const backfill = await backfillNewAddresses(caseIndex);
  if (fresh || backfill.imported || backfill.addresses) {
    console.log(`Gmail sync: ${fresh} new, backfilled ${backfill.addresses} address(es) / ${backfill.imported} message(s).`);
  }
  return { fresh, ...backfill };
}

function syncGmail({ force = false } = {}) {
  if (!gmailConfigured()) return Promise.resolve({ skipped: 'not_configured' });
  if (syncPromise) return syncPromise;
  if (!force && Date.now() - lastSyncAt < SYNC_MIN_INTERVAL_MS) return Promise.resolve({ skipped: 'throttled' });
  lastSyncAt = Date.now();
  syncPromise = runSync()
    .catch((err) => {
      if (isMissingTable(err)) {
        if (!warnedMissingTables) console.warn('Gmail sync skipped: run backend/db/migrations/0004_messages.sql first.');
        warnedMissingTables = true;
        return { skipped: 'missing_tables' };
      }
      console.error('Gmail sync failed:', err.message);
      return { error: err.message };
    })
    .finally(() => { syncPromise = null; });
  return syncPromise;
}

// After a send from inside the app: mirror it onto the case right away
// (tagged with its template) instead of waiting for the next sync.
async function recordSentMessage(messageId, applicationId, templateKey) {
  try {
    const caseIndex = await buildCaseIndex();
    await importMessage(messageId, caseIndex, { applicationId, templateKey });
  } catch (err) {
    if (!isMissingTable(err)) console.warn(`Recording sent Gmail ${messageId} failed:`, err.message);
  }
}

function gmailWebLink(messageId) {
  const mailbox = ownCache.mailbox || '';
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(mailbox)}#all/${messageId}`;
}

// All emails on a case, newest first, with short-lived links for attachments.
async function listCaseMessages(applicationId) {
  const { data, error } = await supabase.from('uez_messages')
    .select('*').eq('application_id', applicationId).order('sent_at', { ascending: false }).limit(500);
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  const paths = [...new Set((data || []).flatMap((m) => (m.attachments || []).map((a) => a.storagePath).filter(Boolean)))];
  const urls = new Map();
  if (paths.length) {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 60 * 60);
    (signed || []).forEach((item) => { if (item.signedUrl) urls.set(item.path, item.signedUrl); });
  }
  if (gmailConfigured()) await mailboxAddress().catch(() => null);
  return (data || []).map((m) => ({
    id: m.id,
    direction: m.direction,
    provider: m.provider,
    gmailMessageId: m.gmail_message_id,
    gmailThreadId: m.gmail_thread_id,
    gmailLink: m.provider === 'gmail' ? gmailWebLink(m.gmail_message_id) : null,
    from: m.from_address,
    fromName: m.from_name,
    to: m.to_addresses || [],
    cc: m.cc_addresses || [],
    subject: m.subject,
    snippet: m.snippet,
    body: m.body_text,
    templateKey: m.template_key,
    sentAt: m.sent_at,
    attachments: (m.attachments || []).map((a) => ({
      filename: a.filename, mimeType: a.mimeType, size: a.size, inline: a.inline, url: a.storagePath ? urls.get(a.storagePath) || null : null
    }))
  }));
}

async function getCaseMessage(applicationId, id) {
  const { data, error } = await supabase.from('uez_messages')
    .select('*').eq('application_id', applicationId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

module.exports = {
  gmailConfigured,
  sendGmail,
  syncGmail,
  recordSentMessage,
  mailboxAddress,
  gmailWebLink,
  listCaseMessages,
  getCaseMessage,
  isMissingTable,
  // exported for tests
  parseAddressList,
  buildMime,
  htmlToText
};
