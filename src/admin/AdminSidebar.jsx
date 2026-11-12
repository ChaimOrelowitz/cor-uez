import React from 'react';
import { applicationMatchesSearch, displayBusinessName, nextStepStatus, sidebarTurn } from './caseLogic';

// The waterfall labels nextStepStatus() returns, in pipeline order, plus two
// buckets pulled out separately and overriding the waterfall entirely:
// Call State sits at the very top (an admin flagged this case as needing a
// phone call to the state, regardless of where it sits in the pipeline), and
// Cancelled sits at the bottom - a cancelled application doesn't meaningfully
// "need" its next pipeline step anymore.
const SECTION_ORDER = [
  'Call State',
  'Not started', 'Needs BRC', 'Needs PBS', 'Needs TC', 'Needs UEZ',
  'Needs LDC application', 'Needs payment', 'Needs grant submission',
  'Awaiting LDC', 'Complete', 'Cancelled',
];

function sectionKey(app) {
  if (app.status === 'call_state') return 'Call State';
  if (app.status === 'cancelled') return 'Cancelled';
  return nextStepStatus(app);
}

// CSS-safe class suffix for a section label, e.g. "Needs LDC application" -> "needs-ldc-application"
function slug(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Maps any DB status value → one of 6 canonical groups
export function toGroup(app) {
  const s = app.status;
  if (s === 'applied' || s === 'grant_submitted' || s === 'submitted') return 'submitted';
  if (s === 'ready_for_submission') return 'ready';
  if (s === 'cancelled') return 'cancelled';
  if (s === 'call_state') return 'call_state';
  if (!s || s === 'not_started') return 'not_started';
  return 'in_progress';
}

export const GROUP_ORDER = ['not_started', 'in_progress', 'ready', 'submitted', 'call_state', 'cancelled'];
// Compact form of the same statuses - shown as the small per-row status
// badge (the sidebar's own section headers are the granular next-step
// labels now, see SECTION_ORDER above).
export const ROW_STATUS_LABELS = {
  not_started: 'New',
  in_progress: 'In Progress',
  ready:       'Ready',
  submitted:   'Submitted',
  call_state:  'Call State',
  cancelled:   'Cancelled',
};

// Same 5-group breakdown the sidebar sections use, for the topbar counter
// cluster - so the counts stay visible even while the sidebar is collapsed.
export function groupCounts(applications) {
  const counts = { not_started: 0, in_progress: 0, ready: 0, submitted: 0, cancelled: 0 };
  (applications || []).filter((app) => !isIncompleteSignup(app)).forEach((app) => { counts[toGroup(app)] += 1; });
  return counts;
}

// The applicant started the online signup but never pressed Submit (which
// now requires the BRC). These are kept out of the work queue and parked in
// a collapsed "Not completed" section at the bottom of the sidebar.
export function isIncompleteSignup(app) {
  return !app.submitted_at && app.status !== 'cancelled';
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
  const [showIncomplete, setShowIncomplete] = React.useState(false);

  // Filter by search; unfinished signups are listed separately at the bottom.
  const searched = (applications || []).filter((app) => applicationMatchesSearch(app, search));
  const matched = searched.filter((app) => !isIncompleteSignup(app));
  const incomplete = searched.filter(isIncompleteSignup)
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));

  // Two levels: whose turn it is (My move / Waiting - see sidebarTurn), then
  // the granular next-step label inside each. Call State, Complete and
  // Cancelled stay as their own top-level sections. My move runs oldest
  // first (it's a queue); Waiting runs longest-untouched first, since that's
  // what most needs a nudge.
  const blocks = [
    { turn: 'call_state', title: null },
    { turn: 'mine', title: 'My move' },
    { turn: 'waiting', title: 'Waiting on applicant / state' },
    { turn: 'done', title: null },
    { turn: 'cancelled', title: null },
  ].map((block) => ({ ...block, groups: {}, total: 0 }));
  const byTurn = Object.fromEntries(blocks.map((b) => [b.turn, b]));
  matched.forEach((app) => {
    const section = sectionKey(app);
    const turn = section === 'Call State' ? 'call_state'
      : section === 'Cancelled' ? 'cancelled'
      : section === 'Complete' ? 'done'
      : sidebarTurn(app) === 'waiting' ? 'waiting' : 'mine';
    const block = byTurn[turn];
    (block.groups[section] ||= []).push(app);
    block.total += 1;
  });
  const time = (value) => new Date(value || 0).getTime();
  blocks.forEach((block) => {
    Object.values(block.groups).forEach((rows) => rows.sort((a, b) => (
      block.turn === 'waiting' ? time(a.updated_at) - time(b.updated_at)
      : block.turn === 'mine' ? time(a.created_at) - time(b.created_at)
      : time(b.created_at) - time(a.created_at)
    )));
  });

  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar-head">
        <div className="sidebar-head-row">
          <span>APPLICATIONS</span>
        </div>
        <input
          placeholder="Search business, owner, phone, email, EIN"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="application-list">
        {blocks.map((block) => block.total > 0 && <div key={block.turn} className={`sidebar-turn sidebar-turn-${block.turn}`}>
          {block.title && <div className="sidebar-turn-title"><span>{block.title}</span><span>{block.total}</span></div>}
          {SECTION_ORDER.map((section) => {
          const rows = block.groups[section];
          if (!rows?.length) return null;
          const key = slug(section);
          const collapseKey = `${block.turn}:${section}`;
          const isCollapsed = collapsed.has(collapseKey);
          return (
            <div key={collapseKey} className={`sidebar-group sidebar-group-${key}`}>
              <button
                type="button"
                className="sidebar-group-header"
                onClick={() => setCollapsed((old) => {
                  const next = new Set(old);
                  if (next.has(collapseKey)) next.delete(collapseKey); else next.add(collapseKey);
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
        </div>)}
        {incomplete.length > 0 && <div className="sidebar-turn sidebar-turn-incomplete">
          <button type="button" className="sidebar-turn-title sidebar-incomplete-toggle" onClick={() => setShowIncomplete((v) => !v)} aria-expanded={showIncomplete}>
            <span><span className={`sidebar-group-chevron ${showIncomplete ? '' : 'collapsed'}`}>▾</span> Not completed</span><span>{incomplete.length}</span>
          </button>
          {showIncomplete && <>
            <div className="sidebar-incomplete-hint">Started signup but never submitted. They can't submit until their BRC is uploaded.</div>
            {incomplete.map((app) => <a
              key={app.id}
              href={`/admin/businesses/${encodeURIComponent(app.id)}`}
              className={`application-list-item sidebar-incomplete-item ${selectedId === app.id ? 'active' : ''}`}
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                onSelectApplication(app.id);
              }}
            >
              <div className="sidebar-row-top">
                <span className="sidebar-row-name">{displayBusinessName(app) || app.contact_email || 'Unnamed business'}</span>
                <span className="sidebar-row-date">{app.updated_at || app.created_at ? new Date(app.updated_at || app.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</span>
              </div>
              <div className="sidebar-row-meta"><div className="sidebar-row-meta-left">
                <span className={`sidebar-badge ${(app.document_types || []).includes('brc') ? 'next-step' : 'aging age-warn'}`}>{(app.document_types || []).includes('brc') ? 'BRC uploaded' : 'No BRC'}</span>
              </div></div>
            </a>)}
          </>}
        </div>}
        {matched.length === 0 && incomplete.length === 0 && <div className="empty-list">No applications found.</div>}
      </div>
    </aside>
  );
}
