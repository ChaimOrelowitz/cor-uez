// Business-shared PBS logins. A business hands its myNJ login (how it gets into PBS)
// to its UEZ zone so the coordinator can help it recertify over the phone.
// Captured via a one-time emailed link; the business enters its creds on a page only it
// can reach; we verify the login live, then store it AES-256-GCM encrypted. The zone NEVER
// sees the password — it only ever sees that a login is on file.
const crypto = require('crypto');
const supabase = require('../db/supabase');
const { encryptText } = require('../utils/uezCrypto');
const { verifyBusinessMyNj } = require('./uezMyNj');
const { sendViaResend } = require('./uezEmail');

const INVITE_TTL_DAYS = 21;
const nowIso = () => new Date().toISOString();
async function must(q) { const { data, error } = await q; if (error) throw error; return data; }
const httpError = (status, message) => Object.assign(new Error(message), { status });

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function titleCase(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s\-/&(.,#])([a-z])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/\bLlc\b/g, 'LLC').replace(/\bInc\b/g, 'Inc');
}
function firstName(s) { return titleCase(String(s || '').trim().split(/\s+/)[0] || ''); }
const bizEmail = (b) => b.email || b.report_contact_email || null;
const bizName = (b) => titleCase(b.trade_name || b.name || 'your business');

function inviteHtml({ first, business, zoneName, link, signature }) {
  const sig = esc(signature || zoneName).replace(/\n/g, '<br>');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e2733;font-size:15px;line-height:1.6;max-width:560px;margin:0 auto">
<p style="margin:0 0 14px">Hi ${esc(first)},</p>
<p style="margin:0 0 14px">Welcome to the ${esc(zoneName)} program — we're glad to have ${esc(business)} with us.</p>
<p style="margin:0 0 14px">UEZ businesses have to recertify to keep the reduced sales-tax benefit, and it's easy to let it slip. If you'd like, we can take care of it for you: securely save your myNJ login, and when it's time to re-up we'll give you a call and do it together. It takes about two minutes.</p>
<p style="margin:0 0 20px">Click below to set it up:</p>
<p style="margin:0 0 20px"><a href="${esc(link)}" style="display:inline-block;background:#2f6fb0;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:9px">Set up assisted recertification →</a></p>
<p style="margin:0 0 14px;font-size:13px;color:#586272">Your login is encrypted and stored securely. Our office never sees your password — it's only used to help you file. If you'd rather not, no problem; just ignore this email.</p>
<p style="margin:22px 0 0">Thanks,<br>${sig}</p>
</div>`;
}

// Zone sends (or re-sends) the capture link to the business's contact email.
async function createInvite({ org, fileNo, userId, userEmail }) {
  const b = await must(supabase.from('uez_zone_businesses').select('*').eq('file_no', fileNo).maybeSingle());
  if (!b) throw httpError(404, 'Business not found.');
  if (b.zone_name !== org.zone_name) throw httpError(403, `This business is in ${b.zone_name}. You can only invite businesses in ${org.zone_name}.`);
  const realTo = bizEmail(b);
  if (!realTo) throw httpError(400, 'No email on file for this business to send the link to.');
  // Safety: same switch as reminders. Until the zone is live, the link goes to the test
  // recipient (so the office can test the whole flow), never to the real business.
  const live = org.email_live === true;
  const to = live ? realTo : (org.test_recipient || userEmail || null);
  if (!to) throw httpError(400, 'Live sending is off and no test recipient is set. Set a test recipient in Settings (or turn on live sending) to send the link.');

  const token = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 864e5).toISOString();
  await must(supabase.from('uez_zone_business_logins').upsert({
    file_no: b.file_no, org_id: org.id, zone_name: org.zone_name,
    status: 'invited', token, token_expires_at: expires, invited_to: to, invited_by: userId || null,
    last_error: null, updated_at: nowIso()
  }, { onConflict: 'file_no' }));

  const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const link = `${base}/enroll/${token}`;
  const zoneName = org.from_name || org.name || 'your UEZ office';
  const first = firstName(b.owner_name || b.report_contact_name) || 'there';
  const baseSubject = `${bizName(b)}: let ${zoneName} handle your UEZ recertification`;
  const subject = live ? baseSubject : `[TEST → ${realTo}] ${baseSubject}`;
  const html = inviteHtml({ first, business: bizName(b), zoneName, link, signature: org.signature });
  let id = null;
  try {
    id = await sendViaResend({ to, subject, html, fromName: org.from_name || org.name, replyTo: org.reply_to || userEmail });
  } catch (e) {
    await supabase.from('uez_zone_email_log').insert({ org_id: org.id, file_no: b.file_no, kind: 'login_invite', to_email: to, subject, status: 'failed', error: e.message, sent_by: userId || null });
    throw httpError(400, `Couldn't send the link: ${e.message}`);
  }
  await supabase.from('uez_zone_email_log').insert({ org_id: org.id, file_no: b.file_no, kind: 'login_invite', to_email: to, subject, status: live ? 'sent' : 'suppressed', provider_id: id, sent_by: userId || null });
  return { status: 'invited', to, live };
}

// Public: what the capture page shows (no credentials, no zone internals).
async function getInvite(token) {
  if (!token) return null;
  const row = await must(supabase.from('uez_zone_business_logins')
    .select('file_no, org_id, status, token_expires_at').eq('token', token).maybeSingle());
  if (!row) return null;
  if (row.token_expires_at && new Date(row.token_expires_at) < new Date()) return { expired: true };
  const b = await must(supabase.from('uez_zone_businesses').select('name, trade_name').eq('file_no', row.file_no).maybeSingle());
  const org = await must(supabase.from('uez_zone_orgs').select('from_name, name').eq('id', row.org_id).maybeSingle());
  return { business: titleCase(b?.trade_name || b?.name || 'your business'), zone: org?.from_name || org?.name || 'your UEZ office', status: row.status };
}

// Public: business submits creds; we verify live, then store encrypted (or report back to retry).
async function submitInvite(token, { username, password }) {
  const row = await must(supabase.from('uez_zone_business_logins').select('*').eq('token', token).maybeSingle());
  if (!row) throw httpError(404, 'This link is not valid. Ask your UEZ office for a new one.');
  if (row.token_expires_at && new Date(row.token_expires_at) < new Date()) throw httpError(410, 'This link has expired. Ask your UEZ office for a new one.');
  username = String(username || '').trim();
  password = String(password || '');
  if (!username || !password) throw httpError(400, 'Enter your myNJ login ID and password.');

  await supabase.from('uez_zone_business_logins').update({ submitted_at: nowIso(), updated_at: nowIso() }).eq('file_no', row.file_no);
  try {
    await verifyBusinessMyNj(username, password);
  } catch (e) {
    await supabase.from('uez_zone_business_logins').update({ status: 'failed', last_error: e.message, updated_at: nowIso() }).eq('file_no', row.file_no);
    const friendly = e.code === 'bad_mynj'
      ? "That myNJ login didn't work. Double-check your ID and password, then try again."
      : e.code === 'blocked'
        ? "We couldn't reach myNJ just now. Please try again in a few minutes."
        : "We couldn't verify that login. Please try again.";
    return { ok: false, error: friendly };
  }
  // Verified — store encrypted, clear the one-time token.
  await must(supabase.from('uez_zone_business_logins').update({
    mynj_username_enc: encryptText(username),
    mynj_password_enc: encryptText(password),
    status: 'ok', last_error: null, last_verified_at: nowIso(),
    token: null, token_expires_at: null, updated_at: nowIso()
  }).eq('file_no', row.file_no));
  return { ok: true };
}

// Office-side status map for a set of businesses (never returns credentials).
async function loginStatusMap(orgId) {
  const rows = await must(supabase.from('uez_zone_business_logins')
    .select('file_no, status, last_verified_at, invited_to, submitted_at').eq('org_id', orgId));
  const map = new Map();
  for (const r of rows) map.set(r.file_no, r);
  return map;
}

module.exports = { createInvite, getInvite, submitInvite, loginStatusMap };
