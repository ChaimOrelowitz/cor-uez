from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)


def replace_between(text, start, end, replacement, label):
    i = text.find(start)
    if i < 0:
        raise SystemExit(f'{label}: start not found')
    j = text.find(end, i)
    if j < 0:
        raise SystemExit(f'{label}: end not found')
    return text[:i] + replacement + text[j:]

# ---------------- backend ----------------
p = Path('backend/routes/uez.js')
s = p.read_text()

s = replace_once(s,
"const DOCUMENT_BUCKET = 'uez-documents';",
"const DOCUMENT_BUCKET = 'uez-documents';\n\nconst DEFAULT_SIGNUP_LAYOUT = {\n  account: ['email', 'password'],\n  business: ['businessName', 'businessDescription', 'ein', 'yearFounded', 'hasDba', 'dbaName', 'fullTimeEmployees', 'partTimeEmployees'],\n  ownerCore: ['title', 'firstName', 'lastName', 'email', 'phone', 'dob', 'ssn', 'ownershipPercent'],\n  ownerAddress: ['addressLine1', 'addressLine2', 'city', 'state', 'zip'],\n  documents: ['formation', 'soleProp', 'supporting']\n};\n\nfunction validateSignupLayout(layout) {\n  const clean = {};\n  for (const [group, defaults] of Object.entries(DEFAULT_SIGNUP_LAYOUT)) {\n    const received = Array.isArray(layout?.[group]) ? layout[group] : defaults;\n    if (received.length !== defaults.length || new Set(received).size !== defaults.length || received.some((key) => !defaults.includes(key))) {\n      throw new Error(`Invalid signup layout for ${group}. Fields can only be reordered within their existing page.`);\n    }\n    clean[group] = received;\n  }\n  return clean;\n}",
'layout defaults')

public_routes = """router.get('/signup-layout', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('uez_signup_layout').select('layout').eq('id', 'default').maybeSingle();
    if (error) throw error;
    res.json({ layout: validateSignupLayout(data?.layout || DEFAULT_SIGNUP_LAYOUT) });
  } catch (err) {
    res.json({ layout: DEFAULT_SIGNUP_LAYOUT });
  }
});

"""
s = replace_once(s, "router.use(requireUezAuth);", public_routes + "router.use(requireUezAuth);", 'public layout route')

admin_routes = """
router.put('/admin/signup-layout', requireUezAdmin, async (req, res) => {
  try {
    const layout = validateSignupLayout(req.body?.layout);
    const { data, error } = await supabase.from('uez_signup_layout')
      .upsert({ id: 'default', layout, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('layout, updated_at').single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/admin/signup-layout/reset', requireUezAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabase.from('uez_signup_layout')
      .upsert({ id: 'default', layout: DEFAULT_SIGNUP_LAYOUT, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('layout, updated_at').single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

"""
s = replace_once(s, "router.get('/whoami', (req, res) => {", admin_routes + "router.get('/whoami', (req, res) => {", 'admin layout routes')
p.write_text(s)

# ---------------- API ----------------
p = Path('src/api.js')
s = p.read_text()
insert = """
export async function getSignupLayout() {
  const response = await fetch(`${API_BASE}/api/uez/signup-layout`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Could not load signup layout.');
  return payload.layout;
}

export function saveAdminSignupLayout(layout) {
  return request('/api/uez/admin/signup-layout', {
    method: 'PUT',
    body: JSON.stringify({ layout })
  });
}

export function resetAdminSignupLayout() {
  return request('/api/uez/admin/signup-layout/reset', { method: 'POST' });
}

"""
s = replace_once(s, "export function whoAmI() {", insert + "export function whoAmI() {", 'api layout funcs')
p.write_text(s)

# ---------------- SignupLayoutPage ----------------
Path('src/SignupLayoutPage.jsx').write_text(r'''import React, { useEffect, useState } from 'react';
import { getApplicantSession, getSignupLayout, resetAdminSignupLayout, saveAdminSignupLayout, whoAmI } from './api';

const GROUPS = {
  account: { title: 'Account page', fields: { email: 'Email', password: 'Password' } },
  business: { title: 'Business page', fields: { businessName: 'Business name', businessDescription: 'Business description', ein: 'EIN', yearFounded: 'Year founded', hasDba: 'DBA question', dbaName: 'DBA name (conditional)', fullTimeEmployees: 'Full-time employees', partTimeEmployees: 'Part-time employees' } },
  ownerCore: { title: 'Owners · main fields', fields: { title: 'Title', firstName: 'First name', lastName: 'Last name', email: 'Email', phone: 'Best phone', dob: 'Date of birth', ssn: 'SSN', ownershipPercent: 'Ownership percentage (when applicable)' } },
  ownerAddress: { title: 'Owners · home address', fields: { addressLine1: 'Street address', addressLine2: 'Address line 2', city: 'City', state: 'State', zip: 'ZIP' } },
  documents: { title: 'Documents page', fields: { formation: 'Certificate of Formation upload', soleProp: 'Sole proprietorship alternative', supporting: 'Other supporting document' } }
};

export default function SignupLayoutPage() {
  const [layout, setLayout] = useState(null);
  const [drag, setDrag] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await getApplicantSession();
      if (!session) return window.location.replace('/admin');
      const me = await whoAmI();
      if (me.role !== 'admin') return window.location.replace('/admin');
      setLayout(await getSignupLayout());
    })().catch((err) => setMessage(err.message));
  }, []);

  function move(group, from, to) {
    if (to < 0 || to >= layout[group].length || from === to) return;
    setLayout((old) => {
      const next = [...old[group]];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return { ...old, [group]: next };
    });
  }

  async function save() {
    setBusy(true); setMessage('');
    try {
      const result = await saveAdminSignupLayout(layout);
      setLayout(result.layout);
      setMessage('Signup field order saved. New applicants will see this order.');
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  async function reset() {
    if (!window.confirm('Reset all signup fields to the original order?')) return;
    setBusy(true); setMessage('');
    try {
      const result = await resetAdminSignupLayout();
      setLayout(result.layout);
      setMessage('Signup layout reset to default.');
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  if (!layout) return <div className="app-shell auth-loading-shell"><div className="auth-loading-card">Loading signup layout…</div></div>;

  return <div className="admin-shell signup-layout-shell">
    <header className="admin-topbar">
      <div className="admin-brand"><div className="brand-mark">COR</div><div><strong>Signup Layout</strong><span>Admin</span></div></div>
      <div className="admin-top-actions"><a href="/admin">BACK TO ADMIN</a><a href="/admin/demo-client" target="_blank" rel="noreferrer">PREVIEW CLIENT</a></div>
    </header>
    <main className="signup-layout-wrap">
      <div className="signup-layout-heading"><div><span className="eyebrow">CLIENT SIGNUP</span><h1>Arrange signup fields</h1><p>Drag fields to reorder them. Guardrails keep every field on its current page so validation and saving continue to work correctly.</p></div><div className="layout-actions"><button className="secondary" onClick={reset} disabled={busy}>Reset to default</button><button className="primary compact" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save layout'}</button></div></div>
      {message && <div className="form-message layout-message">{message}</div>}
      <div className="layout-groups">
        {Object.entries(GROUPS).map(([group, info]) => <section className="wizard-card layout-group" key={group}>
          <div className="layout-group-head"><h2>{info.title}</h2><span>{layout[group].length} fields</span></div>
          <div className="layout-list">
            {layout[group].map((key, index) => <div
              key={key}
              className={`layout-row ${drag?.group === group && drag?.index === index ? 'dragging' : ''}`}
              draggable
              onDragStart={() => setDrag({ group, index })}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (drag?.group === group) move(group, drag.index, index); setDrag(null); }}
            >
              <span className="drag-handle" aria-hidden="true">⋮⋮</span><strong>{info.fields[key] || key}</strong>
              <div className="layout-row-actions"><button title="Move up" onClick={() => move(group, index, index - 1)} disabled={index === 0}>↑</button><button title="Move down" onClick={() => move(group, index, index + 1)} disabled={index === layout[group].length - 1}>↓</button></div>
            </div>)}
          </div>
        </section>)}
      </div>
    </main>
  </div>;
}
''')

# ---------------- main route ----------------
p = Path('src/main.jsx')
s = p.read_text()
s = replace_once(s, "import AccountRecoveryPage from './AccountRecoveryPage';", "import AccountRecoveryPage from './AccountRecoveryPage';\nimport SignupLayoutPage from './SignupLayoutPage';", 'layout import')
s = replace_once(s, "else if (path === '/admin/demo-client') Root = () => <App demoMode />;", "else if (path === '/admin/demo-client') Root = () => <App demoMode />;\nelse if (path === '/admin/signup-layout') Root = SignupLayoutPage;", 'layout route')
p.write_text(s)

# ---------------- admin link ----------------
p = Path('src/AdminPage.jsx')
s = p.read_text()
s = replace_once(s,
'<div className="admin-top-actions"><a href="/admin/email-settings" className="email-settings-primary">EMAIL SETTINGS</a><a href="/admin/demo-client" target="_blank" rel="noreferrer">DEMO CLIENT</a>',
'<div className="admin-top-actions"><a href="/admin/email-settings" className="email-settings-primary">EMAIL SETTINGS</a><a href="/admin/signup-layout">SIGNUP LAYOUT</a><a href="/admin/demo-client" target="_blank" rel="noreferrer">DEMO CLIENT</a>',
'admin layout link')
p.write_text(s)

# ---------------- App layout rendering + sole undo ----------------
p = Path('src/App.jsx')
s = p.read_text()
s = replace_once(s, "  reportBrcCreated,\n  whoAmI", "  reportBrcCreated,\n  whoAmI,\n  getSignupLayout", 'app layout import')
s = replace_once(s,
"const steps = ['Address', 'Eligibility', 'Account', 'Business', 'Owners', 'Documents', 'Review'];",
"const steps = ['Address', 'Eligibility', 'Account', 'Business', 'Owners', 'Documents', 'Review'];\nconst DEFAULT_SIGNUP_LAYOUT = {\n  account: ['email', 'password'],\n  business: ['businessName', 'businessDescription', 'ein', 'yearFounded', 'hasDba', 'dbaName', 'fullTimeEmployees', 'partTimeEmployees'],\n  ownerCore: ['title', 'firstName', 'lastName', 'email', 'phone', 'dob', 'ssn', 'ownershipPercent'],\n  ownerAddress: ['addressLine1', 'addressLine2', 'city', 'state', 'zip'],\n  documents: ['formation', 'soleProp', 'supporting']\n};",
'app defaults')
s = replace_once(s, "  const [uploadingType, setUploadingType] = useState('');", "  const [uploadingType, setUploadingType] = useState('');\n  const [signupLayout, setSignupLayout] = useState(DEFAULT_SIGNUP_LAYOUT);", 'layout state')
s = replace_once(s,
"  useEffect(() => {\n    let active = true;\n    getApplicantSession()",
"  useEffect(() => {\n    let active = true;\n    getSignupLayout().then((layout) => { if (active && layout) setSignupLayout(layout); }).catch(() => {});\n    return () => { active = false; };\n  }, []);\n\n  useEffect(() => {\n    let active = true;\n    getApplicantSession()",
'layout load')

s = replace_once(s,
"  async function declareSoleProprietorship() {\n    setBusy(true); setMessage('');\n    try {\n      await persistSoleProprietorship(true);\n      setMessage('Sole proprietorship confirmed. No Certificate of Formation is required.');\n    } catch (err) { setMessage(err.message); }\n    finally { setBusy(false); }\n  }",
"  async function declareSoleProprietorship() {\n    setBusy(true); setMessage('');\n    try {\n      await persistSoleProprietorship(true);\n      setMessage('Sole proprietorship confirmed. No Certificate of Formation is required.');\n    } catch (err) { setMessage(err.message); }\n    finally { setBusy(false); }\n  }\n\n  async function undoSoleProprietorship() {\n    setBusy(true); setMessage('');\n    try {\n      await persistSoleProprietorship(false);\n      setSolePropConfirmedHere(false);\n      setMessage('Sole proprietorship selection cleared. You can upload the Certificate of Formation.');\n    } catch (err) { setMessage(err.message); }\n    finally { setBusy(false); }\n  }",
'undo sole')

# Account block
start = "        {step === 2 && <form className=\"content-block\""
end = "\n\n        {step === 3 && <div className=\"content-block\">"
account = r'''        {step === 2 && <form className="content-block" onSubmit={(e) => { e.preventDefault(); createAccountAndCase(); }}>
          <div className="intro-copy"><h3>Create your COR account</h3><p>Your account keeps your application, documents, and status in one place.</p></div>
          <div className="field-grid ordered-field-grid">
            {signupLayout.account.map((key) => key === 'email'
              ? <div key={key}><label>Email <span className="required-star">*</span></label><input type="email" value={form.email} onChange={update('email')} required /></div>
              : <div key={key}><label>Password <span className="required-star">*</span></label><input type="password" value={form.password} onChange={update('password')} required minLength="6" /></div>)}
          </div>
          <button type="submit" className="primary account-submit" disabled={busy}>{busy ? 'Please wait…' : 'Create account'}</button>
        </form>}'''
s = replace_between(s, start, end, account, 'account block')

# Business block
start = "        {step === 3 && <div className=\"content-block\">"
end = "\n\n        {step === 4 && <div className=\"content-block\">"
business = r'''        {step === 3 && <div className="content-block">
          <div className="intro-copy"><h3>Tell us about the business</h3><p>We’ll use this information for your UEZ enrollment and available grant application.</p></div>
          <div className="field-grid ordered-field-grid business-ordered-grid">
            {signupLayout.business.map((key) => {
              if (key === 'businessName') return <div className="field-span-2" key={key}><label>Business name <span className="required-star">*</span></label><input required value={form.businessName} onChange={update('businessName')} /></div>;
              if (key === 'businessDescription') return <div className="field-span-2" key={key}><label>In a few words, what does the business do? <span className="required-star">*</span></label><textarea value={form.businessDescription} onChange={update('businessDescription')} placeholder="Example: HVAC installation and repair" required /></div>;
              if (key === 'ein') return <div key={key}><label>EIN <span className="required-star">*</span></label><input required inputMode="numeric" value={form.ein} onChange={(e) => { const d=e.target.value.replace(/\D/g,'').slice(0,9); setForm((old)=>({...old,ein:d.length>2?`${d.slice(0,2)}-${d.slice(2)}`:d})); }} maxLength="10" placeholder="12-3456789" /></div>;
              if (key === 'yearFounded') return <div key={key}><label>Year founded <span className="required-star">*</span></label><input required inputMode="numeric" maxLength="4" value={form.yearFounded} onChange={(e) => setForm((old)=>({...old,yearFounded:e.target.value.replace(/\D/g,'').slice(0,4)}))} /></div>;
              if (key === 'hasDba') return <div key={key}><label>Does the business have a DBA? <span className="required-star">*</span></label><div className="cor-inline-radios"><label className="cor-radio-option"><input type="radio" name="hasDba" value="yes" checked={form.hasDba==='yes'} onChange={(e)=>setForm((old)=>({...old,hasDba:e.target.value}))} required />Yes</label><label className="cor-radio-option"><input type="radio" name="hasDba" value="no" checked={form.hasDba==='no'} onChange={(e)=>setForm((old)=>({...old,hasDba:e.target.value,dbaName:''}))} />No</label></div></div>;
              if (key === 'dbaName') return form.hasDba === 'yes' ? <div key={key}><label>What is the DBA name? <span className="required-star">*</span></label><input value={form.dbaName} onChange={update('dbaName')} required /></div> : null;
              if (key === 'fullTimeEmployees') return <div key={key}><label>Full-time employees <span className="required-star">*</span></label><input required inputMode="numeric" maxLength="3" value={form.fullTimeEmployees} onChange={(e)=>setForm((old)=>({...old,fullTimeEmployees:e.target.value.replace(/\D/g,'').slice(0,3)}))} /></div>;
              if (key === 'partTimeEmployees') return <div key={key}><label>Part-time employees <span className="required-star">*</span></label><input required inputMode="numeric" maxLength="3" value={form.partTimeEmployees} onChange={(e)=>setForm((old)=>({...old,partTimeEmployees:e.target.value.replace(/\D/g,'').slice(0,3)}))} /></div>;
              return null;
            })}
          </div>
        </div>}'''
s = replace_between(s, start, end, business, 'business block')

# Owner block
start = "        {step === 4 && <div className=\"content-block\">"
end = "\n\n        {step === 5 && <div className=\"content-block\">"
owner = r'''        {step === 4 && <div className="content-block">
          <div className="intro-copy"><h3>Business ownership</h3><p>List every owner of the business.</p></div>
          <div className="hint"><strong>Why we ask for DOB and SSN:</strong> The grant application requires this information for each business owner. COR collects it only so we can prepare and submit the required application information on your behalf.</div>
          <div className="field-grid"><div><label>Is the primary owner the 100% owner? <span className="required-star">*</span></label><select required value={primaryOwnershipSelection} onChange={(e) => setPrimaryOwnershipMode(e.target.value)}><option value="" disabled>Select yes or no</option><option value="yes">Yes</option><option value="no">No</option></select></div></div>
          {!primaryIs100 && <div className="ownership-summary"><span>Ownership accounted for</span><strong className={Math.abs(ownershipTotal - 100) < 0.001 ? 'ownership-ok' : ''}>{ownershipTotal}% / 100%</strong></div>}
          {form.owners.map((owner, index) => <div className="owner-card" key={index}>
            <div className="owner-card-head"><strong>{index === 0 ? 'Primary owner' : `Additional owner ${index + 1}`}</strong>{index > 0 && <button className="owner-remove" type="button" onClick={() => removeOwner(index)}>Remove</button>}</div>
            <div className="field-grid ordered-field-grid">
              {signupLayout.ownerCore.map((key) => {
                if (key === 'title') return <React.Fragment key={key}><div><label>Title <span className="required-star">*</span></label><select required value={owner.title || ''} onChange={updateOwner(index, 'title')}><option value="" disabled>Select title</option><option value="Mr.">Mr.</option><option value="Mrs.">Mrs.</option><option value="Ms.">Ms.</option><option value="Dr.">Dr.</option><option value="Rabbi">Rabbi</option><option value="Other">Other</option></select></div>{owner.title === 'Other' && <div><label>Other title <span className="required-star">*</span></label><input required value={owner.titleOther || ''} onChange={updateOwner(index, 'titleOther')} /></div>}</React.Fragment>;
                if (key === 'firstName') return <div key={key}><label>First name <span className="required-star">*</span></label><input required value={owner.firstName} onChange={updateOwner(index, 'firstName')} /></div>;
                if (key === 'lastName') return <div key={key}><label>Last name <span className="required-star">*</span></label><input required value={owner.lastName} onChange={updateOwner(index, 'lastName')} /></div>;
                if (key === 'email') return <div key={key}><label>Email <span className="required-star">*</span></label><input required type="email" value={owner.email} onChange={updateOwner(index, 'email')} /></div>;
                if (key === 'phone') return <div key={key}><label>Best phone <span className="required-star">*</span></label><input required inputMode="tel" value={owner.phone} onChange={updateOwner(index, 'phone')} /></div>;
                if (key === 'dob') return <div key={key}><label>Date of birth <span className="required-star">*</span></label><input required inputMode="numeric" placeholder="MM/DD/YYYY" value={owner.dob} onChange={updateOwner(index, 'dob')} /></div>;
                if (key === 'ssn') return <div key={key}><label>SSN <span className="required-star">*</span></label><input required inputMode="numeric" value={owner.ssn} onChange={updateOwner(index, 'ssn')} placeholder="•••-••-••••" /></div>;
                if (key === 'ownershipPercent') return !primaryIs100 ? <div key={key}><label>Ownership percentage <span className="required-star">*</span></label><input required type="number" min="0.01" max="100" step="0.01" value={owner.ownershipPercent} onChange={updateOwner(index, 'ownershipPercent')} /></div> : null;
                return null;
              })}
              <div className="owner-address-heading field-span-2"><strong>Home address</strong></div>
              {signupLayout.ownerAddress.map((key) => {
                if (key === 'addressLine1') return <div key={key}><label>Street address <span className="required-star">*</span></label><input required autoComplete="street-address" value={owner.addressLine1 || ''} onChange={updateOwner(index, 'addressLine1')} /></div>;
                if (key === 'addressLine2') return <div key={key}><label>Address line 2</label><input value={owner.addressLine2 || ''} onChange={updateOwner(index, 'addressLine2')} /></div>;
                if (key === 'city') return <div key={key}><label>City <span className="required-star">*</span></label><input required value={owner.city || ''} onChange={updateOwner(index, 'city')} /></div>;
                if (key === 'state') return <div key={key}><label>State <span className="required-star">*</span></label><input required maxLength="2" value={owner.state || ''} onChange={(e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0,2); updateOwner(index, 'state')(e); }} /></div>;
                if (key === 'zip') return <div key={key}><label>ZIP <span className="required-star">*</span></label><input required inputMode="numeric" maxLength="5" value={owner.zip || ''} onChange={(e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0,5); updateOwner(index, 'zip')(e); }} /></div>;
                return null;
              })}
            </div>
          </div>)}
          {!primaryIs100 && ownershipTotal < 100 && <button className="secondary add-owner" type="button" onClick={addOwner}>+ Add another owner</button>}
          {ownerError && <div className="validation-error">{ownerError}</div>}
        </div>}'''
s = replace_between(s, start, end, owner, 'owner block')

# Documents block
start = "        {step === 5 && <div className=\"content-block\">"
end = "\n\n        {step === 6 && <div className=\"content-block review-block\">"
docs = r'''        {step === 5 && <div className="content-block">
          <div className="intro-copy"><h3>Documents</h3><p>Upload your formation document and any other supporting documents you want COR to have.</p></div>
          <div className="ordered-documents">
            {signupLayout.documents.map((key) => {
              if (key === 'formation') return <div className="upload-card formation-choice-card" key={key}>
                <div><strong>Certificate of Formation <span className="required-star">*</span></strong><p>Upload the business's Certificate of Formation.</p></div>
                <label className="secondary inline-button file-button">{uploadingType === 'formation' ? 'Uploading…' : hasFormation ? 'Replace / add another' : 'Upload Certificate of Formation'}<input type="file" accept=".pdf,image/*" disabled={Boolean(uploadingType) || solePropConfirmedHere} onChange={(e) => uploadDoc('formation', e.target.files?.[0])} /></label>
              </div>;
              if (key === 'soleProp') return !hasFormation ? <div className={`sole-prop-choice ${solePropConfirmedHere ? 'selected' : ''}`} key={key}>
                <div><strong>Don't have a Certificate of Formation?</strong><p>Only choose this if the business is legally a sole proprietorship. A one-owner LLC or corporation is <b>not</b> a sole proprietorship.</p></div>
                <div className="sole-prop-action-row"><button type="button" className={solePropConfirmedHere ? 'secondary sole-prop-confirmed' : 'secondary'} onClick={declareSoleProprietorship} disabled={busy}>{solePropConfirmedHere ? '✓ Sole proprietorship confirmed' : "I don't have a Certificate of Formation because this business is a sole proprietorship"}</button>{solePropConfirmedHere && <button type="button" className="sole-prop-undo" title="Undo sole proprietorship selection" aria-label="Undo sole proprietorship selection" onClick={undoSoleProprietorship} disabled={busy}>↶</button>}</div>
              </div> : null;
              if (key === 'supporting') return <div className="upload-card" key={key}><div><strong>Other supporting document</strong><p>Optional. Add anything you think COR should have for this application.</p></div><label className="secondary inline-button file-button">{uploadingType === 'supporting' ? 'Uploading…' : 'Upload another file'}<input type="file" accept=".pdf,image/*" disabled={Boolean(uploadingType)} onChange={(e) => uploadDoc('supporting', e.target.files?.[0])} /></label></div>;
              return null;
            })}
          </div>
          {documents.length > 0 && <div className="uploaded-docs"><h4>Uploaded</h4>{documents.map((doc) => <div className="uploaded-doc-row" key={doc.id}><span>{documentLabel(doc.document_type)}</span><strong>{doc.filename}</strong><button type="button" className="owner-remove" onClick={() => removeUploadedDocument(doc)} disabled={Boolean(uploadingType)}>Remove</button></div>)}</div>}
        </div>}'''
s = replace_between(s, start, end, docs, 'documents block')
p.write_text(s)

# ---------------- CSS ----------------
p = Path('src/styles.css')
s = p.read_text()
s += r'''

/* Signup layout editor + ordered intake fields */
.ordered-field-grid{align-items:start}.field-span-2{grid-column:1/-1}.ordered-documents{display:grid;gap:14px}.sole-prop-action-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sole-prop-undo{width:36px;height:36px;border:1px solid #d8dce8;border-radius:50%;background:#fff;color:#596176;font-size:20px;font-weight:800;line-height:1;display:grid;place-items:center;padding:0}.sole-prop-undo:hover{background:#f3f4fa}.sole-prop-undo:disabled{opacity:.45;cursor:default}
.signup-layout-wrap{width:min(980px,calc(100% - 32px));margin:0 auto;padding:42px 0 70px}.signup-layout-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-bottom:26px}.signup-layout-heading h1{margin:4px 0 8px;font-size:36px}.signup-layout-heading p{margin:0;max-width:680px;color:#737b91;line-height:1.6}.layout-actions{display:flex;gap:10px;flex:0 0 auto}.layout-groups{display:grid;gap:18px}.layout-group{overflow:visible}.layout-group-head{display:flex;align-items:center;justify-content:space-between;padding:20px 22px;border-bottom:1px solid #edf0f6}.layout-group-head h2{font-size:19px;margin:0}.layout-group-head span{font-size:12px;color:#8c93a6}.layout-list{display:grid;gap:8px;padding:16px}.layout-row{display:grid;grid-template-columns:28px 1fr auto;align-items:center;gap:10px;padding:12px 14px;border:1px solid #e3e6ef;border-radius:12px;background:#fff;cursor:grab}.layout-row.dragging{opacity:.45}.drag-handle{font-size:20px;color:#9aa0b2;letter-spacing:-4px}.layout-row-actions{display:flex;gap:6px}.layout-row-actions button{width:32px;height:32px;border:1px solid #e0e3ec;background:#f7f8fb;border-radius:9px;color:#596176;font-weight:800}.layout-row-actions button:disabled{opacity:.28}.layout-message{margin:0 0 18px}.signup-layout-shell .admin-top-actions a{display:inline-flex;align-items:center;text-decoration:none}
@media(max-width:760px){.signup-layout-heading{align-items:stretch;flex-direction:column}.layout-actions{width:100%}.layout-actions button{flex:1}.field-span-2{grid-column:auto}.layout-row{grid-template-columns:24px 1fr auto;padding:11px 10px}.signup-layout-wrap{width:min(100% - 20px,980px);padding-top:24px}}
'''
p.write_text(s)

print('signup layout editor patch applied')
