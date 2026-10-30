// Email via Resend. Sends from a verified COR domain, masked with each zone's name;
// replies go to the zone's own inbox. A safety switch (org.email_live) keeps real
// businesses from being emailed until a zone explicitly goes live.
const supabase = require('../db/supabase');

const RESEND_URL = 'https://api.resend.com/emails';
const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'office@corsolutions.io';

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

function layout(bodyHtml, org) {
  const sig = esc(org.signature || `${org.from_name || 'Your UEZ Office'}`);
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e2733;font-size:15px;line-height:1.6;max-width:560px;margin:0 auto">
${bodyHtml}
<p style="margin:22px 0 0">Thank you,<br>${sig}</p>
<hr style="border:0;border-top:1px solid #e7eaf0;margin:26px 0 12px">
<p style="font-size:12px;color:#8b94a4;margin:0">You're receiving this because your business is enrolled in the ${esc(org.from_name || 'Urban Enterprise Zone')} program. Reply to this email with any questions.</p>
</div>`;
}

// Build a reminder email. kind: 'reminder_ar' | 'reminder_recert'
function reminderEmail(biz, org) {
  const name = titleCase(biz.trade_name || biz.name || 'your business');
  const hi = firstName(biz.owner_name || biz.report_contact_name) || 'there';
  const due = fmtDate(biz.deadline || biz.report_next_due || biz.next_annual_due);
  const late = biz.days != null && biz.days < 0;
  const pbs = org.pbs_login_url || 'https://portal03.nj.gov/ords_apex_oit/f?p=404:LOGIN';
  const isRecert = (biz.deadline_type || biz.report_type) === 'RCRT';

  if (isRecert) {
    const video = org.recert_video_url
      ? `<p style="margin:16px 0"><a href="${esc(org.recert_video_url)}" style="color:#2f6fb0;font-weight:600">▶ Watch the 2-minute how-to video</a> — it walks you through every step.</p>`
      : '';
    return {
      kind: 'reminder_recert',
      subject: `${name}: your UEZ recertification ${late ? 'is past due' : `is due ${due}`}`,
      html: layout(`<p style="margin:0 0 14px">Hi ${esc(hi)},</p>
<p style="margin:0 0 14px">This is a friendly reminder that the <strong>UEZ recertification</strong> for <strong>${esc(name)}</strong> ${late ? '<strong style="color:#c14338">is now past due</strong>' : `is due <strong>${esc(due)}</strong>`}. Recertifying keeps your reduced sales-tax benefit active.</p>
${video}
<p style="margin:16px 0"><a href="${esc(pbs)}" style="display:inline-block;background:#2f6fb0;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:9px">Log in to recertify →</a></p>
<p style="margin:14px 0 0">It only takes a few minutes. If you'd like help, just reply to this email.</p>`, org)
    };
  }
  return {
    kind: 'reminder_ar',
    subject: `${name}: your UEZ annual report ${late ? 'is past due' : `is due ${due}`}`,
    html: layout(`<p style="margin:0 0 14px">Hi ${esc(hi)},</p>
<p style="margin:0 0 14px">This is a friendly reminder that the <strong>UEZ annual report</strong> for <strong>${esc(name)}</strong> ${late ? '<strong style="color:#c14338">is now past due</strong>' : `is due <strong>${esc(due)}</strong>`}. Filing on time keeps your UEZ benefits active.</p>
<p style="margin:16px 0"><a href="${esc(pbs)}" style="display:inline-block;background:#2f6fb0;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:9px">Log in to file →</a></p>
<p style="margin:14px 0 0">It only takes a few minutes. If you'd like help, just reply to this email.</p>`, org)
  };
}

function thankYouEmail(biz, org, sender) {
  const name = titleCase(biz.trade_name || biz.name || 'your business');
  const hi = firstName(biz.owner_name || biz.report_contact_name) || 'there';
  const from = sender?.first_name ? `${titleCase(sender.first_name)}` : (org.from_name || 'Your UEZ Office');
  return {
    kind: 'thankyou',
    subject: `Thank you for recertifying, ${name}!`,
    html: layout(`<p style="margin:0 0 14px">Hi ${esc(hi)},</p>
<p style="margin:0 0 14px">Thank you for recertifying <strong>${esc(name)}</strong> in the ${esc(org.from_name || 'Urban Enterprise Zone')} program! 🎉</p>
<p style="margin:0 0 14px">Staying enrolled keeps the reduced sales-tax benefit working for you, and it keeps our zone strong for every business in it. We really appreciate you taking care of it.</p>
<p style="margin:0">If there's ever anything we can help with, just reply — I'm here.</p>`, { ...org, signature: org.signature || `${from}\n${org.from_name || ''}` })
  };
}

async function sendViaResend({ to, subject, html, fromName, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not configured on the server.');
  const payload = {
    from: `${fromName || 'UEZ'} <${FROM_ADDRESS}>`,
    to: [to],
    subject,
    html,
    ...(replyTo ? { reply_to: replyTo } : {})
  };
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Resend returned HTTP ${res.status}`);
  return data.id || null;
}

async function logEmail(row) {
  try { await supabase.from('uez_zone_email_log').insert(row); } catch (e) { console.error('email log failed', e.message); }
}

// Core send. Respects the org safety switch: when email_live is false, nothing reaches
// a real business — it's either redirected to the test recipient or just logged.
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

module.exports = { reminderEmail, thankYouEmail, sendBusinessEmail, sendViaResend, logEmail, titleCase };
