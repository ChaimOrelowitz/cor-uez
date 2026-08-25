const supabase = require('../db/supabase');
const { encryptText, decryptText } = require('../utils/uezCrypto');

function buildMyNjUsername(companyName, phone) {
  const company = String(companyName || '').replace(/ /g, '_').slice(0, 4);
  const phoneDigits = String(phone || '').replace(/\D/g, '');
  if (!company || phoneDigits.length < 4) throw new Error('Business name and primary owner phone are required to create the MyNJ login.');
  const companyPrefix = `${company.slice(0, 1).toUpperCase()}${company.slice(1)}`;
  return `${companyPrefix}${phoneDigits.slice(-4)}`.replace(/[^A-Za-z0-9@._-]/g, '_');
}

function buildMyNjPassword(lastName, ssn) {
  const name = String(lastName || '').trim();
  const ssnDigits = String(ssn || '').replace(/\D/g, '');
  if (!name || ssnDigits.length !== 9) throw new Error('Primary owner last name and SSN are required to create the MyNJ password.');
  const namePrefix = `${name.slice(0, 1).toUpperCase()}${name.slice(1, 3).toLowerCase()}`;
  return `${namePrefix}${ssnDigits.slice(-4)}^`;
}

function decryptCredential(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    username: decryptText(row.username_enc),
    password: decryptText(row.password_enc),
    challengeQuestion: decryptText(row.challenge_question_enc),
    challengeAnswer: decryptText(row.challenge_answer_enc),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function ensureMyNjCredentials(application, userId) {
  const { data: existing, error: existingError } = await supabase.from('uez_credentials')
    .select('*')
    .eq('application_id', application.id)
    .eq('provider', 'mynj')
    .maybeSingle();
  if (existingError) throw existingError;

  const now = new Date().toISOString();
  const applicationPatch = {
    pbs_status: 'mynj_credentials_created',
    updated_at: now
  };
  if (application.submitted_at) applicationPatch.status = 'pbs_account_pending';

  if (existing) {
    const { error: appError } = await supabase.from('uez_applications')
      .update(applicationPatch)
      .eq('id', application.id);
    if (appError) throw appError;
    return { created: false, credentials: decryptCredential(existing) };
  }

  const { data: primaryOwner, error: ownerError } = await supabase.from('uez_owners')
    .select('*')
    .eq('application_id', application.id)
    .order('owner_order')
    .limit(1)
    .maybeSingle();
  if (ownerError) throw ownerError;
  if (!primaryOwner) throw new Error('A primary owner is required.');

  const legalBusinessName = application.registered_business_name || application.brc_registered_name || application.business_name_input;
  const username = buildMyNjUsername(legalBusinessName, primaryOwner.phone);
  const password = buildMyNjPassword(primaryOwner.last_name, decryptText(primaryOwner.ssn_enc));

  const { data, error } = await supabase.from('uez_credentials').insert({
    application_id: application.id,
    provider: 'mynj',
    username_enc: encryptText(username),
    password_enc: encryptText(password),
    challenge_question_enc: encryptText('how many mitzvot'),
    challenge_answer_enc: encryptText("Tarya'g"),
    updated_at: now
  }).select('*').single();
  if (error) throw error;

  const { error: appError } = await supabase.from('uez_applications')
    .update(applicationPatch)
    .eq('id', application.id);
  if (appError) throw appError;

  const { error: eventError } = await supabase.from('uez_status_events').insert({
    application_id: application.id,
    status: 'mynj_credentials_created',
    label: 'MyNJ account information ready',
    message: 'Your MyNJ account information is available securely. COR is creating your PBS account next.',
    visible_to_applicant: true,
    created_by: userId || null
  });
  if (eventError) throw eventError;

  return { created: true, credentials: decryptCredential(data) };
}

module.exports = { decryptCredential, ensureMyNjCredentials };
