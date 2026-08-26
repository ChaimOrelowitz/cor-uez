from pathlib import Path


def repl(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'{label} anchor not found in {path}')
    p.write_text(s.replace(old, new, 1))

# api helper
repl('src/api.js',
"""export function markAdminPbsAccountCreated(applicationId) {
  return request(`/api/uez/admin/applications/${applicationId}/pbs-account-created`, {
    method: 'POST'
  });
}
""",
"""export function markAdminPbsAccountCreated(applicationId) {
  return request(`/api/uez/admin/applications/${applicationId}/pbs-account-created`, {
    method: 'POST'
  });
}

export function updateAdminProcessFlags(applicationId, payload) {
  return request(`/api/uez/admin/applications/${applicationId}/process-flags`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}
""",
'process api helper')

# backend create/submit are overall in-progress, not sequencing statuses
repl('backend/routes/uez.js', "status: 'intake_in_progress'", "status: 'in_progress'", 'new application status')
repl('backend/routes/uez.js', "status: 'submitted_for_review',", "status: 'in_progress',", 'submitted application status')

# Remove upload ordering gates
repl('backend/routes/uez.js',
"""    if (documentType === 'uez_approval_email' && application.pbs_status !== 'account_created' && application.status !== 'waiting_for_uez_approval') {
      return res.status(400).json({ error: 'The PBS account must be marked created before uploading the UEZ approval email.' });
    }
""", '', 'approval upload gate')
repl('backend/routes/uez.js',
"""    if (documentType === 'tax_clearance' && !['account_created', 'uez_approval_uploaded'].includes(application.pbs_status)) {
      return res.status(400).json({ error: 'The PBS account must be created before retrieving tax clearance.' });
    }
""", '', 'tax upload gate')

# BRC upload only changes BRC fact, never overall status
repl('backend/routes/uez.js',
"""    if (documentType === 'brc') {
      const nextStatus = application.submitted_at ? 'brc_uploaded' : application.status;
      await supabase.from('uez_applications').update({
        brc_status: 'uploaded',
        status: nextStatus,
        updated_at: new Date().toISOString()
      }).eq('id', application.id);
""",
"""    if (documentType === 'brc') {
      await supabase.from('uez_applications').update({
        brc_status: 'uploaded',
        updated_at: new Date().toISOString()
      }).eq('id', application.id);
""",
'brc upload status')

# Approval upload records process fact/doc, no overall status movement
repl('backend/routes/uez.js',
"""      const { error: appError } = await supabase.from('uez_applications').update({
        pbs_status: 'uez_approval_uploaded',
        status: 'uez_approval_uploaded',
        updated_at: now
      }).eq('id', application.id);
""",
"""      const { error: appError } = await supabase.from('uez_applications').update({
        pbs_status: 'uez_approval_uploaded',
        uez_application_submitted: true,
        updated_at: now
      }).eq('id', application.id);
""",
'approval process fact')

# Tax document marks tax good independently
repl('backend/routes/uez.js',
"""    if (documentType === 'tax_clearance') {
      await addStatusEvent(
""",
"""    if (documentType === 'tax_clearance') {
      await supabase.from('uez_applications').update({ tax_clearance_good: true, updated_at: new Date().toISOString() }).eq('id', application.id);
      await addStatusEvent(
""",
'tax process fact')

# Credential creation only depends on BRC fact, not old overall status
repl('backend/routes/uez.js',
"""    if (application.brc_status !== 'found' && application.status !== 'brc_confirmed') {
      return res.status(400).json({ error: 'Confirm the BRC before creating MyNJ credentials.' });
    }
""",
"""    if (application.brc_status !== 'found') {
      return res.status(400).json({ error: 'Confirm the BRC before creating MyNJ credentials.' });
    }
""",
'credential BRC fact')

# PBS endpoint independent
repl('backend/routes/uez.js',
"""    const { data, error } = await supabase.from('uez_applications').update({
      pbs_status: 'account_created',
      status: 'waiting_for_uez_approval',
      updated_at: now
    }).eq('id', application.id).select('*').single();
""",
"""    const { data, error } = await supabase.from('uez_applications').update({
      pbs_status: 'account_created',
      pbs_account_created: true,
      updated_at: now
    }).eq('id', application.id).select('*').single();
""",
'pbs independent fact')
repl('backend/routes/uez.js',
"""    if (application.pbs_status !== 'account_created' && application.status !== 'waiting_for_uez_approval') {
""",
"""    if (!application.pbs_account_created && application.pbs_status !== 'account_created') {
""",
'pbs event condition')

# Independent process flags endpoint before admin list
marker = "router.get('/admin/applications', requireUezAdmin, async (_req, res) => {\n"
endpoint = """router.patch('/admin/applications/:id/process-flags', requireUezAdmin, async (req, res) => {
  try {
    const { data: application, error: appError } = await supabase.from('uez_applications')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (appError || !application) return res.status(404).json({ error: 'Application not found' });

    const body = req.body || {};
    const patch = { updated_at: new Date().toISOString() };
    if (typeof body.pbsAccountCreated === 'boolean') {
      patch.pbs_account_created = body.pbsAccountCreated;
      patch.pbs_status = body.pbsAccountCreated ? 'account_created' : null;
    }
    if (typeof body.uezApplicationSubmitted === 'boolean') patch.uez_application_submitted = body.uezApplicationSubmitted;
    if (typeof body.taxClearanceGood === 'boolean') patch.tax_clearance_good = body.taxClearanceGood;

    if (Object.keys(patch).length === 1) return res.status(400).json({ error: 'No process status was supplied.' });
    const { data, error } = await supabase.from('uez_applications').update(patch).eq('id', application.id).select('*').single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

""" + marker
repl('backend/routes/uez.js', marker, endpoint, 'process flags endpoint')

# General status endpoint: only Applied changes overall; all operational events leave overall alone
repl('backend/routes/uez.js',
"""    if (status === 'ready_for_ldc' && application.pbs_status !== 'uez_approval_uploaded') {
      return res.status(400).json({ error: 'The applicant must upload the UEZ approval email before grant processing can begin.' });
    }

    const { data, error } = await supabase.from('uez_applications').update({
      status,
      updated_at: new Date().toISOString()
    }).eq('id', application.id).select('*').single();
""",
"""    const overallStatus = ['grant_submitted', 'applied'].includes(status)
      ? 'applied'
      : application.status === 'applied' ? 'applied' : 'in_progress';

    const { data, error } = await supabase.from('uez_applications').update({
      status: overallStatus,
      updated_at: new Date().toISOString()
    }).eq('id', application.id).select('*').single();
""",
'overall status endpoint')

# BRC routes never mutate overall status
p = Path('backend/routes/uezBrc.js')
s = p.read_text()
s = s.replace("status: 'brc_confirmed', updated_at: checkedAt", "updated_at: checkedAt")
s = s.replace("brc_last_error: null, status: 'brc_confirmed', updated_at: checkedAt", "brc_last_error: null, updated_at: checkedAt")
s = s.replace("brc_last_error: null, status: 'waiting_for_brc', updated_at: checkedAt", "brc_last_error: null, updated_at: checkedAt")
s = s.replace("brc_last_error: 'NJ BRC service requested browser verification.', status: 'brc_manual_verification', updated_at: checkedAt", "brc_last_error: 'NJ BRC service requested browser verification.', updated_at: checkedAt")
s = s.replace("brc_last_error: message, status: 'brc_check_error', updated_at: checkedAt", "brc_last_error: message, updated_at: checkedAt")
s = s.replace("brc_status: 'checking', brc_name_control: lookup.nameControl, brc_nj_tax_id: lookup.njTaxId, brc_last_error: null, status: 'brc_checking', updated_at: startedAt", "brc_status: 'checking', brc_name_control: lookup.nameControl, brc_nj_tax_id: lookup.njTaxId, brc_last_error: null, updated_at: startedAt")
s = s.replace("brc_status: 'recheck_requested', status: 'brc_recheck_requested', updated_at: new Date().toISOString()", "brc_status: 'recheck_requested', updated_at: new Date().toISOString()")
s = s.replace("brc_status: 'not_found', brc_checked_at: checkedAt, status: 'waiting_for_brc', updated_at: checkedAt", "brc_status: 'not_found', brc_checked_at: checkedAt, updated_at: checkedAt")
s = s.replace("brc_storage_path: req.body?.storagePath || application.brc_storage_path, status: 'brc_confirmed', updated_at: checkedAt", "brc_storage_path: req.body?.storagePath || application.brc_storage_path, updated_at: checkedAt")
p.write_text(s)

# Admin imports + simplified labels
repl('src/AdminPage.jsx',
"""  updateAdminMyNjCredentials,
  updateAdminApplicationStatus,
  whoAmI
""",
"""  updateAdminMyNjCredentials,
  updateAdminApplicationStatus,
  updateAdminProcessFlags,
  whoAmI
""",
'admin import')

start = """function statusLabel(status) {
  const labels = {
    intake_in_progress: 'In progress',
    submitted_for_review: 'Submitted',
    waiting_for_brc: 'Waiting for BRC',
    brc_uploaded: 'BRC uploaded',
    brc_confirmed: 'BRC confirmed',
    pbs_account_pending: 'Creating PBS account',
    waiting_for_uez_approval: 'Waiting for UEZ approval email',
    uez_approval_uploaded: 'UEZ approval email uploaded',
    ldc_submitted: 'LDC submitted',
    grant_submitted: 'Grant submitted',
    approved: 'Approved'
  };
  return labels[status] || String(status || '').replace(/_/g, ' ');
}
"""
new = """function statusLabel(status) {
  return status === 'applied' || status === 'grant_submitted' ? 'Applied' : 'In Progress';
}

const REQUIRED_GRANT_DOCUMENTS = [
  ['formation', 'Certificate of Formation'],
  ['tax_clearance', 'Tax Clearance Letter'],
  ['ldc_application', 'Signed LDC Application'],
  ['brc', 'Business Registration Certificate'],
  ['uez_approval_email', 'UEZ Approval Email']
];
"""
repl('src/AdminPage.jsx', start, new, 'simple status labels')

# Process flag toggle helper before markReadyForLdc
marker = """  async function markReadyForLdc() {
"""
helper = """  async function setProcessFlag(key, value) {
    setBusy(true);
    setMessage('Saving process status…');
    try {
      await updateAdminProcessFlags(detail.application.id, { [key]: value });
      await refreshList(detail.application.id);
      setMessage('Process status updated.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

""" + marker
repl('src/AdminPage.jsx', marker, helper, 'process flag helper')

# Filters become overall status only
old = """      if (filter === 'all') return true;
      if (filter === 'submitted') return ['submitted_for_review', 'brc_uploaded'].includes(app.status);
      if (filter === 'brc') return app.status === 'waiting_for_brc';
      if (filter === 'confirmed') return app.brc_status === 'found' || app.status === 'brc_confirmed';
      return true;
"""
new = """      if (filter === 'all') return true;
      if (filter === 'progress') return app.status !== 'applied';
      if (filter === 'applied') return app.status === 'applied';
      return true;
"""
repl('src/AdminPage.jsx', old, new, 'admin filters')
old = """  const counts = useMemo(() => ({
    submitted: applications.filter((app) => ['submitted_for_review', 'brc_uploaded'].includes(app.status)).length,
    brc: applications.filter((app) => app.status === 'waiting_for_brc').length,
    confirmed: applications.filter((app) => app.brc_status === 'found' || app.status === 'brc_confirmed').length,
    all: applications.length
  }), [applications]);
"""
new = """  const counts = useMemo(() => ({
    progress: applications.filter((app) => app.status !== 'applied').length,
    applied: applications.filter((app) => app.status === 'applied').length,
    all: applications.length
  }), [applications]);
"""
repl('src/AdminPage.jsx', old, new, 'admin counts')
repl('src/AdminPage.jsx', "const [filter, setFilter] = useState('submitted');", "const [filter, setFilter] = useState('progress');", 'default filter')
old = """          {[
            ['submitted', 'New', counts.submitted],
            ['brc', 'Needs BRC', counts.brc],
            ['confirmed', 'BRC ✓', counts.confirmed],
            ['all', 'All', counts.all]
          ].map(([key, label, count]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}<span>{count}</span></button>)}
"""
new = """          {[
            ['progress', 'In Progress', counts.progress],
            ['applied', 'Applied', counts.applied],
            ['all', 'All', counts.all]
          ].map(([key, label, count]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}<span>{count}</span></button>)}
"""
repl('src/AdminPage.jsx', old, new, 'filter buttons')
repl('src/AdminPage.jsx',
"""<span className={`mini-status ${app.status === 'waiting_for_brc' ? 'warn' : app.brc_status === 'found' ? 'good' : ''}`}>{statusLabel(app.status)}</span>""",
"""<span className={`mini-status ${app.status === 'applied' ? 'good' : ''}`}>{statusLabel(app.status)}</span>""",
'list status styling')

# Replace Workflow card with process + docs + actions
old = """            <section className=\"admin-card\">
              <div className=\"admin-card-head\"><h3>Workflow</h3></div>
              <button className=\"secondary admin-full-button\" onClick={markReadyForLdc} disabled={busy || detail.application.pbs_status !== 'uez_approval_uploaded'}>Mark ready for grant processing</button>
              <p className=\"admin-help\">This becomes available after the applicant uploads the required UEZ approval email.</p>
              <button
                className=\"primary admin-full-button\"
                onClick={runLdcJotform}
                disabled={busy || detail.application.pbs_status !== 'uez_approval_uploaded' || !detail.documents.some((doc) => doc.document_type === 'tax_clearance') || detail.documents.some((doc) => doc.document_type === 'ldc_application')}
              >{detail.documents.some((doc) => doc.document_type === 'ldc_application') ? '✓ LDC application submitted' : 'Fill & submit LDC application'}</button>
              <p className=\"admin-help\">COR fills the Lakewood JotForm, pauses for the required signature, then saves JotForm’s completed signed PDF here after final submission.</p>
              <button
                className=\"primary admin-full-button\"
                onClick={runLakewoodGrantPortal}
                disabled={busy || !detail.documents.some((doc) => doc.document_type === 'ldc_application') || !detail.documents.some((doc) => doc.document_type === 'formation') || !detail.documents.some((doc) => doc.document_type === 'tax_clearance') || !detail.documents.some((doc) => doc.document_type === 'uez_approval_email') || !detail.documents.some((doc) => doc.document_type === 'brc') || detail.application.status === 'grant_submitted'}
              >{detail.application.status === 'grant_submitted' ? '✓ Grant application submitted' : 'Fill & submit Lakewood grant'}</button>
              <p className=\"admin-help\">COR fills the Lakewood grant form and attaches the signed LDC application, formation certificate, tax clearance, UEZ approval, and BRC. Review the completed packet before the final Submit Form click.</p>
              <div className=\"admin-timeline\">
                {[...detail.statusEvents].reverse().slice(0, 6).map((event) => <div key={event.id}><strong>{event.label || statusLabel(event.status)}</strong><p>{event.message}</p><small>{new Date(event.created_at).toLocaleString()}</small></div>)}
              </div>
            </section>
"""
new = """            <section className=\"admin-card\">
              <div className=\"admin-card-head\"><h3>Process</h3><span>{statusLabel(detail.application.status)}</span></div>
              <div className=\"admin-process-list\">
                {[
                  ['pbsAccountCreated', 'PBS Account Created', detail.application.pbs_account_created === true],
                  ['uezApplicationSubmitted', 'UEZ Application Submitted', detail.application.uez_application_submitted === true],
                  ['taxClearanceGood', 'Tax Clearance Good', detail.application.tax_clearance_good === true]
                ].map(([key, label, value]) => <div className=\"admin-process-row\" key={key}>
                  <strong>{label}</strong>
                  <div className=\"admin-process-buttons\">
                    <button className={value ? 'success-button' : 'secondary'} onClick={() => setProcessFlag(key, true)} disabled={busy}>Yes</button>
                    <button className={!value ? 'warning-button' : 'secondary'} onClick={() => setProcessFlag(key, false)} disabled={busy}>No</button>
                  </div>
                </div>)}
              </div>

              <div className=\"admin-card-head admin-subhead\"><h3>Required documents</h3><span>{REQUIRED_GRANT_DOCUMENTS.filter(([type]) => detail.documents.some((doc) => doc.document_type === type)).length}/5</span></div>
              <div className=\"admin-checklist\">
                {REQUIRED_GRANT_DOCUMENTS.map(([type, label]) => {
                  const doc = detail.documents.find((item) => item.document_type === type);
                  return <button type=\"button\" key={type} className={`admin-check-row ${doc ? 'complete' : ''}`} onClick={() => doc && openDoc(doc)} disabled={!doc}>
                    <span>{doc ? '✓' : '○'}</span><strong>{label}</strong><small>{doc ? 'Received' : 'Missing'}</small>
                  </button>;
                })}
              </div>

              <button
                className=\"primary admin-full-button\"
                onClick={runLdcJotform}
                disabled={busy || detail.documents.some((doc) => doc.document_type === 'ldc_application')}
              >{detail.documents.some((doc) => doc.document_type === 'ldc_application') ? '✓ Signed LDC application received' : 'Fill & sign LDC application'}</button>
              <p className=\"admin-help\">The LDC form can be completed whenever you are ready. It is no longer locked behind another process status.</p>
              <button
                className=\"primary admin-full-button\"
                onClick={runLakewoodGrantPortal}
                disabled={busy || REQUIRED_GRANT_DOCUMENTS.some(([type]) => !detail.documents.some((doc) => doc.document_type === type)) || detail.application.status === 'applied'}
              >{detail.application.status === 'applied' ? '✓ Applied' : REQUIRED_GRANT_DOCUMENTS.every(([type]) => detail.documents.some((doc) => doc.document_type === type)) ? 'Ready to Apply — Fill & submit Lakewood grant' : 'Lakewood grant — waiting for 5 documents'}</button>
              <div className=\"admin-timeline\">
                {[...detail.statusEvents].reverse().slice(0, 6).map((event) => <div key={event.id}><strong>{event.label || event.status}</strong><p>{event.message}</p><small>{new Date(event.created_at).toLocaleString()}</small></div>)}
              </div>
            </section>
"""
repl('src/AdminPage.jsx', old, new, 'workflow card')

# Tax retrieval no longer requires PBS status ordering; only credentials
old = """                  disabled={busy || !myNjCredentials || !['account_created', 'uez_approval_uploaded'].includes(detail.application.pbs_status)}
                >Retrieve tax clearance from PBS</button>
                {!myNjCredentials && <p className=\"admin-help\">MyNJ / PBS login information is required first.</p>}
                {myNjCredentials && !['account_created', 'uez_approval_uploaded'].includes(detail.application.pbs_status) && <p className=\"admin-help\">Mark the PBS account created before retrieving tax clearance.</p>}
"""
new = """                  disabled={busy || !myNjCredentials}
                >Retrieve tax clearance from PBS</button>
                {!myNjCredentials && <p className=\"admin-help\">MyNJ / PBS login information is required first.</p>}
"""
repl('src/AdminPage.jsx', old, new, 'tax clearance ordering gate')

# MyNJ generation uses BRC fact only
s = Path('src/AdminPage.jsx').read_text()
s = s.replace("disabled={busy || (detail.application.brc_status !== 'found' && detail.application.status !== 'brc_confirmed')}", "disabled={busy || detail.application.brc_status !== 'found'}")
s = s.replace("{detail.application.brc_status !== 'found' && detail.application.status !== 'brc_confirmed' && <p className=\"admin-help\">The BRC must be confirmed first.</p>}", "{detail.application.brc_status !== 'found' && <p className=\"admin-help\">The BRC must be confirmed first.</p>}")
Path('src/AdminPage.jsx').write_text(s)

# Simple CSS additions
p = Path('src/styles.css')
s = p.read_text()
s += """

.admin-process-list,.admin-checklist{display:grid;gap:10px;margin:12px 0 18px}.admin-process-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid #e3e7ee;border-radius:10px;background:#fff}.admin-process-buttons{display:flex;gap:8px}.admin-process-buttons button{min-width:56px}.admin-subhead{margin-top:16px}.admin-check-row{width:100%;display:grid;grid-template-columns:24px 1fr auto;align-items:center;gap:10px;text-align:left;padding:11px 12px;border:1px solid #e3e7ee;border-radius:10px;background:#fff;color:inherit}.admin-check-row:disabled{opacity:1;cursor:default}.admin-check-row.complete{border-color:#bad9c4;background:#f7fcf8}.admin-check-row span{font-size:18px}.admin-check-row small{color:#697386}.admin-check-row.complete small{color:#287a45}
"""
p.write_text(s)
