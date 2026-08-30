import React, { useState } from 'react';
import { PROCESS_STEP_STATES, WAITING_ON_VALUES, formatTimestamp } from './caseLogic';

// One component, driven by props, reused for all 8 steps — not 8 bespoke
// components — so there's one place to keep the layout consistent and one
// place to audit against the old grid's gating rules during the migration.
//
// This is a deliberate departure from the rest of this session's "state
// stays in the parent, card is purely presentational" pattern: with 8 steps
// each needing their own small in-progress edit draft, putting that in
// AdminPage.jsx would mean 8x the state variables in an already-large file —
// exactly what this whole redesign is trying to reduce. So this card owns
// its own local "am I editing, what's the draft" UI state, and only calls
// back out to the parent (onSaveOperational) when Save is actually clicked.
const STATE_LABELS = {
  not_started: 'Not started', in_progress: 'In progress', waiting: 'Waiting',
  complete: 'Complete', not_applicable: 'Not applicable', manual: 'Handled manually'
};
const WAITING_ON_LABELS = {
  applicant: 'Waiting on applicant', accountant: 'Waiting on accountant',
  nj_state: 'Waiting on NJ State', document: 'Waiting on document', cor_follow_up: 'Waiting on me'
};

export default function ProcessStepCard({ stepKey, title, factsContent, operational, busy, onSaveOperational, actions }) {
  const [draft, setDraft] = useState(null); // null = not editing; object = in-progress edit
  const [saving, setSaving] = useState(false);

  const current = draft || {
    state: operational.state,
    waitingOn: operational.waitingOn || '',
    waitingSince: operational.waitingSince || '',
    waitingReason: operational.waitingReason || '',
    manualNote: operational.manualNote || ''
  };

  function updateDraft(field, value) {
    setDraft((old) => ({ ...(old || current), [field]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      await onSaveOperational(stepKey, {
        state: current.state,
        waitingOn: current.state === 'waiting' ? (current.waitingOn || null) : null,
        waitingSince: current.state === 'waiting' ? (current.waitingSince || null) : null,
        waitingReason: current.state === 'waiting' ? (current.waitingReason || null) : null,
        manualNote: current.manualNote || null
      });
      setDraft(null);
    } finally {
      setSaving(false);
    }
  }

  const pillTone = operational.state === 'complete' ? 'good' : (operational.state === 'waiting' || operational.state === 'in_progress') ? 'warn' : '';

  return (
    <div className="process-step-card" id={`process-step-${stepKey}`}>
      <div className="process-step-head">
        <h4>{title}</h4>
        <span className={`status-pill ${pillTone}`}>{STATE_LABELS[operational.state] || operational.state}</span>
      </div>

      <div className="process-step-facts">{factsContent}</div>

      <div className="process-step-operational">
        {!draft ? <>
          {operational.source === 'explicit'
            ? <small className="process-step-byline">Set by {operational.updatedByName || 'admin'} · {formatTimestamp(operational.updatedAt)}{operational.state === 'waiting' && operational.waitingOn ? ` · ${WAITING_ON_LABELS[operational.waitingOn]}` : ''}{operational.waitingReason ? ` — ${operational.waitingReason}` : ''}</small>
            : <small className="process-step-byline muted">(auto)</small>}
          <button type="button" className="text-button" onClick={() => setDraft(current)} disabled={busy}>Change status</button>
        </> : (
          <div className="process-step-edit">
            <select value={current.state} onChange={(e) => updateDraft('state', e.target.value)}>
              {PROCESS_STEP_STATES.map((s) => <option key={s} value={s}>{STATE_LABELS[s]}</option>)}
            </select>
            {current.state === 'waiting' && <>
              <select value={current.waitingOn} onChange={(e) => updateDraft('waitingOn', e.target.value)}>
                <option value="">Waiting on…</option>
                {WAITING_ON_VALUES.map((w) => <option key={w} value={w}>{WAITING_ON_LABELS[w]}</option>)}
              </select>
              <input type="date" value={current.waitingSince} onChange={(e) => updateDraft('waitingSince', e.target.value)} />
              <input placeholder="Reason (optional)" value={current.waitingReason} onChange={(e) => updateDraft('waitingReason', e.target.value)} />
            </>}
            <textarea placeholder="Note (optional)" rows={2} value={current.manualNote} onChange={(e) => updateDraft('manualNote', e.target.value)} />
            <div className="process-step-edit-actions">
              <button className="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              <button className="secondary" onClick={() => setDraft(null)} disabled={saving}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {actions?.length > 0 && <div className="process-step-actions">
        {actions.map((action) => (
          <div key={action.label} className="process-step-action">
            <button className="ops-action primary" onClick={action.onClick} disabled={action.disabled || busy}>{action.label}</button>
            {action.hint && <small className="process-step-action-hint">{action.hint}</small>}
            {action.disabled && action.disabledReason && <small className="process-step-action-disabled">{action.disabledReason}</small>}
          </div>
        ))}
      </div>}
    </div>
  );
}
