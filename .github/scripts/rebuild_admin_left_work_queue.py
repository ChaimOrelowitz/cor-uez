from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

admin_path = Path('src/AdminPage.jsx')
admin = admin_path.read_text()

admin = replace_once(
    admin,
    "  const [filter, setFilter] = useState('progress');",
    "  const [filter, setFilter] = useState('needs');",
    'default queue filter'
)

anchor = "function paymentStatusLabel(value) {\n  if (value === 'paid') return 'Paid';\n  if (value === 'client_reported') return 'Client says paid';\n  return 'Not recorded';\n}\n"
helpers = anchor + r'''

function adminStageLabel(app) {
  const types = new Set(app.document_types || []);
  if (app.status === 'applied' || app.status === 'grant_submitted') return 'SUBMITTED';
  if ((app.required_document_ready_count || 0) >= 5) return 'READY TO SUBMIT';
  if (app.uez_application_status === 'approved') return 'GRANT DOCS';
  if (app.uez_application_status === 'applied') return 'UEZ PENDING';
  if (app.pbs_account_created) return 'PBS READY';
  if (types.has('brc')) return 'PBS SETUP';
  if (app.submitted_at) return 'BRC';
  return 'APPLICANT SIGNUP';
}

function adminQueueInfo(app) {
  const types = new Set(app.document_types || []);
  const formationReview = app.formation_review_status || 'not_reviewed';
  const approvalReview = app.uez_approval_review_status || 'not_reviewed';
  const submittedGrant = app.status === 'applied' || app.status === 'grant_submitted';
  const stage = adminStageLabel(app);

  // Immediate human-review items always win.
  if (app.payment_status === 'client_reported') return { bucket: 'needs', action: 'Confirm payment', tone: 'danger', stage, rank: 1 };
  if (app.brc_status === 'client_created') return { bucket: 'needs', action: 'Recheck BRC', tone: 'danger', stage, rank: 2 };
  if (types.has('formation') && formationReview === 'not_reviewed') return { bucket: 'needs', action: 'Review Formation', tone: 'danger', stage, rank: 3 };
  if (types.has('uez_approval_email') && approvalReview === 'not_reviewed') return { bucket: 'needs', action: 'Review UEZ approval', tone: 'danger', stage, rank: 4 };

  if (submittedGrant) return { bucket: 'waiting', action: 'Grant submitted', tone: 'quiet', stage, rank: 90 };
  if (!app.submitted_at) return { bucket: 'waiting', action: 'Applicant still completing signup', tone: 'quiet', stage, rank: 80 };

  // Process sequence after the applicant submits.
  if (!types.has('brc')) {
    if (app.brc_status === 'not_found') return { bucket: 'waiting', action: 'Waiting on BRC follow-up', tone: 'warn', stage, rank: 50 };
    return { bucket: 'needs', action: 'Fetch BRC', tone: 'danger', stage, rank: 5 };
  }

  if (!app.pbs_account_created) return { bucket: 'needs', action: 'Set up PBS', tone: 'danger', stage, rank: 6 };

  if (app.uez_application_status === 'not_started' || !app.uez_application_status) {
    return { bucket: 'needs', action: 'UEZ application next', tone: 'danger', stage, rank: 7 };
  }

  if (app.uez_application_status === 'applied') {
    if (types.has('uez_approval_email') && approvalReview === 'rejected') return { bucket: 'waiting', action: 'Waiting for UEZ email replacement', tone: 'warn', stage, rank: 52 };
    if (!types.has('uez_approval_email') || approvalReview !== 'approved') return { bucket: 'waiting', action: 'Waiting for UEZ approval', tone: 'quiet', stage, rank: 55 };
  }

  if (!app.tax_clearance_good || !types.has('tax_clearance')) {
    if (types.has('tax_clearance_issue')) return { bucket: 'waiting', action: 'Tax clearance issue — waiting on client', tone: 'warn', stage, rank: 51 };
    return { bucket: 'needs', action: 'Fetch tax clearance', tone: 'danger', stage, rank: 8 };
  }

  if (!app.is_sole_proprietorship && !types.has('formation')) return { bucket: 'waiting', action: 'Waiting for Formation document', tone: 'warn', stage, rank: 53 };
  if (types.has('formation') && formationReview === 'rejected') return { bucket: 'waiting', action: 'Waiting for Formation replacement', tone: 'warn', stage, rank: 54 };

  if (app.payment_status !== 'paid') return { bucket: 'waiting', action: 'Waiting for payment', tone: 'quiet', stage, rank: 60 };

  if (!types.has('ldc_application')) return { bucket: 'needs', action: 'Fill out LDC application', tone: 'danger', stage, rank: 9 };

  if ((app.required_document_ready_count || 0) >= 5) return { bucket: 'ready', action: 'Ready for grant submission', tone: 'ready', stage, rank: 0 };

  return { bucket: 'waiting', action: 'Waiting for next document', tone: 'quiet', stage, rank: 70 };
}
'''
admin = replace_once(admin, anchor, helpers, 'queue helper functions')

old_filtered = r'''  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return applications.filter((app) => {
      const matchesSearch = !q || [app.business_name_input, app.registered_business_name, app.contact_email, app.ein]
        .some((value) => String(value || '').toLowerCase().includes(q));
      if (!matchesSearch) return false;
      if (filter === 'all') return true;
      if (filter === 'progress') return app.status !== 'applied';
      if (filter === 'applied') return app.status === 'applied';
      return true;
    });
  }, [applications, filter, search]);

  const counts = useMemo(() => ({
    progress: applications.filter((app) => app.status !== 'applied').length,
    applied: applications.filter((app) => app.status === 'applied').length,
    all: applications.length
  }), [applications]);
'''
new_filtered = r'''  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return applications
      .filter((app) => {
        const matchesSearch = !q || [app.business_name_input, app.registered_business_name, app.contact_email, app.ein]
          .some((value) => String(value || '').toLowerCase().includes(q));
        if (!matchesSearch) return false;
        if (filter === 'all') return true;
        return adminQueueInfo(app).bucket === filter;
      })
      .sort((a, b) => {
        const qa = adminQueueInfo(a);
        const qb = adminQueueInfo(b);
        const bucketPriority = { needs: 0, ready: 1, waiting: 2 };
        const bucketDelta = (bucketPriority[qa.bucket] ?? 9) - (bucketPriority[qb.bucket] ?? 9);
        if (bucketDelta) return bucketDelta;
        if (qa.rank !== qb.rank) return qa.rank - qb.rank;
        const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
        const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
        return aTime - bTime;
      });
  }, [applications, filter, search]);

  const counts = useMemo(() => ({
    needs: applications.filter((app) => adminQueueInfo(app).bucket === 'needs').length,
    waiting: applications.filter((app) => adminQueueInfo(app).bucket === 'waiting').length,
    ready: applications.filter((app) => adminQueueInfo(app).bucket === 'ready').length,
    all: applications.length
  }), [applications]);
'''
admin = replace_once(admin, old_filtered, new_filtered, 'work queue filtering')

old_filters = r'''          {[
            ['progress', 'In Progress', counts.progress],
            ['applied', 'Applied', counts.applied],
            ['all', 'All', counts.all]
          ].map(([key, label, count]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}<span>{count}</span></button>)}'''
new_filters = r'''          {[
            ['needs', 'Needs Me', counts.needs],
            ['waiting', 'Waiting', counts.waiting],
            ['ready', 'Ready', counts.ready],
            ['all', 'All', counts.all]
          ].map(([key, label, count]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}<span>{count}</span></button>)}'''
admin = replace_once(admin, old_filters, new_filters, 'queue tabs')

old_rows = r'''          {filtered.map((app) => {
            const needsAttention = app.payment_status === 'client_reported'
              || app.brc_status === 'client_created'
              || ((app.document_types || []).includes('formation') && app.formation_review_status !== 'approved')
              || ((app.document_types || []).includes('uez_approval_email') && (app.uez_approval_review_status || 'not_reviewed') === 'not_reviewed');
            return <button key={app.id} className={`application-list-item ops-list-item ${selectedId === app.id ? 'active' : ''}`} onClick={() => { setMobileDetailOpen(true); openApplication(app.id); window.scrollTo({ top: 0, behavior: 'instant' }); }}>
              <div className="ops-list-main"><strong>{app.business_name_input || 'Unnamed business'}{needsAttention && <i className="attention-dot" title="Needs attention" />}</strong><small>{app.required_document_ready_count || 0}/5 docs · UEZ {uezStatusLabel(app.uez_application_status)}</small></div>
              <div className="list-item-meta"><span className={`mini-status ${app.payment_status === 'paid' ? 'good' : app.payment_status === 'client_reported' ? 'warn' : ''}`}>{paymentStatusLabel(app.payment_status)}</span><small>{statusLabel(app.status)}</small></div>
            </button>;
          })}'''
new_rows = r'''          {filtered.map((app) => {
            const queue = adminQueueInfo(app);
            const showPayment = app.payment_status === 'client_reported';
            return <button key={app.id} className={`application-list-item ops-list-item queue-${queue.bucket} ${selectedId === app.id ? 'active' : ''}`} onClick={() => { setMobileDetailOpen(true); openApplication(app.id); window.scrollTo({ top: 0, behavior: 'instant' }); }}>
              <div className="ops-list-main queue-list-main">
                <div className="queue-list-title"><strong>{app.business_name_input || 'Unnamed business'}</strong><span className="queue-stage">{queue.stage}</span></div>
                <div className={`queue-next-action ${queue.tone}`}><i aria-hidden="true" />{queue.action}</div>
                {showPayment && <div className="queue-payment-flag">Payment reported</div>}
              </div>
            </button>;
          })}'''
admin = replace_once(admin, old_rows, new_rows, 'queue list rows')

admin_path.write_text(admin)

css_path = Path('src/workflow.css')
css = css_path.read_text()
css = replace_once(css, 'grid-template-columns: repeat(3, minmax(0,1fr));', 'grid-template-columns: repeat(4, minmax(0,1fr));', 'mobile four queue tabs')
marker = '/* Admin left work queue */'
if marker in css:
    raise SystemExit('work queue CSS already exists')
css += r'''

/* Admin left work queue */
.application-list-item.ops-list-item {
  grid-template-columns: minmax(0,1fr);
  gap: 0;
  padding-top: 13px;
  padding-bottom: 13px;
}
.queue-list-main { min-width: 0; }
.queue-list-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}
.queue-list-title strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #252c42;
  font-size: 13px;
}
.queue-stage {
  flex: 0 0 auto;
  color: #9a9faf;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: .045em;
  white-space: nowrap;
}
.queue-next-action {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 7px;
  font-size: 11px;
  font-weight: 800;
  line-height: 1.25;
}
.queue-next-action i {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #aeb3c0;
  flex: 0 0 auto;
}
.queue-next-action.danger { color: #a2473e; }
.queue-next-action.danger i { background: #d45f54; }
.queue-next-action.warn { color: #98691f; }
.queue-next-action.warn i { background: #dba545; }
.queue-next-action.ready { color: #247e4d; }
.queue-next-action.ready i { background: #3ba167; }
.queue-next-action.quiet { color: #767d8f; }
.queue-payment-flag {
  display: inline-flex;
  margin: 7px 0 0 14px;
  padding: 3px 6px;
  border-radius: 999px;
  background: #fff0d8;
  color: #96651f;
  font-size: 8px;
  font-weight: 850;
  text-transform: uppercase;
}
.application-list-item.queue-needs { box-shadow: inset 3px 0 transparent; }
.application-list-item.queue-needs:hover { box-shadow: inset 3px 0 #d96b61; }
.application-list-item.queue-ready:hover { box-shadow: inset 3px 0 #3ba167; }
.application-list-item.queue-waiting:hover { box-shadow: inset 3px 0 #c0c4ce; }
.application-list-item.active.queue-needs { background: #fff7f6; box-shadow: inset 3px 0 #d96b61; }
.application-list-item.active.queue-ready { background: #f3fbf6; box-shadow: inset 3px 0 #3ba167; }
.application-list-item.active.queue-waiting { background: #f6f7fa; box-shadow: inset 3px 0 #aeb3c0; }

@media (max-width: 767px) {
  .application-list-item.ops-list-item {
    min-height: 76px;
    grid-template-columns: minmax(0,1fr);
    align-items: stretch;
  }
  .queue-list-title strong { font-size: 14px; }
  .queue-stage { font-size: 7.5px; }
  .queue-next-action { margin-top: 8px; font-size: 11.5px; }
}
'''
css_path.write_text(css)
