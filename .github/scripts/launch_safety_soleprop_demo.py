from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

app_path = Path('src/App.jsx')
app = app_path.read_text()

app = replace_once(app,
"  reportBrcCreated\n} from './api';",
"  reportBrcCreated,\n  whoAmI\n} from './api';",
'import whoAmI')

app = replace_once(app,
"function ApplicantPortal({ bundle, onRefresh, onSignOut }) {",
"function ApplicantPortal({ bundle, onRefresh, onSignOut, demoMode = false }) {",
'portal signature')

app = replace_once(app,
"  useEffect(() => {\n    let active = true;\n    getMyNjCredentials(app.id).then((result) => {\n      if (active) setMyNjCredentials(result.exists ? result.credentials : null);\n    }).catch(() => {});\n    return () => { active = false; };\n  }, [app.id]);",
"  useEffect(() => {\n    if (demoMode) {\n      setMyNjCredentials({ username: 'demo.user', password: 'DemoPassword1!', challengeQuestion: 'Demo challenge question', challengeAnswer: 'Demo answer' });\n      return undefined;\n    }\n    let active = true;\n    getMyNjCredentials(app.id).then((result) => {\n      if (active) setMyNjCredentials(result.exists ? result.credentials : null);\n    }).catch(() => {});\n    return () => { active = false; };\n  }, [app.id, demoMode]);",
'portal creds effect')

app = replace_once(app,
"  useEffect(() => {\n    let active = true;\n    const refresh = () => { if (active && document.visibilityState === 'visible') onRefresh().catch(() => {}); };\n    const timer = window.setInterval(refresh, 4000);\n    window.addEventListener('focus', refresh);\n    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };\n  }, [app.id, onRefresh]);",
"  useEffect(() => {\n    if (demoMode) return undefined;\n    let active = true;\n    const refresh = () => { if (active && document.visibilityState === 'visible') onRefresh().catch(() => {}); };\n    const timer = window.setInterval(refresh, 4000);\n    window.addEventListener('focus', refresh);\n    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };\n  }, [app.id, onRefresh, demoMode]);",
'portal polling')

for func, msg in [
    ('uploadFormation', 'Demo only: Certificate of Formation upload simulated.'),
    ('uploadApprovalEmail', 'Demo only: UEZ approval upload simulated.'),
]:
    needle = f"  async function {func}(file) {{\n    if (!file) return;"
    repl = f"  async function {func}(file) {{\n    if (!file) return;\n    if (demoMode) {{ setMessage('{msg}'); return; }}"
    app = replace_once(app, needle, repl, f'{func} demo')

app = replace_once(app,
"  async function reportPaymentSent() {\n    setPaymentBusy(true); setMessage('');",
"  async function reportPaymentSent() {\n    if (demoMode) { setMessage('Demo only: payment reported. Nothing was saved.'); return; }\n    setPaymentBusy(true); setMessage('');",
'payment demo')
app = replace_once(app,
"  async function reportBrcMade() {\n    setBrcBusy(true); setMessage('');",
"  async function reportBrcMade() {\n    if (demoMode) { setMessage('Demo only: BRC follow-up simulated. Nothing was saved.'); return; }\n    setBrcBusy(true); setMessage('');",
'brc demo')

app = replace_once(app,
"  return <div className=\"app-shell\">\n    <header className=\"topbar\">",
"  return <div className=\"app-shell\">\n    {demoMode && <div className=\"demo-mode-banner\">DEMO MODE · No data is saved, no emails are sent, and no applications are created.</div>}\n    <header className=\"topbar\">",
'portal demo banner')

app = replace_once(app,
"export default function App() {",
"export default function App({ demoMode = false }) {",
'app signature')
app = replace_once(app,
"  const [uploadingType, setUploadingType] = useState('');\n  const [form, setForm] = useState({\n    address: '', email: '', password: '', businessName: '', businessDescription: '', ein: '', yearFounded: '',\n    isSoleProprietorship: '', fullTimeEmployees: '', partTimeEmployees: '', hasDba: '', dbaName: '',\n    owners: [blankOwner()]\n  });",
"  const [uploadingType, setUploadingType] = useState('');\n  const [solePropConfirmedHere, setSolePropConfirmedHere] = useState(false);\n  const [form, setForm] = useState(() => demoMode ? {\n    address: '123 Demo Street, Lakewood, NJ 08701', email: 'demo@corsolutions.io', password: 'Demo123!',\n    businessName: 'Demo Lakewood Business LLC', businessDescription: 'Demo business for testing the COR client flow', ein: '12-3456789', yearFounded: '2024',\n    isSoleProprietorship: 'no', fullTimeEmployees: '1', partTimeEmployees: '0', hasDba: 'no', dbaName: '',\n    owners: [{ title: 'Mr.', titleOther: '', firstName: 'Demo', lastName: 'Owner', email: 'demo@corsolutions.io', phone: '(732) 555-0100', dob: '01/01/1980', ssn: '123-45-6789', ownershipPercent: '100', addressLine1: '123 Demo Street', addressLine2: '', city: 'Lakewood', state: 'NJ', zip: '08701' }]\n  } : {\n    address: '', email: '', password: '', businessName: '', businessDescription: '', ein: '', yearFounded: '',\n    isSoleProprietorship: '', fullTimeEmployees: '', partTimeEmployees: '', hasDba: '', dbaName: '',\n    owners: [blankOwner()]\n  });",
'demo form')

app = replace_once(app,
"  useEffect(() => {\n    let active = true;\n    getApplicantSession().then(async (current) => {\n      if (!active) return;\n      if (current) {\n        await loadLatestApplication().catch(() => {});\n        if (active) setSession(current);\n      } else if (active) {\n        setSession(null);\n      }\n    }).catch(() => {}).finally(() => { if (active) setAuthResolved(true); });\n    return () => { active = false; };\n  }, []);",
"  useEffect(() => {\n    let active = true;\n    getApplicantSession().then(async (current) => {\n      if (!active) return;\n      if (demoMode) {\n        if (!current) { window.location.href = '/admin'; return; }\n        const me = await whoAmI();\n        if (me.role !== 'admin') { window.location.href = '/admin'; return; }\n        if (active) setSession(current);\n        return;\n      }\n      if (current) {\n        await loadLatestApplication().catch(() => {});\n        if (active) setSession(current);\n      } else if (active) {\n        setSession(null);\n      }\n    }).catch(() => { if (demoMode) window.location.href = '/admin'; }).finally(() => { if (active) setAuthResolved(true); });\n    return () => { active = false; };\n  }, [demoMode]);",
'auth demo')

app = replace_once(app,
"    if (latest.business_name_input && full.owners?.length) setStep((full.documents || []).length ? 6 : 5);",
"    // Always resume an unfinished application with saved owners at Documents. This forces\n    // the applicant to either upload a Formation document or explicitly confirm sole-prop status.\n    if (latest.business_name_input && full.owners?.length) { setSolePropConfirmedHere(false); setStep(5); }",
'resume documents')

app = replace_once(app,
"  async function runAddressCheck(e) {\n    e.preventDefault();\n    setBusy(true);",
"  async function runAddressCheck(e) {\n    e.preventDefault();\n    if (demoMode) {\n      setEligibility({ eligible: true, matchedAddress: form.address, addressLine1: form.address, city: 'Lakewood', state: 'NJ', zip: '08701', latitude: 40.0821, longitude: -74.2097, zoneIdentifier: 'lakewood', zoneName: 'Lakewood Urban Enterprise Zone (UEZ)', programs: [{ code: 'lakewood_technology_grant', name: 'Lakewood LDC Technology Grant' }] });\n      setMessage('');\n      return;\n    }\n    setBusy(true);",
'address demo')

app = replace_once(app,
"  async function createAccountAndCase() {\n    if (!form.email.trim() || !form.password || form.password.length < 6) {",
"  async function createAccountAndCase() {\n    if (demoMode) { setApplicationId('demo-application'); setStep(3); setMessage(''); return; }\n    if (!form.email.trim() || !form.password || form.password.length < 6) {",
'account demo')

app = replace_once(app,
"  async function saveBusinessStep() {\n    const einDigits = form.ein.replace(/\\D/g, '');",
"  async function saveBusinessStep() {\n    if (demoMode) { setForm((old) => ({ ...old, isSoleProprietorship: 'no' })); setStep(4); setMessage(''); return; }\n    const einDigits = form.ein.replace(/\\D/g, '');",
'business demo')
app = app.replace("      !form.isSoleProprietorship || !form.hasDba ||", "      !form.hasDba ||", 1)
app = app.replace("        isSoleProprietorship: form.isSoleProprietorship === 'yes',", "        isSoleProprietorship: false,", 1)
app = replace_once(app, "      setStep(4);\n    } catch (err) {", "      setForm((old) => ({ ...old, isSoleProprietorship: 'no' }));\n      setStep(4);\n    } catch (err) {", 'business reset')

app = replace_once(app,
"  async function saveOwnerStep() {\n    const ownersForSave = primaryIs100",
"  async function saveOwnerStep() {\n    if (demoMode) { setStep(5); setOwnerError(''); return; }\n    const ownersForSave = primaryIs100",
'owners demo')

# Insert sole-prop persistence helper before uploadDoc.
app = replace_once(app,
"  async function uploadDoc(type, file) {",
"  async function persistSoleProprietorship(value) {\n    if (demoMode) {\n      setForm((old) => ({ ...old, isSoleProprietorship: value ? 'yes' : 'no' }));\n      setSolePropConfirmedHere(value);\n      return;\n    }\n    await saveBusiness(applicationId, {\n      businessName: form.businessName, businessDescription: form.businessDescription, ein: form.ein, yearFounded: form.yearFounded,\n      isSoleProprietorship: value, fullTimeEmployees: form.fullTimeEmployees, partTimeEmployees: form.partTimeEmployees,\n      hasDba: form.hasDba === 'yes', dbaName: form.hasDba === 'yes' ? form.dbaName.trim() : '', contactPhone: form.owners[0]?.phone || null\n    });\n    setForm((old) => ({ ...old, isSoleProprietorship: value ? 'yes' : 'no' }));\n    setSolePropConfirmedHere(value);\n  }\n\n  async function declareSoleProprietorship() {\n    setBusy(true); setMessage('');\n    try {\n      await persistSoleProprietorship(true);\n      setMessage('Sole proprietorship confirmed. No Certificate of Formation is required.');\n    } catch (err) { setMessage(err.message); }\n    finally { setBusy(false); }\n  }\n\n  async function uploadDoc(type, file) {",
'insert sole helper')

app = replace_once(app,
"  async function uploadDoc(type, file) {\n    if (!file || !applicationId) return;",
"  async function uploadDoc(type, file) {\n    if (!file || !applicationId) return;\n    if (demoMode) {\n      const demoDoc = { id: `demo-${Date.now()}`, document_type: type, filename: file.name || 'demo-document.pdf' };\n      setDocuments((old) => [...old.filter((doc) => doc.document_type !== type || type === 'supporting'), demoDoc]);\n      if (type === 'formation') { await persistSoleProprietorship(false); setSolePropConfirmedHere(false); }\n      setMessage(`${file.name || 'Document'} added in demo mode. Nothing was uploaded.`);\n      return;\n    }",
'upload demo')
app = replace_once(app,
"      await uploadApplicationDocument(applicationId, type, file);\n      const refreshed",
"      await uploadApplicationDocument(applicationId, type, file);\n      if (type === 'formation') { await persistSoleProprietorship(false); setSolePropConfirmedHere(false); }\n      const refreshed",
'formation clears sole')

app = replace_once(app,
"  async function removeUploadedDocument(doc) {\n    setUploadingType('remove'); setMessage('');",
"  async function removeUploadedDocument(doc) {\n    if (demoMode) { setDocuments((old) => old.filter((item) => item.id !== doc.id)); setMessage('Demo document removed.'); return; }\n    setUploadingType('remove'); setMessage('');",
'remove demo')

app = replace_once(app,
"  function continueFromDocuments() {\n    if (form.isSoleProprietorship !== 'yes' && !hasFormation) {\n      setMessage('Upload the Certificate of Formation or formation document before continuing.');\n      return;\n    }\n    setMessage('');\n    setStep(6);\n  }",
"  async function continueFromDocuments() {\n    if (demoMode) { setMessage(''); setStep(6); return; }\n    if (!hasFormation && !solePropConfirmedHere) {\n      setMessage('Upload the Certificate of Formation, or confirm below that the business is legally a sole proprietorship.');\n      return;\n    }\n    setBusy(true); setMessage('');\n    try {\n      // Formation present means this should not remain marked sole prop because of an earlier misunderstood answer.\n      await persistSoleProprietorship(!hasFormation && solePropConfirmedHere);\n      setStep(6);\n    } catch (err) { setMessage(err.message); }\n    finally { setBusy(false); }\n  }",
'continue docs')

app = replace_once(app,
"  async function submitFinal() {\n    setBusy(true);",
"  async function submitFinal() {\n    if (demoMode) {\n      setPortalBundle({\n        application: { id: 'demo-application', business_name_input: form.businessName, status: 'in_progress', is_sole_proprietorship: form.isSoleProprietorship === 'yes', formation_review_status: hasFormation ? 'not_reviewed' : 'approved', brc_status: 'found', pbs_status: 'account_created', uez_approval_review_status: 'not_reviewed' },\n        documents: documents, payments: [], statusEvents: [{ id: 'demo-event', status: 'submitted_for_review', label: 'Application submitted', created_at: new Date().toISOString() }]\n      });\n      return;\n    }\n    setBusy(true);",
'submit demo')
app = replace_once(app,
"  async function refreshPortal() {\n    if (!portalBundle?.application?.id) return;",
"  async function refreshPortal() {\n    if (demoMode) return;\n    if (!portalBundle?.application?.id) return;",
'refresh demo')
app = replace_once(app,
"  async function handleSignOut() {\n    await signOutApplicant();",
"  async function handleSignOut() {\n    if (demoMode) { window.location.href = '/admin'; return; }\n    await signOutApplicant();",
'exit demo')

app = replace_once(app,
"    return <ApplicantPortal bundle={portalBundle} onRefresh={refreshPortal} onSignOut={handleSignOut} />;",
"    return <ApplicantPortal bundle={portalBundle} onRefresh={refreshPortal} onSignOut={handleSignOut} demoMode={demoMode} />;",
'portal prop')

# Remove sole-prop question from Business page.
sole_business = "            <div><label>Is this business a sole proprietorship? <span className=\"required-star\">*</span></label><div className=\"cor-inline-radios\"><label className=\"cor-radio-option\"><input type=\"radio\" name=\"soleProp\" value=\"yes\" checked={form.isSoleProprietorship==='yes'} onChange={update('isSoleProprietorship')} required />Yes</label><label className=\"cor-radio-option\"><input type=\"radio\" name=\"soleProp\" value=\"no\" checked={form.isSoleProprietorship==='no'} onChange={update('isSoleProprietorship')} />No</label></div></div>\n"
app = replace_once(app, sole_business, '', 'remove sole business question')

# Replace Formation upload card with contextual sole-prop declaration.
old_docs = """          <div className=\"upload-card\">\n            <div><strong>Certificate of Formation / formation document {form.isSoleProprietorship !== 'yes' && <span className=\"required-star\">*</span>}</strong><p>{form.isSoleProprietorship === 'yes' ? 'Optional for a sole proprietorship.' : 'Required before submission.'}</p></div>\n            <label className=\"secondary inline-button file-button\">\n              {uploadingType === 'formation' ? 'Uploading…' : hasFormation ? 'Replace / add another' : 'Upload document'}\n              <input type=\"file\" accept=\".pdf,image/*\" disabled={Boolean(uploadingType)} onChange={(e) => uploadDoc('formation', e.target.files?.[0])} />\n            </label>\n          </div>\n"""
new_docs = """          <div className=\"upload-card formation-choice-card\">\n            <div><strong>Certificate of Formation <span className=\"required-star\">*</span></strong><p>Upload the business's Certificate of Formation.</p></div>\n            <label className=\"secondary inline-button file-button\">\n              {uploadingType === 'formation' ? 'Uploading…' : hasFormation ? 'Replace / add another' : 'Upload Certificate of Formation'}\n              <input type=\"file\" accept=\".pdf,image/*\" disabled={Boolean(uploadingType) || solePropConfirmedHere} onChange={(e) => uploadDoc('formation', e.target.files?.[0])} />\n            </label>\n          </div>\n          {!hasFormation && <div className={`sole-prop-choice ${solePropConfirmedHere ? 'selected' : ''}`}>\n            <div><strong>Don't have a Certificate of Formation?</strong><p>Only choose this if the business is legally a sole proprietorship. A one-owner LLC or corporation is <b>not</b> a sole proprietorship.</p></div>\n            <button type=\"button\" className={solePropConfirmedHere ? 'secondary sole-prop-confirmed' : 'secondary'} onClick={declareSoleProprietorship} disabled={busy}>\n              {solePropConfirmedHere ? '✓ Sole proprietorship confirmed' : \"I don't have a Certificate of Formation because this business is a sole proprietorship\"}\n            </button>\n          </div>}\n"""
app = replace_once(app, old_docs, new_docs, 'documents sole prop UI')

# Add demo banner to main intake flow.
app = replace_once(app,
"  return <div className=\"app-shell\">\n    <header className=\"topbar\">\n      <div className=\"brand-mark\">COR</div>\n      <div><div className=\"brand-name\">COR Solutions</div><div className=\"brand-subtitle\">UEZ Enrollment & Grant Support</div></div>",
"  return <div className=\"app-shell\">\n    {demoMode && <div className=\"demo-mode-banner\">DEMO MODE · No data is saved, no emails are sent, and no applications are created.</div>}\n    <header className=\"topbar\">\n      <div className=\"brand-mark\">COR</div>\n      <div><div className=\"brand-name\">COR Solutions</div><div className=\"brand-subtitle\">UEZ Enrollment & Grant Support</div></div>",
'main demo banner')

app_path.write_text(app)

# Admin demo button.
admin_path = Path('src/AdminPage.jsx')
admin = admin_path.read_text()
admin = replace_once(admin,
'<div className="admin-top-actions"><a href="/admin/email-settings" className="email-settings-primary">EMAIL SETTINGS</a><a href="/" target="_blank" rel="noreferrer">Open applicant site</a><button onClick={handleSignOut}>Log out</button></div>',
'<div className="admin-top-actions"><a href="/admin/email-settings" className="email-settings-primary">EMAIL SETTINGS</a><a href="/admin/demo-client" target="_blank" rel="noreferrer">DEMO CLIENT</a><a href="/" target="_blank" rel="noreferrer">Open applicant site</a><button onClick={handleSignOut}>Log out</button></div>',
'admin demo link')
admin_path.write_text(admin)

# Route demo through the real App component.
main_path = Path('src/main.jsx')
main = main_path.read_text()
main = replace_once(main,
"if (path === '/admin') Root = AdminWithAnalytics;\nelse if (path === '/admin/email-settings') Root = EmailSettingsPage;",
"if (path === '/admin') Root = AdminWithAnalytics;\nelse if (path === '/admin/demo-client') Root = () => <App demoMode />;\nelse if (path === '/admin/email-settings') Root = EmailSettingsPage;",
'demo route')
main_path.write_text(main)

# Styling.
css_path = Path('src/intakePolish.css')
css = css_path.read_text()
css += """\n\n/* Launch safety: sole-prop declaration + admin demo client */\n.demo-mode-banner{position:sticky;top:0;z-index:1000;background:#fff3cd;border-bottom:1px solid #e5c65b;color:#6b5200;text-align:center;padding:9px 14px;font-size:12px;font-weight:900;letter-spacing:.03em}\n.sole-prop-choice{margin:14px 0 20px;padding:18px;border:1px solid #dfe3ee;border-radius:16px;background:#f8f9fc;display:grid;gap:12px}\n.sole-prop-choice.selected{background:#eff9f3;border-color:#afd8bd}\n.sole-prop-choice strong{font-size:15px}.sole-prop-choice p{margin:5px 0 0;color:#697188;font-size:13px;line-height:1.55}\n.sole-prop-choice button{justify-self:start;text-align:left;line-height:1.35}.sole-prop-confirmed{color:#247447;background:#e3f4e8}\n@media(max-width:760px){.sole-prop-choice button{width:100%}}\n"""
css_path.write_text(css)
