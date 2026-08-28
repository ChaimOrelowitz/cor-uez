import React from 'react';
import { adminQueueInfo } from './caseLogic';

const FILTERS = [
  ['needs', 'Needs Me'],
  ['waiting', 'Waiting'],
  ['ready', 'Ready'],
  ['submitted', 'Submitted'],
  ['all', 'All']
];

export default function AdminSidebar({ applications, filtered, counts, filter, search, selectedId, onFilterChange, onSearchChange, onSelectApplication }) {
  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar-head">
        <div><span>APPLICATIONS</span><strong>{applications.length}</strong></div>
        <input placeholder="Search business, email, EIN" value={search} onChange={(e) => onSearchChange(e.target.value)} />
      </div>
      <div className="admin-filter-row">
        {FILTERS.map(([key, label]) => (
          <button key={key} className={filter === key ? 'active' : ''} onClick={() => onFilterChange(key)}>{label}<span>{counts[key]}</span></button>
        ))}
      </div>

      <div className="application-list">
        {filtered.map((app) => {
          const queue = adminQueueInfo(app);
          const showPayment = app.payment_status === 'client_reported';
          return (
            <button
              key={app.id}
              className={`application-list-item ops-list-item queue-${queue.bucket} ${selectedId === app.id ? 'active' : ''}`}
              onClick={() => onSelectApplication(app.id)}
            >
              <div className="ops-list-main queue-list-main">
                <div className="queue-list-title"><strong>{app.business_name_input || 'Unnamed business'}</strong><span className="queue-stage">{queue.stage}</span></div>
                <div className={`queue-next-action ${queue.tone}`}><i aria-hidden="true" />{queue.action}</div>
                {showPayment && <div className="queue-payment-flag">Payment reported</div>}
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && <div className="empty-list">No applications in this view.</div>}
      </div>
    </aside>
  );
}
