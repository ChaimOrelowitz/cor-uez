const supabase = require('../db/supabase');

const ACCOUNT_URL = process.env.UEZ_ACCOUNT_URL || 'https://uez.corsolutions.io';
const FROM_EMAIL = process.env.UEZ_FROM_EMAIL || 'COR UEZ <uez@corsolutions.io>';
const REPLY_TO = process.env.UEZ_REPLY_TO || 'uez@corsolutions.io';

function renderTemplate(value, vars = {}) {
  return String(value || '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key) => String(vars[key] ?? ''));
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function textToHtml(text) {
  const escaped = escapeHtml(text);
  const linked = escaped.replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" style="color:#4f5bd5">$1</a>');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#202534;max-width:640px;margin:auto;white-space:pre-wrap">${linked}</div>`;
}

async function getTemplates() {
  const { data, error } = await supabase.from('uez_email_templates')
    .select('template_key, display_name, description, subject, body, enabled, sort_order, updated_at')
    .order('sort_order');
  if (error) throw error;
  return data || [];
}

async function updateTemplate(templateKey, patch, userId) {
  const clean = { updated_at: new Date().toISOString(), updated_by: userId || null };
  if (typeof patch.subject === 'string') clean.subject = patch.subject.trim();
  if (typeof patch.body === 'string') clean.body = patch.body;
  if (typeof patch.enabled === 'boolean') clean.enabled = patch.enabled;
  if (clean.subject !== undefined && !clean.subject) throw new Error('Email subject cannot be blank.');
  if (clean.body !== undefined && !String(clean.body).trim()) throw new Error('Email body cannot be blank.');
  const { data, error } = await supabase.from('uez_email_templates')
    .update(clean).eq('template_key', templateKey)
    .select('template_key, display_name, description, subject, body, enabled, sort_order, updated_at')
    .single();
  if (error) throw error;
  return data;
}

async function getPrimaryOwner(applicationId) {
  const { data, error } = await supabase.from('uez_owners')
    .select('first_name, last_name, email, phone')
    .eq('application_id', applicationId)
    .order('owner_order')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function buildContext(application, extra = {}) {
  const owner = await getPrimaryOwner(application.id).catch(() => null);
  const einDigits = String(application.ein || '').replace(/\D/g, '');
  return {
    first_name: owner?.first_name || '',
    last_name: owner?.last_name || '',
    business_name: application.business_name_input || application.registered_business_name || '',
    phone: owner?.phone || application.contact_phone || '',
    last_three_ein: einDigits.slice(-3),
    account_url: ACCOUNT_URL,
    ...extra
  };
}

async function findDedupe(dedupeKey) {
  if (!dedupeKey) return null;
  const { data, error } = await supabase.from('uez_email_log')
    .select('*').eq('dedupe_key', dedupeKey).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function sendApplicationEmail(application, templateKey, options = {}) {
  const mode = options.mode === 'manual' ? 'manual' : 'automatic';
  const recipient = String(options.recipient || application.contact_email || '').trim().toLowerCase();
  if (!recipient) throw new Error('The application has no recipient email address.');

  const { data: template, error: templateError } = await supabase.from('uez_email_templates')
    .select('*').eq('template_key', templateKey).single();
  if (templateError || !template) throw templateError || new Error(`Email template ${templateKey} was not found.`);
  if (!template.enabled && mode === 'automatic') return { sent: false, skipped: true, reason: 'template_disabled' };

  const dedupeKey = options.dedupeKey || null;
  const existing = await findDedupe(dedupeKey);
  if (existing && ['pending', 'sent'].includes(existing.status)) {
    return { sent: existing.status === 'sent', skipped: true, reason: 'duplicate', log: existing };
  }

  const vars = await buildContext(application, options.extra || {});
  const subject = renderTemplate(template.subject, vars);
  const body = renderTemplate(template.body, vars);

  if (!process.env.RESEND_API_KEY) {
    console.warn(`UEZ email ${templateKey} not sent: RESEND_API_KEY is not configured.`);
    return { sent: false, skipped: true, reason: 'resend_not_configured' };
  }

  let log;
  if (existing) {
    const { data, error } = await supabase.from('uez_email_log').update({
      recipient, subject, send_mode: mode, status: 'pending', error: null
    }).eq('id', existing.id).select('*').single();
    if (error) throw error;
    log = data;
  } else {
    const { data, error } = await supabase.from('uez_email_log').insert({
      application_id: application.id,
      template_key: templateKey,
      recipient,
      subject,
      send_mode: mode,
      dedupe_key: dedupeKey,
      status: 'pending'
    }).select('*').single();
    if (error) {
      if (dedupeKey && /duplicate|unique/i.test(error.message || '')) {
        const duplicate = await findDedupe(dedupeKey);
        return { sent: duplicate?.status === 'sent', skipped: true, reason: 'duplicate', log: duplicate };
      }
      throw error;
    }
    log = data;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [recipient],
        reply_to: REPLY_TO,
        subject,
        text: body,
        html: textToHtml(body)
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message || payload?.error || `Resend returned ${response.status}`);
    const { data: saved, error } = await supabase.from('uez_email_log').update({
      provider_message_id: payload.id || null,
      status: 'sent',
      sent_at: new Date().toISOString(),
      error: null
    }).eq('id', log.id).select('*').single();
    if (error) throw error;
    return { sent: true, log: saved };
  } catch (err) {
    await supabase.from('uez_email_log').update({ status: 'failed', error: String(err.message || err) }).eq('id', log.id).catch(() => {});
    throw err;
  }
}

async function safeSendApplicationEmail(application, templateKey, options = {}) {
  try {
    return await sendApplicationEmail(application, templateKey, options);
  } catch (err) {
    console.error(`UEZ email ${templateKey} failed:`, err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = {
  getTemplates,
  updateTemplate,
  sendApplicationEmail,
  safeSendApplicationEmail
};
