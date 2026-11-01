// Email via Resend. Templates are editable per zone (subject + body with {{merge}} fields).
// Sends from a verified COR domain, masked with the zone's name; replies go to the zone inbox.
// A safety switch (org.email_live) keeps real businesses from being emailed until a zone goes live.
const supabase = require('../db/supabase');

const RESEND_URL = 'https://api.resend.com/emails';
const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'office@corsolutions.io';
// Fallback recert how-to video if a zone hasn't set its own in Settings.
const DEFAULT_RECERT_VIDEO = 'https://thelcsc.org/uezrecert';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function titleCase(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s\-/&(.,#])([a-z])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/\bLlc\b/g, 'LLC').replace(/\bInc\b/g, 'Inc');
}
function firstName(s) { return titleCase(String(s || '').trim().split(/\s+/)[0] || ''); }
function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return new Date(Date.UTC(+y, +m - 1, +day)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// ---- Default templates (what a zone starts with; editable in Settings) ----
const DEFAULT_TEMPLATES = {
  reminder_ar: {
    subject: '{{business}}: your UEZ annual report {{due_phrase}}',
    body: `Hi {{first_name}},

This is a friendly reminder that the UEZ annual report for {{business}} {{due_phrase}}. Filing on time keeps your UEZ benefits active, including the reduced sales tax.

{{login_button}}

It only takes a few minutes. If you'd like a hand, just reply to this email.`
  },
  reminder_recert: {
    subject: '{{business}}: your UEZ recertification {{due_phrase}}',
    body: `Hi {{first_name}},

This is a friendly reminder that the UEZ recertification for {{business}} {{due_phrase}}. Recertifying keeps your reduced sales-tax benefit active.

{{video_link}}

{{login_button}}

It only takes a few minutes. If you'd like a hand, just reply to this email.`
  },
  thankyou: {
    subject: 'Thank you for recertifying, {{business}}!',
    body: `Hi {{first_name}},

Thank you for recertifying {{business}} in the {{zone}} program! Staying enrolled keeps the reduced sales-tax benefit working for you, and it keeps our zone strong for every business in it.

We really appreciate you taking care of it. If there's ever anything we can help with, just reply — I'm here.`
  }
};

const MERGE_FIELDS = ['business', 'first_name', 'due_date', 'due_phrase', 'zone', 'login_button', 'login_link', 'video_link'];

// Render an editable body (plain text + {{merge}}) into safe HTML.
function renderBody(body, vars, links) {
  // Protect HTML link tokens with placeholders so escaping doesn't mangle them.
  const ph = {};
  let out = String(body || '');
  Object.entries(links).forEach(([k, html], i) => {
    const token = `@@LINK${i}@@`;
    ph[token] = html;
    out = out.split(`{{${k}}}`).join(html ? token : '');
  });
  // Plain-text merge fields.
  out = out.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k) => esc(vars[k] ?? ''));
  out = esc(out);
  // Restore link HTML and newlines.
  for (const [token, html] of Object.entries(ph)) out = out.split(esc(token)).join(html);
  return out.replace(/\n{2,}/g, '</p><p style="margin:0 0 14px">').replace(/\n/g, '<br>');
}

function layout(bodyHtml, org) {
  const sig = esc(org.signature || org.from_name || 'Your UEZ Office').replace(/\n/g, '<br>');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e2733;font-size:15px;line-height:1.6;max-width:560px;margin:0 auto">
<p style="margin:0 0 14px">${bodyHtml}</p>
<p style="margin:22px 0 0">Thank you,<br>${sig}</p>
<hr style="border:0;border-top:1px solid #e7eaf0;margin:26px 0 12px">
<p style="font-size:12px;color:#8b94a4;margin:0">You're receiving this because your business is enrolled in the ${esc(org.from_name || 'Urban Enterprise Zone')} program. Reply to this email with any questions.</p>
</div>`;
}

function tplFor(org, kind) {
  const t = (org.templates && org.templates[kind]) || DEFAULT_TEMPLATES[kind];
  return { subject: t.subject || DEFAULT_TEMPLATES[kind].subject, body: t.body || DEFAULT_TEMPLATES[kind].body };
}

function buildEmail(kind, biz, org) {
  const business = titleCase(biz.trade_name || biz.name || 'your business');
  const first = firstName(biz.owner_name || biz.report_contact_name) || 'there';
  const due = fmtDate(biz.deadline || biz.report_next_due || biz.next_annual_due);
  const late = biz.days != null && biz.days < 0;
  const duePhrase = late ? 'is now past due' : (due ? `is due ${due}` : 'is coming up');
  const pbs = org.pbs_login_url || 'https://portal03.nj.gov/ords_apex_oit/f?p=404:LOGIN';
  const video = org.recert_video_url || DEFAULT_RECERT_VIDEO;
  const vars = { business, first_name: first, due_date: due, due_phrase: duePhrase, zone: org.from_name || 'Urban Enterprise Zone' };
  const links = {
    login_button: `<a href="${esc(pbs)}" style="display:inline-block;background:#2f6fb0;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:9px">Log in to ${kind === 'reminder_recert' ? 'recertify' : 'file'} →</a>`,
    login_link: `<a href="${esc(pbs)}" style="color:#2f6fb0;font-weight:600">${esc(pbs)}</a>`,
    video_link: video ? `<a href="${esc(video)}" style="color:#2f6fb0;font-weight:600">▶ Watch the 2-minute how-to video</a>` : ''
  };
  const t = tplFor(org, kind);
  return { kind, subject: renderBody(t.subject, vars, {}).replace(/<[^>]+>/g, ''), html: layout(renderBody(t.body, vars, links), org) };
}

const reminderEmail = (biz, org) => buildEmail((biz.deadline_type || biz.report_type) === 'RCRT' ? 'reminder_recert' : 'reminder_ar', biz, org);
const thankYouEmail = (biz, org) => buildEmail('thankyou', biz, org);

// Load a zone's templates (stored overrides merged over defaults) to attach as org.templates.
async function loadTemplates(orgId) {
  const { data } = await supabase.from('uez_zone_email_templates').select('kind, subject, body').eq('org_id', orgId);
  const out = {};
  for (const r of (data || [])) out[r.kind] = { subject: r.subject, body: r.body };
  return out;
}

// Preview with sample data (for the Settings editor).
function previewTemplate(kind, org) {
  const sample = { trade_name: 'Sample Shop LLC', owner_name: 'Alex Rivera', deadline: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10), deadline_type: kind === 'reminder_recert' ? 'RCRT' : 'AR', days: 10 };
  return buildEmail(kind, sample, org);
}

async function sendViaResend({ to, subject, html, fromName, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not configured on the server.');
  const payload = { from: `${fromName || 'UEZ'} <${FROM_ADDRESS}>`, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) };
  const res = await fetch(RESEND_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Resend returned HTTP ${res.status}`);
  return data.id || null;
}

async function logEmail(row) {
  try { await supabase.from('uez_zone_email_log').insert(row); } catch (e) { console.error('email log failed', e.message); }
}

async function sendBusinessEmail({ org, biz, built, sender, forceTo }) {
  const realTo = forceTo || biz.contact_email || biz.email || biz.report_contact_email;
  if (!realTo) {
    await logEmail({ org_id: org.id, file_no: biz.file_no, kind: built.kind, status: 'failed', error: 'No email on file', sent_by: sender?.user_id });
    return { status: 'failed', error: 'No email address on file for this business.' };
  }
  const live = org.email_live === true;
  const to = live ? realTo : (org.test_recipient || sender?.email || null);
  if (!to) {
    await logEmail({ org_id: org.id, file_no: biz.file_no, kind: built.kind, to_email: realTo, subject: built.subject, status: 'suppressed', error: 'Test mode, no test recipient set', sent_by: sender?.user_id });
    return { status: 'suppressed', error: 'Test mode is on and no test recipient is set. Email was not sent.' };
  }
  const subject = live ? built.subject : `[TEST → ${realTo}] ${built.subject}`;
  try {
    const id = await sendViaResend({ to, subject, html: built.html, fromName: org.from_name, replyTo: org.reply_to || sender?.email });
    await logEmail({ org_id: org.id, file_no: biz.file_no, kind: built.kind, to_email: to, subject, status: live ? 'sent' : 'suppressed', provider_id: id, sent_by: sender?.user_id });
    return { status: live ? 'sent' : 'suppressed', to, id };
  } catch (e) {
    await logEmail({ org_id: org.id, file_no: biz.file_no, kind: built.kind, to_email: to, subject, status: 'failed', error: e.message, sent_by: sender?.user_id });
    return { status: 'failed', error: e.message };
  }
}

module.exports = { reminderEmail, thankYouEmail, buildEmail, previewTemplate, loadTemplates, sendBusinessEmail, sendViaResend, logEmail, titleCase, DEFAULT_TEMPLATES, MERGE_FIELDS };
