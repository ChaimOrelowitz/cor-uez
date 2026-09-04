import React from 'react';

export default function BrcDetailsCard({ application, brcForm, busy, onChangeBrcForm, onBrcFound, onBrcNotFound }) {
  return (
    <details className="admin-accordion">
      <summary><strong>BRC details</strong><span>{application.brc_status === 'found' ? 'Found' : (application.brc_status || 'Pending')}</span></summary>
      <section className="admin-card brc-admin-card admin-secondary-card">
        <div className="admin-card-head">
          <h3>BRC details</h3>
          <span className={`status-pill ${application.brc_status === 'found' ? 'good' : application.status === 'waiting_for_brc' ? 'warn' : ''}`}>{application.brc_status || 'pending'}</span>
        </div>

        <div className="brc-result-form">
          <label>Registered business name</label>
          <input value={brcForm.registeredBusinessName} onChange={(e) => onChangeBrcForm((old) => ({ ...old, registeredBusinessName: e.target.value }))} />
          <label>DBA / trade name</label>
          <input value={brcForm.tradeName} onChange={(e) => onChangeBrcForm((old) => ({ ...old, tradeName: e.target.value }))} />
          <label>Business address</label>
          <input value={brcForm.address} onChange={(e) => onChangeBrcForm((old) => ({ ...old, address: e.target.value }))} />
        </div>

        {/* Sending the BRC problem email lives on the BRC process card above
            now — one action surface instead of two identical buttons. */}
        <div className="admin-action-row">
          <button className="success-button" onClick={onBrcFound}>✓ BRC found</button>
          <button className="warning-button" onClick={onBrcNotFound}>No BRC found</button>
        </div>
      </section>
    </details>
  );
}
