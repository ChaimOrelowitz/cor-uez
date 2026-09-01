import React, { useEffect, useRef, useState } from 'react';
import {
  adminQueueInfo,
  docFor,
  formatTimestamp,
  grantSubmissionLikelyDetected,
  grantSubmitGateReason,
  lastEmailSent,
  packetReady,
  paymentStatusLabel,
  pbsAccountGateReason,
  PROCESS_STEP_KEYS,
  PROCESS_STEP_STATE_LABELS,
  PROCESS_STEP_STATES,
  PROCESS_STEP_TITLES,
  REQUIRED_GRANT_DOCUMENTS,
  resolveProcessStep,
} from './caseLogic';
import DocThumbnail from './DocThumbnail';
// Legacy view components (still used in the footer drawer's Legacy tab)
import ActivityPanel from './ActivityPanel';
import BrcDetailsCard from './BrcDetailsCard';
import BusinessDetailsCard from './BusinessDetailsCard';
import DocumentsPanel from './DocumentsPanel';
import MyNjPbsCard from './MyNjPbsCard';
import NotesPanel from './NotesPanel';
import OwnersCard from './OwnersCard';
import PaymentCard from './PaymentCard';
import ProcessStepCard from './ProcessStepCard';

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
function stateStyle(state) {
  switch (state) {
    case 'complete':        return { bg: '#1a2c1e', border: '#2d5035', fg: '#57c98a' };
    case 'in_progress':     return { bg: '#182030', border: '#2a3a54', fg: '#6f9fd8' };
    case 'waiting':         return { bg: '#2a1f08', border: '#4a3610', fg: '#e0a23c' };
    case 'not_applicable':  return { bg: '#1a1c20', border: '#2c3038', fg: '#6f7883' };
    case 'manual':          return { bg: '#1e1a28', border: '#352d44', fg: '#a08cd8' };
    case 'cancelled':       return { bg: '#261519', border: '#3d2228', fg: '#c0726a' };
    default:                return { bg: '#181b1f', border: '#262c34', fg: '#6f7883' };
  }
}

// ── Segment bar colour ────────────────────────────────────────────────────────
function segBarColor(state) {
  switch (state) {
    case 'complete':       return '#57c98a';
    case 'in_progress':   return '#6f9fd8';
    case 'waiting':       return '#e0a23c';
    case 'not_applicable':return '#2a3038';
    default:              return '#2a3038';
  }
}

// ── Activity stream helpers ───────────────────────────────────────────────────
function buildStream(detail) {
  const notes = (detail.notes || []).map((n) => ({
    id: `note-${n.id}`,
    kind: 'note',
    body: n.body,
    authorName: n.author_name || 'COR',
    initial: (n.author_name || 'C').charAt(0).toUpperCase(),
    when: formatTimestamp(n.created_at),
    ts: new Date(n.created_at).getTime(),
    noteId: n.id,
    updatedAt: n.updated_at,
    isPinned: n.is_pinned,
  }));

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
  runTaxClearance,
  sendTaxIssueEmail,
  sendUezApplicationSubmittedEmail,
  runLdcJotform,
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
  updateApplicationDraft,
  updateOwnerDraft,
  addOwner,
  removeOwner,
  saveBrcFound,
  saveBrcNotFound,
  saveProcessStep,
  resetProcessStep,
  sendGrantSubmittedEmail,
}) {
  const app = detail.application;
  const defaultStep = adminQueueInfo(app).stepKey || PROCESS_STEP_KEYS[0];

  const [selectedStep, setSelectedStep] = useState(defaultStep);
  const [footerOpen, setFooterOpen] = useState(false);
  const [footerTab, setFooterTab] = useState('docs');
  const [noteDraftLocal, setNoteDraftLocal] = useState('');
  const [pinnedNoteId, setPinnedNoteId] = useState(null);
  const stepPanelRef = useRef(null);
  const savingNoteRef = useRef(false);

  // Reset when application changes
  useEffect(() => {
    const next = adminQueueInfo(detail.application).stepKey || PROCESS_STEP_KEYS[0];
    setSelectedStep(next);
    setFooterOpen(false);
    setPinnedNoteId(null);
  }, [detail.application.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll step panel to top on step change
  useEffect(() => {
    if (stepPanelRef.current) stepPanelRef.current.scrollTop = 0;
  }, [selectedStep]);

  const stream = buildStream(detail);
  const pinnedItem = stream.find((s) => s.noteId === pinnedNoteId || s.id === `note-${pinnedNoteId}`);

  async function saveNote() {
    const body = noteDraftLocal.trim();
    if (!body || savingNoteRef.current) return;
    savingNoteRef.current = true;
    try {
      await addCaseNote(body);
      setNoteDraftLocal(''); // clear only on success
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
              <span className="cw-seg-bar" style={{ background: active ? segBarColor(step.state) : segBarColor(step.state) + '80' }} />
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
            runTaxClearance={runTaxClearance}
            sendTaxIssueEmail={sendTaxIssueEmail}
            sendUezApplicationSubmittedEmail={sendUezApplicationSubmittedEmail}
            runLdcJotform={runLdcJotform}
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

          {/* Composer */}
          <div className="cw-composer">
            <textarea
              className="cw-composer-input"
              value={noteDraftLocal}
              onChange={(e) => setNoteDraftLocal(e.target.value)}
              onBlur={saveNote}
              placeholder="Add a note…"
              rows={2}
              disabled={busy}
            />
            {noteDraftLocal.trim() && (
              <div className="cw-composer-actions">
                {/* onMouseDown+preventDefault keeps focus on the textarea so blur doesn't fire
                    before the click lands — then onClick triggers the actual save */}
                <button
                  className="cw-btn cw-btn-ok"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={saveNote}
                  disabled={busy}
                >Save note</button>
                {/* Discard: clear the draft on mousedown so the blur handler sees an empty body */}
                <button
                  className="cw-btn-ghost"
                  onMouseDown={(e) => { e.preventDefault(); setNoteDraftLocal(''); }}
                >Discard</button>
              </div>
            )}
          </div>

          {/* Pinned note */}
          {pinnedItem && (
            <div className="cw-pinned-card">
              <div className="cw-pinned-head">
                <span className="cw-mono cw-faint2">PINNED</span>
                <button className="cw-unpin-btn" onClick={() => setPinnedNoteId(null)}>✕</button>
              </div>
              <span className="cw-note-body">{pinnedItem.body}</span>
              <span className="cw-mono cw-faint3">{pinnedItem.when}</span>
            </div>
          )}

          {/* Stream */}
          <div className="cw-stream">
            {stream.filter((s) => s.noteId !== pinnedNoteId).map((item) => (
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
                          <button className="cw-pin-btn" onClick={() => setPinnedNoteId(item.noteId)} title="Pin">⚲</button>
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
                        <span className="cw-mono cw-faint3">{item.when}</span>
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
              {['docs', 'legacy'].map((t) => (
                <button
                  key={t}
                  className={`cw-footer-tab${footerTab === t ? ' cw-footer-tab-active' : ''}`}
                  onClick={() => setFooterTab(t)}
                >
                  {t === 'docs' ? 'Documents' : 'Legacy view'}
                </button>
              ))}
            </div>

            <div className="cw-footer-panel">
              {footerTab === 'docs' && (
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
                </div>
              )}

              {footerTab === 'legacy' && (
                <div className="cw-legacy-grid">
                  <p className="cw-legacy-note">All-cards view — kept as a fallback. Every field is editable on its own step above.</p>
                  {PROCESS_STEP_KEYS.map((key) => {
                    const step = resolveProcessStep(key, detail);
                    return (
                      <ProcessStepCard
                        key={key}
                        stepKey={key}
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
                        runTaxClearance={runTaxClearance}
                        sendTaxIssueEmail={sendTaxIssueEmail}
                        sendUezApplicationSubmittedEmail={sendUezApplicationSubmittedEmail}
                        runLdcJotform={runLdcJotform}
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
                      />
                    );
                  })}
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
  markPbsAccountCreated, setProcessFlag, runPbsSignup, sendPbsAccountCreatedEmail,
  runTaxClearance, sendTaxIssueEmail, sendUezApplicationSubmittedEmail,
  runLdcJotform, requestPayment, confirmPayment, sendPaymentRequestedEmail, sendPaymentReceivedEmail,
  runLakewoodGrantPortal, confirmGrantSubmitted, sendGrantSubmittedEmail,
  changePbsAnswerDraft, saveExistingPbsAnswer, saveMyNjCredentials,
  startMyNjEdit, cancelMyNjEdit, toggleShowMyNjSecrets, copyCredential, createMyNjCredentials,
  saveBrcFound, saveBrcNotFound, saveProcessStep, resetProcessStep,
  prevLabel, nextLabel, onPrev, onNext,
}) {
  const app = detail.application;
  const step = resolveProcessStep(stepKey, detail);
  const docType = STEP_DOC_TYPE[stepKey];
  const doc = docType ? docFor(detail, docType) : null;

  // Step-note local state — keep in sync when step or application changes
  const [stepNoteDraft, setStepNoteDraft] = useState(step.manualNote || '');
  useEffect(() => { setStepNoteDraft(step.manualNote || ''); }, [stepKey, detail.application.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveStepNote() {
    const text = stepNoteDraft.trim() || null;
    if (text === (step.manualNote || null)) return; // nothing changed
    await saveProcessStep(stepKey, {
      state: step.state,
      waitingOn: step.waitingOn || null,
      waitingSince: step.waitingSince || null,
      waitingReason: step.waitingReason || null,
      manualNote: text,
    });
  }

  // "Set by" line
  const setByLine = step.source === 'explicit'
    ? `Set by ${step.updatedByName || 'admin'} · ${step.updatedAt ? formatTimestamp(step.updatedAt) : ''}`
    : '(auto)';

  // Alert content per step
  const alert = stepAlert(stepKey, detail, step);

  return (
    <div className="cw-step-panel">
      {/* Header */}
      <div className="cw-step-header">
        <div className="cw-step-title-row">
          <h2 className="cw-step-title">{PROCESS_STEP_TITLES[stepKey]}</h2>
          <span className="cw-step-pill" style={pillStyle(step.state)}>{PROCESS_STEP_STATE_LABELS[step.state]}</span>
        </div>
        <div className="cw-step-meta">
          <span className="cw-mono cw-faint3">STEP {stepIdx + 1} OF 8 · </span>
          <span className="cw-step-setby">{setByLine}</span>
        </div>
        {/* State selector chips */}
        <div className="cw-state-chips">
          {PROCESS_STEP_STATES.map((s) => {
            const st = stateStyle(s);
            const active = step.state === s;
            return (
              <button
                key={s}
                type="button"
                className={`cw-state-chip${active ? ' cw-state-chip-active' : ''}`}
                style={active ? { background: st.bg, border: `1px solid ${st.border}`, color: st.fg } : undefined}
                onClick={() => saveProcessStep(stepKey, { state: s, waitingOn: null, waitingSince: null, waitingReason: null, manualNote: step.manualNote || null })}
                disabled={busy}
              >
                {PROCESS_STEP_STATE_LABELS[s]}
              </button>
            );
          })}
          {step.source === 'explicit' && (
            <button className="cw-state-chip cw-reset-chip" onClick={() => resetProcessStep(stepKey)} disabled={busy}>
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
        {docType && (
          <div className="cw-doc-col">
            <span className="cw-field-label cw-mono">DOCUMENT</span>
            <div
              className={`cw-doc-tile-main${doc ? '' : ' cw-doc-tile-empty'}`}
              onClick={() => doc && previewDocument(doc)}
              title={doc ? doc.filename : 'Nothing on file'}
            >
              {doc ? (
                <>
                  <div className="cw-doc-tile-thumb">
                    <DocThumbnail doc={doc} applicationId={app.id} onClick={() => previewDocument(doc)} />
                  </div>
                  <div className="cw-doc-tile-info">
                    <span className="cw-doc-tile-name">{doc.filename}</span>
                    <button className="cw-doc-open-btn" onClick={(e) => { e.stopPropagation(); previewDocument(doc); }}>Open ↗</button>
                  </div>
                </>
              ) : (
                <>
                  <span className="cw-doc-tile-dashed-icon">📄</span>
                  <span className="cw-doc-tile-empty-label">nothing on file</span>
                </>
              )}
            </div>
          </div>
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
            reviewFormationDoc={reviewFormationDoc}
            sendFormationRejectedEmail={sendFormationRejectedEmail}
            runBrcLookup={runBrcLookup}
            sendBrcProblemEmail={sendBrcProblemEmail}
            sendBrcWrongAddressEmail={sendBrcWrongAddressEmail}
            markPbsAccountCreated={markPbsAccountCreated}
            setProcessFlag={setProcessFlag}
            runPbsSignup={runPbsSignup}
            sendPbsAccountCreatedEmail={sendPbsAccountCreatedEmail}
            runTaxClearance={runTaxClearance}
            sendTaxIssueEmail={sendTaxIssueEmail}
            sendUezApplicationSubmittedEmail={sendUezApplicationSubmittedEmail}
            runLdcJotform={runLdcJotform}
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

      {/* Step note — editable (this panel only renders the currently selected step) */}
      <div className="cw-step-note-section">
        <span className="cw-field-label cw-mono">STEP NOTE</span>
        <textarea
          className="cw-step-note-input"
          value={stepNoteDraft}
          onChange={(e) => setStepNoteDraft(e.target.value)}
          onBlur={saveStepNote}
          placeholder="Add a note for this step…"
          rows={3}
          disabled={busy}
        />
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
  switch (state) {
    case 'complete':       return { background: '#1a2c1e', color: '#57c98a' };
    case 'in_progress':    return { background: '#182030', color: '#6f9fd8' };
    case 'waiting':        return { background: '#2a1f08', color: '#e0a23c' };
    case 'not_applicable': return { background: '#1e1f23', color: '#6f7883' };
    default:               return { background: '#1a1c20', color: '#6f7883' };
  }
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
  copyCredential,
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
            onChange={(v) => setBrcForm((f) => ({ ...f, registeredBusinessName: v }))} disabled={busy} />
          <FieldPair label="Trade name / DBA" value={brcForm.tradeName}
            onChange={(v) => setBrcForm((f) => ({ ...f, tradeName: v }))} disabled={busy} />
          <FieldPair label="Address" value={brcForm.address}
            onChange={(v) => setBrcForm((f) => ({ ...f, address: v }))} disabled={busy} />
          <span className="cw-field-label">BRC status</span>
          <span className="cw-field-value">{app.brc_status || '—'}</span>
        </div>
      );

    case 'pbs_mynj':
      return (
        <div className="cw-fields cw-fields-col1">
          <span className="cw-field-label">PBS account exists?</span>
          <span className="cw-field-value">{app.has_existing_pbs_account == null ? '—' : app.has_existing_pbs_account ? 'Yes' : 'No'}</span>
          <span className="cw-field-label">PBS account created</span>
          <span className="cw-field-value">{app.pbs_account_created ? '✓ Yes' : 'Not yet'}</span>
          {myNjCredentials && <>
            <span className="cw-field-label">MyNJ username</span>
            <span className="cw-field-value cw-mono">
              {myNjCredentials.username}
              <button className="cw-copy-btn" onClick={() => copyCredential(myNjCredentials.username, 'Username')}>Copy</button>
            </span>
          </>}
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
  reviewFormationDoc, sendFormationRejectedEmail,
  runBrcLookup, sendBrcProblemEmail, sendBrcWrongAddressEmail,
  markPbsAccountCreated, setProcessFlag, runPbsSignup, sendPbsAccountCreatedEmail,
  runTaxClearance, sendTaxIssueEmail, sendUezApplicationSubmittedEmail,
  runLdcJotform, requestPayment, confirmPayment, sendPaymentRequestedEmail, sendPaymentReceivedEmail,
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
      disabled={busy || dis}
    >{label}</button>
  );

  switch (stepKey) {
    case 'formation': {
      const lastSent = lastEmailSent(detail, 'formation_rejected');
      return (
        <>
          <Btn label="✓ Approve CoF" onClick={() => reviewFormationDoc('approved')} variant="ok" />
          <Btn label="Wrong document" onClick={() => reviewFormationDoc('rejected')} variant="danger" />
          <Btn label={`✉ Send replacement request${lastSent ? ' (resend)' : ''}`} onClick={sendFormationRejectedEmail} />
        </>
      );
    }

    case 'brc':
      return (
        <>
          <Btn label="🔍 Fetch BRC" onClick={runBrcLookup} />
          <Btn label="Save BRC found" onClick={saveBrcFound} disabled={!brcFormHasData(detail)} />
          <Btn label="Mark not found" onClick={saveBrcNotFound} />
          <Btn label="✉ Send BRC problem email" onClick={sendBrcProblemEmail} />
          <Btn label="✉ Send wrong address email" onClick={sendBrcWrongAddressEmail} />
        </>
      );

    case 'pbs_mynj':
      return (
        <>
          {!myNjCredentials && <Btn label="Generate MyNJ credentials" onClick={createMyNjCredentials} variant="ok" />}
          {myNjCredentials && !myNjEditMode && <Btn label="Edit MyNJ credentials" onClick={startMyNjEdit} />}
          {myNjEditMode && <Btn label="Save credentials" onClick={saveMyNjCredentials} variant="ok" />}
          {myNjEditMode && <Btn label="Cancel" onClick={cancelMyNjEdit} />}
          {!app.pbs_account_created && <Btn label="Mark PBS account created" onClick={markPbsAccountCreated} />}
          {!app.pbs_account_created && <Btn label="Run PBS signup" onClick={runPbsSignup} disabled={!!pbsAccountGateReason(detail, myNjCredentials)} />}
          {app.pbs_account_created && <Btn label="✉ Send PBS account created email" onClick={sendPbsAccountCreatedEmail} />}
        </>
      );

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
          {!latest && <Btn label="Request payment" onClick={requestPayment} />}
          {latest && latest?.status !== 'paid' && (
            <Btn
              label={paymentEmailSent ? `✉ Resend payment request (sent ${formatTimestamp(paymentEmailSent.createdAt)})` : '✉ Send payment request email'}
              onClick={sendPaymentRequestedEmail}
            />
          )}
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
