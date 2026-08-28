import React from 'react';
import { formatTimestamp } from './caseLogic';

// Read-only, chronological system/human action log — reuses the applicant
// portal's existing .timeline styling. Admins see every event (including
// internal-only ones the applicant never sees); events are never edited or
// deleted here, only added by the backend as things actually happen.
export default function ActivityPanel({ events }) {
  const list = events || [];
  return (
    <section className="admin-card admin-activity-card">
      <div className="admin-card-head"><h3>Activity</h3></div>
      <div className="timeline">
        {[...list].reverse().map((event) => (
          <div className="timeline-item" key={event.id}>
            <span className="timeline-dot"></span>
            <div>
              <strong>{event.label || event.status}</strong>
              {event.message && <p>{event.message}</p>}
              <small>{formatTimestamp(event.created_at)}{event.visible_to_applicant === false ? ' · Internal' : ''}</small>
            </div>
          </div>
        ))}
        {list.length === 0 && <p className="muted">No activity yet.</p>}
      </div>
    </section>
  );
}
