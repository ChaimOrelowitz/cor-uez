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
  ['brc', 'Business Registration Certificate'],
  ['tax_clearance', 'Tax Clearance Letter'],
  ['uez_approval_email', 'UEZ Approval Email'],
  ['ldc_application', 'Signed LDC Application']
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

// Shared by adminQueueInfo's urgent-review tier (first match wins, feeds the
// Recommended-action banner) and attentionItems (every match, feeds the
// "Needs attention" strip) — one definition instead of two hand-maintained
// lists that used to drift: same five conditions, sometimes different
// wording, no guarantee they'd ever agree on what's actually urgent.
const URGENT_REVIEW_ITEMS = [
  {
    test: (app) => Boolean(app.tax_clearance_recheck_requested_at),
    action: 'Recheck Tax Clearance',
    attention: 'Client says the tax-clearance issue is resolved — recheck Tax Clearance',
    rank: 0, stepKey: 'tax_clearance'
  },
  {
    test: (app) => app.payment_status === 'client_reported',
    action: 'Confirm payment',
    attention: 'Client says payment was sent',
    rank: 1, stepKey: 'payment'
  },
  {
    test: (app) => app.brc_status === 'client_created',
    action: 'Recheck BRC',
    attention: 'Client says BRC was created — recheck BRC',
    rank: 2, stepKey: 'brc'
  },
  {
    test: (app, types, formationReview) => types.has('formation') && formationReview === 'not_reviewed',
    action: 'Review Formation',
    attention: 'Review Certificate of Formation',
    rank: 3, stepKey: 'formation'
  },
  {
    test: (app, types, _formationReview, approvalReview) => types.has('uez_approval_email') && approvalReview === 'not_reviewed',
    action: 'Review UEZ approval',
    attention: 'Review UEZ approval email',
    rank: 4, stepKey: 'uez_enrollment'
  }
];

// Tax Clearance and UEZ Enrollment are worked in parallel in real life — an
// issue on one doesn't mean COR waits before pushing on the other. So each is
// evaluated independently here instead of one hiding the other behind an
// early return; adminQueueInfo below combines them into a primary + optional
// secondaryAction instead of picking just one and going silent on the rest.
function uezEnrollmentStepEntry(app, types, approvalReview) {
  const status = app.uez_application_status;
  if (!status || status === 'not_started') {
    return { bucket: 'needs', action: 'UEZ application next', tone: 'danger', rank: 7, stepKey: 'uez_enrollment' };
  }
  if (status === 'applied') {
    if (types.has('uez_approval_email') && approvalReview === 'rejected') {
      return { bucket: 'waiting', action: 'Waiting for UEZ email replacement', tone: 'warn', rank: 52, stepKey: 'uez_enrollment' };
    }
    if (!types.has('uez_approval_email') || approvalReview !== 'approved') {
      return { bucket: 'waiting', action: 'Waiting for UEZ approval', tone: 'quiet', rank: 55, stepKey: 'uez_enrollment' };
    }
  }
  return null; // approved — satisfied, nothing to surface
}

function taxClearanceStepEntry(app, types) {
  const status = app.tax_clearance_status || (app.tax_clearance_good ? 'good' : 'no');
  if (status !== 'good' || !types.has('tax_clearance')) {
    if (status === 'issue' || types.has('tax_clearance_issue')) {
      return { bucket: 'waiting', action: 'Tax clearance issue — waiting on client', tone: 'warn', rank: 51, stepKey: 'tax_clearance' };
    }
    return { bucket: 'needs', action: 'Fetch tax clearance', tone: 'danger', rank: 8, stepKey: 'tax_clearance' };
  }
  return null; // good — satisfied, nothing to surface
}

// needs beats waiting; within the same bucket, lower rank wins — the same
// bucket-then-rank precedence filterAndSortApplications already uses below.
function pickPrimaryAndSecondary(uezEntry, taxEntry) {
  if (!uezEntry) return [taxEntry, null];
  if (!taxEntry) return [uezEntry, null];
  const weight = { needs: 0, waiting: 1 };
  const uezWeight = weight[uezEntry.bucket] ?? 9;
  const taxWeight = weight[taxEntry.bucket] ?? 9;
  if (uezWeight !== taxWeight) return uezWeight < taxWeight ? [uezEntry, taxEntry] : [taxEntry, uezEntry];
  return uezEntry.rank <= taxEntry.rank ? [uezEntry, taxEntry] : [taxEntry, uezEntry];
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
  for (const item of URGENT_REVIEW_ITEMS) {
    if (item.test(app, types, formationReview, approvalReview)) {
      return { bucket: 'needs', action: item.action, tone: 'danger', stage, rank: item.rank, stepKey: item.stepKey };
    }
  }

  if (submittedGrant) return { bucket: 'submitted', action: 'Grant submitted', tone: 'submitted', stage, rank: 0, stepKey: 'grant_submission' };
  if (!app.submitted_at) return { bucket: 'waiting', action: 'Applicant still completing signup', tone: 'quiet', stage, rank: 80, stepKey: null };

  // Process sequence after the applicant submits.
  if (!types.has('brc')) {
    if (app.brc_status === 'not_found') return { bucket: 'waiting', action: 'Waiting on BRC follow-up', tone: 'warn', stage, rank: 50, stepKey: 'brc' };
    return { bucket: 'needs', action: 'Fetch BRC', tone: 'danger', stage, rank: 5, stepKey: 'brc' };
  }

  if (app.has_existing_pbs_account == null) return { bucket: 'needs', action: 'Confirm PBS account answer', tone: 'danger', stage, rank: 6, stepKey: 'pbs_mynj' };
  if (!app.pbs_account_created) return { bucket: 'needs', action: 'Set up PBS', tone: 'danger', stage, rank: 6, stepKey: 'pbs_mynj' };

  const uezEntry = uezEnrollmentStepEntry(app, types, approvalReview);
  const taxEntry = taxClearanceStepEntry(app, types);
  if (uezEntry || taxEntry) {
    const [primary, secondary] = pickPrimaryAndSecondary(uezEntry, taxEntry);
    return {
      bucket: primary.bucket, action: primary.action, tone: primary.tone, stage,
      rank: primary.rank, stepKey: primary.stepKey,
      secondaryAction: secondary ? { action: secondary.action, stepKey: secondary.stepKey, tone: secondary.tone, bucket: secondary.bucket } : null
    };
  }

  if (!app.is_sole_proprietorship && !types.has('formation')) return { bucket: 'waiting', action: 'Waiting for Formation document', tone: 'warn', stage, rank: 53, stepKey: 'formation' };
  if (types.has('formation') && formationReview === 'rejected') return { bucket: 'waiting', action: 'Waiting for Formation replacement', tone: 'warn', stage, rank: 54, stepKey: 'formation' };

  if (app.payment_status !== 'paid') return { bucket: 'waiting', action: 'Waiting for payment', tone: 'quiet', stage, rank: 60, stepKey: 'payment' };

  if (!types.has('ldc_application')) return { bucket: 'needs', action: 'Fill out LDC application', tone: 'danger', stage, rank: 9, stepKey: 'ldc_application' };

  if ((app.required_document_ready_count || 0) >= 5) return { bucket: 'ready', action: 'Ready for grant submission', tone: 'ready', stage, rank: 0, stepKey: 'grant_submission' };

  return { bucket: 'waiting', action: 'Waiting for next document', tone: 'quiet', stage, rank: 70, stepKey: null };
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
  const app = detail.application;
  const types = new Set(app.document_types || []);
  const formationReview = app.formation_review_status || 'not_reviewed';
  const approvalReview = app.uez_approval_review_status || 'not_reviewed';
  const items = URGENT_REVIEW_ITEMS
    .filter((item) => item.test(app, types, formationReview, approvalReview))
    .map((item) => item.attention);
  // Formation-rejected isn't in the urgent-review picker above (it already
  // surfaces as its own 'waiting' state further down adminQueueInfo's
  // waterfall, and on the Formation process card itself) but it's still
  // worth flagging here alongside the others.
  if (types.has('formation') && formationReview === 'rejected') items.push('Certificate of Formation marked wrong');
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

// Sourced from uez_status_events rows already on `detail` (addEmailActivity
// in backend/routes/uezEmail.js writes `Email sent: ${templateKey}` on a
// successful manual send, `Email not sent: ${templateKey}` on failure/skip,
// and stamps the Resend message id into the event's metadata so the case
// page can link straight to it). Exact match on both status and the full
// label - never substring-matched - so a failed send can never be mistaken
// for a successful one.
export function lastEmailSent(detail, templateKey) {
  const events = detail?.statusEvents || [];
  const match = [...events].reverse().find(
    (e) => e.status === 'admin_email_sent' && e.label === `Email sent: ${templateKey}`
  );
  if (!match) return null;
  return { createdAt: match.created_at, providerMessageId: match.metadata?.providerMessageId || null };
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

// Sidebar search + filter + sort, extracted from AdminPage.jsx's useMemo so
// the ordering rules (which bucket wins, then which rank within a bucket,
// then oldest-first) are unit tested directly rather than only visible by
// eyeballing the sidebar.
export function filterAndSortApplications(applications, filter, search) {
  const q = String(search || '').trim().toLowerCase();
  return (applications || [])
    .filter((app) => {
      const matchesSearch = !q || [app.business_name_input, app.registered_business_name, app.contact_email, app.ein]
        .some((value) => String(value || '').toLowerCase().includes(q));
      if (!matchesSearch) return false;
      if (filter === 'all') return true;
      return adminQueueInfo(app).bucket === filter;
    })
    .sort((a, b) => {
      const qa = adminQueueInfo(a);
      const qb = adminQueueInfo(b);
      const bucketPriority = { needs: 0, ready: 1, waiting: 2, submitted: 3 };
      const bucketDelta = (bucketPriority[qa.bucket] ?? 9) - (bucketPriority[qb.bucket] ?? 9);
      if (bucketDelta) return bucketDelta;
      if (qa.rank !== qb.rank) return qa.rank - qb.rank;
      const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
      const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
      return aTime - bTime;
    });
}

export function queueCounts(applications) {
  const list = applications || [];
  return {
    needs: list.filter((app) => adminQueueInfo(app).bucket === 'needs').length,
    waiting: list.filter((app) => adminQueueInfo(app).bucket === 'waiting').length,
    ready: list.filter((app) => adminQueueInfo(app).bucket === 'ready').length,
    submitted: list.filter((app) => adminQueueInfo(app).bucket === 'submitted').length,
    all: list.length
  };
}

// --- Process model (the 8-card case-page redesign) ----------------------------
// uez_process_steps is a purely additive operational overlay: an admin's own
// verdict on where a step stands, layered on top of (never replacing) the
// factual columns below. When no explicit row exists yet for a step, the UI
// falls back to a *display-only* derived default computed here — never
// written back to the DB, recomputed fresh on every read, so there's no
// backfill and no risk of a derived guess masquerading as a real decision.

// Canonical order the case actually gets worked in: confirm Formation, fetch
// BRC (or tell the client to register one), set up PBS/MyNJ, then work Tax
// Clearance and UEZ Enrollment in parallel, fill out the LDC application once
// both are good, collect Payment, and submit the Grant last. AdminPage.jsx's
// `.process-step-grid` card order is meant to mirror this exactly — there's
// no programmatic link between the two, so keep them in sync by hand.
export const PROCESS_STEP_KEYS = [
  'formation', 'brc', 'pbs_mynj', 'tax_clearance',
  'uez_enrollment', 'ldc_application', 'payment', 'grant_submission'
];

export const PROCESS_STEP_STATES = ['not_started', 'in_progress', 'waiting', 'complete', 'not_applicable', 'manual'];
export const WAITING_ON_VALUES = ['applicant', 'accountant', 'nj_state', 'document', 'cor_follow_up'];

// The exact title each step's ProcessStepCard renders — single source of
// truth so the card and the at-a-glance status overview never drift.
export const PROCESS_STEP_TITLES = {
  formation: 'Certificate of Formation',
  brc: 'BRC',
  pbs_mynj: 'PBS / MyNJ',
  tax_clearance: 'Tax Clearance',
  uez_enrollment: 'UEZ Enrollment',
  ldc_application: 'LDC Application',
  payment: 'Payment',
  grant_submission: 'Grant Submission'
};

export const PROCESS_STEP_STATE_LABELS = {
  not_started: 'Not started', in_progress: 'In progress', waiting: 'Waiting',
  complete: 'Complete', not_applicable: 'Not applicable', manual: 'Handled manually'
};

// Derives a sensible display default for one step from the existing Facts
// columns/documents — used only when uez_process_steps has no explicit row
// for (application, stepKey) yet. `detail` is the same {application, documents,
// statusEvents, payments} shape used throughout this file.
export function deriveDefaultProcessStep(stepKey, detail) {
  const app = detail?.application || {};

  switch (stepKey) {
    case 'formation': {
      const formation = docFor(detail, 'formation');
      if (!formation) return app.is_sole_proprietorship ? { state: 'not_applicable', waitingOn: null } : { state: 'not_started', waitingOn: null };
      const review = app.formation_review_status || 'not_reviewed';
      if (review === 'approved') return { state: 'complete', waitingOn: null };
      if (review === 'rejected') return { state: 'waiting', waitingOn: 'document' };
      return { state: 'in_progress', waitingOn: null };
    }

    case 'brc': {
      if (app.brc_status === 'found') return { state: 'complete', waitingOn: null };
      if (app.brc_status === 'not_found') return { state: 'waiting', waitingOn: 'nj_state' };
      if (!app.brc_status || app.brc_status === 'pending') return { state: 'not_started', waitingOn: null };
      // checking / uploaded / client_created / manual_verification_required / lookup_error / recheck_requested
      return { state: 'in_progress', waitingOn: null };
    }

    case 'pbs_mynj': {
      if (app.pbs_account_created) return { state: 'complete', waitingOn: null };
      if (app.has_existing_pbs_account == null) return { state: 'waiting', waitingOn: 'applicant' };
      return { state: 'in_progress', waitingOn: null };
    }

    case 'tax_clearance': {
      const status = app.tax_clearance_status || (app.tax_clearance_good ? 'good' : 'no');
      if (status === 'good') return { state: 'complete', waitingOn: null };
      if (status === 'issue') return app.tax_clearance_recheck_requested_at ? { state: 'in_progress', waitingOn: null } : { state: 'waiting', waitingOn: 'applicant' };
      return { state: 'not_started', waitingOn: null };
    }

    case 'uez_enrollment': {
      const status = app.uez_application_status;
      if (status === 'approved') return { state: 'complete', waitingOn: null };
      if (status === 'applied') {
        const review = app.uez_approval_review_status || 'not_reviewed';
        if (review === 'rejected') return { state: 'waiting', waitingOn: 'document' };
        return { state: 'in_progress', waitingOn: null };
      }
      return { state: 'not_started', waitingOn: null };
    }

    case 'ldc_application':
      return docFor(detail, 'ldc_application') ? { state: 'complete', waitingOn: null } : { state: 'not_started', waitingOn: null };

    case 'grant_submission': {
      if (app.status === 'applied' || app.status === 'grant_submitted') return { state: 'complete', waitingOn: null };
      if (grantSubmissionLikelyDetected(detail)) return { state: 'waiting', waitingOn: 'cor_follow_up' };
      if (packetReady(detail)) return { state: 'not_started', waitingOn: null };
      return { state: 'waiting', waitingOn: 'document' };
    }

    case 'payment': {
      const latest = detail?.payments?.[detail.payments.length - 1];
      if (latest?.status === 'paid') return { state: 'complete', waitingOn: null };
      if (latest?.status === 'client_reported') return { state: 'in_progress', waitingOn: null };
      return { state: 'not_started', waitingOn: null };
    }

    default:
      return { state: 'not_started', waitingOn: null };
  }
}

// Pure guard-clause reasons for the two multi-condition actions, hoisted out
// of their try/catch blocks in AdminPage.jsx so a disabled button can show
// *why* before a click, not just as a post-click error message.
export function pbsAccountGateReason(detail, myNjCredentials) {
  const primary = detail?.owners?.[0];
  if (!primary) return 'Add a primary owner before opening PBS.';
  if (!primary.title) return "Add the primary owner's title before opening PBS.";
  if (!myNjCredentials) return 'Generate the MyNJ login first.';
  return null;
}

export function grantSubmitGateReason(detail) {
  if (detail?.application?.status === 'applied') return 'Already submitted.';
  if (!packetReady(detail)) return 'All 5 required documents must be ready first.';
  return null;
}

// The precedence rule for a ProcessStepCard: an explicit uez_process_steps
// row (Chaim's own verdict) always wins when one exists; otherwise fall back
// to the read-only derived default. The card always knows which one it's
// showing via `source`, so "set by Chaim on Aug 28" vs "(auto)" is never
// ambiguous to whoever's looking at it.
export function resolveProcessStep(stepKey, detail) {
  const explicit = (detail?.processSteps || []).find((s) => s.step_key === stepKey);
  if (explicit) {
    return {
      state: explicit.state,
      waitingOn: explicit.waiting_on || null,
      waitingSince: explicit.waiting_since || null,
      waitingReason: explicit.waiting_reason || null,
      manualNote: explicit.manual_note || null,
      source: 'explicit',
      updatedByName: explicit.updated_by_name || null,
      updatedAt: explicit.updated_at || null
    };
  }
  const derived = deriveDefaultProcessStep(stepKey, detail);
  return { ...derived, waitingSince: null, waitingReason: null, manualNote: null, source: 'derived', updatedByName: null, updatedAt: null };
}
