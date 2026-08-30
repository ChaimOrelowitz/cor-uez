import { describe, it, expect } from 'vitest';
import {
  PROCESS_STEP_KEYS,
  adminQueueInfo,
  attentionItems,
  deriveDefaultProcessStep,
  documentLabel,
  filterAndSortApplications,
  formatDob,
  formatPhoneInput,
  formatSsnInput,
  formatTimestamp,
  formationSatisfied,
  grantSubmissionLikelyDetected,
  grantSubmitGateReason,
  lastEmailSentAt,
  packetReady,
  paymentStatusLabel,
  pbsAccountGateReason,
  queueCounts,
  readyDocumentCount,
  resolveProcessStep,
  uezStatusLabel
} from './caseLogic';

describe('formatTimestamp', () => {
  it('returns empty string for missing/invalid input', () => {
    expect(formatTimestamp(null)).toBe('');
    expect(formatTimestamp(undefined)).toBe('');
    expect(formatTimestamp('not a date')).toBe('');
  });

  it('formats a real ISO timestamp into a readable string', () => {
    const result = formatTimestamp('2026-08-27T20:03:00Z');
    expect(result).toContain('2026');
    expect(result).toContain('·');
  });
});

describe('formatDob', () => {
  it('converts ISO yyyy-mm-dd into mm/dd/yyyy', () => {
    expect(formatDob('1990-01-15')).toBe('01/15/1990');
  });

  it('passes through anything that is not a clean ISO date', () => {
    expect(formatDob('01/15/1990')).toBe('01/15/1990');
    expect(formatDob('')).toBe('');
  });
});

describe('formatPhoneInput / formatSsnInput', () => {
  it('progressively formats digits as they are typed', () => {
    expect(formatPhoneInput('55512')).toBe('(555) 12');
    expect(formatPhoneInput('5551234567')).toBe('(555) 123-4567');
    expect(formatSsnInput('12345')).toBe('123-45');
    expect(formatSsnInput('123456789')).toBe('123-45-6789');
  });
});

describe('label helpers', () => {
  it('paymentStatusLabel maps known and unknown values', () => {
    expect(paymentStatusLabel('paid')).toBe('Paid');
    expect(paymentStatusLabel('client_reported')).toBe('Client says paid');
    expect(paymentStatusLabel(null)).toBe('Not recorded');
  });

  it('uezStatusLabel maps known and unknown values', () => {
    expect(uezStatusLabel('approved')).toBe('Approved');
    expect(uezStatusLabel('applied')).toBe('Applied');
    expect(uezStatusLabel('not_started')).toBe('Not Started');
  });

  it('documentLabel covers every document type used in the app', () => {
    expect(documentLabel('formation')).toBe('Formation document');
    expect(documentLabel('brc')).toBe('BRC');
    expect(documentLabel('uez_approval_email')).toBe('UEZ approval email');
    expect(documentLabel('tax_clearance')).toBe('Tax-clearance letter');
    expect(documentLabel('ldc_application')).toBe('LDC incentive application');
    expect(documentLabel('supporting')).toBe('Supporting');
    expect(documentLabel('something_unknown')).toBe('something_unknown');
  });
});

describe('formationSatisfied / packetReady / readyDocumentCount', () => {
  function detailWith(overrides = {}) {
    return {
      application: { is_sole_proprietorship: false, formation_review_status: 'not_reviewed', uez_approval_review_status: 'not_reviewed', ...overrides.application },
      documents: overrides.documents || []
    };
  }

  it('a sole proprietor with no formation doc is satisfied', () => {
    const detail = detailWith({ application: { is_sole_proprietorship: true } });
    expect(formationSatisfied(detail)).toBe(true);
  });

  it('a non-sole-prop with no formation doc is not satisfied', () => {
    const detail = detailWith({ application: { is_sole_proprietorship: false } });
    expect(formationSatisfied(detail)).toBe(false);
  });

  it('a non-sole-prop needs the formation doc approved, not just uploaded', () => {
    const documents = [{ document_type: 'formation', created_at: '2026-01-01' }];
    expect(formationSatisfied(detailWith({ documents, application: { formation_review_status: 'not_reviewed' } }))).toBe(false);
    expect(formationSatisfied(detailWith({ documents, application: { formation_review_status: 'approved' } }))).toBe(true);
  });

  it('packetReady requires every one of the 5 required documents in their satisfied state', () => {
    const documents = [
      { document_type: 'brc' },
      { document_type: 'uez_approval_email' },
      { document_type: 'tax_clearance' },
      { document_type: 'ldc_application' }
    ];
    const almostReady = detailWith({ documents, application: { is_sole_proprietorship: true, uez_approval_review_status: 'approved' } });
    expect(packetReady(almostReady)).toBe(true);
    expect(readyDocumentCount(almostReady)).toBe(5);

    const missingApproval = detailWith({ documents, application: { is_sole_proprietorship: true, uez_approval_review_status: 'not_reviewed' } });
    expect(packetReady(missingApproval)).toBe(false);
    expect(readyDocumentCount(missingApproval)).toBe(4);
  });
});

describe('attentionItems', () => {
  it('surfaces client-reported payment, BRC self-report, and tax recheck requests', () => {
    const detail = {
      // payment_status mirrors the latest payments row - the backend always
      // sends both in sync (uez.js derives payment_status server-side from
      // the same latestPayments lookup), so attentionItems reads the
      // application-level field like adminQueueInfo does, not the array.
      application: { brc_status: 'client_created', tax_clearance_recheck_requested_at: '2026-08-01', payment_status: 'client_reported' },
      documents: [],
      payments: [{ status: 'client_reported' }]
    };
    const items = attentionItems(detail);
    expect(items).toContain('Client says payment was sent');
    expect(items).toContain('Client says BRC was created — recheck BRC');
    expect(items).toContain('Client says the tax-clearance issue is resolved — recheck Tax Clearance');
  });

  it('returns nothing for a clean, fully-reviewed case', () => {
    const detail = { application: {}, documents: [], payments: [] };
    expect(attentionItems(detail)).toEqual([]);
  });

  it('flags a rejected formation document even though it is not in the urgent-review picker', () => {
    const detail = {
      application: { document_types: ['formation'], formation_review_status: 'rejected' },
      documents: [],
      payments: []
    };
    expect(attentionItems(detail)).toEqual(['Certificate of Formation marked wrong']);
  });
});

describe('adminQueueInfo', () => {
  it('a brand-new signup is waiting, not needing action', () => {
    const info = adminQueueInfo({ submitted_at: null });
    expect(info.bucket).toBe('waiting');
    expect(info.action).toMatch(/completing signup/i);
  });

  it('client-reported payment outranks everything else', () => {
    const info = adminQueueInfo({
      submitted_at: '2026-01-01',
      payment_status: 'client_reported',
      brc_status: 'client_created' // would also match a lower-priority rule
    });
    expect(info.bucket).toBe('needs');
    expect(info.action).toBe('Confirm payment');
    expect(info.rank).toBe(1);
  });

  it('an unreviewed formation document needs review before anything else in that tier', () => {
    const info = adminQueueInfo({
      submitted_at: '2026-01-01',
      document_types: ['formation'],
      formation_review_status: 'not_reviewed'
    });
    expect(info).toMatchObject({ bucket: 'needs', action: 'Review Formation' });
  });

  it('a fully-submitted grant application is in the submitted bucket', () => {
    const info = adminQueueInfo({ status: 'grant_submitted', submitted_at: '2026-01-01' });
    expect(info.bucket).toBe('submitted');
  });

  it('a fully complete, unpaid-free packet with 5 ready docs is ready to submit', () => {
    const info = adminQueueInfo({
      submitted_at: '2026-01-01',
      document_types: ['brc', 'uez_approval_email', 'tax_clearance', 'ldc_application'],
      uez_approval_review_status: 'approved',
      has_existing_pbs_account: false,
      pbs_account_created: true,
      uez_application_status: 'approved',
      tax_clearance_status: 'good',
      is_sole_proprietorship: true,
      payment_status: 'paid',
      required_document_ready_count: 5
    });
    expect(info.bucket).toBe('ready');
  });

  it('a tax-clearance issue is a waiting state, not a needs-action state', () => {
    const info = adminQueueInfo({
      submitted_at: '2026-01-01',
      document_types: ['brc'],
      has_existing_pbs_account: false,
      pbs_account_created: true,
      uez_application_status: 'approved',
      tax_clearance_status: 'issue'
    });
    expect(info).toMatchObject({ bucket: 'waiting', action: expect.stringMatching(/tax clearance issue/i) });
  });
});

// Tax Clearance and UEZ Enrollment are worked in parallel in real life, so
// adminQueueInfo evaluates both instead of letting whichever check runs
// first hide the other — these cases pin that behavior down directly.
describe('adminQueueInfo parallel tax/UEZ', () => {
  const base = { submitted_at: '2026-01-01', document_types: ['brc'], has_existing_pbs_account: false, pbs_account_created: true };

  it('UEZ not started and tax not fetched: UEZ is primary, tax surfaces as a secondary needs-action', () => {
    const info = adminQueueInfo({ ...base });
    expect(info).toMatchObject({ bucket: 'needs', action: 'UEZ application next', rank: 7, stepKey: 'uez_enrollment' });
    expect(info.secondaryAction).toMatchObject({ action: 'Fetch tax clearance', stepKey: 'tax_clearance', bucket: 'needs' });
  });

  it('UEZ not started and tax has an issue: UEZ stays primary, tax issue surfaces as a secondary waiting note', () => {
    const info = adminQueueInfo({ ...base, tax_clearance_status: 'issue' });
    expect(info).toMatchObject({ bucket: 'needs', action: 'UEZ application next', stepKey: 'uez_enrollment' });
    expect(info.secondaryAction).toMatchObject({ action: expect.stringMatching(/tax clearance issue/i), stepKey: 'tax_clearance', bucket: 'waiting' });
  });

  it('UEZ approved but tax not good: tax is primary, no secondary, and LDC is not suggested yet', () => {
    const info = adminQueueInfo({ ...base, uez_application_status: 'approved', tax_clearance_status: 'no' });
    expect(info).toMatchObject({ bucket: 'needs', action: 'Fetch tax clearance', stepKey: 'tax_clearance' });
    expect(info.secondaryAction).toBeNull();
    expect(info.stepKey).not.toBe('ldc_application');
  });

  it('UEZ applied and rejected, tax not fetched: tax becomes primary (needs beats waiting), UEZ surfaces as secondary', () => {
    // Today's fix: previously the UEZ waiting-state ended the search early and
    // the admin was never told an actionable tax-clearance fetch was sitting there.
    const info = adminQueueInfo({
      ...base,
      document_types: ['brc', 'uez_approval_email'],
      uez_application_status: 'applied',
      uez_approval_review_status: 'rejected'
    });
    expect(info).toMatchObject({ bucket: 'needs', action: 'Fetch tax clearance', stepKey: 'tax_clearance' });
    expect(info.secondaryAction).toMatchObject({ action: 'Waiting for UEZ email replacement', stepKey: 'uez_enrollment', bucket: 'waiting' });
  });

  it('both waiting at once: the lower (more urgent) rank wins as primary', () => {
    const info = adminQueueInfo({ ...base, uez_application_status: 'applied', tax_clearance_status: 'issue' });
    expect(info).toMatchObject({ bucket: 'waiting', action: expect.stringMatching(/tax clearance issue/i), stepKey: 'tax_clearance' });
    expect(info.secondaryAction).toMatchObject({ stepKey: 'uez_enrollment' });
  });

  it('both satisfied: falls through to LDC Application unchanged, with no secondary action', () => {
    const info = adminQueueInfo({
      ...base,
      document_types: ['brc', 'tax_clearance'],
      uez_application_status: 'approved',
      tax_clearance_status: 'good',
      is_sole_proprietorship: true,
      payment_status: 'paid'
    });
    expect(info).toMatchObject({ bucket: 'needs', action: 'Fill out LDC application', rank: 9, stepKey: 'ldc_application' });
    expect(info.secondaryAction).toBeUndefined();
  });
});

describe('PROCESS_STEP_KEYS order', () => {
  it('places payment before grant_submission, matching the real-world workflow (payment is penultimate)', () => {
    expect(PROCESS_STEP_KEYS.indexOf('payment')).toBeLessThan(PROCESS_STEP_KEYS.indexOf('grant_submission'));
  });
});

describe('grantSubmissionLikelyDetected', () => {
  it('is false with no status events at all', () => {
    expect(grantSubmissionLikelyDetected({ application: { status: 'in_progress' }, statusEvents: [] })).toBe(false);
  });

  it('is true once a detection event exists and nothing has confirmed it', () => {
    const detail = {
      application: { status: 'in_progress' },
      statusEvents: [{ status: 'grant_submission_detected', created_at: '2026-08-27T10:00:00Z' }]
    };
    expect(grantSubmissionLikelyDetected(detail)).toBe(true);
  });

  it('is false once a later confirmation exists', () => {
    const detail = {
      application: { status: 'in_progress' },
      statusEvents: [
        { status: 'grant_submission_detected', created_at: '2026-08-27T10:00:00Z' },
        { status: 'grant_submitted', created_at: '2026-08-27T10:05:00Z' }
      ]
    };
    expect(grantSubmissionLikelyDetected(detail)).toBe(false);
  });

  it('is false once the application itself is already marked applied/submitted', () => {
    const detail = {
      application: { status: 'applied' },
      statusEvents: [{ status: 'grant_submission_detected', created_at: '2026-08-27T10:00:00Z' }]
    };
    expect(grantSubmissionLikelyDetected(detail)).toBe(false);
  });
});

describe('lastEmailSentAt', () => {
  it('is null with no status events at all', () => {
    expect(lastEmailSentAt({ statusEvents: [] }, 'tax_issue')).toBe(null);
  });

  it('returns created_at for a successful send', () => {
    const detail = { statusEvents: [
      { status: 'admin_email_sent', label: 'Email sent: tax_issue', created_at: '2026-08-20T10:00:00Z' }
    ] };
    expect(lastEmailSentAt(detail, 'tax_issue')).toBe('2026-08-20T10:00:00Z');
  });

  it('does not match a failed-send-only history', () => {
    const detail = { statusEvents: [
      { status: 'admin_email_sent', label: 'Email not sent: tax_issue', created_at: '2026-08-20T10:00:00Z' }
    ] };
    expect(lastEmailSentAt(detail, 'tax_issue')).toBe(null);
  });

  it('returns the latest success, ignoring an earlier success and a later failure', () => {
    const detail = { statusEvents: [
      { status: 'admin_email_sent', label: 'Email sent: tax_issue', created_at: '2026-08-18T10:00:00Z' },
      { status: 'admin_email_sent', label: 'Email sent: tax_issue', created_at: '2026-08-22T09:00:00Z' },
      { status: 'admin_email_sent', label: 'Email not sent: tax_issue', created_at: '2026-08-25T09:00:00Z' }
    ] };
    expect(lastEmailSentAt(detail, 'tax_issue')).toBe('2026-08-22T09:00:00Z');
  });

  it('does not match a different template key', () => {
    const detail = { statusEvents: [
      { status: 'admin_email_sent', label: 'Email sent: pbs_account_created', created_at: '2026-08-20T10:00:00Z' }
    ] };
    expect(lastEmailSentAt(detail, 'tax_issue')).toBe(null);
  });
});

describe('queueCounts', () => {
  it('buckets applications independently of filter/search', () => {
    const applications = [
      { submitted_at: null }, // waiting: still completing signup
      { status: 'grant_submitted', submitted_at: '2026-01-01' }, // submitted
      { submitted_at: '2026-01-01', payment_status: 'client_reported' } // needs
    ];
    const counts = queueCounts(applications);
    expect(counts).toEqual({ needs: 1, waiting: 1, ready: 0, submitted: 1, all: 3 });
  });
});

describe('filterAndSortApplications', () => {
  const applications = [
    // waiting: submitted, BRC follow-up already in progress
    { id: 'a', business_name_input: 'Alpha Bagels', ein: '111111111', submitted_at: '2026-01-01', brc_status: 'not_found', updated_at: '2026-01-03' },
    // needs: client says they paid, outranks everything
    { id: 'b', business_name_input: 'Beta Bakery', ein: '222222222', submitted_at: '2026-01-01', payment_status: 'client_reported', updated_at: '2026-01-02' },
    // submitted: grant already sent
    { id: 'c', business_name_input: 'Gamma Grocery', contact_email: 'owner@gamma.com', ein: '333333333', status: 'grant_submitted', submitted_at: '2026-01-01', updated_at: '2026-01-01' }
  ];

  it('search matches business name, email, or EIN, case-insensitively', () => {
    expect(filterAndSortApplications(applications, 'all', 'bagels').map((a) => a.id)).toEqual(['a']);
    expect(filterAndSortApplications(applications, 'all', 'nonexistent business').map((a) => a.id)).toEqual([]);
    expect(filterAndSortApplications(applications, 'all', 'owner@gamma.com').map((a) => a.id)).toEqual(['c']);
    expect(filterAndSortApplications(applications, 'all', '222222222').map((a) => a.id)).toEqual(['b']);
  });

  it('filter narrows to one bucket', () => {
    expect(filterAndSortApplications(applications, 'needs', '').map((a) => a.id)).toEqual(['b']);
    expect(filterAndSortApplications(applications, 'waiting', '').map((a) => a.id)).toEqual(['a']);
    expect(filterAndSortApplications(applications, 'submitted', '').map((a) => a.id)).toEqual(['c']);
  });

  it('needs-my-action outranks waiting, which outranks submitted, regardless of recency', () => {
    // "a" (waiting) has the most recent updated_at of the three, but bucket
    // priority must still win over recency.
    const ordered = filterAndSortApplications(applications, 'all', '').map((a) => a.id);
    expect(ordered).toEqual(['b', 'a', 'c']);
  });
});

describe('adminQueueInfo stepKey', () => {
  it('points the recommended-action banner at the right process card', () => {
    expect(adminQueueInfo({ submitted_at: '2026-01-01', payment_status: 'client_reported' }).stepKey).toBe('payment');
    expect(adminQueueInfo({ submitted_at: '2026-01-01', document_types: [] }).stepKey).toBe('brc');
    expect(adminQueueInfo({ submitted_at: null }).stepKey).toBeNull();
  });
});

describe('deriveDefaultProcessStep', () => {
  it('formation: sole prop with no document is not_applicable, not a blocker', () => {
    const detail = { application: { is_sole_proprietorship: true }, documents: [] };
    expect(deriveDefaultProcessStep('formation', detail)).toEqual({ state: 'not_applicable', waitingOn: null });
  });

  it('formation: non-sole-prop with no document is not_started; rejected doc is waiting on the applicant', () => {
    const noDoc = { application: { is_sole_proprietorship: false }, documents: [] };
    expect(deriveDefaultProcessStep('formation', noDoc)).toEqual({ state: 'not_started', waitingOn: null });

    const rejected = { application: { formation_review_status: 'rejected' }, documents: [{ document_type: 'formation' }] };
    expect(deriveDefaultProcessStep('formation', rejected)).toEqual({ state: 'waiting', waitingOn: 'document' });
  });

  it('brc: found is complete, not_found waits on NJ state, mid-flight is in_progress', () => {
    expect(deriveDefaultProcessStep('brc', { application: { brc_status: 'found' } })).toEqual({ state: 'complete', waitingOn: null });
    expect(deriveDefaultProcessStep('brc', { application: { brc_status: 'not_found' } })).toEqual({ state: 'waiting', waitingOn: 'nj_state' });
    expect(deriveDefaultProcessStep('brc', { application: { brc_status: 'checking' } })).toEqual({ state: 'in_progress', waitingOn: null });
    expect(deriveDefaultProcessStep('brc', { application: {} })).toEqual({ state: 'not_started', waitingOn: null });
  });

  it('pbs_mynj: unanswered existing-account question waits on the applicant', () => {
    expect(deriveDefaultProcessStep('pbs_mynj', { application: { has_existing_pbs_account: null } })).toEqual({ state: 'waiting', waitingOn: 'applicant' });
    expect(deriveDefaultProcessStep('pbs_mynj', { application: { pbs_account_created: true } })).toEqual({ state: 'complete', waitingOn: null });
  });

  it('tax_clearance: issue with a recheck request is in_progress, without one is waiting on the applicant', () => {
    const withRecheck = { application: { tax_clearance_status: 'issue', tax_clearance_recheck_requested_at: '2026-08-01' } };
    expect(deriveDefaultProcessStep('tax_clearance', withRecheck)).toEqual({ state: 'in_progress', waitingOn: null });
    const withoutRecheck = { application: { tax_clearance_status: 'issue' } };
    expect(deriveDefaultProcessStep('tax_clearance', withoutRecheck)).toEqual({ state: 'waiting', waitingOn: 'applicant' });
    expect(deriveDefaultProcessStep('tax_clearance', { application: { tax_clearance_status: 'good' } })).toEqual({ state: 'complete', waitingOn: null });
  });

  it('grant_submission: a likely-but-unconfirmed submission waits on COR follow-up', () => {
    const detail = {
      application: { status: 'in_progress' },
      statusEvents: [{ status: 'grant_submission_detected', created_at: '2026-08-27T10:00:00Z' }],
      documents: []
    };
    expect(deriveDefaultProcessStep('grant_submission', detail)).toEqual({ state: 'waiting', waitingOn: 'cor_follow_up' });
  });

  it('payment: client-reported needs confirmation (in_progress), not a passive wait', () => {
    const detail = { application: {}, payments: [{ status: 'client_reported' }] };
    expect(deriveDefaultProcessStep('payment', detail)).toEqual({ state: 'in_progress', waitingOn: null });
  });

  it('covers all 8 step keys without throwing on a bare-minimum detail object', () => {
    const detail = { application: {}, documents: [], payments: [], statusEvents: [] };
    for (const key of PROCESS_STEP_KEYS) {
      const result = deriveDefaultProcessStep(key, detail);
      expect(result).toHaveProperty('state');
      expect(result).toHaveProperty('waitingOn');
    }
  });
});

describe('pbsAccountGateReason', () => {
  it('surfaces the real blocker before a click, not just after', () => {
    expect(pbsAccountGateReason({ owners: [] }, null)).toMatch(/primary owner/i);
    expect(pbsAccountGateReason({ owners: [{ title: '' }] }, null)).toMatch(/title/i);
    expect(pbsAccountGateReason({ owners: [{ title: 'Mr.' }] }, null)).toMatch(/MyNJ login/i);
    expect(pbsAccountGateReason({ owners: [{ title: 'Mr.' }] }, { username: 'x' })).toBeNull();
  });
});

describe('grantSubmitGateReason', () => {
  it('explains why grant submission is blocked, or clears once ready', () => {
    expect(grantSubmitGateReason({ application: { status: 'applied' } })).toMatch(/already submitted/i);
    expect(grantSubmitGateReason({ application: { status: 'in_progress' }, documents: [] })).toMatch(/5 required documents/i);
  });
});

describe('resolveProcessStep', () => {
  it('falls back to the derived default when no explicit row exists', () => {
    const detail = { application: { pbs_account_created: true }, processSteps: [] };
    const resolved = resolveProcessStep('pbs_mynj', detail);
    expect(resolved).toMatchObject({ state: 'complete', source: 'derived', updatedByName: null });
  });

  it('an explicit row always wins over the derived default, even to the same value', () => {
    const detail = {
      application: { pbs_account_created: true }, // would derive to 'complete'
      processSteps: [{ step_key: 'pbs_mynj', state: 'waiting', waiting_on: 'accountant', waiting_since: '2026-08-20', waiting_reason: 'Confirming EIN', manual_note: null, updated_by_name: 'Chaim', updated_at: '2026-08-28T12:00:00Z' }]
    };
    const resolved = resolveProcessStep('pbs_mynj', detail);
    expect(resolved).toEqual({
      state: 'waiting', waitingOn: 'accountant', waitingSince: '2026-08-20', waitingReason: 'Confirming EIN',
      manualNote: null, source: 'explicit', updatedByName: 'Chaim', updatedAt: '2026-08-28T12:00:00Z'
    });
  });

  it('only looks at the row matching this stepKey, not any other step', () => {
    const detail = {
      application: {},
      processSteps: [{ step_key: 'brc', state: 'complete', updated_by_name: 'Chaim', updated_at: '2026-08-28T12:00:00Z' }]
    };
    expect(resolveProcessStep('payment', detail).source).toBe('derived');
  });
});
