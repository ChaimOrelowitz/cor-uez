from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'{label}: anchor not found in {path}')
    p.write_text(s.replace(old, new, 1))

# ---------------- backend/routes/uez.js ----------------
p = Path('backend/routes/uez.js')
s = p.read_text()

# Public confirmed-signup endpoint before auth middleware
anchor = "router.use(requireUezAuth);\n"
block = """router.post('/signup', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !/^\\S+@\\S+\\.\\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (error) throw error;
    res.status(201).json({ id: data.user?.id || null, email });
  } catch (err) {
    const message = /already|registered|exists/i.test(err.message || '') ? 'An account already exists for this email. Sign in instead.' : err.message;
    res.status(400).json({ error: message });
  }
});

""" + anchor
if "router.post('/signup'" not in s:
    if anchor not in s: raise SystemExit('signup auth anchor missing')
    s = s.replace(anchor, block, 1)

# Approval upload: remain applied pending human review
s = s.replace("uez_application_submitted: true,", "uez_application_submitted: true,\n        uez_application_status: application.uez_application_status === 'approved' ? 'approved' : 'applied',")

# Formation upload always resets review for entities
needle = """    if (documentType === 'brc') {
"""
insert = """    if (documentType === 'formation' && !application.is_sole_proprietorship) {
      await supabase.from('uez_applications').update({ formation_review_status: 'not_reviewed', updated_at: new Date().toISOString() }).eq('id', application.id);
    }

""" + needle
if insert not in s:
    if needle not in s: raise SystemExit('formation upload anchor missing')
    s = s.replace(needle, insert, 1)

# Deleting formation resets review
needle = """    if (doc.document_type === 'brc' && req.user.role === 'admin') {
"""
insert = """    if (doc.document_type === 'formation') {
      await supabase.from('uez_applications').update({ formation_review_status: 'not_reviewed', updated_at: new Date().toISOString() }).eq('id', application.id);
    }

""" + needle
if insert not in s:
    s = s.replace(needle, insert, 1)

# Process flags endpoint extended
old = """    if (typeof body.pbsAccountCreated === 'boolean') {
      patch.pbs_account_created = body.pbsAccountCreated;
      patch.pbs_status = body.pbsAccountCreated ? 'account_created' : null;
    }
    if (typeof body.uezApplicationSubmitted === 'boolean') patch.uez_application_submitted = body.uezApplicationSubmitted;
    if (typeof body.taxClearanceGood === 'boolean') patch.tax_clearance_good = body.taxClearanceGood;
"""
new = """    if (typeof body.pbsAccountCreated === 'boolean') {
      patch.pbs_account_created = body.pbsAccountCreated;
      patch.pbs_status = body.pbsAccountCreated ? 'account_created' : null;
    }
    if (typeof body.taxClearanceGood === 'boolean') patch.tax_clearance_good = body.taxClearanceGood;
    if (['not_started', 'applied', 'approved'].includes(body.uezApplicationStatus)) {
      patch.uez_application_status = body.uezApplicationStatus;
      patch.uez_application_submitted = body.uezApplicationStatus !== 'not_started';
    }
    if (['not_reviewed', 'approved', 'rejected'].includes(body.formationReviewStatus)) {
      patch.formation_review_status = body.formationReviewStatus;
    }
"""
if old in s: s = s.replace(old, new, 1)

# Payment: applicant reports sent
admin_list_anchor = "router.get('/admin/applications', requireUezAdmin, async (_req, res) => {\n"
payment_routes = """router.post('/applications/:id/payment-reported', async (req, res) => {
  try {
    const application = await getOwnedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });

    const { data: existing, error: existingError } = await supabase.from('uez_payments')
      .select('*')
      .eq('application_id', application.id)
      .in('status', ['client_reported', 'paid'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return res.json(existing);

    const { data, error } = await supabase.from('uez_payments').insert({
      application_id: application.id,
      amount: Number(application.payment_expected_amount || 500),
      status: 'client_reported',
      notes: 'Applicant reported that payment was sent.',
      recorded_by: req.user.id
    }).select('*').single();
    if (error) throw error;
    await addStatusEvent(application.id, 'payment_reported', 'Payment reported', 'You told COR that your payment was sent. We will verify receipt.', req.user.id, true);
    res.status(201).json(data);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/admin/applications/:id/payment', requireUezAdmin, async (req, res) => {
  try {
    const { data: application, error: appError } = await supabase.from('uez_applications').select('*').eq('id', req.params.id).single();
    if (appError || !application) return res.status(404).json({ error: 'Application not found' });

    const amount = Number(req.body?.amount ?? application.payment_expected_amount ?? 500);
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Enter a valid payment amount.' });
    const status = req.body?.status === 'client_reported' ? 'client_reported' : 'paid';
    const paymentDate = status === 'paid' ? (req.body?.paymentDate || new Date().toISOString().slice(0, 10)) : null;
    const method = String(req.body?.paymentMethod || '').trim() || null;
    const reference = String(req.body?.reference || '').trim() || null;
    const notes = String(req.body?.notes || '').trim() || null;

    const { data: existing, error: existingError } = await supabase.from('uez_payments')
      .select('*').eq('application_id', application.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existingError) throw existingError;

    let result;
    if (existing) {
      const { data, error } = await supabase.from('uez_payments').update({
        amount, status, payment_date: paymentDate, payment_method: method, reference, notes, recorded_by: req.user.id
      }).eq('id', existing.id).select('*').single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase.from('uez_payments').insert({
        application_id: application.id, amount, status, payment_date: paymentDate,
        payment_method: method, reference, notes, recorded_by: req.user.id
      }).select('*').single();
      if (error) throw error;
      result = data;
    }

    if (status === 'paid') await addStatusEvent(application.id, 'payment_recorded', 'Client payment recorded', 'COR confirmed that your payment was received.', req.user.id, true);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

""" + admin_list_anchor
if "payment-reported" not in s:
    if admin_list_anchor not in s: raise SystemExit('payment route anchor missing')
    s = s.replace(admin_list_anchor, payment_routes, 1)

p.write_text(s)

# ---------------- src/api.js ----------------
p = Path('src/api.js'); s = p.read_text()
old = """export async function signUpApplicant(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${window.location.origin}/` }
  });
  if (error) throw error;
  return data;
}
"""
new = """export async function signUpApplicant(email, password) {
  const response = await fetch(`${API_BASE}/api/uez/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Could not create your account.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
"""
if old in s: s=s.replace(old,new,1)
add = """
export function reportApplicantPayment(applicationId) {
  return request(`/api/uez/applications/${applicationId}/payment-reported`, { method: 'POST' });
}

export function saveAdminPayment(applicationId, payload) {
  return request(`/api/uez/admin/applications/${applicationId}/payment`, {
    method: 'PUT', body: JSON.stringify(payload)
  });
}
"""
if 'reportApplicantPayment' not in s: s += add
p.write_text(s)

# ---------------- src/App.jsx ----------------
p = Path('src/App.jsx'); s=p.read_text()
# imports
s=s.replace("  submitApplication,\n  uploadApplicationDocument\n", "  submitApplication,\n  uploadApplicationDocument,\n  deleteDocument,\n  reportApplicantPayment\n")

# simple overall status
start = s.find('function statusLabel(status) {')
if start >= 0:
    end = s.find('\n}\n\nfunction documentLabel', start)
    if end >= 0:
        s = s[:start] + "function statusLabel(status) {\n  return status === 'applied' ? 'Applied' : 'In Progress';\n}\n" + s[end+2:]

# helper formatters before ApplicantPortal
marker='function ApplicantPortal({ bundle, onRefresh, onSignOut }) {'
helpers="""function formatPhone(value) {
  const digits = String(value || '').replace(/\\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0,3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
}
function formatSsn(value) {
  const digits = String(value || '').replace(/\\D/g, '').slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0,3)}-${digits.slice(3)}`;
  return `${digits.slice(0,3)}-${digits.slice(3,5)}-${digits.slice(5)}`;
}
function formatDob(value) {
  const digits = String(value || '').replace(/\\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0,2)}/${digits.slice(2)}`;
  return `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`;
}

"""+marker
if 'function formatPhone(value)' not in s: s=s.replace(marker,helpers,1)

# applicant portal payment state and actions
s=s.replace("  const [showMyNjSecrets, setShowMyNjSecrets] = useState(false);", "  const [showMyNjSecrets, setShowMyNjSecrets] = useState(false);\n  const [paymentBusy, setPaymentBusy] = useState(false);")
s=s.replace("  const approvalUploaded = bundle.documents.some((doc) => doc.document_type === 'uez_approval_email');", "  const approvalUploaded = bundle.documents.some((doc) => doc.document_type === 'uez_approval_email');\n  const latestPayment = [...(bundle.payments || [])].reverse()[0] || null;")
portal_func_anchor="""  async function openDocument(doc) {
"""
payment_fn="""  async function reportPaymentSent() {
    setPaymentBusy(true); setMessage('');
    try {
      await reportApplicantPayment(app.id);
      await onRefresh();
      setMessage('Thanks. COR will verify the payment and update your account.');
    } catch (err) { setMessage(err.message); }
    finally { setPaymentBusy(false); }
  }

"""+portal_func_anchor
if 'async function reportPaymentSent' not in s: s=s.replace(portal_func_anchor,payment_fn,1)
# insert payment card before MyNJ card
card_anchor="""        {myNjCredentials && <section className=\"wizard-card portal-card portal-wide mynj-card\">"""
payment_card="""        <section className=\"wizard-card portal-card\">
          <div className=\"portal-section-head\"><h3>Payment</h3><span>$500</span></div>
          {latestPayment?.status === 'paid' ? <div className=\"action-panel good-panel\"><h3>✓ Client payment recorded</h3><p>COR confirmed that your payment was received.</p></div>
            : latestPayment?.status === 'client_reported' ? <div className=\"action-panel\"><h3>Payment reported</h3><p>You told COR the payment was sent. We are verifying it.</p></div>
            : <><p className=\"muted\">After you send the $500 payment, click below so COR knows to check for it.</p><button className=\"primary admin-full-button\" onClick={reportPaymentSent} disabled={paymentBusy}>{paymentBusy ? 'Saving…' : 'I sent my payment'}</button></>}
        </section>

"""+card_anchor
if 'I sent my payment' not in s: s=s.replace(card_anchor,payment_card,1)

# new suggestion index state
s=s.replace("  const [showAddressSuggestions, setShowAddressSuggestions] = useState(false);", "  const [showAddressSuggestions, setShowAddressSuggestions] = useState(false);\n  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);")
# reset when suggestions fetch
s=s.replace("setShowAddressSuggestions(suggestions.length > 0);", "setShowAddressSuggestions(suggestions.length > 0);\n          setActiveSuggestionIndex(-1);")
# owner formatting
old="""  function updateOwner(index, key) {
    return (e) => {
      const value = e.target.value;
"""
new="""  function updateOwner(index, key) {
    return (e) => {
      const raw = e.target.value;
      const value = key === 'phone' ? formatPhone(raw) : key === 'ssn' ? formatSsn(raw) : key === 'dob' ? formatDob(raw) : raw;
"""
if old in s:s=s.replace(old,new,1)
# address keydown handler before updateAddress
marker="""  function updateAddress(e) {
"""
fn="""  function handleAddressKeyDown(e) {
    if (!showAddressSuggestions || !addressSuggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSuggestionIndex((i) => Math.min(i + 1, addressSuggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSuggestionIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && activeSuggestionIndex >= 0) { e.preventDefault(); selectAddressSuggestion(addressSuggestions[activeSuggestionIndex]); }
    else if (e.key === 'Escape') { setShowAddressSuggestions(false); setActiveSuggestionIndex(-1); }
  }

"""+marker
if 'function handleAddressKeyDown' not in s:s=s.replace(marker,fn,1)
# select reset
s=s.replace("setShowAddressSuggestions(false);\n    setEligibility(null);", "setShowAddressSuggestions(false);\n    setActiveSuggestionIndex(-1);\n    setEligibility(null);")
# remove doc helper
marker="""  function continueFromAddress() {
"""
fn="""  async function removeUploadedDocument(doc) {
    setUploadingType('remove'); setMessage('');
    try {
      await deleteDocument(applicationId, doc.id);
      const refreshed = await getApplication(applicationId);
      setBundle(refreshed); setDocuments(refreshed.documents || []);
    } catch (err) { setMessage(err.message); }
    finally { setUploadingType(''); }
  }

"""+marker
if 'removeUploadedDocument' not in s:s=s.replace(marker,fn,1)
# Account step as form for enter submission
old="""        {step === 2 && <div className=\"content-block\">
          <div className=\"intro-copy\">
"""
new="""        {step === 2 && <form className=\"content-block\" onSubmit={(e) => { e.preventDefault(); (signInMode ? signInAndResume : createAccountAndCase)(); }}>
          <div className=\"intro-copy\">
"""
if old in s:s=s.replace(old,new,1)
s=s.replace("          <button type=\"button\" className=\"text-button\" onClick={() => { setSignInMode((old) => !old); setMessage(''); }}>{signInMode ? 'Need to create an account?' : 'Already have an account?'}</button>\n        </div>}", "          <button type=\"button\" className=\"text-button\" onClick={() => { setSignInMode((old) => !old); setMessage(''); }}>{signInMode ? 'Need to create an account?' : 'Already have an account?'}</button>\n          <button type=\"submit\" className=\"primary account-submit\" disabled={busy}>{busy ? 'Please wait…' : signInMode ? 'Sign in' : 'Create account'}</button>\n        </form>}")
# avoid duplicate footer account button
s=s.replace("          {step === 2 && <button className=\"primary compact\" onClick={signInMode ? signInAndResume : createAccountAndCase} disabled={busy}>{busy ? 'Please wait…' : signInMode ? 'Sign in' : 'Create account'}</button>}\n", "")
# email/password required
s=s.replace('<div><label>Email</label><input type="email" value={form.email} onChange={update(\'email\')} /></div>', '<div><label>Email <span className="required-star">*</span></label><input type="email" value={form.email} onChange={update(\'email\')} required /></div>')
s=s.replace('<div><label>Password</label><input type="password" value={form.password} onChange={update(\'password\')} /></div>', '<div><label>Password <span className="required-star">*</span></label><input type="password" value={form.password} onChange={update(\'password\')} required minLength="6" /></div>')
# address required star + keyboard active class
s=s.replace('<label>Registered business address</label>', '<label>Registered business address <span className="required-star">*</span></label>')
s=s.replace('onFocus={() => setShowAddressSuggestions(addressSuggestions.length > 0)} autoComplete="off"', 'onFocus={() => setShowAddressSuggestions(addressSuggestions.length > 0)} onKeyDown={handleAddressKeyDown} autoComplete="off"')
s=s.replace("{addressSuggestions.map((suggestion) => <button key={`${suggestion.text}-${suggestion.magicKey || ''}`} type=\"button\" onMouseDown={(e) => e.preventDefault()} onClick={() => selectAddressSuggestion(suggestion)}>{suggestion.text}</button>)}", "{addressSuggestions.map((suggestion, index) => <button key={`${suggestion.text}-${suggestion.magicKey || ''}`} className={index === activeSuggestionIndex ? 'active' : ''} type=\"button\" onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActiveSuggestionIndex(index)} onClick={() => selectAddressSuggestion(suggestion)}>{suggestion.text}</button>)}")
# business required fields/stars
repls={
'<label>Business name</label><input value={form.businessName}':'<label>Business name <span className="required-star">*</span></label><input required value={form.businessName}',
'<label>In a few words, what does the business do?</label>':'<label>In a few words, what does the business do? <span className="required-star">*</span></label>',
'<div><label>EIN</label><input value={form.ein}':'<div><label>EIN <span className="required-star">*</span></label><input required value={form.ein}',
'<div><label>Year founded</label><input value={form.yearFounded}':'<div><label>Year founded <span className="required-star">*</span></label><input required value={form.yearFounded}',
'<div><label>Is this business a sole proprietorship?</label><select':'<div><label>Is this business a sole proprietorship? <span className="required-star">*</span></label><select required',
'<div><label>Full-time employees</label><input':'<div><label>Full-time employees <span className="required-star">*</span></label><input required',
'<div><label>Part-time employees</label><input':'<div><label>Part-time employees <span className="required-star">*</span></label><input required',
'<div className="field-grid"><div><label>Is the primary owner the 100% owner?</label><select':'<div className="field-grid"><div><label>Is the primary owner the 100% owner? <span className="required-star">*</span></label><select required',
'<div><label>First name</label><input':'<div><label>First name <span className="required-star">*</span></label><input required',
'<div><label>Last name</label><input':'<div><label>Last name <span className="required-star">*</span></label><input required',
'<div><label>Email</label><input type="email" value={owner.email}':'<div><label>Email <span className="required-star">*</span></label><input required type="email" value={owner.email}',
'<div><label>Best phone</label><input value={owner.phone}':'<div><label>Best phone <span className="required-star">*</span></label><input required inputMode="tel" value={owner.phone}',
'<div><label>Date of birth</label><input type="date" value={owner.dob}':'<div><label>Date of birth <span className="required-star">*</span></label><input required inputMode="numeric" placeholder="MM/DD/YYYY" value={owner.dob}',
'<div><label>SSN</label><input value={owner.ssn}':'<div><label>SSN <span className="required-star">*</span></label><input required inputMode="numeric" value={owner.ssn}',
'<div><label>Ownership percentage</label><input type="number"':'<div><label>Ownership percentage <span className="required-star">*</span></label><input required type="number"'
}
for a,b in repls.items(): s=s.replace(a,b)
s=s.replace(' placeholder="50"','')
# document formation visual required star
s=s.replace('<strong>Certificate of Formation / formation document</strong>', '<strong>Certificate of Formation / formation document {form.isSoleProprietorship !== \'yes\' && <span className="required-star">*</span>}</strong>')
# remove docs row buttons
s=s.replace("{documents.map((doc) => <div className=\"uploaded-doc-row\" key={doc.id}><span>{documentLabel(doc.document_type)}</span><strong>{doc.filename}</strong></div>)}", "{documents.map((doc) => <div className=\"uploaded-doc-row\" key={doc.id}><span>{documentLabel(doc.document_type)}</span><strong>{doc.filename}</strong><button type=\"button\" className=\"owner-remove\" onClick={() => removeUploadedDocument(doc)} disabled={Boolean(uploadingType)}>Remove</button></div>)}")

p.write_text(s)

# ---------------- AdminPage.jsx ----------------
p=Path('src/AdminPage.jsx'); s=p.read_text()
s=s.replace("  updateAdminProcessFlags,\n  whoAmI", "  updateAdminProcessFlags,\n  saveAdminPayment,\n  whoAmI")
# Remove obsolete manual BRC fields from state but keep backend values if needed
old="""  const [brcForm, setBrcForm] = useState({
    registeredBusinessName: '',
    tradeName: '',
    address: '',
    certificateNumber: '',
    effectiveDate: '',
    issuanceDate: ''
  });
"""
new="""  const [brcForm, setBrcForm] = useState({ registeredBusinessName: '', tradeName: '', address: '' });
  const [paymentDraft, setPaymentDraft] = useState({ amount: '500', paymentDate: new Date().toISOString().slice(0,10), paymentMethod: 'Zelle', reference: '', notes: '' });
"""
if old in s:s=s.replace(old,new,1)
# brc set form when opening
old="""      setBrcForm({
        registeredBusinessName: app.brc_registered_name || app.registered_business_name || app.business_name_input || '',
        tradeName: brc.tradeName || '',
        address: brc.address || '',
        certificateNumber: brc.certificateNumber || '',
        effectiveDate: brc.effectiveDate || '',
        issuanceDate: brc.issuanceDate || ''
      });
"""
new="""      setBrcForm({
        registeredBusinessName: app.brc_registered_name || app.registered_business_name || app.business_name_input || '',
        tradeName: brc.tradeName || '',
        address: brc.address || ''
      });
      const latestPayment = [...(data.payments || [])].reverse()[0];
      setPaymentDraft({
        amount: String(latestPayment?.amount ?? app.payment_expected_amount ?? 500),
        paymentDate: latestPayment?.payment_date || new Date().toISOString().slice(0,10),
        paymentMethod: latestPayment?.payment_method || 'Zelle', reference: latestPayment?.reference || '', notes: latestPayment?.notes || ''
      });
"""
if old in s:s=s.replace(old,new,1)
# process helper allow strings
old="""  async function setProcessFlag(key, value) {
"""
# no change function needed
# add payment save function before markReadyForLdc
marker="""  async function markReadyForLdc() {
"""
fn="""  async function confirmPayment() {
    setBusy(true); setMessage('Recording payment…');
    try {
      await saveAdminPayment(detail.application.id, { ...paymentDraft, status: 'paid' });
      await refreshList(detail.application.id);
      setMessage('Client payment recorded.');
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

"""+marker
if 'async function confirmPayment' not in s:s=s.replace(marker,fn,1)
# BRC fields simplify exact chunk by deleting cert/date two-col
import re
s=re.sub(r"\n\s*<div className=\"admin-two-col\">\s*<div><label>Certificate #</label>.*?</div>\s*</div>\n", "\n", s, count=1, flags=re.S)
# better ensure no cert fields if regex missed
s=re.sub(r"\s*<div><label>Certificate #</label>.*?</div>", "", s, count=1, flags=re.S)
s=re.sub(r"\s*<div><label>Effective date</label>.*?</div>", "", s, count=1, flags=re.S)
s=re.sub(r"\s*<div><label>Issue date</label>.*?</div>", "", s, count=1, flags=re.S)
# Make Process card wide and replace content array
s=s.replace('<section className="admin-card">\n              <div className="admin-card-head"><h3>Process</h3>', '<section className="admin-card admin-wide admin-operations-card">\n              <div className="admin-card-head"><h3>Requirements & Processing</h3>')
oldarr="""                {[
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
"""
newarr="""                <div className=\"admin-process-row\"><strong>PBS Account Created</strong><div className=\"admin-process-buttons\"><button className={detail.application.pbs_account_created ? 'success-button' : 'secondary'} onClick={() => setProcessFlag('pbsAccountCreated', true)} disabled={busy}>Yes</button><button className={!detail.application.pbs_account_created ? 'warning-button' : 'secondary'} onClick={() => setProcessFlag('pbsAccountCreated', false)} disabled={busy}>No</button></div></div>
                <div className=\"admin-process-row\"><strong>UEZ Application Status</strong><select value={detail.application.uez_application_status || 'not_started'} onChange={(e) => setProcessFlag('uezApplicationStatus', e.target.value)} disabled={busy}><option value=\"not_started\">Not Started</option><option value=\"applied\">Applied</option><option value=\"approved\">Approved</option></select></div>
                <div className=\"admin-process-row\"><strong>Tax Clearance Good</strong><div className=\"admin-process-buttons\"><button className={detail.application.tax_clearance_good ? 'success-button' : 'secondary'} onClick={() => setProcessFlag('taxClearanceGood', true)} disabled={busy}>Yes</button><button className={!detail.application.tax_clearance_good ? 'warning-button' : 'secondary'} onClick={() => setProcessFlag('taxClearanceGood', false)} disabled={busy}>No</button></div></div>
"""
if oldarr in s:s=s.replace(oldarr,newarr,1)
# formation review card inside required docs before checklist
needle='<div className="admin-checklist">'
formation_ui="""{!detail.application.is_sole_proprietorship && <div className=\"formation-review-box\"><strong>Formation review</strong><span>{detail.documents.some((doc) => doc.document_type === 'formation') ? 'Document uploaded' : 'Waiting for upload'}</span><div className=\"admin-process-buttons\"><button className={detail.application.formation_review_status === 'approved' ? 'success-button' : 'secondary'} onClick={() => setProcessFlag('formationReviewStatus','approved')} disabled={busy || !detail.documents.some((doc) => doc.document_type === 'formation')}>Approve</button><button className={detail.application.formation_review_status === 'rejected' ? 'warning-button' : 'secondary'} onClick={() => setProcessFlag('formationReviewStatus','rejected')} disabled={busy || !detail.documents.some((doc) => doc.document_type === 'formation')}>Wrong document</button></div></div>}
              """+needle
if 'formation-review-box' not in s:s=s.replace(needle,formation_ui,1)
# checklist formation readiness special and ready-for-processing 4 checks
oldcount="REQUIRED_GRANT_DOCUMENTS.filter(([type]) => detail.documents.some((doc) => doc.document_type === type)).length"
newcount="REQUIRED_GRANT_DOCUMENTS.filter(([type]) => type === 'formation' ? (detail.application.is_sole_proprietorship || (detail.documents.some((doc) => doc.document_type === 'formation') && detail.application.formation_review_status === 'approved')) : detail.documents.some((doc) => doc.document_type === type)).length"
s=s.replace(oldcount,newcount)
# insert computed readiness directly in JSX via expression before LDC button
ldc_button='''              <button
                className="primary admin-full-button"
                onClick={runLdcJotform}'''
readiness='''              <div className={`processing-readiness ${(detail.application.is_sole_proprietorship || (detail.documents.some((doc) => doc.document_type === 'formation') && detail.application.formation_review_status === 'approved')) && detail.documents.some((doc) => doc.document_type === 'brc') && detail.documents.some((doc) => doc.document_type === 'uez_approval_email') && detail.documents.some((doc) => doc.document_type === 'tax_clearance') ? 'ready' : ''}`}><strong>{(detail.application.is_sole_proprietorship || (detail.documents.some((doc) => doc.document_type === 'formation') && detail.application.formation_review_status === 'approved')) && detail.documents.some((doc) => doc.document_type === 'brc') && detail.documents.some((doc) => doc.document_type === 'uez_approval_email') && detail.documents.some((doc) => doc.document_type === 'tax_clearance') ? '✓ Ready for processing' : 'Not ready for processing'}</strong><small>Formation approved (or sole prop) · BRC · UEZ approval email · Tax clearance</small></div>

'''+ldc_button
if 'processing-readiness' not in s:s=s.replace(ldc_button,readiness,1)
# Grant button should use all 5, formation approval sole prop exception
old="disabled={busy || REQUIRED_GRANT_DOCUMENTS.some(([type]) => !detail.documents.some((doc) => doc.document_type === type)) || detail.application.status === 'applied'}"
new="disabled={busy || !((detail.application.is_sole_proprietorship || (detail.documents.some((doc) => doc.document_type === 'formation') && detail.application.formation_review_status === 'approved')) && detail.documents.some((doc) => doc.document_type === 'brc') && detail.documents.some((doc) => doc.document_type === 'uez_approval_email') && detail.documents.some((doc) => doc.document_type === 'tax_clearance') && detail.documents.some((doc) => doc.document_type === 'ldc_application')) || detail.application.status === 'applied'}"
s=s.replace(old,new)
s=s.replace("REQUIRED_GRANT_DOCUMENTS.every(([type]) => detail.documents.some((doc) => doc.document_type === type))", "((detail.application.is_sole_proprietorship || (detail.documents.some((doc) => doc.document_type === 'formation') && detail.application.formation_review_status === 'approved')) && detail.documents.some((doc) => doc.document_type === 'brc') && detail.documents.some((doc) => doc.document_type === 'uez_approval_email') && detail.documents.some((doc) => doc.document_type === 'tax_clearance') && detail.documents.some((doc) => doc.document_type === 'ldc_application'))")
# Add payment card before BRC verification
brc_anchor='<section className="admin-card brc-admin-card">'
payment_admin="""<section className=\"admin-card payment-admin-card\">
              <div className=\"admin-card-head\"><h3>Payment</h3><span>{detail.payments?.[detail.payments.length - 1]?.status === 'paid' ? 'PAID' : detail.payments?.[detail.payments.length - 1]?.status === 'client_reported' ? 'CLIENT SAYS PAID' : 'NOT RECORDED'}</span></div>
              {detail.payments?.[detail.payments.length - 1]?.status === 'client_reported' && <div className=\"admin-alert\">Client says payment was sent. Check your bank before confirming.</div>}
              <div className=\"admin-edit-grid\"><div><label>Amount</label><input type=\"number\" value={paymentDraft.amount} onChange={(e) => setPaymentDraft((old) => ({...old, amount:e.target.value}))} /></div><div><label>Date</label><input type=\"date\" value={paymentDraft.paymentDate} onChange={(e) => setPaymentDraft((old) => ({...old, paymentDate:e.target.value}))} /></div><div><label>Method</label><input value={paymentDraft.paymentMethod} onChange={(e) => setPaymentDraft((old) => ({...old, paymentMethod:e.target.value}))} /></div><div><label>Reference</label><input value={paymentDraft.reference} onChange={(e) => setPaymentDraft((old) => ({...old, reference:e.target.value}))} /></div><div className=\"admin-edit-wide\"><label>Notes</label><input value={paymentDraft.notes} onChange={(e) => setPaymentDraft((old) => ({...old, notes:e.target.value}))} /></div></div>
              <button className=\"success-button admin-full-button\" onClick={confirmPayment} disabled={busy}>✓ Confirm payment received</button>
            </section>

            """+brc_anchor
if 'payment-admin-card' not in s:s=s.replace(brc_anchor,payment_admin,1)
# Rename BRC card and simplify form labels
s=s.replace('<h3>BRC verification</h3>', '<h3>BRC</h3>')
s=s.replace('<label>Official registered business name</label>', '<label>Registered business name</label>')
s=s.replace('<label>BRC address</label>', '<label>Business address</label>')
# Add structural classes to existing cards for CSS ordering
s=s.replace('<section className="admin-card">\n              <div className="admin-card-head"><h3>Business</h3>', '<section className="admin-card admin-business-card">\n              <div className="admin-card-head"><h3>Business</h3>',1)
s=s.replace('<section className="admin-card mynj-card">','<section className="admin-card mynj-card admin-account-card">')
s=s.replace('<section className="admin-card tax-clearance-card">','<section className="admin-card tax-clearance-card admin-tax-card">')
s=s.replace('<section className="admin-card admin-wide">\n              <div className="admin-card-head"><h3>Owners</h3>', '<section className="admin-card admin-wide admin-owners-card">\n              <div className="admin-card-head"><h3>Owners</h3>',1)
s=s.replace('<section className="admin-card">\n              <div className="admin-card-head"><h3>Documents</h3>', '<section className="admin-card admin-documents-card">\n              <div className="admin-card-head"><h3>Documents</h3>',1)
p.write_text(s)

# ---------------- styles.css ----------------
p=Path('src/styles.css'); s=p.read_text()
s += """

/* UEZ launch cleanup */
.account-submit{margin-top:18px;width:100%}.address-suggestions button.active{background:#edf5ff;outline:2px solid #285f9d;outline-offset:-2px}.uploaded-doc-row{display:grid;grid-template-columns:minmax(120px,1fr) minmax(120px,2fr) auto;align-items:center;gap:10px}.required-star{color:#c62828;font-weight:800}.admin-operations-card{order:1}.payment-admin-card{order:2}.brc-admin-card{order:3}.admin-account-card{order:4}.admin-tax-card{order:5}.admin-documents-card{order:6}.admin-business-card{order:7}.admin-owners-card{order:8}.formation-review-box,.processing-readiness,.admin-alert{padding:12px;border-radius:10px;border:1px solid #dde3ea;margin:10px 0;background:#fafbfc}.formation-review-box{display:grid;gap:8px}.processing-readiness{display:grid;gap:4px}.processing-readiness.ready{background:#f1fbf4;border-color:#a8d7b5}.admin-alert{background:#fff8e8;border-color:#e8c36a}.admin-process-row select{min-width:160px}.admin-card-grid{align-items:start}
@media (max-width:760px){.topbar{gap:10px;align-items:center}.brand-subtitle{font-size:12px}.signin-link{margin-left:auto;font-size:13px}.page-wrap{padding:18px 12px 40px}.hero h1{font-size:30px;line-height:1.08}.wizard-card{border-radius:16px}.progress-row.seven{overflow-x:auto;justify-content:flex-start;padding-bottom:8px}.progress-item{min-width:70px}.field-grid,.portal-grid,.admin-edit-grid,.credential-grid,.review-grid{grid-template-columns:1fr!important}.wizard-footer{position:sticky;bottom:0;background:rgba(255,255,255,.96);padding:12px 0;z-index:10}.wizard-footer button{min-height:46px}.upload-card,.action-row,.portal-status-row,.admin-process-row{align-items:stretch;flex-direction:column}.inline-button,.admin-process-buttons button{width:100%}.uploaded-doc-row{grid-template-columns:1fr}.address-suggestions{max-height:45vh}.admin-layout{display:block}.admin-sidebar{position:static;width:auto;max-height:none}.admin-detail{padding:12px}.admin-detail-header{flex-direction:column;align-items:flex-start}.admin-card-grid{grid-template-columns:1fr}.admin-wide{grid-column:auto}.admin-process-buttons{width:100%}.admin-process-row select{width:100%}.admin-topbar{padding:10px 12px}.admin-filter-row{overflow-x:auto}.application-list{max-height:280px}}
"""
p.write_text(s)
