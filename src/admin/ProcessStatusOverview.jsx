import React from 'react';
import { PROCESS_STEP_KEYS, PROCESS_STEP_TITLES, PROCESS_STEP_STATE_LABELS, resolveProcessStep } from './caseLogic';

// Replaces the old single "recommended next action" banner - that only ever
// surfaced one step at a time, picked by a rank/priority calculation that
// wasn't obvious from the label alone ("Confirm PBS account answer" told you
// what to click, not what it actually meant). This just lays out where every
// one of the 8 steps stands, plainly, all at once. Read-only - no click-to-
// change here, that's what each step's own card (and its own status pill)
// is for.
export default function ProcessStatusOverview({ detail }) {
  return (
    <div className="process-status-overview">
      {PROCESS_STEP_KEYS.map((stepKey) => {
        const operational = resolveProcessStep(stepKey, detail);
        const tone = operational.state === 'complete' ? 'good' : (operational.state === 'waiting' || operational.state === 'in_progress') ? 'warn' : '';
        return (
          <div key={stepKey} className="process-status-item">
            <span className="process-status-title">{PROCESS_STEP_TITLES[stepKey]}</span>
            <span className={`status-pill ${tone}`}>{PROCESS_STEP_STATE_LABELS[operational.state] || operational.state}</span>
          </div>
        );
      })}
    </div>
  );
}
