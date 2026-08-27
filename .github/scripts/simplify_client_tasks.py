from pathlib import Path


def rep(path, old, new, label, count=1):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'missing {label} in {path}')
    p.write_text(s.replace(old, new, count))

p = Path('src/App.jsx')
s = p.read_text()

s = s.replace('  getDocumentUrl,\n', '')
s = s.replace('  getMyNjCredentials,\n', '')
s = s.replace("  const [myNjCredentials, setMyNjCredentials] = useState(null);\n  const [showMyNjSecrets, setShowMyNjSecrets] = useState(false);\n", '')

old = """  const app = bundle.application;
  const needsBrc = ['not_found', 'missing', 'required'].includes(app.brc_status) || app.status === 'waiting_for_brc';
  const brcUploaded = app.brc_status === 'uploaded' || app.status === 'brc_uploaded';
  const brcConfirmed = app.brc_status === 'found' || app.status === 'brc_confirmed';
  const approvalUploaded = bundle.documents.some((doc) => doc.document_type === 'uez_approval_email');
  const latestPayment = [...(bundle.payments || [])].reverse()[0] || null;
  const needsApprovalEmail = app.pbs_status === 'account_created' || app.status === 'waiting_for_uez_approval';

  useEffect(() => {
    let active = true;
    getMyNjCredentials(app.id).then((result) => {
      if (active) setMyNjCredentials(result.exists ? result.credentials : null);
    }).catch(() => {});
    return () => { active = false; };
  }, [app.id]);
"""
new = """  const app = bundle.application;
  const latestDocument = (type) => [...(bundle.documents || [])].reverse().find((doc) => doc.document_type === type) || null;
  const formation = latestDocument('formation');
  const formationRequired = !app.is_sole_proprietorship;
  const formationReview = app.formation_review_status || 'not_reviewed';
  const approval = latestDocument('uez_approval_email');
  const approvalReview = app.uez_approval_review_status || 'not_reviewed';
  const needsBrc = ['not_found', 'missing', 'required'].includes(app.brc_status) || app.status === 'waiting_for_brc';
  const brcConfirmed = app.brc_status === 'found' || app.status === 'brc_confirmed';
  const latestPayment = [...(bundle.payments || [])].reverse()[0] || null;
  const approvalStageReached = app.pbs_status === 'account_created' || app.pbs_status === 'uez_approval_uploaded' || app.status === 'waiting_for_uez_approval' || Boolean(approval);
"""
if old not in s:
    raise SystemExit('missing portal state block')
s = s.replace(old, new, 1)

old = """  async function uploadApprovalEmail(file) {
"""
new = """  async function uploadFormation(file) {
    if (!file) return;
    setUploading(true);
    setMessage('');
    try {
      await uploadApplicationDocument(app.id, 'formation', file);
      await onRefresh();
      setMessage('Certificate of Formation uploaded.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function uploadApprovalEmail(file) {
"""
if old not in s:
    raise SystemExit('missing approval upload function anchor')
s = s.replace(old, new, 1)

s = s.replace("      setMessage('Your UEZ approval email was uploaded. COR will verify it.');", "      setMessage('UEZ approval email uploaded.');")
s = s.replace("      setMessage('Thanks. COR will verify the payment and update your account.');", "      setMessage('Payment reported. Your account will update when it is confirmed.');")
s = s.replace("      setMessage('Thanks. COR was notified and will recheck your BRC.');", "      setMessage('Thanks. Your BRC will be rechecked.');")

# Remove document opener; the client portal no longer exposes a generic document library.
start = s.find('  async function openDocument(doc) {')
if start != -1:
    end = s.find('\n\n  return <div className="app-shell">', start)
    if end == -1:
        raise SystemExit('could not remove openDocument')
    s = s[:start] + s[end:]

s = s.replace('<p>COR will post each next step here as your application moves forward.</p>', '<p>Your next steps and application updates appear here.</p>')

old = """          {brcConfirmed && <div className="action-panel good-panel">
            <h3>✓ BRC confirmed</h3>
            <p>{app.registered_business_name || app.brc_registered_name || app.business_name_input}</p>
          </div>}

          {needsBrc && <div className="action-panel warn-panel">
"""
new = """          <div className=\"portal-section-head\"><h3>What you need to do</h3></div>

          {formationRequired && !formation && <div className=\"action-panel warn-panel\">
            <h3>Upload your Certificate of Formation <span className=\"required-star\">*</span></h3>
            <p>Upload your Certificate of Formation to continue.</p>
            <label className=\"primary compact inline-button file-button\">
              {uploading ? 'Uploading…' : 'Upload Certificate of Formation'}
              <input type=\"file\" accept=\".pdf,image/*\" disabled={uploading} onChange={(e) => uploadFormation(e.target.files?.[0])} />
            </label>
          </div>}

          {formationRequired && formation && formationReview === 'not_reviewed' && <div className=\"action-panel\">
            <h3>Certificate of Formation uploaded</h3>
            <p>Under review.</p>
          </div>}

          {formationRequired && formation && formationReview === 'approved' && <div className=\"action-panel good-panel\">
            <h3>✓ Certificate of Formation accepted</h3>
          </div>}

          {formationRequired && formationReview === 'rejected' && <div className=\"action-panel warn-panel\">
            <h3>Certificate of Formation needs replacement</h3>
            <p>Please upload a new Certificate of Formation.</p>
            <label className=\"primary compact inline-button file-button\">
              {uploading ? 'Uploading…' : 'Upload replacement Certificate of Formation'}
              <input type=\"file\" accept=\".pdf,image/*\" disabled={uploading} onChange={(e) => uploadFormation(e.target.files?.[0])} />
            </label>
          </div>}

          {needsBrc && <div className=\"action-panel warn-panel\">
"""
if old not in s:
    raise SystemExit('missing BRC confirmed/action block')
s = s.replace(old, new, 1)

s = s.replace("<p>COR could not locate a current New Jersey BRC. Create/register for it with New Jersey, then come back here and tell us when you're done. You do not need to upload the BRC.</p>", "<p>Create/register for your New Jersey BRC, then come back here and tell us when you're done. You do not need to upload it.</p>")

old = """          {needsApprovalEmail && !approvalUploaded && <div className="action-panel warn-panel">
            <h3>Upload your UEZ approval email <span className="required-star">*</span></h3>
            <p>Upload the “Notice of Certification Application Approved” email you received from UEZdonotreply@dca.nj.gov as proof that the business is registered in the program.</p>
            <label className="primary compact inline-button file-button">
              {uploading ? 'Uploading…' : 'Upload required approval email'}
              <input type="file" accept=".pdf,.eml,image/*" disabled={uploading} onChange={(e) => uploadApprovalEmail(e.target.files?.[0])} />
            </label>
          </div>}

          {approvalUploaded && <div className="action-panel good-panel">
            <h3>✓ UEZ approval email received</h3>
            <p>COR will verify the notice and continue your application.</p>
          </div>}
"""
new = """          {approvalStageReached && !approval && <div className=\"action-panel warn-panel\">
            <h3>Upload your UEZ approval email <span className=\"required-star\">*</span></h3>
            <p>Upload the “Notice of Certification Application Approved” email you received from UEZdonotreply@dca.nj.gov.</p>
            <label className=\"primary compact inline-button file-button\">
              {uploading ? 'Uploading…' : 'Upload UEZ approval email'}
              <input type=\"file\" accept=\".pdf,.eml,image/*\" disabled={uploading} onChange={(e) => uploadApprovalEmail(e.target.files?.[0])} />
            </label>
          </div>}

          {approval && approvalReview === 'not_reviewed' && <div className=\"action-panel\">
            <h3>UEZ approval email uploaded</h3>
            <p>Under review.</p>
          </div>}

          {approval && approvalReview === 'approved' && <div className=\"action-panel good-panel\">
            <h3>✓ UEZ approval email accepted</h3>
          </div>}

          {approvalReview === 'rejected' && <div className=\"action-panel warn-panel\">
            <h3>UEZ approval email needs replacement</h3>
            <p>Please upload the correct “Notice of Certification Application Approved” email.</p>
            <label className=\"primary compact inline-button file-button\">
              {uploading ? 'Uploading…' : 'Upload replacement approval email'}
              <input type=\"file\" accept=\".pdf,.eml,image/*\" disabled={uploading} onChange={(e) => uploadApprovalEmail(e.target.files?.[0])} />
            </label>
          </div>}
"""
if old not in s:
    raise SystemExit('missing approval portal block')
s = s.replace(old, new, 1)

# Remove generic document library.
old = """        <section className="wizard-card portal-card">
          <div className="portal-section-head"><h3>Documents</h3><span>{bundle.documents.length}</span></div>
          <div className="document-list">
            {bundle.documents.length === 0 && <p className="muted">No documents uploaded yet.</p>}
            {bundle.documents.map((doc) => <button className="document-row" key={doc.id} onClick={() => openDocument(doc)}>
              <span><strong>{documentLabel(doc.document_type)}</strong><small>{doc.filename}</small></span>
              <b>Open</b>
            </button>)}
          </div>
        </section>

"""
if old not in s:
    raise SystemExit('missing generic document section')
s = s.replace(old, '', 1)

s = s.replace("<div className=\"action-panel good-panel\"><h3>✓ Client payment recorded</h3><p>COR confirmed that your payment was received.</p></div>", "<div className=\"action-panel good-panel\"><h3>✓ Payment received</h3></div>")
s = s.replace("<p className=\"muted\">After you send the $500 payment, click below so COR knows to check for it.</p>", "<p className=\"muted\">After you send the $500 payment, click below.</p>")

# Remove MyNJ/PBS credentials from client portal. They are not a client action.
start = s.find('        {myNjCredentials && <section className="wizard-card portal-card portal-wide mynj-card">')
if start != -1:
    end_marker = '        <section className="wizard-card portal-card portal-wide">\n          <div className="portal-section-head"><h3>Updates</h3></div>'
    end = s.find(end_marker, start)
    if end == -1:
        raise SystemExit('could not remove MyNJ card')
    s = s[:start] + s[end:]
else:
    raise SystemExit('missing MyNJ client card')

# Keep the activity tracker, but make it a clean tracker: label + timestamp only.
s = s.replace("              <div><strong>{event.label || statusLabel(event.status)}</strong><p>{event.message}</p><small>{new Date(event.created_at).toLocaleString()}</small></div>", "              <div><strong>{event.label || statusLabel(event.status)}</strong><small>{new Date(event.created_at).toLocaleString()}</small></div>")

p.write_text(s)

# Backend: formation upload should appear in the activity tracker, and review results should be visible with neutral language.
p = Path('backend/routes/uez.js')
s = p.read_text()
old = """    if (documentType === 'formation') {
      await supabase.from('uez_applications').update({ formation_review_status: 'not_reviewed', updated_at: new Date().toISOString() }).eq('id', application.id);
    }
"""
new = """    if (documentType === 'formation') {
      await supabase.from('uez_applications').update({ formation_review_status: 'not_reviewed', updated_at: new Date().toISOString() }).eq('id', application.id);
      await addStatusEvent(
        application.id,
        'formation_uploaded',
        'Certificate of Formation uploaded',
        'Certificate of Formation uploaded and awaiting review.',
        req.user.id,
        true
      );
    }
"""
if old not in s:
    raise SystemExit('missing formation upload backend block')
s = s.replace(old, new, 1)

old = """      decision === 'approved'
        ? `${document.filename} was reviewed and approved by COR.`
        : `${document.filename} was reviewed and marked as the wrong document.`,
      req.user.id,
      false
"""
new = """      decision === 'approved'
        ? `${document.filename} was reviewed and accepted.`
        : `${document.filename} needs to be replaced.`,
      req.user.id,
      true
"""
if old not in s:
    raise SystemExit('missing document review activity block')
s = s.replace(old, new, 1)

p.write_text(s)
