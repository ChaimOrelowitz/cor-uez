import React from 'react';

// Pure reuse of adminQueueInfo — the same computation that already drives
// the sidebar's sort order and per-row label, just surfaced prominently on
// the case page itself instead of only being visible one row at a time in
// the list. No new decision logic lives here.
export default function RecommendedActionBanner({ queue }) {
  if (!queue) return null;
  return (
    <div className={`recommended-action-banner tone-${queue.tone}`}>
      <i aria-hidden="true" />
      <div className="recommended-action-body">
        <span className="recommended-action-label">Recommended next</span>
        <strong>{queue.action}</strong>
        {queue.secondaryAction && (
          <small className={`recommended-action-secondary tone-${queue.secondaryAction.tone}`}>
            Also: {queue.secondaryAction.action}
          </small>
        )}
      </div>
      <span className="recommended-action-stage">{queue.stage}</span>
    </div>
  );
}
