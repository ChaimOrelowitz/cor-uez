import React from 'react';
import { paymentStatusLabel } from './caseLogic';

export default function PaymentCard({ payments, draft, busy, onDraftChange, onConfirm }) {
  const latest = payments?.[payments.length - 1];
  return (
    <details className="admin-accordion">
      <summary><strong>Payment details</strong><span>{paymentStatusLabel(latest?.status)}</span></summary>
      <section className="admin-card payment-admin-card admin-secondary-card">
        <div className="admin-card-head">
          <h3>Payment details</h3>
          <span>{latest?.status === 'paid' ? 'PAID' : latest?.status === 'client_reported' ? 'CLIENT SAYS PAID' : 'NOT RECORDED'}</span>
        </div>
        {latest?.status === 'client_reported' && <div className="admin-alert">Client says payment was sent. Check your bank before confirming.</div>}
        <div className="admin-edit-grid">
          <div><label>Amount</label><input type="number" value={draft.amount} onChange={(e) => onDraftChange((old) => ({ ...old, amount: e.target.value }))} /></div>
          <div><label>Date</label><input type="date" value={draft.paymentDate} onChange={(e) => onDraftChange((old) => ({ ...old, paymentDate: e.target.value }))} /></div>
          <div><label>Method</label><input value={draft.paymentMethod} onChange={(e) => onDraftChange((old) => ({ ...old, paymentMethod: e.target.value }))} /></div>
          <div><label>Reference</label><input value={draft.reference} onChange={(e) => onDraftChange((old) => ({ ...old, reference: e.target.value }))} /></div>
          <div className="admin-edit-wide"><label>Notes</label><input value={draft.notes} onChange={(e) => onDraftChange((old) => ({ ...old, notes: e.target.value }))} /></div>
        </div>
        {latest?.status !== 'paid' && <button className="success-button admin-full-button" onClick={onConfirm} disabled={busy}>✓ Confirm payment received</button>}
      </section>
    </details>
  );
}
