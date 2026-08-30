import React, { useState } from 'react';
import { PROCESS_STEP_STATES, PROCESS_STEP_STATE_LABELS as STATE_LABELS, formatTimestamp } from './caseLogic';

// One component, driven by props, reused for all 8 steps — not 8 bespoke
// components — so there's one place to keep the layout consistent and one
// place to audit against the old grid's gating rules during the migration.
//
// The status pill itself is the control: pick a value, it saves immediately.
// No "Change status" link, no separate edit form, no Save/Cancel step —
// whatever you click it to is what it is. That means the richer waiting-on/
// since/reason/manual-note fields the old edit form had are gone too; this
// card only ever writes a bare state change now. Any previously-saved
// waitingOn/waitingReason still displays in the byline below (historical
// data, read-only here), it just can't be set from this control anymore.
//
// One escape hatch: since there's no confirm step, a stray click can leave
// a wrong value stuck with no way back to "let the facts decide." Once an
// explicit verdict exists, the same dropdown gets a "Reset to auto" option
// that deletes it and reverts to the calculated default.
const WAITING_ON_LABELS = {
  applicant: 'Waiting on applicant', accountant: 'Waiting on accountant',
  nj_state: 'Waiting on NJ State', document: 'Waiting on document', cor_follow_up: 'Waiting on me'
};

const RESET_VALUE = '__reset__';

export default function ProcessStepCard({ stepKey, title, factsContent, operational, busy, onSaveOperational, onResetOperational, actions }) {
  const [saving, setSaving] = useState(false);

  async function changeState(newValue) {
    if (newValue === operational.state) return;
    setSaving(true);
    try {
      if (newValue === RESET_VALUE) {
        await onResetOperational(stepKey);
      } else {
        await onSaveOperational(stepKey, {
          state: newValue,
          waitingOn: null,
          waitingSince: null,
          waitingReason: null,
          manualNote: operational.manualNote || null
        });
      }
    } finally {
      setSaving(false);
    }
  }

  const pillTone = operational.state === 'complete' ? 'good' : (operational.state === 'waiting' || operational.state === 'in_progress') ? 'warn' : '';

  return (
    <div className="process-step-card" id={`process-step-${stepKey}`}>
      <div className="process-step-head">
        <h4>{title}</h4>
        <select
          className={`status-pill status-pill-select ${pillTone}`}
          value={operational.state}
          onChange={(e) => changeState(e.target.value)}
          disabled={busy || saving}
        >
          {PROCESS_STEP_STATES.map((s) => <option key={s} value={s}>{STATE_LABELS[s]}</option>)}
          {operational.source === 'explicit' && <option value={RESET_VALUE}>↺ Reset to auto</option>}
        </select>
      </div>

      <div className="process-step-facts">{factsContent}</div>

      {operational.source === 'explicit' && <div className="process-step-operational">
        <small className="process-step-byline">Set by {operational.updatedByName || 'admin'} · {formatTimestamp(operational.updatedAt)}{operational.state === 'waiting' && operational.waitingOn ? ` · ${WAITING_ON_LABELS[operational.waitingOn]}` : ''}{operational.waitingReason ? ` — ${operational.waitingReason}` : ''}</small>
      </div>}

      {actions?.length > 0 && <div className="process-step-actions">
        {actions.map((action) => (
          <div key={action.label} className="process-step-action">
            <button className="ops-action primary" onClick={action.onClick} disabled={action.disabled || busy}>{action.label}</button>
          </div>
        ))}
      </div>}
    </div>
  );
}
