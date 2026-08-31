import React from 'react';
import {
  docFor,
  formatTimestamp,
  grantSubmissionLikelyDetected,
  grantSubmitGateReason,
  lastEmailSent,
  packetReady,
  paymentStatusLabel,
  pbsAccountGateReason,
  PROCESS_STEP_TITLES,
  resolveProcessStep,
} from './caseLogic';
import ActivityPanel from './ActivityPanel';
import BrcDetailsCard from './BrcDetailsCard';
import BusinessDetailsCard from './BusinessDetailsCard';
import DocThumbnail from './DocThumbnail';
import DocumentsPanel from './DocumentsPanel';
import MyNjPbsCard from './MyNjPbsCard';
import NotesPanel from './NotesPanel';
import OwnersCard from './OwnersCard';
import PaymentCard from './PaymentCard';
import ProcessStepCard from './ProcessStepCard';

const TABS = [
  { key: 'formation_brc',      label: 'Formation & BRC' },
  { key: 'pbs_mynj',          label: 'MyNJ / PBS' },
  { key: 'uez_tax',           label: 'UEZ & Tax Clearance' },
  { key: 'payment_ldc_grant', label: 'Payment, LDC & Grant' },
  { key: 'details',           label: 'Case File' },
  { key: 'legacy',            label: 'Legacy' },
];

export default function CaseDetailTabs({
  activeTab,
  setActiveTab,
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
  // ── shared factsContent helpers (inline JSX, same as AdminPage had them) ──

  function formationFacts() {
    const formation = docFor(detail, 'formation');
    const sole = detail.application.is_sole_proprietorship;
    const review = detail.application.formation_review_status || 'not_reviewed';
    const lastSent = lastEmailSent(detail, 'formation_rejected');
    return (
      <>
        {/* Inline preview — readable without clicking */}
        {!sole && (
          <DocThumbnail
            variant="inline"
            doc={formation}
            applicationId={detail.application.id}
            onClick={() => formation && previewDocument(formation)}
          />
        )}

        {/* Status line */}
        {sole && !formation
          ? <small>Not required (sole proprietorship)</small>
          : !formation
            ? <small className="cof-status-missing">Missing — applicant has not uploaded yet</small>
            : <small className={`cof-status-${review}`}>
                {review === 'approved' ? '✓ Approved' : review === 'rejected' ? '⚠ Marked wrong — needs replacement' : '! Needs review'}
                {' — '}{formation.filename}
              </small>}

        {/* FEIN hint — shown whenever a doc is present and not yet approved */}
        {formation && review !== 'approved' && (
          <small className="cof-fein-hint">
            💡 Common mistake: applicants sometimes upload the FEIN letter (IRS SS-4) instead of the NJ Certificate of Formation
          </small>
        )}
        {!formation && !sole && (
          <small className="cof-fein-hint">
            💡 If the applicant uploaded something and it's missing here, they may have uploaded the FEIN letter (IRS SS-4) by mistake
          </small>
        )}

        {lastSent && (
          <small className="email-sent-note">
            Replacement request sent {formatTimestamp(lastSent.createdAt)}
            {lastSent.providerMessageId && <> · <a href={`https://resend.com/emails/${lastSent.providerMessageId}`} target="_blank" rel="noreferrer">View on Resend</a></>}
          </small>
        )}
      </>
    );
  }

  function brcFacts() {
    const brc = docFor(detail, 'brc');
    const status = detail.application.brc_status;
    const lastSentNotFound = lastEmailSent(detail, 'brc_not_found');
    const lastSentWrongAddress = lastEmailSent(detail, 'brc_wrong_address');
    return (
      <>
        <div className="doc-preview-row">
          <DocThumbnail doc={brc} applicationId={detail.application.id} onClick={() => brc && previewDocument(brc)} />
          {brc
            ? <small>✓ BRC on file — {brc.filename}</small>
            : status === 'not_found'
              ? <small>NJ did not find a matching BRC</small>
              : status && status !== 'pending'
                ? <small>{status.replace(/_/g, ' ')}</small>
                : <small>Not yet fetched</small>}
        </div>

        {/* BRC data fields — inline (replaces the old accordion card) */}
        <div className="brc-inline-fields">
          <label>Registered business name</label>
          <input value={brcForm.registeredBusinessName} onChange={(e) => setBrcForm((f) => ({ ...f, registeredBusinessName: e.target.value }))} />
          <label>DBA / trade name</label>
          <input value={brcForm.tradeName} onChange={(e) => setBrcForm((f) => ({ ...f, tradeName: e.target.value }))} />
          <label>Business address</label>
          <input value={brcForm.address} onChange={(e) => setBrcForm((f) => ({ ...f, address: e.target.value }))} />
        </div>

        {lastSentNotFound && (
          <small className="email-sent-note">
            No-BRC email sent {formatTimestamp(lastSentNotFound.createdAt)}
            {lastSentNotFound.providerMessageId && <> · <a href={`https://resend.com/emails/${lastSentNotFound.providerMessageId}`} target="_blank" rel="noreferrer">View on Resend</a></>}
          </small>
        )}
        {lastSentWrongAddress && (
          <small className="email-sent-note">
            Wrong-address email sent {formatTimestamp(lastSentWrongAddress.createdAt)}
            {lastSentWrongAddress.providerMessageId && <> · <a href={`https://resend.com/emails/${lastSentWrongAddress.providerMessageId}`} target="_blank" rel="noreferrer">View on Resend</a></>}
          </small>
        )}
      </>
    );
  }

  function pbsFacts() {
    const hasExisting = detail.application.has_existing_pbs_account;
    const lastSent = lastEmailSent(detail, 'pbs_account_created');
    return (
      <>
        <div className="process-step-inline-select">
          <label>PBS account created</label>
          <div className="tiny-toggle">
            <button className={detail.application.pbs_account_created ? 'active-good' : ''} onClick={markPbsAccountCreated} disabled={busy}>Yes</button>
            <button className={!detail.application.pbs_account_created ? 'active-neutral' : ''} onClick={() => setProcessFlag('pbsAccountCreated', false)} disabled={busy}>No</button>
          </div>
        </div>
        {myNjCredentials
          ? <small>MyNJ login on file</small>
          : <small>No MyNJ login yet{hasExisting == null ? " — waiting on the applicant's existing-account answer" : ''}</small>}
        {lastSent && (
          <small className="email-sent-note">
            PBS email sent {formatTimestamp(lastSent.createdAt)}
            {lastSent.providerMessageId && <> · <a href={`https://resend.com/emails/${lastSent.providerMessageId}`} target="_blank" rel="noreferrer">View on Resend</a></>}
          </small>
        )}
      </>
    );
  }

  function taxFacts() {
    const doc = docFor(detail, 'tax_clearance');
    const issueDoc = docFor(detail, 'tax_clearance_issue');
    const status = detail.application.tax_clearance_status || (detail.application.tax_clearance_good ? 'good' : 'no');
    const shownDoc = doc || issueDoc;
    const lastSent = lastEmailSent(detail, 'tax_issue');
    return (
      <>
        <div className="process-step-inline-select">
          <label>Tax clearance</label>
          <div className="tiny-toggle tax-tristate">
            <button className={status === 'no' ? 'active-neutral' : ''} onClick={() => setProcessFlag('taxClearanceStatus', 'no')} disabled={busy}>No</button>
            <button className={status === 'issue' ? 'active-warn' : ''} onClick={() => setProcessFlag('taxClearanceStatus', 'issue')} disabled={busy}>Issue</button>
            <button className={status === 'good' ? 'active-good' : ''} onClick={() => setProcessFlag('taxClearanceStatus', 'good')} disabled={busy}>Good</button>
          </div>
        </div>
        {detail.application.tax_clearance_recheck_requested_at && <small className="tax-recheck-note">Client says resolved</small>}
        {shownDoc
          ? <div className="doc-preview-row">
              <DocThumbnail doc={shownDoc} applicationId={detail.application.id} onClick={() => previewDocument(shownDoc)} />
              <small>{doc ? '✓ Tax clearance letter on file' : '⚠ Issue screenshot on file'} — {shownDoc.filename}</small>
            </div>
          : <small>No tax clearance document yet</small>}
        {lastSent && (
          <small className="email-sent-note">
            Email sent {formatTimestamp(lastSent.createdAt)}
            {lastSent.providerMessageId && <> · <a href={`https://resend.com/emails/${lastSent.providerMessageId}`} target="_blank" rel="noreferrer">View on Resend</a></>}
          </small>
        )}
      </>
    );
  }

  function uezFacts() {
    const approval = docFor(detail, 'uez_approval_email');
    const review = detail.application.uez_approval_review_status || 'not_reviewed';
    const lastSent = lastEmailSent(detail, 'uez_application_submitted');
    return (
      <>
        <div className="process-step-inline-select">
          <label>UEZ status</label>
          <select value={detail.application.uez_application_status || 'not_started'} onChange={(e) => setProcessFlag('uezApplicationStatus', e.target.value)} disabled={busy}>
            <option value="not_started">Not Started</option>
            <option value="applied">Applied</option>
            <option value="approved">Approved</option>
          </select>
        </div>
        <div className="doc-preview-row">
          <DocThumbnail doc={approval} applicationId={detail.application.id} onClick={() => approval && previewDocument(approval)} />
          {approval
            ? <small>{review === 'approved' ? '✓ Approval email approved' : review === 'rejected' ? '⚠ Approval email marked wrong' : '! Approval email needs review'} — {approval.filename}</small>
            : <small>No UEZ approval email yet</small>}
        </div>
        {lastSent && (
          <small className="email-sent-note">
            UEZ submitted email sent {formatTimestamp(lastSent.createdAt)}
            {lastSent.providerMessageId && <> · <a href={`https://resend.com/emails/${lastSent.providerMessageId}`} target="_blank" rel="noreferrer">View on Resend</a></>}
          </small>
        )}
      </>
    );
  }

  function ldcFacts() {
    const doc = docFor(detail, 'ldc_application');
    return (
      <div className="doc-preview-row">
        <DocThumbnail doc={doc} applicationId={detail.application.id} onClick={() => doc && previewDocument(doc)} />
        {doc ? <small>✓ Signed application on file — {doc.filename}</small> : <small>Not yet filled out</small>}
      </div>
    );
  }

  function paymentFacts() {
    const latest = detail.payments?.[detail.payments.length - 1];
    const requestedAt = detail.application.payment_requested_at;
    const lastSent = lastEmailSent(detail, 'payment_received');
    return (
      <>
        <strong>{paymentStatusLabel(latest?.status)}</strong>
        {latest?.amount != null && <small>${Number(latest.amount).toLocaleString()}{latest.payment_method ? ` · ${latest.payment_method}` : ''}</small>}
        <small>{requestedAt ? `Requested ${formatTimestamp(requestedAt)}` : 'Not yet requested — client sees no payment ask yet'}</small>
        {lastSent && (
          <small className="email-sent-note">
            Payment received email sent {formatTimestamp(lastSent.createdAt)}
            {lastSent.providerMessageId && <> · <a href={`https://resend.com/emails/${lastSent.providerMessageId}`} target="_blank" rel="noreferrer">View on Resend</a></>}
          </small>
        )}
      </>
    );
  }

  function grantFacts() {
    const lastSent = lastEmailSent(detail, 'grant_submitted');
    return (
      <>
        {(detail.application.status === 'applied' || detail.application.status === 'grant_submitted')
          ? <strong>✓ Submitted</strong>
          : grantSubmissionLikelyDetected(detail)
            ? <strong>Looks submitted — needs confirmation</strong>
            : packetReady(detail)
              ? <strong>Packet ready — not yet submitted</strong>
              : <strong>Waiting on required documents</strong>}
        {lastSent && (
          <small className="email-sent-note">
            Grant submitted email sent {formatTimestamp(lastSent.createdAt)}
            {lastSent.providerMessageId && <> · <a href={`https://resend.com/emails/${lastSent.providerMessageId}`} target="_blank" rel="noreferrer">View on Resend</a></>}
          </small>
        )}
      </>
    );
  }

  // ── tab panels ─────────────────────────────────────────────────────────────

  function renderFormationBrc() {
    return (
      <div className="case-tab-panel">
        <div className="case-tab-two-col">
          {/* Formation step */}
          <ProcessStepCard
            stepKey="formation"
            title={PROCESS_STEP_TITLES.formation}
            busy={busy}
            operational={resolveProcessStep('formation', detail)}
            onSaveOperational={saveProcessStep}
            onResetOperational={resetProcessStep}
            factsContent={formationFacts()}
            actions={[{
              label: 'Send replacement request email',
              onClick: sendFormationRejectedEmail,
              disabled: busy
            }]}
          />

          {/* BRC step — inline fields + all actions always shown */}
          <ProcessStepCard
            stepKey="brc"
            title={PROCESS_STEP_TITLES.brc}
            busy={busy}
            operational={resolveProcessStep('brc', detail)}
            onSaveOperational={saveProcessStep}
            onResetOperational={resetProcessStep}
            factsContent={brcFacts()}
            actions={[
              { label: 'Fetch BRC',              onClick: runBrcLookup,             disabled: busy },
              { label: '✓ BRC found',            onClick: saveBrcFound,             disabled: busy },
              { label: 'No BRC found',            onClick: saveBrcNotFound,          disabled: busy },
              { label: 'Email: no BRC',           onClick: sendBrcProblemEmail,      disabled: busy },
              { label: 'Email: wrong address',    onClick: sendBrcWrongAddressEmail, disabled: busy },
            ]}
          />
        </div>
      </div>
    );
  }

  function renderPbsMyNj() {
    return (
      <div className="case-tab-panel">
        <ProcessStepCard
          stepKey="pbs_mynj"
          title={PROCESS_STEP_TITLES.pbs_mynj}
          busy={busy}
          operational={resolveProcessStep('pbs_mynj', detail)}
          onSaveOperational={saveProcessStep}
          onResetOperational={resetProcessStep}
          factsContent={pbsFacts()}
          actions={[
            {
              label: 'Open PBS account',
              onClick: runPbsSignup,
              disabled: busy || Boolean(pbsAccountGateReason(detail, myNjCredentials))
            },
            {
              label: 'Send PBS account email',
              onClick: sendPbsAccountCreatedEmail,
              disabled: busy || !myNjCredentials
            }
          ]}
        />

        <MyNjPbsCard
          application={detail.application}
          myNjCredentials={myNjCredentials}
          pbsAnswerDraft={pbsAnswerDraft}
          pbsLoginDraft={pbsLoginDraft}
          myNjEditMode={myNjEditMode}
          myNjDraft={myNjDraft}
          showMyNjSecrets={showMyNjSecrets}
          busy={busy}
          onChangePbsAnswer={changePbsAnswerDraft}
          onChangePbsLoginDraft={setPbsLoginDraft}
          onSavePbsAnswer={saveExistingPbsAnswer}
          onChangeMyNjDraft={setMyNjDraft}
          onSaveMyNjCredentials={saveMyNjCredentials}
          onStartMyNjEdit={startMyNjEdit}
          onCancelMyNjEdit={cancelMyNjEdit}
          onToggleShowSecrets={toggleShowMyNjSecrets}
          onCopyCredential={copyCredential}
          onCreateMyNjCredentials={createMyNjCredentials}
        />
      </div>
    );
  }

  function renderUezTax() {
    return (
      <div className="case-tab-panel">
        <div className="case-tab-two-col">
          <ProcessStepCard
            stepKey="tax_clearance"
            title={PROCESS_STEP_TITLES.tax_clearance}
            busy={busy}
            operational={resolveProcessStep('tax_clearance', detail)}
            onSaveOperational={saveProcessStep}
            onResetOperational={resetProcessStep}
            factsContent={taxFacts()}
            actions={[
              { label: 'Fetch Tax Clearance', onClick: runTaxClearance, disabled: busy || !myNjCredentials },
              { label: 'Send TC Email',        onClick: sendTaxIssueEmail, disabled: busy },
            ]}
          />

          <ProcessStepCard
            stepKey="uez_enrollment"
            title={PROCESS_STEP_TITLES.uez_enrollment}
            busy={busy}
            operational={resolveProcessStep('uez_enrollment', detail)}
            onSaveOperational={saveProcessStep}
            onResetOperational={resetProcessStep}
            factsContent={uezFacts()}
            actions={[{
              label: 'Send UEZ submitted email',
              onClick: sendUezApplicationSubmittedEmail,
              disabled: busy
            }]}
          />
        </div>
      </div>
    );
  }

  function renderPaymentLdcGrant() {
    return (
      <div className="case-tab-panel">
        {/* Payment */}
        <ProcessStepCard
          stepKey="payment"
          title={PROCESS_STEP_TITLES.payment}
          busy={busy}
          operational={resolveProcessStep('payment', detail)}
          onSaveOperational={saveProcessStep}
          onResetOperational={resetProcessStep}
          factsContent={paymentFacts()}
          actions={[
            { label: detail.application.payment_requested_at ? 'Re-request Payment' : 'Request Payment', onClick: requestPayment, disabled: busy },
            { label: 'Confirm payment received',  onClick: confirmPayment,          disabled: busy || detail.payments?.[detail.payments.length - 1]?.status === 'paid' },
            { label: 'Send payment received email', onClick: sendPaymentReceivedEmail, disabled: busy },
          ]}
        />

        <PaymentCard
          payments={detail.payments}
          draft={paymentDraft}
          busy={busy}
          onDraftChange={setPaymentDraft}
          onConfirm={confirmPayment}
        />

        {/* LDC Application */}
        <ProcessStepCard
          stepKey="ldc_application"
          title={PROCESS_STEP_TITLES.ldc_application}
          busy={busy}
          operational={resolveProcessStep('ldc_application', detail)}
          onSaveOperational={saveProcessStep}
          onResetOperational={resetProcessStep}
          factsContent={ldcFacts()}
          actions={[{
            label: 'Fill out LDC application',
            onClick: runLdcJotform,
            disabled: busy
          }]}
        />

        {/* Grant Submission */}
        <ProcessStepCard
          stepKey="grant_submission"
          title={PROCESS_STEP_TITLES.grant_submission}
          busy={busy}
          operational={resolveProcessStep('grant_submission', detail)}
          onSaveOperational={saveProcessStep}
          onResetOperational={resetProcessStep}
          factsContent={grantFacts()}
          actions={[
            { label: 'Submit Grant App',          onClick: runLakewoodGrantPortal, disabled: busy || Boolean(grantSubmitGateReason(detail)) },
            { label: 'Confirm grant submitted',   onClick: confirmGrantSubmitted,  disabled: busy || !grantSubmissionLikelyDetected(detail) },
            { label: 'Send grant submitted email', onClick: sendGrantSubmittedEmail, disabled: busy },
          ]}
        />
      </div>
    );
  }

  function renderDetails() {
    return (
      <div className="case-tab-panel">
        {/* Notes + Activity across the top — most-used reference during a session */}
        <div className="case-details-top-row">
          <NotesPanel
            notes={detail.notes}
            draft={noteDraft}
            busy={noteBusy}
            editingId={noteEditingId}
            editDraft={noteEditDraft}
            onDraftChange={setNoteDraft}
            onAdd={addCaseNote}
            onStartEdit={startEditingNote}
            onCancelEdit={cancelEditingNote}
            onEditDraftChange={setNoteEditDraft}
            onSaveEdit={saveCaseNoteEdit}
            onDelete={removeCaseNote}
          />
          <ActivityPanel events={detail.statusEvents} />
        </div>

        {/* Business + Owners side by side */}
        <div className="case-details-two-col">
          <BusinessDetailsCard
            application={detail.application}
            editMode={editMode}
            draft={applicationDraft}
            onChangeField={updateApplicationDraft}
          />
          <OwnersCard
            owners={detail.owners}
            editMode={editMode}
            ownerDrafts={ownerDrafts}
            onChangeOwnerField={updateOwnerDraft}
            onAddOwner={addOwner}
            onRemoveOwner={removeOwner}
          />
        </div>

        {/* Documents — full width */}
        <DocumentsPanel
          documents={detail.documents}
          busy={busy}
          onOpen={openDoc}
          onDelete={handleDeleteDoc}
          manualDocType={manualDocType}
          onChangeManualDocType={setManualDocType}
          manualDocFile={manualDocFile}
          onChangeManualDocFile={setManualDocFile}
          manualDocUploading={manualDocUploading}
          onUploadManualDoc={uploadManualAdminDocument}
        />
      </div>
    );
  }

  function renderLegacy() {
    return (
      <div className="case-tab-panel">
        {/* All 8 process step cards */}
        <div className="process-step-grid">
          <ProcessStepCard
            stepKey="formation"
            title={PROCESS_STEP_TITLES.formation}
            busy={busy}
            operational={resolveProcessStep('formation', detail)}
            onSaveOperational={saveProcessStep}
            onResetOperational={resetProcessStep}
            factsContent={formationFacts()}
            actions={detail.application.formation_review_status === 'rejected' ? [{
              label: 'Send replacement request email',
              onClick: sendFormationRejectedEmail,
              disabled: busy
            }] : []}
          />
          <ProcessStepCard
            stepKey="brc"
            title={PROCESS_STEP_TITLES.brc}
            busy={busy}
            operational={resolveProcessStep('brc', detail)}
            onSaveOperational={saveProcessStep}
            onResetOperational={resetProcessStep}
            factsContent={brcFacts()}
            actions={[
              { label: 'Fetch BRC', onClick: runBrcLookup, disabled: busy },
              ...(detail.application.brc_status === 'not_found' ? [{
                label: 'Send BRC Email',
                onClick: sendBrcProblemEmail,
                disabled: busy
              }] : [])
            ]}
          />
          <ProcessStepCard
            stepKey="pbs_mynj"
            title={PROCESS_STEP_TITLES.pbs_mynj}
            busy={busy}
            operational={resolveProcessStep('pbs_mynj', detail)}
            onSaveOperational={saveProcessStep}
            onResetOperational={resetProcessStep}
            factsContent={pbsFacts()}
            actions={[
              { label: 'Open PBS account', onClick: runPbsSignup, disabled: busy || Boolean(pbsAccountGateReason(detail, myNjCredentials)) },
              { label: 'Send PBS account email', onClick: sendPbsAccountCreatedEmail, disabled: busy || !myNjCredentials }
            ]}
          />
          <ProcessStepCard
            stepKey="tax_clearance"
            title={PROCESS_STEP_TITLES.tax_clearance}
            busy={busy}
            operational={resolveProcessStep('tax_clearance', detail)}
            onSaveOperational={saveProcessStep}
            onResetOperational={resetProcessStep}
            factsContent={taxFacts()}
            actions={[
              { label: 'Fetch Tax Clearance', onClick: runTaxClearance, disabled: busy || !myNjCredentials },
              ...(detail.application.tax_clearance_status === 'issue' ? [{ label: 'Send TC Email', onClick: sendTaxIssueEmail, disabled: busy }] : [])
            ]}
          />
          <ProcessStepCard
            stepKey="uez_enrollment"
            title={PROCESS_STEP_TITLES.uez_enrollment}
            busy={busy}
            operational={resolveProcessStep('uez_enrollment', detail)}
            onSaveOperational={saveProcessStep}
            onResetOperational={resetProcessStep}
            factsContent={uezFacts()}
            actions={['applied', 'approved'].includes(detail.application.uez_application_status) ? [{ label: 'Send UEZ application submitted email', onClick: sendUezApplicationSubmittedEmail, disabled: busy }] : []}
          />
          <ProcessStepCard
            stepKey="ldc_application"
            title={PROCESS_STEP_TITLES.ldc_application}
            busy={busy}
            operational={resolveProcessStep('ldc_application', detail)}
            onSaveOperational={saveProcessStep}
            onResetOperational={resetProcessStep}
            factsContent={ldcFacts()}
            actions={[{ label: 'Fill out LDC application', onClick: runLdcJotform, disabled: busy }]}
          />
          <ProcessStepCard
            stepKey="payment"
            title={PROCESS_STEP_TITLES.payment}
            busy={busy}
            operational={resolveProcessStep('payment', detail)}
            onSaveOperational={saveProcessStep}
            onResetOperational={resetProcessStep}
            factsContent={paymentFacts()}
            actions={[
              { label: detail.application.payment_requested_at ? 'Re-request Payment' : 'Request Payment', onClick: requestPayment, disabled: busy },
              { label: 'Confirm payment received', onClick: confirmPayment, disabled: busy || detail.payments?.[detail.payments.length - 1]?.status === 'paid' },
              ...(detail.payments?.[detail.payments.length - 1]?.status === 'paid' ? [{ label: 'Send payment received email', onClick: sendPaymentReceivedEmail, disabled: busy }] : [])
            ]}
          />
          <ProcessStepCard
            stepKey="grant_submission"
            title={PROCESS_STEP_TITLES.grant_submission}
            busy={busy}
            operational={resolveProcessStep('grant_submission', detail)}
            onSaveOperational={saveProcessStep}
            onResetOperational={resetProcessStep}
            factsContent={grantFacts()}
            actions={[
              { label: 'Submit Grant App', onClick: runLakewoodGrantPortal, disabled: busy || Boolean(grantSubmitGateReason(detail)) },
              ...(grantSubmissionLikelyDetected(detail) ? [{ label: 'Confirm grant submitted', onClick: confirmGrantSubmitted, disabled: busy }] : []),
              ...(detail.application.status === 'applied' || detail.application.status === 'grant_submitted' ? [{ label: 'Send grant submitted email', onClick: sendGrantSubmittedEmail, disabled: busy }] : [])
            ]}
          />
        </div>

        <div className="admin-card-grid case-workbench-grid">
          <NotesPanel
            notes={detail.notes}
            draft={noteDraft}
            busy={noteBusy}
            editingId={noteEditingId}
            editDraft={noteEditDraft}
            onDraftChange={setNoteDraft}
            onAdd={addCaseNote}
            onStartEdit={startEditingNote}
            onCancelEdit={cancelEditingNote}
            onEditDraftChange={setNoteEditDraft}
            onSaveEdit={saveCaseNoteEdit}
            onDelete={removeCaseNote}
          />
          <ActivityPanel events={detail.statusEvents} />
        </div>

        <div className="admin-details-heading"><span>DETAILS</span><small>Reference information and manual overrides</small></div>

        <div className="admin-card-grid">
          <BusinessDetailsCard
            application={detail.application}
            editMode={editMode}
            draft={applicationDraft}
            onChangeField={updateApplicationDraft}
          />
          <OwnersCard
            owners={detail.owners}
            editMode={editMode}
            ownerDrafts={ownerDrafts}
            onChangeOwnerField={updateOwnerDraft}
            onAddOwner={addOwner}
            onRemoveOwner={removeOwner}
          />
          <BrcDetailsCard
            application={detail.application}
            brcForm={brcForm}
            busy={busy}
            onChangeBrcForm={setBrcForm}
            onBrcFound={saveBrcFound}
            onBrcNotFound={saveBrcNotFound}
          />
          <MyNjPbsCard
            application={detail.application}
            myNjCredentials={myNjCredentials}
            pbsAnswerDraft={pbsAnswerDraft}
            pbsLoginDraft={pbsLoginDraft}
            myNjEditMode={myNjEditMode}
            myNjDraft={myNjDraft}
            showMyNjSecrets={showMyNjSecrets}
            busy={busy}
            onChangePbsAnswer={changePbsAnswerDraft}
            onChangePbsLoginDraft={setPbsLoginDraft}
            onSavePbsAnswer={saveExistingPbsAnswer}
            onChangeMyNjDraft={setMyNjDraft}
            onSaveMyNjCredentials={saveMyNjCredentials}
            onStartMyNjEdit={startMyNjEdit}
            onCancelMyNjEdit={cancelMyNjEdit}
            onToggleShowSecrets={toggleShowMyNjSecrets}
            onCopyCredential={copyCredential}
            onCreateMyNjCredentials={createMyNjCredentials}
          />
          <PaymentCard
            payments={detail.payments}
            draft={paymentDraft}
            busy={busy}
            onDraftChange={setPaymentDraft}
            onConfirm={confirmPayment}
          />
          <DocumentsPanel
            documents={detail.documents}
            busy={busy}
            onOpen={openDoc}
            onDelete={handleDeleteDoc}
            manualDocType={manualDocType}
            onChangeManualDocType={setManualDocType}
            manualDocFile={manualDocFile}
            onChangeManualDocFile={setManualDocFile}
            manualDocUploading={manualDocUploading}
            onUploadManualDoc={uploadManualAdminDocument}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="case-tabs">
      <nav className="case-tab-bar" aria-label="Case sections">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'formation_brc'      && renderFormationBrc()}
      {activeTab === 'pbs_mynj'           && renderPbsMyNj()}
      {activeTab === 'uez_tax'            && renderUezTax()}
      {activeTab === 'payment_ldc_grant'  && renderPaymentLdcGrant()}
      {activeTab === 'details'            && renderDetails()}
      {activeTab === 'legacy'             && renderLegacy()}
    </div>
  );
}
