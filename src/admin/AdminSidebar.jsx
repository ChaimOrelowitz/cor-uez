import React from 'react';

// Maps any DB status value → one of 5 canonical groups
function toGroup(app) {
  const s = app.status;
  if (s === 'applied' || s === 'grant_submitted' || s === 'submitted') return 'submitted';
  if (s === 'ready_for_submission') return 'ready';
  if (s === 'cancelled') return 'cancelled';
  if (!s || s === 'not_started') return 'not_started';
  return 'in_progress';
}

const GROUP_ORDER = ['not_started', 'in_progress', 'ready', 'submitted', 'cancelled'];
const GROUP_LABELS = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  ready:       'Ready for Submission',
  submitted:   'Submitted',
  cancelled:   'Cancelled',
};

// Days since a date string — returns null if date is missing/invalid
function daysSince(dateStr) {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(dateStr).getTime();
  if (isNaN(ms) || ms < 0) return null;
  return Math.floor(ms / 86400000);
}

// Aging tone for in_progress rows — null means no badge shown
function agingTone(days) {
  if (days === null || days < 7) return null;
  if (days < 14) return 'age-warn';    // yellow  7–13 d
  if (days < 30) return 'age-orange';  // orange 14–29 d
  return 'age-red';                    // red    30+ d
}

export default function AdminSidebar({ applications, selectedId, search, onSearchChange, onSelectApplication }) {
  const q = String(search || '').trim().toLowerCase();

  // Filter by search
  const matched = (applications || []).filter((app) => {
    if (!q) return true;
    return [app.business_name_input, app.registered_business_name, app.contact_email, app.ein]
      .some((v) => String(v || '').toLowerCase().includes(q));
  });

  // Group and sort newest-first within each group
  const groups = {};
  GROUP_ORDER.forEach((g) => { groups[g] = []; });
  matched.forEach((app) => {
    const g = toGroup(app);
    if (groups[g]) groups[g].push(app);
  });
  GROUP_ORDER.forEach((g) => {
    groups[g].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  });

  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar-head">
        <div className="sidebar-head-row">
          <span>APPLICATIONS</span>
          <strong>{applications.length}</strong>
        </div>
        <input
          placeholder="Search business, email, EIN"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="application-list">
        {GROUP_ORDER.map((groupKey) => {
          const rows = groups[groupKey];
          if (!rows.length) return null;
          return (
            <div key={groupKey} className={`sidebar-group sidebar-group-${groupKey}`}>
              <div className="sidebar-group-header">
                <span className="sidebar-group-label">{GROUP_LABELS[groupKey]}</span>
                <span className="sidebar-group-count">{rows.length}</span>
              </div>
              {rows.map((app) => {
                const paid = app.payment_status === 'paid';
                const paymentPending = app.payment_status === 'client_reported';
                // Aging — only flag in_progress (already moving beats already submitted/ready)
                const days = groupKey === 'in_progress' ? daysSince(app.updated_at) : null;
                const tone = agingTone(days);
                return (
                  <button
                    key={app.id}
                    className={`application-list-item sidebar-group-item-${groupKey} ${selectedId === app.id ? 'active' : ''}`}
                    onClick={() => onSelectApplication(app.id)}
                  >
                    <div className="sidebar-row-name">
                      {app.business_name_input || 'Unnamed business'}
                    </div>
                    <div className="sidebar-row-meta">
                      <span className="sidebar-row-date">
                        {app.created_at ? new Date(app.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                      </span>
                      {paid && <span className="sidebar-badge paid">Paid</span>}
                      {paymentPending && <span className="sidebar-badge payment-pending">$ Pending</span>}
                      {tone && <span className={`sidebar-badge aging ${tone}`} title={`No activity in ${days} days`}>{days}d</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
        {matched.length === 0 && <div className="empty-list">No applications found.</div>}
      </div>
    </aside>
  );
}
