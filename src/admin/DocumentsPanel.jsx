import React from 'react';
import { documentLabel } from './caseLogic';

// The full document list (reference/manual-override surface) - the case
// page's own document checklist further up the page is what drives the
// day-to-day workflow; this is the complete list with delete.
export default function DocumentsPanel({ documents, busy, onOpen, onDelete }) {
  const list = documents || [];
  return (
    <details className="admin-accordion">
      <summary><strong>Documents</strong><span>{`${list.length} files`}</span></summary>
      <section className="admin-card admin-documents-card admin-secondary-card">
        <div className="admin-card-head"><h3>Documents</h3><span>{list.length}</span></div>
        <div className="admin-document-list">
          {list.map((doc) => (
            <div key={doc.id} className="admin-doc-row">
              <button type="button" className="admin-doc-open-btn" onClick={() => onOpen(doc)}>
                <span><strong>{documentLabel(doc.document_type)}</strong><small>{doc.filename}</small></span>
                <b>Open</b>
              </button>
              <button type="button" className="admin-doc-delete-btn" onClick={() => onDelete(doc)} disabled={busy} title="Delete document">
                Delete
              </button>
            </div>
          ))}
          {list.length === 0 && <p className="muted">No documents uploaded.</p>}
        </div>
      </section>
    </details>
  );
}
