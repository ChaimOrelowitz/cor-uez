// Records when the Lakewood LDC board approves a grant we applied for.
//
// Per COR's terms the service fee stops being refundable the moment the LDC
// approves the grant, so this keeps a durable, timestamped record of that:
// one admin-only uez_status_events row (status 'ldc_board_approved') per
// application, written the first time the LDC's own Airtable shows the
// "LDC Board Approved" box ticked. The row is never removed or rewritten -
// if the LDC later unticks or rescinds, the record of when it was approved
// stays, which is the point.
//
// Read-only against the LDC's "LDC Tech Grants" base (AIRTABLE_API_KEY is a
// read-only PAT). Nothing here ever writes to Airtable.

const supabase = require('../db/supabase');

const TECH_GRANTS_TABLE = 'tbl7WFxynHgFeUBSN';
const BOARD_MEETINGS_TABLE = 'tblmU50PMMUa5itke';
const APPROVED_STATUS = 'ldc_board_approved';
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
    if (!res.ok) throw new Error(`Airtable ${table} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
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

async function approvedLdcRecords() {
  const query = [
    ['filterByFormula', '{LDC Board Approved}'],
    ['pageSize', '100'],
    ...['Application ID', 'Business Name', 'Contact E-mail', 'Business E-mail', 'LDC Status', 'LDC Board Meetings', 'Application Submission Date']
      .map((field) => ['fields[]', field])
  ];
  const records = await airtableList(TECH_GRANTS_TABLE, query);
  const meetingIds = [...new Set(records.flatMap((r) => r.fields['LDC Board Meetings'] || []))];
  const meetingDates = {};
  if (meetingIds.length) {
    const meetings = await airtableList(BOARD_MEETINGS_TABLE, [['pageSize', '100'], ['fields[]', 'LDC Board Meeting Date']]);
    for (const m of meetings) meetingDates[m.id] = m.fields['LDC Board Meeting Date'] || null;
  }
  return records.map((r) => {
    const dates = (r.fields['LDC Board Meetings'] || []).map((id) => meetingDates[id]).filter(Boolean).sort();
    return {
      recordId: r.id,
      ldcApplicationId: r.fields['Application ID'] ?? null,
      businessName: r.fields['Business Name'] || '',
      emails: [r.fields['Contact E-mail'], r.fields['Business E-mail']].map(normalizeEmail).filter(Boolean),
      ldcStatus: r.fields['LDC Status'] || null,
      submittedOn: r.fields['Application Submission Date'] || null,
      boardMeetingDate: dates[dates.length - 1] || null
    };
  });
}

// Matches by email first (contact email or any owner's email). When one
// email hits several LDC records - one person, two businesses - the business
// name has to agree too. With no email hit, an exact normalized business
// name match is accepted. Anything still ambiguous is skipped and logged
// rather than guessed, since this record has money consequences. Only LDC
// applications submitted on or after the day the case was created here are
// candidates, so an older grant the same business got before COR is never
// mistaken for ours.
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

async function runSync() {
  const ldcRecords = await approvedLdcRecords();
  if (!ldcRecords.length) return { approvedInLdc: 0, recorded: 0 };

  const [appsResult, ownersResult, eventsResult] = await Promise.all([
    supabase.from('uez_applications').select('id, created_at, contact_email, business_name_input, registered_business_name, brc_registered_name'),
    supabase.from('uez_owners').select('application_id, email'),
    supabase.from('uez_status_events').select('application_id').eq('status', APPROVED_STATUS)
  ]);
  if (appsResult.error) throw appsResult.error;
  if (ownersResult.error) throw ownersResult.error;
  if (eventsResult.error) throw eventsResult.error;

  const alreadyRecorded = new Set((eventsResult.data || []).map((e) => e.application_id));
  const ownerEmails = {};
  for (const o of ownersResult.data || []) (ownerEmails[o.application_id] ||= []).push(normalizeEmail(o.email));

  let recorded = 0;
  for (const application of appsResult.data || []) {
    if (alreadyRecorded.has(application.id)) continue;
    const match = matchApplication(application, ownerEmails[application.id] || [], ldcRecords);
    if (!match) continue;
    if (match.ambiguous) {
      console.warn(`[ldc-approvals] ${application.id}: ${match.ambiguous} approved LDC records could match - skipped, check by hand`);
      continue;
    }
    const { record, matchedBy } = match;
    const meeting = record.boardMeetingDate ? ` at the ${record.boardMeetingDate} board meeting` : '';
    const ref = record.ldcApplicationId != null ? ` (LDC application #${record.ldcApplicationId})` : '';
    const { error } = await supabase.from('uez_status_events').insert({
      application_id: application.id,
      status: APPROVED_STATUS,
      label: 'LDC board approved the grant',
      message: `The Lakewood LDC board approved this grant${meeting}${ref}. Per COR's terms, the service fee is no longer refundable from this point.`,
      visible_to_applicant: false,
      metadata: {
        source: 'ldc_airtable',
        airtableRecordId: record.recordId,
        ldcApplicationId: record.ldcApplicationId,
        ldcBusinessName: record.businessName,
        ldcStatus: record.ldcStatus,
        boardMeetingDate: record.boardMeetingDate,
        matchedBy,
        recordedAt: new Date().toISOString()
      }
    });
    if (error) throw error;
    recorded += 1;
  }
  return { approvedInLdc: ldcRecords.length, recorded };
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
      if (result.recorded) console.log(`[ldc-approvals] recorded ${result.recorded} new LDC approval(s)`);
      return result;
    })
    .catch((err) => {
      console.error('[ldc-approvals] sync failed:', err.message);
      return { error: err.message };
    })
    .finally(() => { running = null; });
  return running;
}

module.exports = { syncLdcApprovals, APPROVED_STATUS, matchApplication, normalizeName };
