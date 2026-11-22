import React, { useRef, useState } from 'react';
import { REQUIRED_GRANT_DOCUMENTS, docsFor } from './caseLogic';

// Every type a file can be filed as (drop zone, "File as" on email attachments).
const FILE_AS = [
  ...REQUIRED_GRANT_DOCUMENTS,
  ['tax_clearance_issue', 'Tax clearance issue screenshot'],
  ['supporting', 'Other / supporting'],
];
const REQUIRED_TYPES = new Set(REQUIRED_GRANT_DOCUMENTS.map(([type]) => type));
const TYPE_LABEL = Object.fromEntries(FILE_AS);

// Which step each required document belongs to (clicking its name jumps there).
const STEP_FOR = {
  formation: 'formation', brc: 'brc', tax_clearance: 'tax_clearance',
  uez_pending_certification: 'uez_enrollment', uez_approval_email: 'uez_enrollment',
  ldc_application: 'ldc_application',
};

function sourceLabel(doc) {
  if (doc.source === 'applicant_upload') return 'client';
  if (doc.source === 'email') return 'from email';
  if (doc.metadata?.capturedBy === 'chrome_extension' || doc.source === 'extension_capture') return 'COR extension';
  if (doc.source === 'admin_upload') return 'COR';
  return doc.source || '';
}

function shortDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Status for one required document: { icon, tone, text }.
function rowStatus(type, latest, app, detail) {
  if (type === 'formation') {
    if (!latest) return app.is_sole_proprietorship
      ? { icon: '–', tone: 'muted', text: 'Not needed (sole prop)' }
      : { icon: '○', tone: 'missing', text: 'Missing' };
    const review = app.formation_review_status || 'not_reviewed';
    if (review === 'approved') return { icon: '✓', tone: 'ok', text: 'Approved' };
    if (review === 'rejected') return { icon: '⚠', tone: 'warn', text: 'Wrong document' };
    return { icon: '◐', tone: 'review', text: 'Needs review' };
  }
  if (type === 'uez_approval_email' && latest) {
    const review = app.uez_approval_review_status || 'not_reviewed';
    if (review === 'approved') return { icon: '✓', tone: 'ok', text: 'Approved' };
    if (review === 'rejected') return { icon: '⚠', tone: 'warn', text: 'Wrong document' };
    return { icon: '◐', tone: 'review', text: 'Needs review' };
  }
  if (type === 'tax_clearance' && !latest
      && (app.tax_clearance_status === 'issue' || docsFor(detail, 'tax_clearance_issue').length)) {
    return { icon: '⚠', tone: 'warn', text: 'Issue reported' };
  }
  return latest ? { icon: '✓', tone: 'ok', text: 'On file' } : { icon: '○', tone: 'missing', text: 'Missing' };
}

// One file input per row, opened by its Upload / Replace button.
function UploadButton({ label, type, busy, onFile }) {
  const input = useRef(null);
  return (
    <>
      <button type="button" className="cw-dl-btn" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Uploading…' : label}
      </button>
      <input ref={input} type="file" accept=".pdf,.eml,image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(type, f); }} />
    </>
  );
}

// Lets a row (or the header) accept a dropped file.
function useDrop(onDropFile) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setOver(true); } },
      onDragLeave: () => setOver(false),
      onDrop: (e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer?.files?.[0]; if (f) onDropFile(f); },
    },
  };
}

function DocRow({ type, label, detail, previewDocument, uploadDocumentDirect, directUploadType, goToStep }) {
  const app = detail.application;
  const all = docsFor(detail, type);
  const latest = all[all.length - 1] || null;
  const earlier = all.slice(0, -1).reverse();
  const status = rowStatus(type, latest, app, detail);
  const [showEarlier, setShowEarlier] = useState(false);
  const drop = useDrop((file) => uploadDocumentDirect(type, file));
  const busy = directUploadType === type;

  return (
    <li className={`cw-dl-row tone-${status.tone}${drop.over ? ' drop' : ''}`} {...drop.props}>
      <span className="cw-dl-icon" aria-hidden="true">{status.icon}</span>
      <button type="button" className="cw-dl-name" onClick={() => STEP_FOR[type] && goToStep(STEP_FOR[type])} title="Go to this step">
        {label}
      </button>
      <span className="cw-dl-meta">
        {latest ? (
          <>
            <button type="button" className="cw-dl-file" onClick={() => previewDocument(latest)} title="View">{latest.filename}</button>
            <span>{sourceLabel(latest)}</span>
            <span>{shortDate(latest.created_at)}</span>
            {status.tone !== 'ok' && <span className={`cw-dl-status tone-${status.tone}`}>{status.text}</span>}
            {earlier.length > 0 && (
              <button type="button" className="cw-dl-more" onClick={() => setShowEarlier((v) => !v)}>
                {showEarlier ? 'hide earlier' : `+${earlier.length} earlier`}
              </button>
            )}
          </>
        ) : (
          <span className={`cw-dl-status tone-${status.tone}`}>{status.text}</span>
        )}
      </span>
      <span className="cw-dl-actions">
        {latest && <button type="button" className="cw-dl-btn" onClick={() => previewDocument(latest)}>View</button>}
        <UploadButton label={latest ? 'Replace' : 'Upload'} type={type} busy={busy} onFile={uploadDocumentDirect} />
      </span>
      {showEarlier && (
        <ul className="cw-dl-earlier">
          {earlier.map((doc) => (
            <li key={doc.id}>
              <button type="button" className="cw-dl-file" onClick={() => previewDocument(doc)}>{doc.filename}</button>
              <span>{sourceLabel(doc)} · {shortDate(doc.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function DocsChecklist({ detail, previewDocument, uploadDocumentDirect, directUploadType, goToStep, fileEmailAttachment }) {
  const documents = detail.documents || [];
  const onFile = REQUIRED_GRANT_DOCUMENTS.filter(([type]) => docsFor(detail, type).length).length;
  const others = documents.filter((doc) => !REQUIRED_TYPES.has(doc.document_type)).slice().reverse();

  // A file dropped/chosen at the top waits here until you say what it is.
  const [pending, setPending] = useState(null);
  const [pendingType, setPendingType] = useState('supporting');
  const headerInput = useRef(null);
  const headerDrop = useDrop((file) => { setPending(file); setPendingType('supporting'); });

  // Attachments clients emailed in (inbound, real files - not inline logos).
  const filed = new Map();
  documents.forEach((doc) => {
    if (doc.metadata?.fromMessageId != null) filed.set(`${doc.metadata.fromMessageId}:${doc.metadata.attachmentIndex}`, doc.document_type);
  });
  const emailed = (detail.messages || [])
    .filter((m) => m.direction === 'inbound')
    .flatMap((m) => (m.attachments || [])
      .filter((a) => !a.inline && a.url)
      .map((a) => ({ message: m, attachment: a, key: `${m.id}:${a.index}` })));
  const [fileAs, setFileAs] = useState({});
  const [filing, setFiling] = useState('');

  async function fileAttachment(item) {
    const type = fileAs[item.key];
    if (!type) return;
    setFiling(item.key);
    try {
      await fileEmailAttachment({ messageId: item.message.id, attachmentIndex: item.attachment.index, documentType: type });
    } finally {
      setFiling('');
    }
  }

  return (
    <div className="cw-docs">
      <div className={`cw-dl-head${headerDrop.over ? ' drop' : ''}`} {...headerDrop.props}>
        <strong>{onFile} of {REQUIRED_GRANT_DOCUMENTS.length} on file</strong>
        {pending ? (
          <span className="cw-dl-pending">
            <span className="cw-dl-pending-name">{pending.name}</span>
            <span>file as</span>
            <select value={pendingType} onChange={(e) => setPendingType(e.target.value)}>
              {FILE_AS.map(([type, label]) => <option key={type} value={type}>{label}</option>)}
            </select>
            <button type="button" className="cw-dl-btn primary-ish"
              onClick={async () => { const f = pending; setPending(null); await uploadDocumentDirect(pendingType, f); }}>Upload</button>
            <button type="button" className="cw-dl-btn" onClick={() => setPending(null)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className="cw-dl-dropzone" onClick={() => headerInput.current?.click()}>
            Drop a file here or <u>choose</u>, then pick what it is
          </button>
        )}
        <input ref={headerInput} type="file" accept=".pdf,.eml,image/*" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setPending(f); setPendingType('supporting'); } }} />
      </div>

      <ul className="cw-dl">
        {REQUIRED_GRANT_DOCUMENTS.map(([type, label]) => (
          <DocRow key={type} type={type} label={label} detail={detail}
            previewDocument={previewDocument} uploadDocumentDirect={uploadDocumentDirect}
            directUploadType={directUploadType} goToStep={goToStep} />
        ))}
      </ul>

      {others.length > 0 && (
        <section className="cw-dl-section">
          <h4>Other files <span>{others.length}</span></h4>
          <ul className="cw-dl-simple">
            {others.map((doc) => (
              <li key={doc.id}>
                <span className="cw-dl-kind">{TYPE_LABEL[doc.document_type] || doc.document_type}</span>
                <button type="button" className="cw-dl-file" onClick={() => previewDocument(doc)}>{doc.filename}</button>
                <span className="cw-dl-sub">{sourceLabel(doc)} · {shortDate(doc.created_at)}</span>
                <button type="button" className="cw-dl-btn" onClick={() => previewDocument(doc)}>View</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {emailed.length > 0 && (
        <section className="cw-dl-section">
          <h4>From emails <span>{emailed.length}</span></h4>
          <ul className="cw-dl-simple cw-dl-emails">
            {emailed.map((item) => {
              const already = filed.get(item.key);
              return (
                <li key={item.key}>
                  <span className="cw-dl-kind">✉</span>
                  <a className="cw-dl-file" href={item.attachment.url} target="_blank" rel="noreferrer">{item.attachment.filename}</a>
                  <span className="cw-dl-sub" title={item.message.subject || ''}>
                    {item.message.fromName || item.message.from} · {shortDate(item.message.sentAt)}
                  </span>
                  {already ? (
                    <span className="cw-dl-status tone-ok">Filed as {TYPE_LABEL[already] || already}</span>
                  ) : (
                    <span className="cw-dl-fileas">
                      <select value={fileAs[item.key] || ''} onChange={(e) => setFileAs((v) => ({ ...v, [item.key]: e.target.value }))}>
                        <option value="">File as…</option>
                        {FILE_AS.map(([type, label]) => <option key={type} value={type}>{label}</option>)}
                      </select>
                      <button type="button" className="cw-dl-btn" disabled={!fileAs[item.key] || filing === item.key}
                        onClick={() => fileAttachment(item)}>{filing === item.key ? 'Filing…' : 'File'}</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
