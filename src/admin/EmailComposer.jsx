import React from 'react';
import { formatTimestamp } from './caseLogic';

// Friendly labels for the modal header — falls back to the raw template_key
// for any template not in this list (e.g. one added later straight in the
// Email Settings page), so a new template never breaks the composer.
const TEMPLATE_LABELS = {
  brc_not_found:              'BRC not found',
  brc_wrong_address:          'BRC address not in UEZ',
  formation_rejected:         'Formation replacement request',
  pbs_account_created:        'PBS account created',
  tax_issue:                  'Tax clearance issue',
  uez_application_submitted:  'UEZ application submitted',
  payment_received:           'Payment received',
  grant_submitted:            'Grant submitted',
};

// The "show me the actual email before it goes out" flow: preview loads,
// subject/body are editable, Send calls back into the caller, and the
// durable sent/failed result stays visible until the admin closes it.
// State lives in the parent (AdminPage) since opening/sending both need the
// selected application's id — this is purely presentational.
export default function EmailComposer({ composer, onChangeSubject, onChangeBody, onSend, onClose }) {
  if (!composer) return null;

  return (
    <div className="document-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !composer.sending) onClose(); }}>
      <div className="document-modal email-composer-modal" role="dialog" aria-modal="true" aria-label="Send email">
        <div className="document-modal-head">
          <div><strong>Send email</strong><small>{TEMPLATE_LABELS[composer.templateKey] || composer.templateKey}</small></div>
          <button onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="document-modal-body email-composer-body">
          {composer.loading ? <div className="document-modal-loading">Loading preview…</div> : composer.error && !composer.subject ? <p className="admin-message">{composer.error}</p> : <>
            {composer.sentResult && <div className={`admin-message ${composer.sentResult.sent ? '' : 'admin-message-error'}`}>
              {composer.sentResult.sent
                ? `✅ Email sent to ${composer.recipient} · ${formatTimestamp(composer.sentResult.log?.sent_at) || 'just now'}`
                : `⚠️ Email was not sent${composer.sentResult.error ? `: ${composer.sentResult.error}` : '.'}`}
            </div>}
            {composer.error && <p className="admin-message admin-message-error">{composer.error}</p>}
            <label>To</label><input value={composer.recipient} disabled />
            <label>Subject</label>
            <input value={composer.subject} onChange={(e) => onChangeSubject(e.target.value)} disabled={Boolean(composer.sentResult?.sent)} />
            <label>Body</label>
            <textarea rows={10} value={composer.body} onChange={(e) => onChangeBody(e.target.value)} disabled={Boolean(composer.sentResult?.sent)} />
            {composer.attachments?.length > 0 && <div className="email-composer-attachments">
              <label>Attachments</label>
              {composer.attachments.map((a) => (
                <div key={a.filename} className="email-composer-attachment">
                  <span>{a.filename}</span>
                  <small>{a.contentType} · {Math.round((a.size || 0) / 1024)} KB</small>
                </div>
              ))}
            </div>}
          </>}
        </div>
        <div className="document-modal-footer">
          <div></div>
          {!composer.sentResult?.sent && <button className="primary" onClick={onSend} disabled={composer.loading || !composer.subject}>{composer.sending ? 'Sending…' : 'Send'}</button>}
          {composer.sentResult?.sent && <button className="secondary" onClick={onClose}>Done</button>}
        </div>
      </div>
    </div>
  );
}
