from pathlib import Path
import re

# ---------- backend ----------
p = Path('backend/routes/uez.js')
s = p.read_text()

# UEZ approval upload must reset review and remain Applied pending review.
old = """        uez_application_status: application.uez_application_status === 'approved' ? 'approved' : 'applied',
"""
new = """        uez_application_status: 'applied',
        uez_approval_review_status: 'not_reviewed',
"""
if old in s:
    s = s.replace(old, new, 1)

# Deleting approval email resets its review state and cannot leave UEZ approved.
anchor = """    if (doc.document_type === 'formation') {
      await supabase.from('uez_applications').update({ formation_review_status: 'not_reviewed', updated_at: new Date().toISOString() }).eq('id', application.id);
    }

"""
insert = anchor + """    if (doc.document_type === 'uez_approval_email') {
      await supabase.from('uez_applications').update({
        uez_approval_review_status: 'not_reviewed',
        uez_application_status: application.uez_application_status === 'approved' ? 'applied' : application.uez_application_status,
        updated_at: new Date().toISOString()
      }).eq('id', application.id);
    }

"""
if "doc.document_type === 'uez_approval_email'" not in s:
    if anchor not in s: raise SystemExit('delete review anchor missing')
    s = s.replace(anchor, insert, 1)

# Process flags handles review semantics atomically.
anchor = """    if (['not_reviewed', 'approved', 'rejected'].includes(body.formationReviewStatus)) {
      patch.formation_review_status = body.formationReviewStatus;
    }
"""
replace = anchor + """    if (['not_reviewed', 'approved', 'rejected'].includes(body.uezApprovalReviewStatus)) {
      patch.uez_approval_review_status = body.uezApprovalReviewStatus;
      if (body.uezApprovalReviewStatus === 'approved') {
        patch.uez_application_status = 'approved';
        patch.uez_application_submitted = true;
      } else if (body.uezApprovalReviewStatus === 'rejected') {
        patch.uez_application_status = 'applied';
        patch.uez_application_submitted = true;
      }
    }
"""
if 'uezApprovalReviewStatus' not in s:
    if anchor not in s: raise SystemExit('process review anchor missing')
    s = s.replace(anchor, replace, 1)

p.write_text(s)

# ---------- AdminPage ----------
p = Path('src/AdminPage.jsx')
s = p.read_text()

# Needs attention uses actual review state.
s = s.replace("if (approval && detail.application.uez_application_status !== 'approved') items.push('Review UEZ approval email');", "if (approval && (detail.application.uez_approval_review_status || 'not_reviewed') === 'not_reviewed') items.push('Review UEZ approval email');")
s = s.replace("|| ((app.document_types || []).includes('uez_approval_email') && app.uez_application_status !== 'approved');", "|| ((app.document_types || []).includes('uez_approval_email') && (app.uez_approval_review_status || 'not_reviewed') === 'not_reviewed');")

# State: modal, accordions and draggable status order.
state_anchor = """  const [paymentDraft, setPaymentDraft] = useState({ amount: '500', paymentDate: new Date().toISOString().slice(0,10), paymentMethod: 'Zelle', reference: '', notes: '' });
"""
state_new = state_anchor + """  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [dragStatusKey, setDragStatusKey] = useState(null);
  const [statusOrder, setStatusOrder] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('cor_uez_admin_status_order') || 'null');
      return Array.isArray(stored) && stored.length === 4 ? stored : ['pbs','uez','tax','payment'];
    } catch (_) { return ['pbs','uez','tax','payment']; }
  });
"""
if 'const [previewDoc' not in s:
    if state_anchor not in s: raise SystemExit('state anchor missing')
    s = s.replace(state_anchor, state_new, 1)

# Modal/reorder helpers before openDoc.
anchor = """  async function openDoc(doc) {
"""
helpers = """  function saveStatusOrder(next) {
    setStatusOrder(next);
    localStorage.setItem('cor_uez_admin_status_order', JSON.stringify(next));
  }

  function dropStatus(targetKey) {
    if (!dragStatusKey || dragStatusKey === targetKey) return setDragStatusKey(null);
    const next = statusOrder.filter((key) => key !== dragStatusKey);
    next.splice(next.indexOf(targetKey), 0, dragStatusKey);
    saveStatusOrder(next);
    setDragStatusKey(null);
  }

  async function previewDocument(doc) {
    if (!doc) return;
    setPreviewDoc(doc);
    setPreviewUrl('');
    setPreviewBusy(true);
    try {
      const result = await getDocumentUrl(detail.application.id, doc.id);
      setPreviewUrl(result.url);
    } catch (err) {
      setMessage(err.message);
      setPreviewDoc(null);
    } finally { setPreviewBusy(false); }
  }

  function closePreview() {
    setPreviewDoc(null);
    setPreviewUrl('');
    setPreviewBusy(false);
  }

  async function reviewPreviewDoc(result) {
    if (!previewDoc) return;
    const type = previewDoc.document_type;
    if (type === 'formation') await setProcessFlag('formationReviewStatus', result);
    if (type === 'uez_approval_email') await setProcessFlag('uezApprovalReviewStatus', result);
    closePreview();
  }

""" + anchor
if 'async function previewDocument' not in s:
    if anchor not in s: raise SystemExit('openDoc anchor missing')
    s = s.replace(anchor, helpers, 1)

# Header owner first/last after phone on same line.
old = """<p>{detail.application.contact_email} · {detail.application.contact_phone || 'No phone'}</p>"""
new = """<p>{detail.application.contact_email} · {detail.application.contact_phone || 'No phone'}{detail.owners?.[0] ? ` · ${detail.owners[0].firstName} ${detail.owners[0].lastName}` : ''}</p>"""
s = s.replace(old, new, 1)

# Replace status grid with sortable one-row-each renderer.
pattern = re.compile(r'<div className="compact-status-grid">.*?</div>\n\s*</div>\n\n\s*<div className="ops-panel documents-panel">', re.S)
status_block = '''<div className="compact-status-grid status-sort-list">
                  {statusOrder.map((key) => {
                    const row = key === 'pbs' ? <><span>PBS</span><div className="tiny-toggle"><button className={detail.application.pbs_account_created ? 'active-good' : ''} onClick={() => setProcessFlag('pbsAccountCreated', true)} disabled={busy}>Yes</button><button className={!detail.application.pbs_account_created ? 'active-neutral' : ''} onClick={() => setProcessFlag('pbsAccountCreated', false)} disabled={busy}>No</button></div></>
                      : key === 'uez' ? <><span>UEZ</span><select value={detail.application.uez_application_status || 'not_started'} onChange={(e) => setProcessFlag('uezApplicationStatus', e.target.value)} disabled={busy}><option value="not_started">Not Started</option><option value="applied">Applied</option><option value="approved">Approved</option></select></>
                      : key === 'tax' ? <><span>Tax clearance</span><div className="tiny-toggle"><button className={detail.application.tax_clearance_good ? 'active-good' : ''} onClick={() => setProcessFlag('taxClearanceGood', true)} disabled={busy}>Good</button><button className={!detail.application.tax_clearance_good ? 'active-neutral' : ''} onClick={() => setProcessFlag('taxClearanceGood', false)} disabled={busy}>No</button></div></>
                      : <><span>Payment</span><div className="status-payment-value"><strong className={detail.payments?.[detail.payments.length - 1]?.status === 'paid' ? 'text-good' : detail.payments?.[detail.payments.length - 1]?.status === 'client_reported' ? 'text-warn' : ''}>{paymentStatusLabel(detail.payments?.[detail.payments.length - 1]?.status)}</strong>{detail.payments?.[detail.payments.length - 1]?.status === 'client_reported' && <button className="tiny-confirm" onClick={confirmPayment} disabled={busy}>Confirm</button>}</div></>;
                    return <div key={key} className="compact-status-item sortable-status-row" draggable onDragStart={() => setDragStatusKey(key)} onDragOver={(e) => e.preventDefault()} onDrop={() => dropStatus(key)}><i className="drag-handle" title="Drag to reorder">⋮⋮</i>{row}</div>;
                  })}
                </div>
              </div>

              <div className="ops-panel documents-panel">'''
s, n = pattern.subn(status_block, s, count=1)
if n != 1: raise SystemExit(f'status grid replacement failed {n}')

# Replace document panel list: two reviewables first, clickable modal, review status in row.
pattern = re.compile(r'<div className="ops-doc-list">.*?</div>\n\s*</div>\n\n\s*<div className="ops-panel actions-panel">', re.S)
doc_block = '''<div className="ops-doc-list">
                  {(() => {
                    const formation = docFor(detail, 'formation');
                    const sole = detail.application.is_sole_proprietorship;
                    const review = detail.application.formation_review_status || 'not_reviewed';
                    return <div className={`ops-doc-row reviewable-doc ${formationSatisfied(detail) ? 'ready' : review === 'rejected' ? 'bad' : ''}`}><button className="ops-doc-name" onClick={() => formation && previewDocument(formation)} disabled={!formation}><b>{formationSatisfied(detail) ? '✓' : '○'}</b><span>Certificate of Formation</span></button><small>{sole ? 'Not required' : !formation ? 'Missing' : review === 'approved' ? 'Approved' : review === 'rejected' ? 'Wrong document' : 'Review'}</small></div>;
                  })()}
                  {(() => {
                    const approval = docFor(detail, 'uez_approval_email');
                    const review = detail.application.uez_approval_review_status || 'not_reviewed';
                    return <div className={`ops-doc-row reviewable-doc ${review === 'approved' ? 'ready' : review === 'rejected' ? 'bad' : approval ? 'review-pending' : ''}`}><button className="ops-doc-name" onClick={() => approval && previewDocument(approval)} disabled={!approval}><b>{review === 'approved' ? '✓' : approval ? '!' : '○'}</b><span>UEZ Approval Email</span></button><small>{!approval ? 'Missing' : review === 'approved' ? 'Approved' : review === 'rejected' ? 'Wrong document' : 'Review'}</small></div>;
                  })()}
                  {[
                    ['brc', 'BRC'],
                    ['tax_clearance', 'Tax Clearance'],
                    ['ldc_application', 'Signed LDC Application']
                  ].map(([type, label]) => {
                    const doc = docFor(detail, type);
                    return <div key={type} className={`ops-doc-row ${doc ? 'ready' : ''}`}><button className="ops-doc-name" onClick={() => doc && previewDocument(doc)} disabled={!doc}><b>{doc ? '✓' : '○'}</b><span>{label}</span></button><small>{doc ? 'Received' : 'Missing'}</small></div>;
                  })}
                </div>
              </div>

              <div className="ops-panel actions-panel">'''
s, n = pattern.subn(doc_block, s, count=1)
if n != 1: raise SystemExit(f'document panel replacement failed {n}')

# Actions: no heading; small verb top, big noun bottom. Green when completed, but rerunnable except grant.
old = '''                <div className="ops-panel-head"><h3>Actions</h3></div>
                <div className="ops-action-grid">
                  <button className="ops-action primary" onClick={runBrcLookup} disabled={busy}><span>BRC</span><strong>Look up & import</strong></button>
                  <button className="ops-action primary" onClick={runTaxClearance} disabled={busy || !myNjCredentials}><span>Tax clearance</span><strong>{myNjCredentials ? 'Retrieve from PBS' : 'Needs MyNJ login'}</strong></button>
                  <button className="ops-action primary" onClick={runLdcJotform} disabled={busy}><span>LDC application</span><strong>{docFor(detail, 'ldc_application') ? 'Run again' : 'Fill & sign'}</strong></button>
                  <button className={`ops-action ${packetReady(detail) ? 'success-action' : ''}`} onClick={runLakewoodGrantPortal} disabled={busy || !packetReady(detail) || detail.application.status === 'applied'}><span>Lakewood grant</span><strong>{detail.application.status === 'applied' ? 'Submitted ✓' : packetReady(detail) ? 'Submit grant' : `${readyDocumentCount(detail)}/5 docs ready`}</strong></button>
                </div>'''
new = '''                <div className="ops-action-grid clean-action-grid">
                  <button className={`ops-action ${docFor(detail, 'brc') ? 'success-action' : 'primary'}`} onClick={runBrcLookup} disabled={busy}><span>FETCH</span><strong>BRC</strong></button>
                  <button className={`ops-action ${docFor(detail, 'tax_clearance') ? 'success-action' : 'primary'}`} onClick={runTaxClearance} disabled={busy || !myNjCredentials}><span>FETCH</span><strong>TAX CLEARANCE</strong></button>
                  <button className={`ops-action ${docFor(detail, 'ldc_application') ? 'success-action' : 'primary'}`} onClick={runLdcJotform} disabled={busy}><span>FILL OUT</span><strong>LDC APP</strong></button>
                  <button className={`ops-action ${detail.application.status === 'applied' ? 'success-action' : packetReady(detail) ? 'ready-action' : ''}`} onClick={runLakewoodGrantPortal} disabled={busy || !packetReady(detail) || detail.application.status === 'applied'}><span>SUBMIT</span><strong>GRANT APP</strong></button>
                </div>'''
if old not in s: raise SystemExit('actions block anchor missing')
s = s.replace(old, new, 1)

# Convert detail sections to accordions by wrapping known cards. Keep all collapsed by default.
sections = [
  ('admin-business-card', 'Business details', "{detail.application.ein || 'No EIN'}"),
  ('payment-admin-card', 'Payment details', "{paymentStatusLabel(detail.payments?.[detail.payments.length - 1]?.status)}"),
  ('brc-admin-card', 'BRC details', "{detail.application.brc_status === 'found' ? 'Found' : (detail.application.brc_status || 'Pending')}"),
  ('admin-documents-card', 'Documents', "{`${detail.documents.length} files`}"),
  ('admin-owners-card', 'Owners', "{`${detail.owners.length} owner${detail.owners.length === 1 ? '' : 's'}`}"),
  ('admin-account-card', 'MyNJ / PBS', "{myNjCredentials ? 'Login ready' : 'Not created'}")
]
for cls, title, summary in sections:
    pattern = re.compile(rf'(\s*)(<section className="[^"]*{cls}[^"]*">.*?</section>)', re.S)
    m = pattern.search(s)
    if not m:
        continue
    wrapped = f'''{m.group(1)}<details className="admin-accordion"><summary><strong>{title}</strong><span>{summary}</span></summary>{m.group(2)}</details>'''
    s = s[:m.start()] + wrapped + s[m.end():]

# Modal before final root close, just before </section></main> near end.
needle = '''        </>}
      </section>
    </main>
  </div>;
}'''
modal = '''        </>}
        {previewDoc && <div className="document-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closePreview(); }}>
          <div className="document-modal" role="dialog" aria-modal="true" aria-label={documentLabel(previewDoc.document_type)}>
            <div className="document-modal-head"><div><strong>{documentLabel(previewDoc.document_type)}</strong><small>{previewDoc.filename}</small></div><button onClick={closePreview} aria-label="Close document">×</button></div>
            <div className="document-modal-body">{previewBusy ? <div className="document-modal-loading">Loading document…</div> : previewUrl ? <iframe src={previewUrl} title={previewDoc.filename} /> : null}</div>
            <div className="document-modal-footer">
              <div>{previewUrl && <a href={previewUrl} target="_blank" rel="noreferrer">Open in new tab</a>}</div>
              {(previewDoc.document_type === 'formation' || previewDoc.document_type === 'uez_approval_email') && <div className="document-review-actions"><button className="warning-button" onClick={() => reviewPreviewDoc('rejected')} disabled={busy}>Wrong document</button><button className="success-button" onClick={() => reviewPreviewDoc('approved')} disabled={busy}>✓ Approve</button></div>}
            </div>
          </div>
        </div>}
      </section>
    </main>
  </div>;
}'''
if needle not in s: raise SystemExit('modal root anchor missing')
s = s.replace(needle, modal, 1)

p.write_text(s)

# ---------- CSS ----------
p = Path('src/styles.css')
s = p.read_text()
s += r'''

/* Final admin polish */
.status-sort-list{grid-template-columns:1fr!important;gap:6px}.sortable-status-row{position:relative;grid-template-columns:18px minmax(90px,1fr) auto!important;display:grid!important;justify-content:initial!important;min-height:40px}.drag-handle{font-style:normal;color:#a0a8b4;cursor:grab;font-size:14px;letter-spacing:-3px}.sortable-status-row:active .drag-handle{cursor:grabbing}.status-payment-value{display:flex;align-items:center;gap:7px}.reviewable-doc{font-weight:700}.ops-doc-row.review-pending{background:#fff9eb}.ops-doc-row.review-pending .ops-doc-name b{color:#b77a00}.clean-action-grid{height:100%}.clean-action-grid .ops-action{min-height:70px;display:flex;flex-direction:column;justify-content:center}.clean-action-grid .ops-action span{font-size:9px;margin-bottom:4px}.clean-action-grid .ops-action strong{font-size:14px;letter-spacing:.01em}.ops-action.ready-action{background:#f3f8f4;border-color:#bfd3c3}.admin-accordion{grid-column:auto;border:1px solid #e0e5eb;border-radius:12px;background:#fff;overflow:hidden}.admin-accordion>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;font-size:13px}.admin-accordion>summary::-webkit-details-marker{display:none}.admin-accordion>summary:after{content:'›';font-size:18px;color:#8a94a1;transform:rotate(90deg);transition:.15s}.admin-accordion[open]>summary:after{transform:rotate(-90deg)}.admin-accordion>summary span{margin-left:auto;color:#7a8491;font-size:11px;font-weight:600}.admin-accordion>.admin-card{border:0;border-top:1px solid #edf0f3;border-radius:0;box-shadow:none;margin:0}.admin-card-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.document-modal-backdrop{position:fixed;inset:0;background:rgba(18,25,35,.62);z-index:9999;display:flex;align-items:center;justify-content:center;padding:22px}.document-modal{width:min(1000px,94vw);height:min(850px,90vh);background:#fff;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.3);display:grid;grid-template-rows:auto 1fr auto;overflow:hidden}.document-modal-head{display:flex;align-items:center;justify-content:space-between;padding:12px 15px;border-bottom:1px solid #e6e9ed}.document-modal-head>div{display:grid;gap:2px}.document-modal-head small{color:#7c8795}.document-modal-head>button{border:0;background:#f1f3f5;border-radius:50%;width:34px;height:34px;font-size:24px;line-height:1;cursor:pointer}.document-modal-body{min-height:0;background:#eef1f4}.document-modal-body iframe{width:100%;height:100%;border:0;background:#fff}.document-modal-loading{height:100%;display:grid;place-items:center;color:#687486}.document-modal-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 15px;border-top:1px solid #e6e9ed}.document-modal-footer a{font-size:12px}.document-review-actions{display:flex;gap:8px}.document-review-actions button{min-width:120px}.actions-panel{display:flex;align-items:stretch}.cockpit-header p{white-space:normal}.admin-details-heading{margin-bottom:7px}
@media(max-width:900px){.admin-card-grid{grid-template-columns:1fr}.document-modal{width:96vw;height:92vh}.document-modal-footer{align-items:stretch;flex-direction:column}.document-review-actions{width:100%}.document-review-actions button{flex:1}.sortable-status-row{grid-template-columns:16px minmax(80px,1fr) auto!important}}
'''
p.write_text(s)
