import React from 'react';
import { documentLabel } from './caseLogic';

// The full document list (reference/manual-override surface) - the case
// page's own document checklist further up the page is what drives the
// day-to-day workflow; this is the complete list with delete. Manual upload
// lives here too now (it used to float alone in its own half-empty section
// up top) - this is its natural home, a fallback/records tool right next to
// the records it's a fallback for.
export default function DocumentsPanel({
  documents, busy, onOpen, onDelete,
  manualDocType, onChangeManualDocType, manualDocFile, onChangeManualDocFile, manualDocUploading, onUploadManualDoc
}) {
  const list = documents || [];
  return (
    <details className="admin-accordion">
      <summary><strong>Documents</strong><span>{`${list.length} files`}</span></summary>
      <section className="admin-card admin-documents-card admin-secondary-card">
        <div className="admin-card-head"><h3>Documents</h3><span className="status-pill">{list.length}</span></div>
        <div className="admin-document-list">
          {list.map((doc) => (
            <div key={doc.id} className="admin-doc-row">
              <button type="button" className="admin-doc-open-btn" onClick={() => onOpen(doc)}>
                <span><strong>{documentLabel(doc.document_type)}</strong><small>{doc.filename}</small></span>
                <b>Open</b>
              </button>
              <button type="button" className="admin-doc-delete-btn" onClick={() => onDelete(doc)} title="Delete document">
                Delete
              </button>
            </div>
          ))}
          {list.length === 0 && <p className="muted">No documents uploaded.</p>}
        </div>

        <div className="admin-manual-upload">
          <div className="admin-manual-upload-head"><strong>Manual document upload</strong><small>Fallback / records</small></div>
          <select value={manualDocType} onChange={(e) => onChangeManualDocType(e.target.value)}>
            <option value="formation">Certificate of Formation</option>
            <option value="brc">Business Registration Certificate</option>
            <option value="uez_pending_certification">UEZ Pending Certification Application</option>
            <option value="uez_approval_email">UEZ Approval Email</option>
            <option value="tax_clearance">Tax Clearance Letter</option>
            <option value="tax_clearance_issue">Tax Clearance Issue Screenshot</option>
            <option value="ldc_application">Signed LDC Application</option>
            <option value="supporting">Other / Supporting Document</option>
          </select>
          <input type="file" accept=".pdf,.eml,image/*" onChange={(e) => onChangeManualDocFile(e.target.files?.[0] || null)} />
          <button className="secondary" onClick={onUploadManualDoc} disabled={manualDocUploading || !manualDocFile}>{manualDocUploading ? 'Uploading…' : 'Upload document'}</button>
        </div>
      </section>
    </details>
  );
}
