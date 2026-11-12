// Links each UEZ case to its record in the Lakewood LDC's own Airtable, and
// records when the LDC board approves the grant.
//
// Per COR's terms the service fee stops being refundable the moment the LDC
// approves the grant, so this keeps a durable, timestamped record of that:
// one admin-only uez_status_events row (status 'ldc_board_approved') per
// application, written the first time the LDC's Airtable shows the
// "LDC Board Approved" box ticked. That row is never removed - if the LDC
// later unticks or rescinds, the record of when it was approved stays.
//
// Linking (status 'ldc_airtable_linked', also admin-only) happens once per
// case and is then trusted on every later run instead of re-matching:
//   1. by the grant form's JotForm submission ID, captured by the extension
//      when the Lakewood grant is submitted (see grant-jotform.js). The LDC
//      stores that ID as "Application ID" in a number field, so Airtable
//      keeps only ~16 significant digits - compared as numbers, not strings.
//   2. otherwise by email (contact or any owner), then exact business name -
//      see matchApplication. This covers cases submitted before the ID was
//      captured.
//
// Read-only against the LDC's "LDC Tech Grants" base (AIRTABLE_API_KEY is a
// read-only PAT). Nothing here ever writes to Airtable.

const supabase = require('../db/supabase');

const TECH_GRANTS_TABLE = 'tbl7WFxynHgFeUBSN';
const BOARD_MEETINGS_TABLE = 'tblmU50PMMUa5itke';
const APPROVED_STATUS = 'ldc_board_approved';
const LINKED_STATUS = 'ldc_airtable_linked';
const DETECTED_STATUS = 'grant_submission_detected';
const MIN_INTERVAL_MS = 10 * 60 * 1000;

let lastRunAt = 0;
let running = null;

function configured() {
  return Boolean(process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID);
}

async function airtableList(table, params) {
  const records = [];
  let offset;
  do {
    const query = new URLSearchParams(params);
    if (offset) query.set('offset', offset);
    const res = await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${table}?${query}`, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` }
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Airtable ${table} returned ${res.status}: ${text.slice(0, 200)}`);
    // "Application ID" is a 19-digit number; keep Airtable's digits as a
    // string instead of letting JSON.parse round them a second time.
    const body = JSON.parse(text.replace(/"Application ID":(\d+)/g, '"Application ID":"$1"'));
    records.push(...body.records);
    offset = body.offset;
  } while (offset);
  return records;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

// "Acme Bagels, L.L.C." and "ACME BAGELS LLC" compare equal.
function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(l ?l ?c|inc|incorporated|corp|corporation|co|company|ltd|llp|pllc|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A captured JotForm ID and the LDC's rounded copy of it refer to the same
// submission when they're the same double - which is exactly what Airtable
// did to it on the way in.
function sameSubmissionId(captured, ldcApplicationId) {
  if (!captured || !ldcApplicationId) return false;
  const a = String(captured).replace(/\D/g, '');
  const b = String(ldcApplicationId).replace(/\D/g, '');
  return a.length === b.length && a.length >= 15 && Number(a) === Number(b);
}

async function ldcTechGrantRecords() {
  const query = [
    ['pageSize', '100'],
    ...['Application ID', 'Business Name', 'Contact E-mail', 'Business E-mail', 'LDC Status', 'LDC Board Approved', 'LDC Board Meetings', 'Application Submission Date']
      .map((field) => ['fields[]', field])
  ];
  const [records, meetings] = await Promise.all([
    airtableList(TECH_GRANTS_TABLE, query),
    airtableList(BOARD_MEETINGS_TABLE, [['pageSize', '100'], ['fields[]', 'LDC Board Meeting Date']])
  ]);
  const meetingDates = {};
  for (const m of meetings) meetingDates[m.id] = m.fields['LDC Board Meeting Date'] || null;
  return records.map((r) => {
    const dates = (r.fields['LDC Board Meetings'] || []).map((id) => meetingDates[id]).filter(Boolean).sort();
    return {
      recordId: r.id,
      ldcApplicationId: r.fields['Application ID'] ?? null,
      businessName: r.fields['Business Name'] || '',
      emails: [r.fields['Contact E-mail'], r.fields['Business E-mail']].map(normalizeEmail).filter(Boolean),
      ldcStatus: r.fields['LDC Status'] || null,
      approved: Boolean(r.fields['LDC Board Approved']),
      submittedOn: r.fields['Application Submission Date'] || null,
      boardMeetingDate: dates[dates.length - 1] || null
    };
  });
}

// Email/name fallback. Matches by email first (contact email or any owner's
// email). When one email hits several LDC records - one person, two
// businesses - the business name has to agree too. With no email hit, an
// exact normalized business name match is accepted. Anything still ambiguous
// is skipped and logged rather than guessed, since this has money
// consequences. Only LDC applications submitted on or after the day the case
// was created here are candidates, so an older grant the same business got
// before COR is never mistaken for ours.
function matchApplication(application, ownerEmails, allLdcRecords) {
  const createdOn = String(application.created_at || '').slice(0, 10);
  const ldcRecords = allLdcRecords.filter((r) => !createdOn || !r.submittedOn || r.submittedOn >= createdOn);
  const emails = new Set([normalizeEmail(application.contact_email), ...ownerEmails].filter(Boolean));
  const names = new Set([application.registered_business_name, application.brc_registered_name, application.business_name_input]
    .map(normalizeName).filter(Boolean));

  const byEmail = ldcRecords.filter((r) => r.emails.some((e) => emails.has(e)));
  if (byEmail.length === 1) return { record: byEmail[0], matchedBy: 'email' };
  if (byEmail.length > 1) {
    const both = byEmail.filter((r) => names.has(normalizeName(r.businessName)));
    if (both.length === 1) return { record: both[0], matchedBy: 'email+name' };
    return { ambiguous: byEmail.length };
  }
  const byName = ldcRecords.filter((r) => names.has(normalizeName(r.businessName)));
  if (byName.length === 1) return { record: byName[0], matchedBy: 'name' };
  if (byName.length > 1) return { ambiguous: byName.length };
  return null;
}

function approvalMessage(record) {
  const meeting = record.boardMeetingDate ? ` at the ${record.boardMeetingDate} board meeting` : '';
  const ref = record.ldcApplicationId != null ? ` (LDC application #${record.ldcApplicationId})` : '';
  return `The Lakewood LDC board approved this grant${meeting}${ref}. Per COR's terms, the service fee is no longer refundable from this point.`;
}

async function runSync() {
  const ldcRecords = await ldcTechGrantRecords();
  const byRecordId = Object.fromEntries(ldcRecords.map((r) => [r.recordId, r]));

  const [appsResult, ownersResult, eventsResult] = await Promise.all([
    supabase.from('uez_applications').select('id, created_at, status, contact_email, business_name_input, registered_business_name, brc_registered_name'),
    supabase.from('uez_owners').select('application_id, email'),
    supabase.from('uez_status_events').select('id, application_id, status, message, metadata, created_at')
      .in('status', [APPROVED_STATUS, LINKED_STATUS, DETECTED_STATUS])
      .order('created_at')
  ]);
  if (appsResult.error) throw appsResult.error;
  if (ownersResult.error) throw ownersResult.error;
  if (eventsResult.error) throw eventsResult.error;

  const ownerEmails = {};
  for (const o of ownersResult.data || []) (ownerEmails[o.application_id] ||= []).push(normalizeEmail(o.email));

  const links = {};
  const approvals = {};
  const capturedIds = {};
  for (const e of eventsResult.data || []) {
    if (e.status === LINKED_STATUS && e.metadata?.airtableRecordId) links[e.application_id] = e.metadata.airtableRecordId;
    if (e.status === APPROVED_STATUS) approvals[e.application_id] = e;
    if (e.status === DETECTED_STATUS && e.metadata?.grantSubmissionId) capturedIds[e.application_id] = e.metadata.grantSubmissionId;
  }
  // Approvals recorded before linking existed carry their record id - treat
  // that as the link too.
  for (const [appId, e] of Object.entries(approvals)) {
    if (!links[appId] && e.metadata?.airtableRecordId) links[appId] = e.metadata.airtableRecordId;
  }

  // Cancelled cases are never linked: no live service, no fee consequence,
  // and they're usually a client's abandoned duplicate sharing an email with
  // the real case.
  const activeApps = (appsResult.data || []).filter((a) => a.status !== 'cancelled');

  // Phase 1: propose a link for every unlinked case. A record can belong to
  // one case only - if two cases would claim the same LDC record (and no
  // existing link settles it), neither is linked and it's logged instead.
  const proposed = {};
  for (const application of activeApps) {
    if (links[application.id]) continue;
    const captured = capturedIds[application.id];
    const byId = captured ? ldcRecords.filter((r) => sameSubmissionId(captured, r.ldcApplicationId)) : [];
    if (byId.length === 1) {
      proposed[application.id] = { record: byId[0], matchedBy: 'jotform_submission_id' };
      continue;
    }
    const match = matchApplication(application, ownerEmails[application.id] || [], ldcRecords);
    if (match?.ambiguous) {
      console.warn(`[ldc-approvals] ${application.id}: ${match.ambiguous} LDC records could match - skipped, check by hand`);
      continue;
    }
    if (match) proposed[application.id] = match;
  }
  const claims = {};
  for (const recordId of Object.values(links)) claims[recordId] = (claims[recordId] || 0) + 1;
  for (const { record } of Object.values(proposed)) claims[record.recordId] = (claims[record.recordId] || 0) + 1;
  for (const [appId, { record }] of Object.entries(proposed)) {
    if (claims[record.recordId] > 1) {
      console.warn(`[ldc-approvals] ${appId}: LDC record ${record.recordId} matches more than one case - skipped, check by hand`);
      delete proposed[appId];
    }
  }

  // Phase 2: write new links, then approvals for every linked case.
  let linked = 0;
  let recorded = 0;
  for (const application of activeApps) {
    let record = links[application.id] ? byRecordId[links[application.id]] : null;
    const hasLinkEvent = (eventsResult.data || []).some((e) => e.application_id === application.id && e.status === LINKED_STATUS);

    if (!record) {
      if (!proposed[application.id]) continue;
      const { matchedBy } = proposed[application.id];
      record = proposed[application.id].record;
      links[application.id] = record.recordId;
      if (!hasLinkEvent) {
        const ref = record.ldcApplicationId != null ? ` #${record.ldcApplicationId}` : '';
        const { error } = await supabase.from('uez_status_events').insert({
          application_id: application.id,
          status: LINKED_STATUS,
          label: 'Linked to LDC application',
          message: `Found this grant in the LDC's system as LDC application${ref} (${record.ldcStatus || 'no status yet'}). Matched by ${matchedBy.replace(/_/g, ' ')}.`,
          visible_to_applicant: false,
          metadata: {
            source: 'ldc_airtable',
            airtableRecordId: record.recordId,
            ldcApplicationId: record.ldcApplicationId,
            ldcBusinessName: record.businessName,
            matchedBy,
            linkedAt: new Date().toISOString()
          }
        });
        if (error) throw error;
        linked += 1;
      }
    } else if (!hasLinkEvent) {
      const { error } = await supabase.from('uez_status_events').insert({
        application_id: application.id,
        status: LINKED_STATUS,
        label: 'Linked to LDC application',
        message: `Linked to LDC application #${record.ldcApplicationId} from the earlier approval record.`,
        visible_to_applicant: false,
        metadata: { source: 'ldc_airtable', airtableRecordId: record.recordId, ldcApplicationId: record.ldcApplicationId, ldcBusinessName: record.businessName, matchedBy: 'approval_record', linkedAt: new Date().toISOString() }
      });
      if (error) throw error;
      linked += 1;
    }

    const existing = approvals[application.id];
    if (existing) {
      // One-time correction: approvals recorded before the Application ID was
      // read as a string carry a doubly-rounded number. Only the reference
      // number is fixed - when it was recorded and what was approved stay.
      if (record && record.ldcApplicationId != null && String(existing.metadata?.ldcApplicationId) !== String(record.ldcApplicationId)) {
        const { error } = await supabase.from('uez_status_events')
          .update({
            message: existing.message.replace(/LDC application #\d+/, `LDC application #${record.ldcApplicationId}`),
            metadata: { ...existing.metadata, ldcApplicationId: record.ldcApplicationId, ldcApplicationIdCorrectedAt: new Date().toISOString() }
          })
          .eq('id', existing.id);
        if (error) throw error;
      }
      continue;
    }
    if (!record?.approved) continue;

    const { error } = await supabase.from('uez_status_events').insert({
      application_id: application.id,
      status: APPROVED_STATUS,
      label: 'LDC board approved the grant',
      message: approvalMessage(record),
      visible_to_applicant: false,
      metadata: {
        source: 'ldc_airtable',
        airtableRecordId: record.recordId,
        ldcApplicationId: record.ldcApplicationId,
        ldcBusinessName: record.businessName,
        ldcStatus: record.ldcStatus,
        boardMeetingDate: record.boardMeetingDate,
        recordedAt: new Date().toISOString()
      }
    });
    if (error) throw error;
    recorded += 1;
  }
  return { ldcRecords: ldcRecords.length, linked, recorded };
}

// Throttled, single-flight entry point: safe to call from a timer and from
// request handlers without piling up Airtable calls.
function syncLdcApprovals({ force = false } = {}) {
  if (!configured()) return Promise.resolve({ skipped: 'AIRTABLE_API_KEY / AIRTABLE_BASE_ID not set' });
  if (running) return running;
  if (!force && Date.now() - lastRunAt < MIN_INTERVAL_MS) return Promise.resolve({ skipped: 'ran recently' });
  lastRunAt = Date.now();
  running = runSync()
    .then((result) => {
      if (result.linked || result.recorded) console.log(`[ldc-approvals] linked ${result.linked} case(s), recorded ${result.recorded} new LDC approval(s)`);
      return result;
    })
    .catch((err) => {
      console.error('[ldc-approvals] sync failed:', err.message);
      return { error: err.message };
    })
    .finally(() => { running = null; });
  return running;
}

module.exports = {
  syncLdcApprovals,
  APPROVED_STATUS,
  LINKED_STATUS,
  matchApplication,
  normalizeName,
  sameSubmissionId,
  ldcTechGrantRecords
};
