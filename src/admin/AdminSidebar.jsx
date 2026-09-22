import React from 'react';
import { displayBusinessName, nextStepStatus } from './caseLogic';

// The waterfall labels nextStepStatus() returns, in pipeline order, plus a
// Cancelled bucket pulled out separately - a cancelled application doesn't
// meaningfully "need" its next pipeline step anymore, so grouping it under
// whatever the waterfall happens to say next would be misleading.
const SECTION_ORDER = [
  'Not started', 'Needs BRC', 'Needs PBS', 'Needs TC', 'Needs UEZ',
  'Needs LDC application', 'Needs payment', 'Needs grant submission',
  'Complete', 'Cancelled',
];

function sectionKey(app) {
  return app.status === 'cancelled' ? 'Cancelled' : nextStepStatus(app);
}

// CSS-safe class suffix for a section label, e.g. "Needs LDC application" -> "needs-ldc-application"
function slug(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Maps any DB status value → one of 5 canonical groups
export function toGroup(app) {
  const s = app.status;
  if (s === 'applied' || s === 'grant_submitted' || s === 'submitted') return 'submitted';
  if (s === 'ready_for_submission') return 'ready';
  if (s === 'cancelled') return 'cancelled';
  if (!s || s === 'not_started') return 'not_started';
  return 'in_progress';
}

export const GROUP_ORDER = ['not_started', 'in_progress', 'ready', 'submitted', 'cancelled'];
// Compact form of the same 5 statuses - shown as the small per-row status
// badge (the sidebar's own section headers are the granular next-step
// labels now, see SECTION_ORDER above).
export const ROW_STATUS_LABELS = {
  not_started: 'New',
  in_progress: 'In Progress',
  ready:       'Ready',
  submitted:   'Submitted',
  cancelled:   'Cancelled',
};

// Same 5-group breakdown the sidebar sections use, for the topbar counter
// cluster - so the counts stay visible even while the sidebar is collapsed.
export function groupCounts(applications) {
  const counts = { not_started: 0, in_progress: 0, ready: 0, submitted: 0, cancelled: 0 };
  (applications || []).forEach((app) => { counts[toGroup(app)] += 1; });
  return counts;
}

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
  const [collapsed, setCollapsed] = React.useState(() => new Set());
  const q = String(search || '').trim().toLowerCase();

  // Filter by search
  const matched = (applications || []).filter((app) => {
    if (!q) return true;
    return [app.business_name_input, app.registered_business_name, app.contact_email, app.ein]
      .some((v) => String(v || '').toLowerCase().includes(q));
  });

  // Group by granular pipeline position (Not started / Needs BRC / ... /
  // Complete, plus Cancelled) instead of the coarse 5-value status column -
  // "what does this case actually need next" is the more useful triage view.
  const groups = {};
  SECTION_ORDER.forEach((g) => { groups[g] = []; });
  matched.forEach((app) => {
    const g = sectionKey(app);
    if (groups[g]) groups[g].push(app);
  });
  SECTION_ORDER.forEach((g) => {
    groups[g].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  });

  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar-head">
        <div className="sidebar-head-row">
          <span>APPLICATIONS</span>
        </div>
        <input
          placeholder="Search business, email, EIN"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="application-list">
        {SECTION_ORDER.map((section) => {
          const rows = groups[section];
          if (!rows.length) return null;
          const key = slug(section);
          const isCollapsed = collapsed.has(section);
          return (
            <div key={section} className={`sidebar-group sidebar-group-${key}`}>
              <button
                type="button"
                className="sidebar-group-header"
                onClick={() => setCollapsed((old) => {
                  const next = new Set(old);
                  if (next.has(section)) next.delete(section); else next.add(section);
                  return next;
                })}
                aria-expanded={!isCollapsed}
              >
                <span className="sidebar-group-label-row">
                  <span className={`sidebar-group-chevron ${isCollapsed ? 'collapsed' : ''}`}>▾</span>
                  <span className="sidebar-group-label">{section}</span>
                </span>
                <span className="sidebar-group-count">{rows.length}</span>
              </button>
              {!isCollapsed && rows.map((app) => {
                const coarseGroup = toGroup(app);
                const nextStep = nextStepStatus(app);
                const paymentTone = app.payment_status === 'paid' ? 'paid' : app.payment_status === 'client_reported' ? 'pending' : 'unpaid';
                const paymentLabel = paymentTone === 'paid' ? 'Paid' : paymentTone === 'pending' ? 'Pending' : 'Not paid';
                // Aging — only flag in_progress (already moving beats already submitted/ready)
                const days = coarseGroup === 'in_progress' ? daysSince(app.updated_at) : null;
                const tone = agingTone(days);
                return (
                  <a
                    key={app.id}
                    href={`/admin/businesses/${encodeURIComponent(app.id)}`}
                    className={`application-list-item sidebar-group-item-${key} ${selectedId === app.id ? 'active' : ''}`}
                    onClick={(e) => {
                      // Plain left-click navigates in place (same handler as
                      // before); ctrl/cmd/shift/middle-click falls through to
                      // the real href so "open in new tab" / "copy link" work.
                      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                      e.preventDefault();
                      onSelectApplication(app.id);
                    }}
                  >
                    <div className="sidebar-row-top">
                      <span className="sidebar-row-name">{displayBusinessName(app) || 'Unnamed business'}</span>
                      <span className="sidebar-row-date">
                        {app.created_at ? new Date(app.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                      </span>
                    </div>
                    <div className="sidebar-row-meta">
                      <div className="sidebar-row-meta-left">
                        <span className={`sidebar-badge status-${coarseGroup}`}>{ROW_STATUS_LABELS[coarseGroup]}</span>
                        <span className={`sidebar-badge next-step ${nextStep === 'Complete' ? 'next-step-complete' : ''}`}>{nextStep}</span>
                      </div>
                      <div className="sidebar-row-meta-right">
                        {tone && <span className={`sidebar-badge aging ${tone}`} title={`No activity in ${days} days`}>{days}d</span>}
                        <span className={`sidebar-badge payment-${paymentTone}`}>{paymentLabel}</span>
                      </div>
                    </div>
                  </a>
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
