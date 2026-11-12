import React, { useEffect, useRef, useState } from 'react';
import {
  adminQueueInfo,
  docFor,
  docsFor,
  formatDob,
  formatSsn,
  formatTimestamp,
  grantSubmissionLikelyDetected,
  grantSubmitGateReason,
  lastEmailSent,
  packetReady,
  paymentStatusLabel,
  pbsAccountGateReason,
  programLabel,
  PROCESS_STEP_KEYS,
  PROCESS_STEP_STATE_LABELS,
  PROCESS_STEP_TITLES,
  REQUIRED_GRANT_DOCUMENTS,
  resolveProcessStep,
  STEP_STATE_OPTIONS,
  stepStateOption,
} from './caseLogic';
import DocThumbnail from './DocThumbnail';
import BusinessDetailsCard from './BusinessDetailsCard';
import OwnersCard from './OwnersCard';

// ── Segment labels shown on the process bar (short form) ─────────────────────
const SEG_LABEL = {
  formation:        'CoF',
  brc:              'BRC',
  pbs_mynj:         'PBS / MyNJ',
  tax_clearance:    'Tax Clearance',
  uez_enrollment:   'UEZ Enrollment',
  ldc_application:  'LDC Application',
  payment:          'Payment',
  grant_submission: 'Grant Submission',
};

// Documents owned by each step (for the doc tile)
const STEP_DOC_TYPE = {
  formation:       'formation',
  brc:             'brc',
  tax_clearance:   'tax_clearance',
  uez_enrollment:  'uez_approval_email',
  ldc_application: 'ldc_application',
};

// ── State chip styling ────────────────────────────────────────────────────────
// Theme tokens (--cw-st-<state>-*, adminTheme.css) so chips read correctly in
// both light and dark mode instead of always rendering dark-theme blobs.
function stateStyle(state) {
  const key = ['complete', 'in_progress', 'waiting', 'manual', 'cancelled', 'not_applicable'].includes(state) ? state : 'not_started';
  return { bg: `var(--cw-st-${key}-bg)`, border: `var(--cw-st-${key}-border)`, fg: `var(--cw-st-${key}-fg)` };
}

// ── Segment bar colour ────────────────────────────────────────────────────────
function segBarColor(state) {
  switch (state) {
    case 'complete':       return '#34d399';
    case 'in_progress':   return '#60a5fa';
    case 'waiting':       return '#fbbf24';
    // Neutral/not-started track - a fixed dark hex here read as a hard grey
    // line on the light theme's tabs; var() resolves per-theme instead.
    case 'not_applicable':return 'var(--cw-bar-empty)';
    default:              return 'var(--cw-bar-empty)';
  }
}

// ── Activity stream helpers ───────────────────────────────────────────────────
// A case note can be tagged to a step by starting it with "[step_key] " -
// stored as plain text so tagging needs no schema change; the stream shows
// the tag as a step chip and hides the prefix.
function splitStepTag(text) {
  const match = /^\[([a-z_]+)\] /.exec(text || '');
  if (match && PROCESS_STEP_KEYS.includes(match[1])) return { stepKey: match[1], body: text.slice(match[0].length) };
  return { stepKey: null, body: text };
}

function buildStream(detail) {
  const notes = (detail.notes || []).map((n) => {
    const { stepKey, body } = splitStepTag(n.body);
    return {
    id: `note-${n.id}`,
    kind: 'note',
    body,
    stepKey,
    stepLabel: stepKey ? SEG_LABEL[stepKey] : null,
    authorName: n.author_name || 'COR',
    initial: (n.author_name || 'C').charAt(0).toUpperCase(),
    when: formatTimestamp(n.created_at),
    ts: new Date(n.created_at).getTime(),
    noteId: n.id,
    updatedAt: n.updated_at,
    };
  });

  const stepNotes = (detail.processSteps || [])
    .filter((s) => s.manual_note)
    .map((s) => ({
      id: `stepnote-${s.step_key}`,
      kind: 'stepnote',
      stepKey: s.step_key,
      stepLabel: SEG_LABEL[s.step_key] || s.step_key,
      body: s.manual_note,
      authorName: s.updated_by_name || 'COR',
      initial: (s.updated_by_name || 'C').charAt(0).toUpperCase(),
      when: s.updated_at ? formatTimestamp(s.updated_at) : '',
      ts: s.updated_at ? new Date(s.updated_at).getTime() : 0,
    }));

  const events = (detail.statusEvents || []).map((e) => ({
    id: `evt-${e.id}`,
    kind: 'event',
    title: e.label || e.status || e.type,
    body: e.message || '',
    when: formatTimestamp(e.created_at),
    ts: new Date(e.created_at).getTime(),
    dot: '#6f7883',
    providerMessageId: e.metadata?.providerMessageId || null,
  }));

  const all = [...notes, ...stepNotes, ...events].sort((a, b) => b.ts - a.ts);

  // Inject day dividers
  const result = [];
  let lastDay = null;
  for (const item of all) {
    const d = new Date(item.ts);
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    let dayLabel;
    if (d.toDateString() === today.toDateString()) dayLabel = 'Today';
    else if (d.toDateString() === yesterday.toDateString()) dayLabel = 'Yesterday';
    else dayLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    result.push({ ...item, divider: dayLabel !== lastDay ? dayLabel : null });
    lastDay = dayLabel;
  }
  return result;
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function CaseDetailTabs({
  detail,
  busy,
  myNjCredentials,
  brcForm, setBrcForm,
  paymentDraft, setPaymentDraft,
  pbsAnswerDraft,
  pbsLoginDraft, setPbsLoginDraft,
  myNjEditMode,
  myNjDraft, setMyNjDraft,
  showMyNjSecrets,
  editMode,
  applicationDraft,
  ownerDrafts,
  noteDraft, setNoteDraft,
  noteBusy,
  noteEditingId,
  noteEditDraft, setNoteEditDraft,
  manualDocType, setManualDocType,
  manualDocFile, setManualDocFile,
  manualDocUploading,
  // handlers
  previewDocument,
  reviewFormationDoc,
  sendFormationRejectedEmail,
  runBrcLookup,
  sendBrcProblemEmail,
  sendBrcWrongAddressEmail,
  markPbsAccountCreated,
  setProcessFlag,
  runPbsSignup,
  sendPbsAccountCreatedEmail,
  sendPbsExistingAccountEmail,
  runTaxClearance,
  sendTaxIssueEmail,
  sendUezApplicationSubmittedEmail,
  runLdcJotform,
  runUezEnrollment,
  runningJob,
  requestPayment,
  confirmPayment,
  sendPaymentRequestedEmail,
  sendPaymentReceivedEmail,
  runLakewoodGrantPortal,
  confirmGrantSubmitted,
  changePbsAnswerDraft,
  saveExistingPbsAnswer,
  saveMyNjCredentials,
  startMyNjEdit,
  cancelMyNjEdit,
  toggleShowMyNjSecrets,
  copyCredential,
  createMyNjCredentials,
  addCaseNote,
  startEditingNote,
  cancelEditingNote,
  saveCaseNoteEdit,
  removeCaseNote,
  openDoc,
  handleDeleteDoc,
  uploadManualAdminDocument,
  uploadDocumentDirect,
  directUploadType,
  updateApplicationDraft,
  updateOwnerDraft,
  addOwner,
  removeOwner,
  saveBrcFound,
  saveBrcNotFound,
  saveProcessStep,
  resetProcessStep,
  sendGrantSubmittedEmail,
  startEditing,
  saveAdminEdits,
  cancelEditing,
  deleteApplication,
}) {
  const app = detail.application;
  const defaultStep = adminQueueInfo(app).stepKey || PROCESS_STEP_KEYS[0];

  const [selectedStep, setSelectedStep] = useState(defaultStep);
  const [footerOpen, setFooterOpen] = useState(false);
  const [footerTab, setFooterTab] = useState('docs');
  // Note drafts are kept per application, so switching cases mid-sentence
  // neither loses the draft nor posts it to the wrong business.
  const [noteDrafts, setNoteDrafts] = useState({});
  const noteDraftLocal = noteDrafts[app.id] || '';
  const setNoteDraftLocal = (value) => setNoteDrafts((old) => ({ ...old, [app.id]: value }));
  const [tagNoteToStep, setTagNoteToStep] = useState(false);
  const stepPanelRef = useRef(null);
  const savingNoteRef = useRef(false);

  // Reset when application changes
  useEffect(() => {
    const next = adminQueueInfo(detail.application).stepKey || PROCESS_STEP_KEYS[0];
    setSelectedStep(next);
    setFooterOpen(false);
  }, [detail.application.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll step panel to top on step change
  useEffect(() => {
    if (stepPanelRef.current) stepPanelRef.current.scrollTop = 0;
  }, [selectedStep]);

  const stream = buildStream(detail);

  async function saveNote() {
    const text = noteDraftLocal.trim();
    if (!text || savingNoteRef.current) return;
    const applicationId = app.id;
    savingNoteRef.current = true;
    try {
      await addCaseNote(tagNoteToStep ? `[${selectedStep}] ${text}` : text);
      setNoteDrafts((old) => ({ ...old, [applicationId]: '' })); // clear only on success
    } catch {
      // error already surfaced by addCaseNote via the global message banner
    } finally {
      savingNoteRef.current = false;
    }
  }

  const stepIdx = PROCESS_STEP_KEYS.indexOf(selectedStep);
  const prevKey = stepIdx > 0 ? PROCESS_STEP_KEYS[stepIdx - 1] : null;
  const nextKey = stepIdx < PROCESS_STEP_KEYS.length - 1 ? PROCESS_STEP_KEYS[stepIdx + 1] : null;

  return (
    <div className="cw-shell">
      {/* ── Process bar ──────────────────────────────────────────────────────── */}
      <div className="cw-process-bar">
        {PROCESS_STEP_KEYS.map((key) => {
          const step = resolveProcessStep(key, detail);
          const active = key === selectedStep;
          return (
            <button
              key={key}
              type="button"
              className={`cw-seg${active ? ' cw-seg-active' : ''}`}
              onClick={() => setSelectedStep(key)}
            >
              <span className="cw-seg-bar" style={{ background: segBarColor(step.state), opacity: active ? 1 : 0.7 }} />
              <span className="cw-seg-title">{SEG_LABEL[key]}</span>
              <span className="cw-seg-state" style={{ color: active ? segBarColor(step.state) : undefined }}>
                {PROCESS_STEP_STATE_LABELS[step.state] || step.state}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Body: step panel + activity rail ─────────────────────────────────── */}
      <div className="cw-body">

        {/* Step panel */}
        <div className="cw-step-col" ref={stepPanelRef}>
          <StepPanel
            stepKey={selectedStep}
            stepIdx={stepIdx}
            detail={detail}
            busy={busy}
            myNjCredentials={myNjCredentials}
            brcForm={brcForm} setBrcForm={setBrcForm}
            paymentDraft={paymentDraft} setPaymentDraft={setPaymentDraft}
            pbsAnswerDraft={pbsAnswerDraft}
            pbsLoginDraft={pbsLoginDraft} setPbsLoginDraft={setPbsLoginDraft}
            myNjEditMode={myNjEditMode}
            myNjDraft={myNjDraft} setMyNjDraft={setMyNjDraft}
            showMyNjSecrets={showMyNjSecrets}
            previewDocument={previewDocument}
            reviewFormationDoc={reviewFormationDoc}
            sendFormationRejectedEmail={sendFormationRejectedEmail}
            runBrcLookup={runBrcLookup}
            sendBrcProblemEmail={sendBrcProblemEmail}
            sendBrcWrongAddressEmail={sendBrcWrongAddressEmail}
            markPbsAccountCreated={markPbsAccountCreated}
            setProcessFlag={setProcessFlag}
            runPbsSignup={runPbsSignup}
            sendPbsAccountCreatedEmail={sendPbsAccountCreatedEmail}
            sendPbsExistingAccountEmail={sendPbsExistingAccountEmail}
            runTaxClearance={runTaxClearance}
            sendTaxIssueEmail={sendTaxIssueEmail}
            sendUezApplicationSubmittedEmail={sendUezApplicationSubmittedEmail}
            runLdcJotform={runLdcJotform}
            runUezEnrollment={runUezEnrollment}
            runningJob={runningJob}
            requestPayment={requestPayment}
            confirmPayment={confirmPayment}
            sendPaymentRequestedEmail={sendPaymentRequestedEmail}
            sendPaymentReceivedEmail={sendPaymentReceivedEmail}
            runLakewoodGrantPortal={runLakewoodGrantPortal}
            confirmGrantSubmitted={confirmGrantSubmitted}
            sendGrantSubmittedEmail={sendGrantSubmittedEmail}
            changePbsAnswerDraft={changePbsAnswerDraft}
            saveExistingPbsAnswer={saveExistingPbsAnswer}
            saveMyNjCredentials={saveMyNjCredentials}
            startMyNjEdit={startMyNjEdit}
            cancelMyNjEdit={cancelMyNjEdit}
            toggleShowMyNjSecrets={toggleShowMyNjSecrets}
            copyCredential={copyCredential}
            createMyNjCredentials={createMyNjCredentials}
            saveBrcFound={saveBrcFound}
            saveBrcNotFound={saveBrcNotFound}
            saveProcessStep={saveProcessStep}
            resetProcessStep={resetProcessStep}
            uploadDocumentDirect={uploadDocumentDirect}
            directUploadType={directUploadType}
            prevLabel={prevKey ? SEG_LABEL[prevKey] : null}
            nextLabel={nextKey ? SEG_LABEL[nextKey] : null}
            onPrev={() => prevKey && setSelectedStep(prevKey)}
            onNext={() => nextKey && setSelectedStep(nextKey)}
          />
        </div>

        {/* Activity rail */}
        <aside className="cw-rail">
          <div className="cw-rail-head">
            <span className="cw-rail-label">ACTIVITY</span>
            <span className="cw-rail-count">{stream.length} entries</span>
          </div>

          {/* Composer - saves on the button or ⌘/Ctrl+Enter only, never on blur */}
          <div className="cw-composer">
            <textarea
              className="cw-composer-input"
              value={noteDraftLocal}
              onChange={(e) => setNoteDraftLocal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveNote(); } }}
              placeholder="Add a note… (⌘↵ to save)"
              rows={2}
            />
            {noteDraftLocal.trim() && (
              <div className="cw-composer-actions">
                <button className="cw-btn cw-btn-ok" onClick={saveNote} disabled={noteBusy}>Save note</button>
                <button
                  type="button"
                  className={`cw-step-chip${tagNoteToStep ? ' cw-step-chip-on' : ''}`}
                  onClick={() => setTagNoteToStep((on) => !on)}
                  title="Tag this note to the step you're on"
                >{tagNoteToStep ? '✓ ' : '+ '}{SEG_LABEL[selectedStep].toUpperCase()}</button>
                <button className="cw-btn-ghost" onClick={() => setNoteDraftLocal('')}>Discard</button>
              </div>
            )}
          </div>

          {/* Stream */}
          <div className="cw-stream">
            {stream.map((item) => (
              <div key={item.id} className="cw-stream-entry">
                {item.divider && (
                  <div className="cw-day-divider">
                    <span className="cw-mono cw-faint3">{item.divider}</span>
                    <span className="cw-divider-line" />
                  </div>
                )}
                <div className="cw-stream-row">
                  <div className="cw-stream-gutter">
                    <span className="cw-stream-dot" style={{ background: item.kind === 'event' ? item.dot : 'var(--cw-muted)' }} />
                    <span className="cw-stream-spine" />
                  </div>
                  <div className="cw-stream-content">
                    {(item.kind === 'note' || item.kind === 'stepnote') ? (
                      <div className="cw-note-card" style={{ borderLeft: item.kind === 'stepnote' ? '2px solid var(--cw-muted)' : undefined }}>
                        <div className="cw-note-card-head">
                          <span className="cw-initial">{item.initial}</span>
                          {item.stepLabel && (
                            <button
                              className="cw-step-chip"
                              onClick={() => setSelectedStep(item.stepKey)}
                            >{item.stepLabel.toUpperCase()}</button>
                          )}
                        </div>
                        <span className="cw-note-body">{item.body}</span>
                        <div className="cw-note-footer">
                          <span className="cw-mono cw-faint3">{item.when}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="cw-event-row">
                        <span className="cw-event-title">{item.title}</span>
                        {item.body && <span className="cw-event-body">{item.body}</span>}
                        <span className="cw-mono cw-faint3">
                          {item.when}
                          {item.providerMessageId && (
                            <> · <a href={`https://resend.com/emails/${item.providerMessageId}`} target="_blank" rel="noreferrer">View email ↗</a></>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {stream.length === 0 && <p className="cw-empty-note">No activity yet.</p>}
          </div>
        </aside>
      </div>

      {/* ── Footer drawer ────────────────────────────────────────────────────── */}
      <div className="cw-footer">
        <button className="cw-footer-toggle" onClick={() => setFooterOpen((o) => !o)}>
          <span className="cw-rail-label">CASE FILE</span>
          <span className="cw-footer-summary">
            {REQUIRED_GRANT_DOCUMENTS.filter(([type]) => docFor(detail, type)).length}/{REQUIRED_GRANT_DOCUMENTS.length} docs ready
            {detail.payments?.[detail.payments.length - 1]?.status === 'paid' ? ' · Paid' : ''}
          </span>
          <span className="cw-footer-chevron">{footerOpen ? '▾' : '▴'}</span>
        </button>

        {footerOpen && (
          <div className="cw-footer-body">
            <div className="cw-footer-tabs">
              {['docs', 'applicant'].map((t) => (
                <button
                  key={t}
                  className={`cw-footer-tab${footerTab === t ? ' cw-footer-tab-active' : ''}`}
                  onClick={() => setFooterTab(t)}
                >
                  {t === 'docs' ? 'Documents' : 'Application'}
                </button>
              ))}
            </div>

            <div className="cw-footer-panel">
              {footerTab === 'docs' && (
                <div className="cw-docs-tab-body">
                  <div className="cw-docs-grid">
                    {REQUIRED_GRANT_DOCUMENTS.map(([type, label]) => {
                      const doc = docFor(detail, type);
                      return (
                        <div key={type} className="cw-doc-tile" onClick={() => doc && previewDocument(doc)}>
                          <div className="cw-doc-thumb">
                            {doc ? <DocThumbnail doc={doc} applicationId={app.id} onClick={() => previewDocument(doc)} /> : <span className="cw-doc-missing">—</span>}
                          </div>
                          <div className="cw-doc-info">
                            <span className="cw-doc-label">{label}</span>
                            <span className="cw-mono cw-faint2">{doc ? doc.filename : 'nothing on file'}</span>
                            <span className={`cw-doc-status ${doc ? 'ok' : 'missing'}`}>{doc ? 'ON FILE' : 'MISSING'}</span>
                          </div>
                        </div>
                      );
                    })}
                    {/* Tax clearance issue screenshots — supplemental, shown when present */}
                    {[...(detail.documents || [])].filter((d) => d.document_type === 'tax_clearance_issue').map((doc) => (
                      <div key={doc.id} className="cw-doc-tile" onClick={() => previewDocument(doc)}>
                        <div className="cw-doc-thumb">
                          <DocThumbnail doc={doc} applicationId={app.id} onClick={() => previewDocument(doc)} />
                        </div>
                        <div className="cw-doc-info">
                          <span className="cw-doc-label">TC Issue Screenshot</span>
                          <span className="cw-mono cw-faint2">{doc.filename}</span>
                          <span className="cw-doc-status warn">ISSUE</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* ── Upload ── */}
                  <div className="cw-footer-upload">
                    <span className="cw-rail-label">UPLOAD</span>
                    <select value={manualDocType} onChange={(e) => setManualDocType(e.target.value)}>
                      <option value="formation">Certificate of Formation</option>
                      <option value="brc">Business Registration Certificate</option>
                      <option value="uez_pending_certification">UEZ Pending Certification</option>
                      <option value="uez_approval_email">UEZ Approval Email</option>
                      <option value="tax_clearance">Tax Clearance Letter</option>
                      <option value="tax_clearance_issue">Tax Clearance Issue Screenshot</option>
                      <option value="ldc_application">Signed LDC Application</option>
                      <option value="supporting">Other / Supporting</option>
                    </select>
                    <label className="cw-footer-file-label">
                      {manualDocFile ? manualDocFile.name : 'Choose file…'}
                      <input type="file" accept=".pdf,.eml,image/*" style={{ display: 'none' }} onChange={(e) => setManualDocFile(e.target.files?.[0] || null)} />
                    </label>
                    <button
                      className="secondary"
                      onClick={uploadManualAdminDocument}
                      disabled={manualDocUploading || !manualDocFile}
                    >
                      {manualDocUploading ? 'Uploading…' : 'Upload'}
                    </button>
                  </div>
                </div>
              )}

              {footerTab === 'applicant' && (
                <div className="cw-applicant-view">
                  {/* ── Edit / Save / Cancel / Delete row ── */}
                  <div className="cw-app-edit-bar">
                    {editMode ? (
                      <>
                        <button className="primary" onClick={saveAdminEdits}>{busy ? 'Saving…' : 'Save all changes'}</button>
                        <button className="secondary" onClick={cancelEditing}>Cancel</button>
                      </>
                    ) : (
                      <button className="secondary" onClick={() => { startEditing(); setFooterOpen(true); setFooterTab('applicant'); }}>Edit application</button>
                    )}
                    <button className="admin-delete-button" onClick={deleteApplication}>Delete application</button>
                  </div>

                  {/* ── Business (reuses the existing editable card) ── */}
                  <BusinessDetailsCard
                    application={app}
                    editMode={editMode}
                    draft={applicationDraft}
                    onChangeField={updateApplicationDraft}
                  />

                  {/* ── Owners (reuses the existing editable card) ── */}
                  <OwnersCard
                    owners={detail.owners || []}
                    editMode={editMode}
                    ownerDrafts={ownerDrafts}
                    onChangeOwnerField={updateOwnerDraft}
                    onAddOwner={addOwner}
                    onRemoveOwner={removeOwner}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// One document container for a step panel: the inline preview plus a direct
// upload button and (when more than one document of this type exists) a note
// that there's a stack to browse — clicking the preview opens the modal,
// which has its own prev/next + delete controls (see AdminPage.jsx).
function DocSlot({ label, doc, docType, gallery, app, previewDocument, uploadDocumentDirect, directUploadType }) {
  const uploading = directUploadType === docType;
  return (
    <div className="cw-doc-col">
      <span className="cw-field-label cw-mono">{label}</span>
      <DocThumbnail doc={doc} applicationId={app.id} onClick={() => doc && previewDocument(doc)} variant="inline" />
      {gallery.length > 1 && <small className="cw-doc-count-note">{gallery.length} uploaded — open to browse</small>}
      <label className={`cw-doc-upload-btn${uploading ? ' disabled' : ''}`}>
        {uploading ? 'Uploading…' : doc ? 'Replace / add another' : 'Upload'}
        <input
          type="file"
          accept=".pdf,image/*"
          disabled={uploading}
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) uploadDocumentDirect(docType, file); }}
        />
      </label>
    </div>
  );
}

// StepPanel — renders the focused step's full content
// ═══════════════════════════════════════════════════════════════════════════════
function StepPanel({
  stepKey, stepIdx, detail, busy,
  myNjCredentials, brcForm, setBrcForm,
  paymentDraft, setPaymentDraft,
  pbsAnswerDraft, pbsLoginDraft, setPbsLoginDraft,
  myNjEditMode, myNjDraft, setMyNjDraft, showMyNjSecrets,
  previewDocument, reviewFormationDoc, sendFormationRejectedEmail,
  runBrcLookup, sendBrcProblemEmail, sendBrcWrongAddressEmail,
  markPbsAccountCreated, setProcessFlag, runPbsSignup, sendPbsAccountCreatedEmail, sendPbsExistingAccountEmail,
  runTaxClearance, sendTaxIssueEmail, sendUezApplicationSubmittedEmail,
  runLdcJotform, runUezEnrollment, runningJob, requestPayment, confirmPayment, sendPaymentRequestedEmail, sendPaymentReceivedEmail,
  runLakewoodGrantPortal, confirmGrantSubmitted, sendGrantSubmittedEmail,
  changePbsAnswerDraft, saveExistingPbsAnswer, saveMyNjCredentials,
  startMyNjEdit, cancelMyNjEdit, toggleShowMyNjSecrets, copyCredential, createMyNjCredentials,
  saveBrcFound, saveBrcNotFound, saveProcessStep, resetProcessStep,
  uploadDocumentDirect, directUploadType,
  prevLabel, nextLabel, onPrev, onNext,
}) {
  const app = detail.application;
  const step = resolveProcessStep(stepKey, detail);
  const docType = STEP_DOC_TYPE[stepKey];
  const doc = docType ? docFor(detail, docType) : null;

  // "Set by" line
  const setByLine = step.source === 'explicit'
    ? `Set by ${step.updatedByName || 'admin'} · ${step.updatedAt ? formatTimestamp(step.updatedAt) : ''}`
    : step.source === 'ldc'
    ? `LDC board approved${app.ldc_board_meeting_date ? ` at the ${app.ldc_board_meeting_date} meeting` : ''} · recorded ${formatTimestamp(step.updatedAt)} · fee non-refundable`
    : '(auto)';

  // Alert content per step
  const alert = stepAlert(stepKey, detail, step);
  const currentOption = stepStateOption(stepKey, step, detail);

  return (
    <div className="cw-step-panel">
      {/* Header */}
      <div className="cw-step-header">
        <div className="cw-step-title-row">
          <h2 className="cw-step-title">{PROCESS_STEP_TITLES[stepKey]}</h2>
          <span className="cw-step-pill" style={pillStyle(currentOption.state)}>
            {currentOption.label}
          </span>
        </div>
        <div className="cw-step-meta">
          <span className="cw-mono cw-faint3">STEP {stepIdx + 1} OF 8 · </span>
          <span className="cw-step-setby">{setByLine}</span>
        </div>
        {/* State selector chips */}
        <div className="cw-state-chips">
          {(STEP_STATE_OPTIONS[stepKey] || [])
            .map(({ state: s, label }) => {
            const st = stateStyle(s);
            const active = currentOption.state === s;
            return (
              <button
                key={s}
                type="button"
                className={`cw-state-chip${active ? ' cw-state-chip-active' : ''}`}
                style={active ? { background: st.bg, border: `1px solid ${st.border}`, color: st.fg } : undefined}
                onClick={() => saveProcessStep(stepKey, { state: s, waitingOn: null, waitingSince: null, waitingReason: null, manualNote: step.manualNote || null })}
               
              >
                {label}
              </button>
            );
          })}
          {step.source === 'explicit' && (
            <button className="cw-state-chip cw-reset-chip" onClick={() => resetProcessStep(stepKey)}>
              Reset to auto
            </button>
          )}
        </div>
      </div>

      {/* Alert block */}
      {alert && (
        <div className="cw-alert-block">
          <span className="cw-alert-title">{alert.title}</span>
          <span className="cw-alert-body">{alert.body}</span>
        </div>
      )}

      {/* Doc tile + fields */}
      <div className="cw-doc-fields-grid">
        {stepKey === 'uez_enrollment' ? (
          <>
            <DocSlot
              label="UEZ PENDING CERT" docType="uez_pending_certification"
              doc={docFor(detail, 'uez_pending_certification')} gallery={docsFor(detail, 'uez_pending_certification')}
              app={app} previewDocument={previewDocument}
              uploadDocumentDirect={uploadDocumentDirect} directUploadType={directUploadType}
            />
            <DocSlot
              label="UEZ APPROVAL EMAIL" docType="uez_approval_email"
              doc={doc} gallery={docsFor(detail, 'uez_approval_email')}
              app={app} previewDocument={previewDocument}
              uploadDocumentDirect={uploadDocumentDirect} directUploadType={directUploadType}
            />
          </>
        ) : stepKey === 'tax_clearance' ? (
          <>
            <DocSlot
              label="TAX CLEARANCE" docType="tax_clearance"
              doc={doc} gallery={docsFor(detail, 'tax_clearance')}
              app={app} previewDocument={previewDocument}
              uploadDocumentDirect={uploadDocumentDirect} directUploadType={directUploadType}
            />
            {/* Only shown once NJ has actually reported an issue — most
                applications never have one of these. */}
            {docFor(detail, 'tax_clearance_issue') && (
              <DocSlot
                label="TC ISSUE SCREENSHOT" docType="tax_clearance_issue"
                doc={docFor(detail, 'tax_clearance_issue')} gallery={docsFor(detail, 'tax_clearance_issue')}
                app={app} previewDocument={previewDocument}
                uploadDocumentDirect={uploadDocumentDirect} directUploadType={directUploadType}
              />
            )}
          </>
        ) : docType && (
          <DocSlot
            label="DOCUMENT" docType={docType}
            doc={doc} gallery={docsFor(detail, docType)}
            app={app} previewDocument={previewDocument}
            uploadDocumentDirect={uploadDocumentDirect} directUploadType={directUploadType}
          />
        )}

        <div className="cw-fields-col">
          <StepFields
            stepKey={stepKey} detail={detail} busy={busy}
            myNjCredentials={myNjCredentials}
            brcForm={brcForm} setBrcForm={setBrcForm}
            paymentDraft={paymentDraft} setPaymentDraft={setPaymentDraft}
            pbsAnswerDraft={pbsAnswerDraft}
            pbsLoginDraft={pbsLoginDraft} setPbsLoginDraft={setPbsLoginDraft}
            myNjEditMode={myNjEditMode} myNjDraft={myNjDraft} setMyNjDraft={setMyNjDraft}
            showMyNjSecrets={showMyNjSecrets}
            copyCredential={copyCredential}
            saveMyNjCredentials={saveMyNjCredentials}
            cancelMyNjEdit={cancelMyNjEdit}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="cw-actions-section">
        <span className="cw-field-label cw-mono">ACTIONS</span>
        <div className="cw-actions-row">
          <StepActions
            stepKey={stepKey} detail={detail} busy={busy}
            myNjCredentials={myNjCredentials} step={step}
            saveProcessStep={saveProcessStep}
            reviewFormationDoc={reviewFormationDoc}
            sendFormationRejectedEmail={sendFormationRejectedEmail}
            runBrcLookup={runBrcLookup}
            sendBrcProblemEmail={sendBrcProblemEmail}
            sendBrcWrongAddressEmail={sendBrcWrongAddressEmail}
            markPbsAccountCreated={markPbsAccountCreated}
            setProcessFlag={setProcessFlag}
            runPbsSignup={runPbsSignup}
            sendPbsAccountCreatedEmail={sendPbsAccountCreatedEmail}
            sendPbsExistingAccountEmail={sendPbsExistingAccountEmail}
            runTaxClearance={runTaxClearance}
            sendTaxIssueEmail={sendTaxIssueEmail}
            sendUezApplicationSubmittedEmail={sendUezApplicationSubmittedEmail}
            runLdcJotform={runLdcJotform}
            runUezEnrollment={runUezEnrollment}
            runningJob={runningJob}
            requestPayment={requestPayment}
            confirmPayment={confirmPayment}
            sendPaymentRequestedEmail={sendPaymentRequestedEmail}
            sendPaymentReceivedEmail={sendPaymentReceivedEmail}
            runLakewoodGrantPortal={runLakewoodGrantPortal}
            confirmGrantSubmitted={confirmGrantSubmitted}
            sendGrantSubmittedEmail={sendGrantSubmittedEmail}
            changePbsAnswerDraft={changePbsAnswerDraft}
            saveExistingPbsAnswer={saveExistingPbsAnswer}
            saveMyNjCredentials={saveMyNjCredentials}
            startMyNjEdit={startMyNjEdit}
            cancelMyNjEdit={cancelMyNjEdit}
            createMyNjCredentials={createMyNjCredentials}
            saveBrcFound={saveBrcFound}
            saveBrcNotFound={saveBrcNotFound}
          />
        </div>
      </div>

      {/* Prev / Next nav */}
      <div className="cw-step-nav">
        {prevLabel
          ? <button className="cw-step-nav-btn" onClick={onPrev}>← {prevLabel}</button>
          : <span />}
        {nextLabel
          ? <button className="cw-step-nav-btn" onClick={onNext}>{nextLabel} →</button>
          : <span />}
      </div>
    </div>
  );
}

// ── Pill style helper ─────────────────────────────────────────────────────────
function pillStyle(state) {
  const st = stateStyle(state);
  return { background: st.bg, color: st.fg };
}

// ── Per-step alert ────────────────────────────────────────────────────────────
function stepAlert(stepKey, detail, step) {
  const app = detail.application;
  switch (stepKey) {
    case 'formation': {
      const review = app.formation_review_status || 'not_reviewed';
      if (review === 'rejected') return { title: 'Wrong document', body: 'Applicant submitted the wrong document. Send the replacement request email, then wait for re-upload.' };
      const doc = docFor(detail, 'formation');
      if (!doc && !app.is_sole_proprietorship) return { title: 'Document missing', body: "Applicant hasn't uploaded the Certificate of Formation yet. Common mistake: they may upload the IRS FEIN letter (SS-4) by mistake." };
      if (doc && review === 'not_reviewed') return { title: 'Needs review', body: 'Review the document — approve it or mark it as the wrong type.' };
      return null;
    }
    case 'brc':
      if (app.brc_status === 'not_found') return { title: 'BRC not found', body: 'The NJ state registry did not return a match. Follow up with the applicant or retry after the business registers.' };
      if (app.brc_status === 'lookup_error') return { title: 'Lookup error', body: 'An error occurred during the BRC lookup. Retry or resolve manually.' };
      return null;
    case 'tax_clearance': {
      const tc = app.tax_clearance_status || (app.tax_clearance_good ? 'good' : 'no');
      if (tc === 'issue') return { title: 'Tax clearance issue', body: 'The state returned an issue. Resolve with the applicant before proceeding.' };
      return null;
    }
    case 'uez_enrollment': {
      const review = app.uez_approval_review_status || 'not_reviewed';
      if (review === 'rejected') return { title: 'Approval email wrong', body: 'The uploaded UEZ approval email was marked wrong. Request a replacement.' };
      return null;
    }
    case 'grant_submission':
      if (grantSubmissionLikelyDetected(detail)) return { title: 'Possible submission detected', body: 'The extension detected activity that may indicate the grant was submitted. Confirm or dismiss below.' };
      if (!packetReady(detail)) return { title: 'Packet not ready', body: 'All 5 required documents must be ready before submitting the grant.' };
      return null;
    default:
      return null;
  }
}

// ── Step-specific fields ──────────────────────────────────────────────────────
function StepFields({
  stepKey, detail, busy,
  myNjCredentials, brcForm, setBrcForm,
  paymentDraft, setPaymentDraft,
  pbsAnswerDraft, pbsLoginDraft, setPbsLoginDraft,
  myNjEditMode, myNjDraft, setMyNjDraft, showMyNjSecrets,
  copyCredential, saveMyNjCredentials, cancelMyNjEdit,
}) {
  const app = detail.application;

  switch (stepKey) {
    case 'formation': {
      const review = app.formation_review_status || 'not_reviewed';
      return (
        <div className="cw-fields">
          <span className="cw-field-label">Review status</span>
          <span className="cw-field-label">Sole proprietorship</span>
          <span className={`cw-field-value cw-review-${review}`}>
            {review === 'approved' ? '✓ Approved' : review === 'rejected' ? '⚠ Wrong document' : 'Not reviewed'}
          </span>
          <span className="cw-field-value">{app.is_sole_proprietorship ? 'Yes — CoF not required' : 'No'}</span>
        </div>
      );
    }

    case 'brc':
      return (
        <div className="cw-fields cw-fields-col1">
          <FieldPair label="Registered business name" value={brcForm.registeredBusinessName}
            onChange={(v) => setBrcForm((f) => ({ ...f, registeredBusinessName: v }))} />
          <FieldPair label="Trade name / DBA" value={brcForm.tradeName}
            onChange={(v) => setBrcForm((f) => ({ ...f, tradeName: v }))} />
          <FieldPair label="Address" value={brcForm.address}
            onChange={(v) => setBrcForm((f) => ({ ...f, address: v }))} />
          <span className="cw-field-label">BRC status</span>
          <span className="cw-field-value">{app.brc_status || '—'}</span>
        </div>
      );

    case 'pbs_mynj':
      if (myNjEditMode && myNjDraft) {
        return (
          <div className="cw-fields cw-fields-col1">
            <FieldPair label="MyNJ username" value={myNjDraft.username || ''}
              onChange={(v) => setMyNjDraft((d) => ({ ...d, username: v }))} />
            <FieldPair label="MyNJ password" value={myNjDraft.password || ''}
              onChange={(v) => setMyNjDraft((d) => ({ ...d, password: v }))} />
            <FieldPair label="Challenge question" value={myNjDraft.challengeQuestion || ''}
              onChange={(v) => setMyNjDraft((d) => ({ ...d, challengeQuestion: v }))} />
            <FieldPair label="Challenge answer" value={myNjDraft.challengeAnswer || ''}
              onChange={(v) => setMyNjDraft((d) => ({ ...d, challengeAnswer: v }))} />
            {/* Save/Cancel live right next to the fields they apply to —
                the step's own Actions row (further down the page) also has
                a copy, but editing and saving should not require a scroll. */}
            <div className="cw-action-btn-row">
              <button type="button" className="cw-action-btn cw-action-ok" onClick={saveMyNjCredentials}>💾 Save credentials</button>
              <button type="button" className="cw-action-btn cw-action-secondary" onClick={cancelMyNjEdit}>Cancel</button>
            </div>
          </div>
        );
      }
      return (
        <div className="cw-fields cw-fields-col1">
          <span className="cw-field-label">PBS account created</span>
          <span className="cw-field-value">{app.pbs_account_created ? '✓ Yes' : 'Not yet'}</span>
          {myNjCredentials ? (
            <>
              <span className="cw-field-label">MyNJ username</span>
              <span className="cw-field-value cw-mono">
                {myNjCredentials.username}
                <button className="cw-copy-btn" onClick={() => copyCredential(myNjCredentials.username, 'Username')}>Copy</button>
              </span>
              <span className="cw-field-label">MyNJ password</span>
              <span className="cw-field-value cw-mono">
                {myNjCredentials.password}
                <button className="cw-copy-btn" onClick={() => copyCredential(myNjCredentials.password, 'Password')}>Copy</button>
              </span>
              <span className="cw-field-label">Challenge question</span>
              <span className="cw-field-value cw-mono">
                {myNjCredentials.challengeQuestion}
                <button className="cw-copy-btn" onClick={() => copyCredential(myNjCredentials.challengeQuestion, 'Challenge question')}>Copy</button>
              </span>
              <span className="cw-field-label">Challenge answer</span>
              <span className="cw-field-value cw-mono">
                {myNjCredentials.challengeAnswer}
                <button className="cw-copy-btn" onClick={() => copyCredential(myNjCredentials.challengeAnswer, 'Challenge answer')}>Copy</button>
              </span>
            </>
          ) : (
            <>
              <span className="cw-field-label">MyNJ credentials</span>
              <span className="cw-field-value">— not generated yet</span>
            </>
          )}
        </div>
      );

    case 'tax_clearance': {
      const tc = app.tax_clearance_status || (app.tax_clearance_good ? 'good' : 'no');
      return (
        <div className="cw-fields">
          <span className="cw-field-label">Tax clearance status</span>
          <span className="cw-field-label">Recheck requested</span>
          <span className={`cw-field-value cw-tc-${tc}`}>
            {tc === 'good' ? '✓ Good' : tc === 'issue' ? '⚠ Issue' : 'Not cleared'}
          </span>
          <span className="cw-field-value">{app.tax_clearance_recheck_requested_at ? formatTimestamp(app.tax_clearance_recheck_requested_at) : '—'}</span>
        </div>
      );
    }

    case 'uez_enrollment': {
      const review = app.uez_approval_review_status || 'not_reviewed';
      return (
        <div className="cw-fields">
          <span className="cw-field-label">UEZ application status</span>
          <span className="cw-field-label">Approval email review</span>
          <span className="cw-field-value">{app.uez_application_status || '—'}</span>
          <span className={`cw-field-value cw-review-${review}`}>
            {review === 'approved' ? '✓ Approved' : review === 'rejected' ? '⚠ Wrong doc' : 'Not reviewed'}
          </span>
        </div>
      );
    }

    case 'payment': {
      const latest = [...(detail.payments || [])].reverse()[0];
      // Until it's recorded, the details "Confirm payment received" will save
      // are editable right here (prefilled $500 / Zelle / today).
      if (latest?.status !== 'paid') {
        return (
          <div className="cw-fields cw-fields-col1">
            <FieldPair label="Amount ($)" value={paymentDraft.amount}
              onChange={(v) => setPaymentDraft((d) => ({ ...d, amount: v }))} />
            <span className="cw-field-label">Method</span>
            <select className="cw-field-input" value={paymentDraft.paymentMethod}
              onChange={(e) => setPaymentDraft((d) => ({ ...d, paymentMethod: e.target.value }))}>
              {['Zelle', 'Check', 'Cash', 'Card', 'Other'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="cw-field-label">Date</span>
            <input className="cw-field-input" type="date" value={paymentDraft.paymentDate}
              onChange={(e) => setPaymentDraft((d) => ({ ...d, paymentDate: e.target.value }))} />
            <FieldPair label="Reference" value={paymentDraft.reference}
              onChange={(v) => setPaymentDraft((d) => ({ ...d, reference: v }))} />
            <span className="cw-field-label">Status</span>
            <span className="cw-field-value">{paymentStatusLabel(latest?.status)}</span>
          </div>
        );
      }
      return (
        <div className="cw-fields">
          <span className="cw-field-label">Amount</span>
          <span className="cw-field-label">Method</span>
          <span className="cw-field-value">{latest ? `$${latest.amount}` : `$${paymentDraft.amount} (expected)`}</span>
          <span className="cw-field-value">{latest?.payment_method || paymentDraft.paymentMethod}</span>
          <span className="cw-field-label">Date</span>
          <span className="cw-field-label">Status</span>
          <span className="cw-field-value">{latest?.payment_date || '—'}</span>
          <span className="cw-field-value">{paymentStatusLabel(latest?.status)}</span>
        </div>
      );
    }

    case 'grant_submission': {
      const submitted = app.status === 'applied' || app.status === 'grant_submitted';
      return (
        <div className="cw-fields">
          <span className="cw-field-label">Grant status</span>
          <span className="cw-field-label">Packet complete</span>
          <span className="cw-field-value">{submitted ? '✓ Submitted' : '—'}</span>
          <span className="cw-field-value">{packetReady(detail) ? '✓ Ready' : 'Not ready'}</span>
        </div>
      );
    }

    case 'ldc_application':
      return (
        <div className="cw-fields">
          <span className="cw-field-label">LDC form</span>
          <span className="cw-field-value">{docFor(detail, 'ldc_application') ? '✓ Uploaded' : 'Not uploaded'}</span>
        </div>
      );

    default:
      return null;
  }
}

function FieldPair({ label, value, onChange, disabled }) {
  return (
    <>
      <span className="cw-field-label">{label}</span>
      <input
        className="cw-field-input"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </>
  );
}

// ── Step-specific action buttons ──────────────────────────────────────────────
function StepActions({
  stepKey, detail, busy, myNjCredentials, myNjEditMode, step,
  saveProcessStep,
  reviewFormationDoc, sendFormationRejectedEmail,
  runBrcLookup, sendBrcProblemEmail, sendBrcWrongAddressEmail,
  markPbsAccountCreated, setProcessFlag, runPbsSignup, sendPbsAccountCreatedEmail, sendPbsExistingAccountEmail,
  runTaxClearance, sendTaxIssueEmail, sendUezApplicationSubmittedEmail,
  runLdcJotform, runUezEnrollment, runningJob, requestPayment, confirmPayment, sendPaymentRequestedEmail, sendPaymentReceivedEmail,
  runLakewoodGrantPortal, confirmGrantSubmitted, sendGrantSubmittedEmail,
  changePbsAnswerDraft, saveExistingPbsAnswer, saveMyNjCredentials,
  startMyNjEdit, cancelMyNjEdit, createMyNjCredentials,
  saveBrcFound, saveBrcNotFound,
}) {
  const app = detail.application;

  const Btn = ({ label, onClick, variant = 'default', disabled: dis }) => (
    <button
      type="button"
      className={`cw-action-btn cw-action-${variant}`}
      onClick={onClick}
      disabled={dis}
    >{label}</button>
  );

  switch (stepKey) {
    case 'formation': {
      const lastSent = lastEmailSent(detail, 'formation_rejected');
      const cofState = step?.state;
      const saveStep = (state) => saveProcessStep('formation', { state, waitingOn: null, waitingSince: null, waitingReason: null, manualNote: step?.manualNote || null });
      return (
        <>
          <Btn label="✓ Approve CoF" variant="ok"
            onClick={() => { reviewFormationDoc('approved'); saveStep('complete'); }} />
          <Btn label="✗ Not approved" variant="danger"
            onClick={() => { reviewFormationDoc('rejected'); saveStep('cancelled'); }} />
          {(cofState === 'cancelled' || cofState === 'manual') && (
            <Btn
              label={`✉ Send replacement request${lastSent ? ' (resend)' : ''}`}
              onClick={() => sendFormationRejectedEmail(() => saveStep('waiting'))}
            />
          )}
        </>
      );
    }

    case 'brc': {
      const brcState = step?.state;
      const saveStep = (state) => saveProcessStep('brc', { state, waitingOn: null, waitingSince: null, waitingReason: null, manualNote: step?.manualNote || null });
      return (
        <>
          <Btn label="🔍 Fetch BRC" onClick={runBrcLookup} />
          <Btn label="✓ Save BRC found" variant="ok"
            onClick={() => { saveBrcFound(); saveStep('complete'); }}
            disabled={!brcFormHasData(detail)} />
          {brcState !== 'complete' && (
            <Btn label="Mark not found"
              onClick={() => { saveBrcNotFound(); saveStep('waiting'); }} />
          )}
          {brcState !== 'complete' && (
            <Btn label="✉ Send BRC problem email"
              onClick={() => sendBrcProblemEmail(() => saveStep('waiting'))} />
          )}
          {brcState !== 'complete' && (
            <Btn label="✉ Send wrong address email"
              onClick={() => sendBrcWrongAddressEmail(() => saveStep('waiting'))} />
          )}
        </>
      );
    }

    case 'pbs_mynj': {
      const pbsState = step?.state;
      const saveStep = (state) => saveProcessStep('pbs_mynj', { state, waitingOn: null, waitingSince: null, waitingReason: null, manualNote: step?.manualNote || null });
      return (
        <>
          {/* MyNJ credentials — always available */}
          {!myNjCredentials && <Btn label="Generate MyNJ credentials" onClick={createMyNjCredentials} variant="ok" />}
          {myNjCredentials && !myNjEditMode && <Btn label="Edit MyNJ credentials" onClick={startMyNjEdit} />}
          {myNjEditMode && <Btn label="💾 Save credentials" onClick={saveMyNjCredentials} variant="ok" />}
          {myNjEditMode && <Btn label="Cancel" onClick={cancelMyNjEdit} />}

          {/* PBS setup — available when not complete */}
          {pbsState !== 'complete' && (
            <Btn label="▶ Run PBS setup" onClick={runPbsSignup}
              disabled={!!pbsAccountGateReason(detail, myNjCredentials)} />
          )}

          {/* Existing account path: mark waiting + manually email applicant for creds */}
          {pbsState !== 'complete' && (
            <Btn label={pbsState === 'waiting' ? '✉ Email: already has PBS account (resend)' : '✉ Email: already has PBS account'}
              onClick={() => sendPbsExistingAccountEmail(() => saveStep('waiting'))} />
          )}

          {/* Applicant provided creds — confirm business added */}
          {pbsState === 'waiting' && (
            <Btn label="✓ Creds received — confirm business added" variant="ok"
              onClick={() => saveStep('manual')} />
          )}

          {/* Final confirmation */}
          {pbsState === 'manual' && (
            <Btn label="✓ Business added — Mark complete" variant="ok"
              onClick={() => { markPbsAccountCreated(); saveStep('complete'); }} />
          )}

          {/* New PBS account path: direct complete */}
          {pbsState !== 'complete' && pbsState !== 'waiting' && pbsState !== 'manual' && (
            <Btn label="✓ PBS created — Mark complete" variant="ok"
              onClick={() => { markPbsAccountCreated(); saveStep('complete'); }} />
          )}

          {/* Post-complete */}
          {pbsState === 'complete' && (
            <Btn label="✉ Send PBS account created email" onClick={sendPbsAccountCreatedEmail} />
          )}
        </>
      );
    }

    case 'tax_clearance':
      return (
        <>
          <Btn label="🔍 Run tax clearance" onClick={runTaxClearance} />
          <Btn label="✉ Send TC issue email" onClick={sendTaxIssueEmail} />
        </>
      );

    case 'uez_enrollment':
      return (
        <>
          <Btn label="▶ Open UEZ application" onClick={runUezEnrollment} variant="ok" disabled={!!runningJob} />
          <Btn label="✉ Send UEZ submitted email" onClick={sendUezApplicationSubmittedEmail} />
        </>
      );

    case 'ldc_application':
      return (
        <>
          <Btn label="📋 Fill out LDC form" onClick={runLdcJotform} />
        </>
      );

    case 'payment': {
      const latest = [...(detail.payments || [])].reverse()[0];
      const paymentEmailSent = lastEmailSent(detail, 'payment_requested');
      return (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Btn label={`✉ Request payment${paymentEmailSent ? ' (resend)' : ''}`} onClick={requestPayment} />
            {paymentEmailSent?.providerMessageId && (
              <a href={`https://resend.com/emails/${paymentEmailSent.providerMessageId}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>View email ↗</a>
            )}
          </div>
          {latest?.status !== 'paid' && <Btn label="Confirm payment received" onClick={confirmPayment} variant="ok" />}
          {latest?.status === 'paid' && <Btn label="✉ Send payment received email" onClick={sendPaymentReceivedEmail} />}
        </>
      );
    }

    case 'grant_submission':
      return (
        <>
          <Btn
            label="🚀 Submit to Lakewood grant portal"
            onClick={runLakewoodGrantPortal}
            variant="ok"
            disabled={!!grantSubmitGateReason(detail)}
          />
          {grantSubmissionLikelyDetected(detail) && (
            <Btn label="✓ Confirm grant submitted" onClick={confirmGrantSubmitted} />
          )}
          {(app.status === 'applied' || app.status === 'grant_submitted') && (
            <Btn label="✉ Send grant submitted email" onClick={sendGrantSubmittedEmail} />
          )}
        </>
      );

    default:
      return null;
  }
}

function brcFormHasData(detail) {
  const app = detail.application;
  return !!(app.brc_registered_name || app.registered_business_name || app.business_name_input);
}
