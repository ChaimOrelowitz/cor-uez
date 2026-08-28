// Pure, side-effect-free logic for deriving an applicant's case state, stage,
// and "what needs to happen next" — extracted out of AdminPage.jsx so it can
// be unit tested directly (see src/admin/caseLogic.test.js) instead of only
// being exercised indirectly by clicking through the admin UI.
//
// Nothing in this file touches React, the DOM, or the network — it only
// transforms plain data (an application row, a document list, etc.) into
// plain output (a label, a boolean, a sorted bucket). That's what makes it
// testable without mocking anything.

export const REQUIRED_GRANT_DOCUMENTS = [
  ['formation', 'Certificate of Formation'],
  ['tax_clearance', 'Tax Clearance Letter'],
  ['ldc_application', 'Signed LDC Application'],
  ['brc', 'Business Registration Certificate'],
  ['uez_approval_email', 'UEZ Approval Email']
];

export function statusLabel(status) {
  return status === 'applied' || status === 'grant_submitted' ? 'Applied' : 'In Progress';
}

export function programLabel(code) {
  return code === 'lakewood_technology_grant' ? 'Lakewood LDC Technology Grant' : (code || 'UEZ enrollment');
}

export function documentLabel(type) {
  if (type === 'formation') return 'Formation document';
  if (type === 'brc') return 'BRC';
  if (type === 'uez_approval_email') return 'UEZ approval email';
  if (type === 'tax_clearance') return 'Tax-clearance letter';
  if (type === 'ldc_application') return 'LDC incentive application';
  if (type === 'supporting') return 'Supporting';
  return type;
}

export function nameControl(name) {
  return String(name || '').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase();
}

export function njTaxId(ein) {
  const digits = String(ein || '').replace(/\D/g, '').slice(0, 9);
  return digits.length === 9 ? `${digits}000` : '';
}

export function formatSsn(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 9) return value || '—';
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

export function formatPhoneInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function formatSsnInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

export function formatDob(value) {
  const text = String(value || '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  return text;
}

export function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export function formatDobInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function uezStatusLabel(value) {
  if (value === 'approved') return 'Approved';
  if (value === 'applied') return 'Applied';
  return 'Not Started';
}

export function paymentStatusLabel(value) {
  if (value === 'paid') return 'Paid';
  if (value === 'client_reported') return 'Client says paid';
  return 'Not recorded';
}

export function adminStageLabel(app) {
  const types = new Set(app.document_types || []);
  if (app.status === 'applied' || app.status === 'grant_submitted') return 'SUBMITTED';
  if ((app.required_document_ready_count || 0) >= 5) return 'READY TO SUBMIT';
  if (app.uez_application_status === 'approved') return 'GRANT DOCS';
  if (app.uez_application_status === 'applied') return 'UEZ PENDING';
  if (app.pbs_account_created) return 'PBS READY';
  if (types.has('brc')) return 'PBS SETUP';
  if (app.submitted_at) return 'BRC';
  return 'APPLICANT SIGNUP';
}

// The single most important derivation in the admin app: given one applicant
// row, decide what bucket they're in (needs my action / waiting / ready /
// submitted) and what the one recommended next action is. This is what
// sorts and labels every row in the admin sidebar — if this logic is wrong,
// an applicant can silently sit unattended, so it gets real test coverage.
export function adminQueueInfo(app) {
  const types = new Set(app.document_types || []);
  const formationReview = app.formation_review_status || 'not_reviewed';
  const approvalReview = app.uez_approval_review_status || 'not_reviewed';
  const submittedGrant = app.status === 'applied' || app.status === 'grant_submitted';
  const stage = adminStageLabel(app);

  // Immediate human-review items always win.
  if (app.tax_clearance_recheck_requested_at) return { bucket: 'needs', action: 'Recheck Tax Clearance', tone: 'danger', stage, rank: 0 };
  if (app.payment_status === 'client_reported') return { bucket: 'needs', action: 'Confirm payment', tone: 'danger', stage, rank: 1 };
  if (app.brc_status === 'client_created') return { bucket: 'needs', action: 'Recheck BRC', tone: 'danger', stage, rank: 2 };
  if (types.has('formation') && formationReview === 'not_reviewed') return { bucket: 'needs', action: 'Review Formation', tone: 'danger', stage, rank: 3 };
  if (types.has('uez_approval_email') && approvalReview === 'not_reviewed') return { bucket: 'needs', action: 'Review UEZ approval', tone: 'danger', stage, rank: 4 };

  if (submittedGrant) return { bucket: 'submitted', action: 'Grant submitted', tone: 'submitted', stage, rank: 0 };
  if (!app.submitted_at) return { bucket: 'waiting', action: 'Applicant still completing signup', tone: 'quiet', stage, rank: 80 };

  // Process sequence after the applicant submits.
  if (!types.has('brc')) {
    if (app.brc_status === 'not_found') return { bucket: 'waiting', action: 'Waiting on BRC follow-up', tone: 'warn', stage, rank: 50 };
    return { bucket: 'needs', action: 'Fetch BRC', tone: 'danger', stage, rank: 5 };
  }

  if (app.has_existing_pbs_account == null) return { bucket: 'needs', action: 'Confirm PBS account answer', tone: 'danger', stage, rank: 6 };
  if (!app.pbs_account_created) return { bucket: 'needs', action: 'Set up PBS', tone: 'danger', stage, rank: 6 };

  if (app.uez_application_status === 'not_started' || !app.uez_application_status) {
    return { bucket: 'needs', action: 'UEZ application next', tone: 'danger', stage, rank: 7 };
  }

  if (app.uez_application_status === 'applied') {
    if (types.has('uez_approval_email') && approvalReview === 'rejected') return { bucket: 'waiting', action: 'Waiting for UEZ email replacement', tone: 'warn', stage, rank: 52 };
    if (!types.has('uez_approval_email') || approvalReview !== 'approved') return { bucket: 'waiting', action: 'Waiting for UEZ approval', tone: 'quiet', stage, rank: 55 };
  }

  if ((app.tax_clearance_status || (app.tax_clearance_good ? 'good' : 'no')) !== 'good' || !types.has('tax_clearance')) {
    if ((app.tax_clearance_status || 'no') === 'issue' || types.has('tax_clearance_issue')) return { bucket: 'waiting', action: 'Tax clearance issue — waiting on client', tone: 'warn', stage, rank: 51 };
    return { bucket: 'needs', action: 'Fetch tax clearance', tone: 'danger', stage, rank: 8 };
  }

  if (!app.is_sole_proprietorship && !types.has('formation')) return { bucket: 'waiting', action: 'Waiting for Formation document', tone: 'warn', stage, rank: 53 };
  if (types.has('formation') && formationReview === 'rejected') return { bucket: 'waiting', action: 'Waiting for Formation replacement', tone: 'warn', stage, rank: 54 };

  if (app.payment_status !== 'paid') return { bucket: 'waiting', action: 'Waiting for payment', tone: 'quiet', stage, rank: 60 };

  if (!types.has('ldc_application')) return { bucket: 'needs', action: 'Fill out LDC application', tone: 'danger', stage, rank: 9 };

  if ((app.required_document_ready_count || 0) >= 5) return { bucket: 'ready', action: 'Ready for grant submission', tone: 'ready', stage, rank: 0 };

  return { bucket: 'waiting', action: 'Waiting for next document', tone: 'quiet', stage, rank: 70 };
}

export function docFor(detail, type) {
  return [...(detail?.documents || [])].reverse().find((doc) => doc.document_type === type) || null;
}

export function formationSatisfied(detail) {
  const formation = docFor(detail, 'formation');
  if (!formation) return Boolean(detail?.application?.is_sole_proprietorship);
  return detail?.application?.formation_review_status === 'approved';
}

export function packetReady(detail) {
  return formationSatisfied(detail)
    && Boolean(docFor(detail, 'brc'))
    && Boolean(docFor(detail, 'uez_approval_email'))
    && detail?.application?.uez_approval_review_status === 'approved'
    && Boolean(docFor(detail, 'tax_clearance'))
    && Boolean(docFor(detail, 'ldc_application'));
}

export function readyDocumentCount(detail) {
  return (formationSatisfied(detail) ? 1 : 0)
    + (docFor(detail, 'brc') ? 1 : 0)
    + (docFor(detail, 'uez_approval_email') && detail?.application?.uez_approval_review_status === 'approved' ? 1 : 0)
    + (docFor(detail, 'tax_clearance') ? 1 : 0)
    + (docFor(detail, 'ldc_application') ? 1 : 0);
}

export function attentionItems(detail) {
  if (!detail) return [];
  const items = [];
  const payment = detail.payments?.[detail.payments.length - 1];
  const formation = docFor(detail, 'formation');
  const approval = docFor(detail, 'uez_approval_email');
  if (payment?.status === 'client_reported') items.push('Client says payment was sent');
  if (detail.application.brc_status === 'client_created') items.push('Client says BRC was created — recheck BRC');
  if (detail.application.tax_clearance_recheck_requested_at) items.push('Client says the tax-clearance issue is resolved — recheck Tax Clearance');
  if (formation && detail.application.formation_review_status === 'not_reviewed') items.push('Review Certificate of Formation');
  if (formation && detail.application.formation_review_status === 'rejected') items.push('Certificate of Formation marked wrong');
  if (approval && (detail.application.uez_approval_review_status || 'not_reviewed') === 'not_reviewed') items.push('Review UEZ approval email');
  if (detail.application.tax_clearance_status === 'submitted_checking') items.push('Review tax clearance letter');
  return items;
}

// Lakewood grant submission is the one step in the whole app where "did this
// succeed" is genuinely ambiguous (see backend/routes/uez.js and
// brc-helper-extension/grant-jotform.js for why) — this decides whether the
// "Confirm grant submitted" banner should show, by comparing the most recent
// detection event against the most recent confirmation event.
export function grantSubmissionLikelyDetected(detail) {
  if (!detail) return false;
  if (detail.application.status === 'applied' || detail.application.status === 'grant_submitted') return false;
  const events = detail.statusEvents || [];
  const lastDetected = [...events].reverse().find((e) => e.status === 'grant_submission_detected');
  if (!lastDetected) return false;
  const lastConfirmed = [...events].reverse().find((e) => e.status === 'grant_submitted');
  return !lastConfirmed || new Date(lastDetected.created_at) > new Date(lastConfirmed.created_at);
}

export function applicationDraftFrom(app) {
  return {
    contactEmail: app.contact_email || '',
    contactPhone: formatPhoneInput(app.contact_phone),
    businessName: app.business_name_input || '',
    registeredBusinessName: app.registered_business_name || '',
    ein: app.ein || '',
    businessDescription: app.business_description || '',
    yearFounded: app.year_founded ?? '',
    isSoleProprietorship: app.is_sole_proprietorship === true,
    fullTimeEmployees: app.full_time_employees ?? '',
    partTimeEmployees: app.part_time_employees ?? '',
    hasDba: app.has_dba == null ? '' : (app.has_dba ? 'yes' : 'no'),
    dbaName: app.dba_name || '',
    grantAmountRequested: app.grant_amount_requested ?? (app.program_code === 'lakewood_technology_grant' ? 5000 : ''),
    addressLine1: app.address_line1 || '',
    addressLine2: app.address_line2 || '',
    city: app.city || '',
    state: app.state || 'NJ',
    zip: app.zip || ''
  };
}

export function ownerDraftFrom(owner = {}) {
  return {
    title: owner.title || '',
    firstName: owner.firstName || '',
    lastName: owner.lastName || '',
    email: owner.email || '',
    phone: formatPhoneInput(owner.phone),
    dob: formatDob(owner.dob),
    ssn: formatSsnInput(owner.ssn),
    ownershipPercent: owner.ownershipPercent ?? '',
    positionTitle: owner.positionTitle || '',
    addressLine1: owner.addressLine1 || '',
    addressLine2: owner.addressLine2 || '',
    city: owner.city || '',
    state: owner.state || 'NJ',
    zip: owner.zip || ''
  };
}
