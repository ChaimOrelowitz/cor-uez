import React from 'react';

// The biggest of the four remaining cards, but the most self-contained -
// nothing here is read by any other card. myNjCredentials itself stays
// lifted in AdminPage.jsx (the ops-cockpit action buttons gate on it too);
// everything else (edit mode, drafts, secret-reveal, the PBS-account
// question) is purely local to this card and passed down as props.
export default function MyNjPbsCard({
  application,
  myNjCredentials,
  pbsAnswerDraft,
  pbsLoginDraft,
  myNjEditMode,
  myNjDraft,
  showMyNjSecrets,
  busy,
  onChangePbsAnswer,
  onChangePbsLoginDraft,
  onSavePbsAnswer,
  onChangeMyNjDraft,
  onSaveMyNjCredentials,
  onStartMyNjEdit,
  onCancelMyNjEdit,
  onToggleShowSecrets,
  onCopyCredential,
  onMarkPbsAccountCreated,
  onCreateMyNjCredentials
}) {
  return (
    <details className="admin-accordion">
      <summary><strong>MyNJ / PBS</strong><span>{myNjCredentials ? 'Login ready' : 'Not created'}</span></summary>
      <section className="admin-card mynj-card admin-account-card admin-secondary-card">
        <div className="admin-card-head">
          <h3>MyNJ / PBS account</h3>
          <span>{application.pbs_status === 'account_created' || application.pbs_status === 'uez_approval_uploaded' ? 'ACCOUNT CREATED' : myNjCredentials ? 'LOGIN READY' : 'NOT CREATED'}</span>
        </div>
        <div className="admin-pbs-answer-box">
          <label>Does this business already have a PBS account?</label>
          <select
            value={pbsAnswerDraft || (application.has_existing_pbs_account == null ? '' : application.has_existing_pbs_account ? 'yes' : 'no')}
            onChange={(e) => onChangePbsAnswer(e.target.value)}
          >
            <option value="">Not answered</option>
            <option value="yes">Yes — existing PBS account</option>
            <option value="no">No — COR needs to create it</option>
          </select>
          {(pbsAnswerDraft || (application.has_existing_pbs_account ? 'yes' : '')) === 'yes' && <div className="credential-edit-grid">
            <label>Existing MyNJ username<input value={pbsLoginDraft.username || myNjCredentials?.username || ''} onChange={(e) => onChangePbsLoginDraft((old) => ({ ...old, username: e.target.value }))} /></label>
            <label>Existing MyNJ password<input type="password" value={pbsLoginDraft.password || myNjCredentials?.password || ''} onChange={(e) => onChangePbsLoginDraft((old) => ({ ...old, password: e.target.value }))} /></label>
          </div>}
          <button className="secondary admin-full-button" onClick={onSavePbsAnswer} disabled={busy}>Save PBS answer</button>
        </div>
        {myNjCredentials ? <>
          {myNjEditMode ? <div className="credential-edit-grid">
            <label>MyNJ username <span className="required-star">*</span><input value={myNjDraft?.username || ''} onChange={(e) => onChangeMyNjDraft((old) => ({ ...old, username: e.target.value }))} /></label>
            <label>MyNJ password <span className="required-star">*</span><input value={myNjDraft?.password || ''} onChange={(e) => onChangeMyNjDraft((old) => ({ ...old, password: e.target.value }))} /></label>
            <label>Challenge question <span className="required-star">*</span><input value={myNjDraft?.challengeQuestion || ''} onChange={(e) => onChangeMyNjDraft((old) => ({ ...old, challengeQuestion: e.target.value }))} /></label>
            <label>Challenge answer <span className="required-star">*</span><input value={myNjDraft?.challengeAnswer || ''} onChange={(e) => onChangeMyNjDraft((old) => ({ ...old, challengeAnswer: e.target.value }))} /></label>
            <div className="admin-action-row">
              <button className="primary" onClick={onSaveMyNjCredentials} disabled={busy}>Save login information</button>
              <button className="secondary" onClick={onCancelMyNjEdit} disabled={busy}>Cancel</button>
            </div>
          </div> : <>
            <div className="credential-grid">
              <div><span>MyNJ username</span><strong>{myNjCredentials.username}</strong><button onClick={() => onCopyCredential(myNjCredentials.username, 'Username')}>Copy</button></div>
              <div><span>MyNJ password</span><strong>{showMyNjSecrets ? myNjCredentials.password : '••••••••••••'}</strong><button onClick={() => onCopyCredential(myNjCredentials.password, 'Password')}>Copy</button></div>
              <div><span>Challenge question</span><strong>{myNjCredentials.challengeQuestion}</strong><button onClick={() => onCopyCredential(myNjCredentials.challengeQuestion, 'Challenge question')}>Copy</button></div>
              <div><span>Challenge answer</span><strong>{showMyNjSecrets ? myNjCredentials.challengeAnswer : '••••••••'}</strong><button onClick={() => onCopyCredential(myNjCredentials.challengeAnswer, 'Challenge answer')}>Copy</button></div>
            </div>
            <button className="secondary admin-full-button" onClick={onToggleShowSecrets}>{showMyNjSecrets ? 'Hide password and answer' : 'Reveal password and answer'}</button>
            <button className="secondary admin-full-button" onClick={onStartMyNjEdit}>Edit login information</button>
          </>}
          <p className="admin-help">Stored encrypted in the UEZ application. The applicant sees the same MyNJ information in their portal.</p>
          {application.pbs_status !== 'account_created' && application.pbs_status !== 'uez_approval_uploaded' && <button className="success-button admin-full-button" onClick={onMarkPbsAccountCreated} disabled={busy}>✓ PBS account has been created</button>}
          {(application.pbs_status === 'account_created' || application.status === 'waiting_for_uez_approval') && <p className="admin-help">Waiting for the applicant to upload the required UEZ approval email.</p>}
          {application.pbs_status === 'uez_approval_uploaded' && <p className="admin-help">The applicant uploaded the UEZ approval email. Open it in Documents below.</p>}
        </> : <>
          <p className="admin-help mynj-intro">This login is generated automatically as soon as the BRC is confirmed. If an earlier confirmation did not generate it, retry here.</p>
          <button
            className="primary admin-full-button"
            onClick={onCreateMyNjCredentials}
            disabled={busy || application.brc_status !== 'found'}
          >Generate missing MyNJ login</button>
          {application.brc_status !== 'found' && <p className="admin-help">The BRC must be confirmed first.</p>}
        </>}
      </section>
    </details>
  );
}
