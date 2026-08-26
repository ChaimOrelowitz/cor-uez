from pathlib import Path
import re


def replace_once(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'{label}: anchor not found in {path}')
    p.write_text(s.replace(old, new, 1))

# ---------- backend ----------
p = Path('backend/routes/uez.js')
s = p.read_text()

old = """    const [ownersResult, docsResult] = await Promise.all([
      supabase.from('uez_owners').select('application_id').in('application_id', ids),
      supabase.from('uez_documents').select('application_id, document_type').in('application_id', ids)
    ]);
    if (ownersResult.error) throw ownersResult.error;
    if (docsResult.error) throw docsResult.error;

    const ownerCounts = {};
    const docCounts = {};
    const brcUploads = {};
    for (const row of ownersResult.data || []) ownerCounts[row.application_id] = (ownerCounts[row.application_id] || 0) + 1;
    for (const row of docsResult.data || []) {
      docCounts[row.application_id] = (docCounts[row.application_id] || 0) + 1;
      if (row.document_type === 'brc') brcUploads[row.application_id] = true;
    }

    res.json((data || []).map((row) => ({
      ...row,
      owner_count: ownerCounts[row.id] || 0,
      document_count: docCounts[row.id] || 0,
      has_brc_upload: Boolean(brcUploads[row.id])
    })));
"""
new = """    const [ownersResult, docsResult, paymentsResult] = await Promise.all([
      supabase.from('uez_owners').select('application_id').in('application_id', ids),
      supabase.from('uez_documents').select('application_id, document_type, created_at').in('application_id', ids),
      supabase.from('uez_payments').select('application_id, status, amount, payment_date, created_at').in('application_id', ids).order('created_at')
    ]);
    if (ownersResult.error) throw ownersResult.error;
    if (docsResult.error) throw docsResult.error;
    if (paymentsResult.error) throw paymentsResult.error;

    const ownerCounts = {};
    const docCounts = {};
    const docTypes = {};
    const latestPayments = {};
    for (const row of ownersResult.data || []) ownerCounts[row.application_id] = (ownerCounts[row.application_id] || 0) + 1;
    for (const row of docsResult.data || []) {
      docCounts[row.application_id] = (docCounts[row.application_id] || 0) + 1;
      if (!docTypes[row.application_id]) docTypes[row.application_id] = new Set();
      docTypes[row.application_id].add(row.document_type);
    }
    for (const row of paymentsResult.data || []) latestPayments[row.application_id] = row;

    res.json((data || []).map((row) => {
      const types = docTypes[row.id] || new Set();
      const formationReady = row.is_sole_proprietorship || (types.has('formation') && row.formation_review_status === 'approved');
      const readyCount = (formationReady ? 1 : 0)
        + (types.has('brc') ? 1 : 0)
        + (types.has('uez_approval_email') ? 1 : 0)
        + (types.has('tax_clearance') ? 1 : 0)
        + (types.has('ldc_application') ? 1 : 0);
      return {
        ...row,
        owner_count: ownerCounts[row.id] || 0,
        document_count: docCounts[row.id] || 0,
        document_types: [...types],
        required_document_ready_count: readyCount,
        payment_status: latestPayments[row.id]?.status || null,
        payment_amount: latestPayments[row.id]?.amount || null
      };
    }));
"""
if old not in s: raise SystemExit('admin list bundle anchor missing')
s = s.replace(old, new, 1)

old = """    const [ownersResult, docsResult, eventsResult] = await Promise.all([
      supabase.from('uez_owners').select('*').eq('application_id', application.id).order('owner_order'),
      supabase.from('uez_documents').select('id, document_type, filename, source, status, metadata, created_at').eq('application_id', application.id).order('created_at'),
      supabase.from('uez_status_events').select('*').eq('application_id', application.id).order('created_at')
    ]);

    if (ownersResult.error) throw ownersResult.error;
    if (docsResult.error) throw docsResult.error;
    if (eventsResult.error) throw eventsResult.error;
"""
new = """    const [ownersResult, docsResult, eventsResult, paymentsResult] = await Promise.all([
      supabase.from('uez_owners').select('*').eq('application_id', application.id).order('owner_order'),
      supabase.from('uez_documents').select('id, document_type, filename, source, status, metadata, created_at').eq('application_id', application.id).order('created_at'),
      supabase.from('uez_status_events').select('*').eq('application_id', application.id).order('created_at'),
      supabase.from('uez_payments').select('id, amount, payment_date, payment_method, reference, notes, status, refund_amount, refunded_at, created_at').eq('application_id', application.id).order('created_at')
    ]);

    if (ownersResult.error) throw ownersResult.error;
    if (docsResult.error) throw docsResult.error;
    if (eventsResult.error) throw eventsResult.error;
    if (paymentsResult.error) throw paymentsResult.error;
"""
if old not in s: raise SystemExit('admin detail query anchor missing')
s = s.replace(old, new, 1)
old = """      documents: docsResult.data || [],
      statusEvents: eventsResult.data || []
"""
new = """      documents: docsResult.data || [],
      statusEvents: eventsResult.data || [],
      payments: paymentsResult.data || []
"""
if old not in s: raise SystemExit('admin detail response anchor missing')
s = s.replace(old, new, 1)

# BRC facts must never mutate the overall In Progress / Applied status.
s = s.replace("      status: application.submitted_at ? 'brc_confirmed' : application.status,\n", "")
s = s.replace("      status: 'waiting_for_brc',\n", "")

p.write_text(s)

# ---------- AdminPage ----------
p = Path('src/AdminPage.jsx')
s = p.read_text()

# Utility helpers.
marker = """function applicationDraftFrom(app) {
"""
helpers = """function uezStatusLabel(value) {
  if (value === 'approved') return 'Approved';
  if (value === 'applied') return 'Applied';
  return 'Not Started';
}

function paymentStatusLabel(value) {
  if (value === 'paid') return 'Paid';
  if (value === 'client_reported') return 'Client says paid';
  return 'Not recorded';
}

function docFor(detail, type) {
  return [...(detail?.documents || [])].reverse().find((doc) => doc.document_type === type) || null;
}

function formationSatisfied(detail) {
  return Boolean(detail?.application?.is_sole_proprietorship) || Boolean(docFor(detail, 'formation') && detail?.application?.formation_review_status === 'approved');
}

function packetReady(detail) {
  return formationSatisfied(detail)
    && Boolean(docFor(detail, 'brc'))
    && Boolean(docFor(detail, 'uez_approval_email'))
    && Boolean(docFor(detail, 'tax_clearance'))
    && Boolean(docFor(detail, 'ldc_application'));
}

function readyDocumentCount(detail) {
  return (formationSatisfied(detail) ? 1 : 0)
    + (docFor(detail, 'brc') ? 1 : 0)
    + (docFor(detail, 'uez_approval_email') ? 1 : 0)
    + (docFor(detail, 'tax_clearance') ? 1 : 0)
    + (docFor(detail, 'ldc_application') ? 1 : 0);
}

function attentionItems(detail) {
  if (!detail) return [];
  const items = [];
  const payment = detail.payments?.[detail.payments.length - 1];
  const formation = docFor(detail, 'formation');
  const approval = docFor(detail, 'uez_approval_email');
  if (payment?.status === 'client_reported') items.push('Client says payment was sent');
  if (!detail.application.is_sole_proprietorship && formation && detail.application.formation_review_status === 'not_reviewed') items.push('Review Certificate of Formation');
  if (!detail.application.is_sole_proprietorship && detail.application.formation_review_status === 'rejected') items.push('Certificate of Formation marked wrong');
  if (approval && detail.application.uez_application_status !== 'approved') items.push('Review UEZ approval email');
  return items;
}

""" + marker
if 'function packetReady(detail)' not in s:
    if marker not in s: raise SystemExit('helper insert anchor missing')
    s = s.replace(marker, helpers, 1)

# Clean stale workflow wording.
s = s.replace("setMessage('Moving the application to the UEZ approval-email stage…');", "setMessage('Saving PBS account status…');")
s = s.replace("setMessage('PBS account marked created. The applicant is now required to upload the UEZ approval email.');", "setMessage('PBS account marked created.');")
s = s.replace("setMessage('NJ did not find a matching BRC. The applicant was marked as waiting for a BRC.');", "setMessage('NJ did not find a matching BRC.');")
s = s.replace("setMessage('Marked as waiting for BRC. The applicant now sees the BRC instructions and upload button in their account.');", "setMessage('BRC marked not found. The applicant can see the BRC instructions and upload button.');")

# Sidebar becomes an operational queue.
old = """          {filtered.map((app) => <button key={app.id} className={`application-list-item ${selectedId === app.id ? 'active' : ''}`} onClick={() => openApplication(app.id)}>
            <div><strong>{app.business_name_input || 'Unnamed business'}</strong><small>{app.contact_email || 'No email'}</small></div>
            <div className="list-item-meta"><span className={`mini-status ${app.status === 'applied' ? 'good' : ''}`}>{statusLabel(app.status)}</span><small>{new Date(app.created_at).toLocaleDateString()}</small></div>
          </button>)}
"""
new = """          {filtered.map((app) => {
            const needsAttention = app.payment_status === 'client_reported'
              || (!app.is_sole_proprietorship && (app.document_types || []).includes('formation') && app.formation_review_status !== 'approved')
              || ((app.document_types || []).includes('uez_approval_email') && app.uez_application_status !== 'approved');
            return <button key={app.id} className={`application-list-item ops-list-item ${selectedId === app.id ? 'active' : ''}`} onClick={() => openApplication(app.id)}>
              <div className="ops-list-main"><strong>{app.business_name_input || 'Unnamed business'}{needsAttention && <i className="attention-dot" title="Needs attention" />}</strong><small>{app.required_document_ready_count || 0}/5 docs · UEZ {uezStatusLabel(app.uez_application_status)}</small></div>
              <div className="list-item-meta"><span className={`mini-status ${app.payment_status === 'paid' ? 'good' : app.payment_status === 'client_reported' ? 'warn' : ''}`}>{paymentStatusLabel(app.payment_status)}</span><small>{statusLabel(app.status)}</small></div>
            </button>;
          })}
"""
if old not in s: raise SystemExit('sidebar list anchor missing')
s = s.replace(old, new, 1)

# Header compact metrics.
old = """          <div className="admin-detail-header">
            <div><span className="eyebrow">UEZ APPLICATION</span><h1>{detail.application.business_name_input}</h1><p>{detail.application.contact_email} · {detail.application.contact_phone || 'No phone'}</p></div>
            <div className="admin-header-status"><span>{statusLabel(detail.application.status)}</span><small>Submitted {detail.application.submitted_at ? new Date(detail.application.submitted_at).toLocaleString() : 'not yet'}</small></div>
          </div>
"""
new = """          <div className="admin-detail-header cockpit-header">
            <div><span className="eyebrow">UEZ APPLICATION</span><h1>{detail.application.business_name_input}</h1><p>{detail.application.contact_email} · {detail.application.contact_phone || 'No phone'}</p></div>
            <div className="cockpit-header-chips">
              <span className={`cockpit-chip ${detail.application.status === 'applied' ? 'good' : ''}`}>{statusLabel(detail.application.status)}</span>
              <span className="cockpit-chip">{readyDocumentCount(detail)}/5 docs</span>
              <span className={`cockpit-chip ${detail.payments?.[detail.payments.length - 1]?.status === 'paid' ? 'good' : detail.payments?.[detail.payments.length - 1]?.status === 'client_reported' ? 'warn' : ''}`}>{paymentStatusLabel(detail.payments?.[detail.payments.length - 1]?.status)}</span>
            </div>
          </div>
"""
if old not in s: raise SystemExit('header anchor missing')
s = s.replace(old, new, 1)

# Insert cockpit immediately after edit/delete controls.
anchor = """          <div className="admin-card-grid">
"""
cockpit = """          <section className="ops-cockpit">
            {attentionItems(detail).length > 0 && <div className="ops-attention-strip">
              <strong>Needs attention</strong>
              <div>{attentionItems(detail).map((item) => <span key={item}>{item}</span>)}</div>
            </div>}

            <div className="ops-cockpit-grid">
              <div className="ops-panel status-panel">
                <div className="ops-panel-head"><h3>Status</h3></div>
                <div className="compact-status-grid">
                  <div className="compact-status-item"><span>PBS</span><div className="tiny-toggle"><button className={detail.application.pbs_account_created ? 'active-good' : ''} onClick={() => setProcessFlag('pbsAccountCreated', true)} disabled={busy}>Yes</button><button className={!detail.application.pbs_account_created ? 'active-neutral' : ''} onClick={() => setProcessFlag('pbsAccountCreated', false)} disabled={busy}>No</button></div></div>
                  <div className="compact-status-item"><span>UEZ</span><select value={detail.application.uez_application_status || 'not_started'} onChange={(e) => setProcessFlag('uezApplicationStatus', e.target.value)} disabled={busy}><option value="not_started">Not Started</option><option value="applied">Applied</option><option value="approved">Approved</option></select></div>
                  <div className="compact-status-item"><span>Tax clearance</span><div className="tiny-toggle"><button className={detail.application.tax_clearance_good ? 'active-good' : ''} onClick={() => setProcessFlag('taxClearanceGood', true)} disabled={busy}>Good</button><button className={!detail.application.tax_clearance_good ? 'active-neutral' : ''} onClick={() => setProcessFlag('taxClearanceGood', false)} disabled={busy}>No</button></div></div>
                  <div className="compact-status-item"><span>Payment</span><strong className={detail.payments?.[detail.payments.length - 1]?.status === 'paid' ? 'text-good' : detail.payments?.[detail.payments.length - 1]?.status === 'client_reported' ? 'text-warn' : ''}>{paymentStatusLabel(detail.payments?.[detail.payments.length - 1]?.status)}</strong>{detail.payments?.[detail.payments.length - 1]?.status === 'client_reported' && <button className="tiny-confirm" onClick={confirmPayment} disabled={busy}>Confirm</button>}</div>
                </div>
              </div>

              <div className="ops-panel documents-panel">
                <div className="ops-panel-head"><h3>Documents</h3><span>{readyDocumentCount(detail)}/5 ready</span></div>
                <div className="ops-doc-list">
                  {(() => {
                    const formation = docFor(detail, 'formation');
                    const sole = detail.application.is_sole_proprietorship;
                    return <div className={`ops-doc-row ${formationSatisfied(detail) ? 'ready' : detail.application.formation_review_status === 'rejected' ? 'bad' : ''}`}>
                      <button className="ops-doc-name" onClick={() => formation && openDoc(formation)} disabled={!formation}><b>{formationSatisfied(detail) ? '✓' : '○'}</b><span>Certificate of Formation</span></button>
                      {sole ? <small>Not required</small> : !formation ? <small>Missing</small> : <div className="formation-inline-review"><button className={detail.application.formation_review_status === 'approved' ? 'selected-good' : ''} onClick={() => setProcessFlag('formationReviewStatus', 'approved')} disabled={busy}>Approve</button><button className={detail.application.formation_review_status === 'rejected' ? 'selected-bad' : ''} onClick={() => setProcessFlag('formationReviewStatus', 'rejected')} disabled={busy}>Wrong</button></div>}
                    </div>;
                  })()}
                  {[
                    ['brc', 'BRC'],
                    ['uez_approval_email', 'UEZ Approval Email'],
                    ['tax_clearance', 'Tax Clearance'],
                    ['ldc_application', 'Signed LDC Application']
                  ].map(([type, label]) => {
                    const doc = docFor(detail, type);
                    return <div key={type} className={`ops-doc-row ${doc ? 'ready' : ''}`}><button className="ops-doc-name" onClick={() => doc && openDoc(doc)} disabled={!doc}><b>{doc ? '✓' : '○'}</b><span>{label}</span></button><small>{doc ? 'Received' : 'Missing'}</small></div>;
                  })}
                </div>
              </div>

              <div className="ops-panel actions-panel">
                <div className="ops-panel-head"><h3>Actions</h3></div>
                <div className="ops-action-grid">
                  <button className="ops-action primary" onClick={runBrcLookup} disabled={busy}><span>BRC</span><strong>Look up & import</strong></button>
                  <button className="ops-action primary" onClick={runTaxClearance} disabled={busy || !myNjCredentials}><span>Tax clearance</span><strong>{myNjCredentials ? 'Retrieve from PBS' : 'Needs MyNJ login'}</strong></button>
                  <button className="ops-action primary" onClick={runLdcJotform} disabled={busy}><span>LDC application</span><strong>{docFor(detail, 'ldc_application') ? 'Run again' : 'Fill & sign'}</strong></button>
                  <button className={`ops-action ${packetReady(detail) ? 'success-action' : ''}`} onClick={runLakewoodGrantPortal} disabled={busy || !packetReady(detail) || detail.application.status === 'applied'}><span>Lakewood grant</span><strong>{detail.application.status === 'applied' ? 'Submitted ✓' : packetReady(detail) ? 'Submit grant' : `${readyDocumentCount(detail)}/5 docs ready`}</strong></button>
                </div>
              </div>
            </div>
          </section>

          <div className="admin-details-heading"><span>DETAILS</span><small>Reference information and manual overrides</small></div>

""" + anchor
if 'className="ops-cockpit"' not in s:
    if anchor not in s: raise SystemExit('cockpit anchor missing')
    s = s.replace(anchor, cockpit, 1)

# Formation review is only in the formation document line now: remove the old giant operations card.
s, n = re.subn(r'\n\s*<section className="admin-card admin-wide admin-operations-card">.*?</section>', '', s, count=1, flags=re.S)
if n != 1: raise SystemExit(f'expected to remove one old operations section, removed {n}')

# Remove the redundant tax-clearance action card: action is in cockpit.
s, n = re.subn(r'\n\s*<section className="admin-card tax-clearance-card admin-tax-card">.*?</section>', '', s, count=1, flags=re.S)
if n != 1: raise SystemExit(f'expected to remove one tax action section, removed {n}')

# Payment detail card stays below, but no giant status banner wording and no duplicate confirm button when already paid.
s = s.replace('<section className="admin-card payment-admin-card">', '<section className="admin-card payment-admin-card admin-secondary-card">')
s = s.replace('<div className="admin-card-head"><h3>Payment</h3>', '<div className="admin-card-head"><h3>Payment details</h3>')
s = s.replace('<button className="success-button admin-full-button" onClick={confirmPayment} disabled={busy}>✓ Confirm payment received</button>', "{detail.payments?.[detail.payments.length - 1]?.status !== 'paid' && <button className=\"success-button admin-full-button\" onClick={confirmPayment} disabled={busy}>✓ Confirm payment received</button>}")

# BRC detail card: keep only name, DBA, address and manual overrides. The main action moved up.
s = s.replace('<section className="admin-card brc-admin-card">', '<section className="admin-card brc-admin-card admin-secondary-card">')
s = s.replace('<div className="admin-card-head"><h3>BRC</h3>', '<div className="admin-card-head"><h3>BRC details</h3>')
s = re.sub(r'\n\s*<div className="lookup-values">.*?</div>\n\s*<button className="primary admin-primary".*?</button>\n\s*<p className="admin-help">.*?</p>\n', '\n', s, count=1, flags=re.S)
needle = '<label>Registered business name</label><input value={brcForm.registeredBusinessName} onChange={(e) => setBrcForm((old) => ({ ...old, registeredBusinessName: e.target.value }))} />\n                <label>Business address</label>'
replacement = '<label>Registered business name</label><input value={brcForm.registeredBusinessName} onChange={(e) => setBrcForm((old) => ({ ...old, registeredBusinessName: e.target.value }))} />\n                <label>DBA / trade name</label><input value={brcForm.tradeName} onChange={(e) => setBrcForm((old) => ({ ...old, tradeName: e.target.value }))} />\n                <label>Business address</label>'
if needle not in s: raise SystemExit('BRC trade name insert anchor missing')
s = s.replace(needle, replacement, 1)
s = s.replace("{detail.application.status === 'waiting_for_brc' && <a", "{detail.application.brc_status === 'not_found' && <a")

# Push low-value reference cards down.
s = s.replace('<section className="admin-card admin-business-card">', '<section className="admin-card admin-business-card admin-secondary-card">')
s = s.replace('<section className="admin-card mynj-card admin-account-card">', '<section className="admin-card mynj-card admin-account-card admin-secondary-card">')
s = s.replace('<section className="admin-card admin-wide admin-owners-card">', '<section className="admin-card admin-wide admin-owners-card admin-secondary-card">')
s = s.replace('<section className="admin-card admin-documents-card">', '<section className="admin-card admin-documents-card admin-secondary-card">')

p.write_text(s)

# ---------- CSS ----------
p = Path('src/styles.css')
s = p.read_text()
s += r'''

/* 100-applicant operations cockpit */
.cockpit-header{align-items:center}.cockpit-header-chips{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.cockpit-chip{display:inline-flex;align-items:center;min-height:30px;padding:5px 10px;border:1px solid #dbe2ea;border-radius:999px;background:#fff;font-size:12px;font-weight:800;color:#485568}.cockpit-chip.good{background:#eef9f1;border-color:#b8ddc2;color:#21733b}.cockpit-chip.warn{background:#fff7e8;border-color:#efd08d;color:#8b5a00}.ops-cockpit{margin:12px 0 18px}.ops-attention-strip{display:flex;align-items:center;gap:12px;padding:9px 12px;margin-bottom:10px;border:1px solid #f0c36c;border-radius:10px;background:#fff9eb;font-size:12px}.ops-attention-strip>strong{color:#8b5900;white-space:nowrap}.ops-attention-strip>div{display:flex;gap:6px;flex-wrap:wrap}.ops-attention-strip span{padding:4px 8px;border-radius:999px;background:#fff;border:1px solid #efd99f;color:#6d5018}.ops-cockpit-grid{display:grid;grid-template-columns:minmax(220px,.8fr) minmax(320px,1.25fr) minmax(260px,1fr);gap:10px}.ops-panel{border:1px solid #dfe5ec;border-radius:14px;background:#fff;box-shadow:0 4px 14px rgba(30,45,65,.05);padding:12px}.ops-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}.ops-panel-head h3{margin:0;font-size:14px}.ops-panel-head span{font-size:11px;color:#6c7787;font-weight:800}.compact-status-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.compact-status-item{min-width:0;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 9px;border-radius:9px;background:#f7f9fb}.compact-status-item>span{font-size:11px;color:#687386;font-weight:700}.compact-status-item>strong{font-size:12px;text-align:right}.compact-status-item select{width:auto;max-width:110px;padding:5px 7px;font-size:11px;min-height:30px}.tiny-toggle{display:flex;gap:3px}.tiny-toggle button,.tiny-confirm{border:1px solid #d8dee7;background:#fff;border-radius:7px;padding:4px 7px;font-size:10px;font-weight:800;cursor:pointer}.tiny-toggle .active-good{background:#e9f8ee;border-color:#9fd2ad;color:#176b34}.tiny-toggle .active-neutral{background:#eef1f4;color:#56616e}.tiny-confirm{background:#14783a;color:#fff;border-color:#14783a}.text-good{color:#18733a}.text-warn{color:#986400}.ops-doc-list{display:grid;gap:4px}.ops-doc-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;min-height:34px;padding:5px 7px;border-radius:8px;background:#f8fafb}.ops-doc-row.ready{background:#f1f9f3}.ops-doc-row.bad{background:#fff2f0}.ops-doc-name{display:flex;align-items:center;gap:7px;min-width:0;border:0;background:transparent;text-align:left;padding:0;color:#253245;cursor:pointer}.ops-doc-name:disabled{cursor:default}.ops-doc-name b{width:16px;color:#788494}.ops-doc-row.ready .ops-doc-name b{color:#1b7a3d}.ops-doc-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:750}.ops-doc-row>small{font-size:10px;color:#7c8795}.formation-inline-review{display:flex;gap:3px}.formation-inline-review button{border:1px solid #d7dde5;border-radius:6px;background:#fff;padding:3px 6px;font-size:9px;font-weight:800}.formation-inline-review .selected-good{background:#eaf8ed;border-color:#9bcda7;color:#176b34}.formation-inline-review .selected-bad{background:#fff0ee;border-color:#e9aaa2;color:#a23528}.ops-action-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.ops-action{min-height:58px;border:1px solid #d9e0e8;border-radius:10px;padding:8px 9px;text-align:left;background:#f8fafc;color:#263448;cursor:pointer}.ops-action span{display:block;font-size:9px;letter-spacing:.04em;text-transform:uppercase;color:#758091;font-weight:800;margin-bottom:3px}.ops-action strong{font-size:11px;line-height:1.25}.ops-action.primary{background:#f1f6fc;border-color:#cbd9eb}.ops-action.success-action{background:#edf8f0;border-color:#b4d9bd;color:#176b34}.ops-action:disabled{opacity:.55;cursor:not-allowed}.admin-details-heading{display:flex;align-items:end;justify-content:space-between;gap:10px;margin:8px 2px 8px;border-top:1px solid #e4e8ed;padding-top:14px}.admin-details-heading span{font-size:10px;letter-spacing:.12em;color:#7b8694;font-weight:900}.admin-details-heading small{color:#929aa5}.admin-secondary-card{box-shadow:none}.ops-list-item{padding-top:10px!important;padding-bottom:10px!important}.ops-list-main{min-width:0}.ops-list-main>strong{display:flex!important;align-items:center;gap:6px}.ops-list-main small{font-size:10px!important}.attention-dot{width:7px;height:7px;border-radius:50%;background:#d99b16;display:inline-block;flex:0 0 auto}.application-list-item .list-item-meta{gap:4px}.application-list-item .list-item-meta small{font-size:9px}.payment-admin-card{order:3}.brc-admin-card{order:4}.admin-documents-card{order:2}.admin-business-card{order:5}.admin-owners-card{order:6}.admin-account-card{order:7}
@media (max-width:1100px){.ops-cockpit-grid{grid-template-columns:1fr 1fr}.actions-panel{grid-column:1/-1}.ops-action-grid{grid-template-columns:repeat(4,1fr)}}
@media (max-width:760px){.cockpit-header{gap:9px}.cockpit-header-chips{width:100%}.ops-attention-strip{align-items:flex-start;flex-direction:column}.ops-cockpit-grid{grid-template-columns:1fr}.actions-panel{grid-column:auto}.compact-status-grid{grid-template-columns:1fr 1fr}.ops-action-grid{grid-template-columns:1fr 1fr}.ops-panel{padding:10px}.admin-details-heading small{display:none}.admin-edit-actions{flex-wrap:wrap}.admin-edit-actions button{min-height:36px}}
'''
p.write_text(s)
