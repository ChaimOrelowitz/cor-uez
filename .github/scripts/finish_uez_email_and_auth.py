from pathlib import Path

def replace_once(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'Missing anchor for {label} in {path}')
    p.write_text(s.replace(old, new, 1))

# ---------------- App.jsx ----------------
p = Path('src/App.jsx')
s = p.read_text()

s = s.replace("  const [signInMode, setSignInMode] = useState(false);", "  const [signInMode, setSignInMode] = useState(() => new URLSearchParams(window.location.search).get('login') === '1');", 1)

old = """    getApplicantSession().then(async (current) => {\n      if (!active) return;\n      setSession(current || null);\n      if (current) await loadLatestApplication().catch(() => {});\n    }).catch(() => {}).finally(() => { if (active) setAuthResolved(true); });"""
new = """    getApplicantSession().then(async (current) => {\n      if (!active) return;\n      if (current) {\n        await loadLatestApplication().catch(() => {});\n        if (active) setSession(current);\n      } else if (active) {\n        setSession(null);\n      }\n    }).catch(() => {}).finally(() => { if (active) setAuthResolved(true); });"""
if old not in s: raise SystemExit('Missing App initial auth anchor')
s = s.replace(old, new, 1)

old = """  async function signInAndResume() {\n    if (!form.email.trim() || !form.password) {\n      setMessage('Enter your email and password.');\n      return;\n    }\n    setBusy(true);\n    setMessage('');\n    try {\n      const auth = await signInApplicant(form.email.trim(), form.password);\n      setSession(auth.session || null);\n      const loaded = await loadLatestApplication();"""
new = """  async function signInAndResume() {\n    if (!form.email.trim() || !form.password) {\n      setMessage('Enter your email and password.');\n      return;\n    }\n    setBusy(true);\n    setAuthResolved(false);\n    setMessage('');\n    try {\n      const auth = await signInApplicant(form.email.trim(), form.password);\n      const loaded = await loadLatestApplication();\n      setSession(auth.session || null);"""
if old not in s: raise SystemExit('Missing signInAndResume anchor')
s = s.replace(old, new, 1)

old = """    } finally {\n      setBusy(false);\n    }\n  }\n\n  async function saveBusinessStep()"""
new = """    } finally {\n      setAuthResolved(true);\n      setBusy(false);\n    }\n  }\n\n  async function saveBusinessStep()"""
if old not in s: raise SystemExit('Missing login finally anchor')
s = s.replace(old, new, 1)

# Remove applicant BRC upload handler.
start = s.find("  async function uploadBrc(file) {")
end = s.find("  async function uploadApprovalEmail(file) {", start)
if start != -1 and end != -1:
    s = s[:start] + s[end:]

# Remove the applicant BRC action panel entirely.
start = s.find("          {needsBrc && <div className=\"action-panel warn-panel\">")
end = s.find("          {brcUploaded &&", start)
if start != -1 and end != -1:
    s = s[:start] + s[end:]

# Remove the BRC received panel too; lookup is admin-side.
start = s.find("          {brcUploaded && <div className=\"action-panel\">")
end = s.find("          {brcConfirmed &&", start)
if start != -1 and end != -1:
    s = s[:start] + s[end:]

# Remove BRC upload card in intake.
marker = """          <div className=\"upload-card\">\n            <div><strong>Business Registration Certificate (BRC)</strong><p>Optional. If you already have it, upload it. If not, COR will check after submission.</p></div>\n            <label className=\"secondary inline-button file-button\">\n              {uploadingType === 'brc' ? 'Uploading…' : 'Upload BRC'}\n              <input type=\"file\" accept=\".pdf,image/*\" disabled={Boolean(uploadingType)} onChange={(e) => uploadDoc('brc', e.target.files?.[0])} />\n            </label>\n          </div>\n\n"""
if marker in s: s = s.replace(marker, '', 1)

s = s.replace("<div className=\"intro-copy\"><h3>Documents</h3><p>Upload what you already have. COR will handle the BRC check after you submit.</p></div>", "<div className=\"intro-copy\"><h3>Documents</h3><p>Upload your formation document and any other supporting documents you want COR to have.</p></div>", 1)
s = s.replace("Complete one intake. COR will review your documents, verify your New Jersey Business Registration Certificate after submission, enroll the business in the UEZ, and handle the available grant application when applicable. If a BRC is missing, we’ll tell you exactly what to do next.", "Complete one intake. COR will review your documents, handle the New Jersey verification steps, enroll the business in the UEZ, and process the available grant application when applicable.", 1)
s = s.replace("<div className=\"intro-copy\"><h3>Review and submit</h3><p>Make sure the information below looks right. COR will verify the BRC after submission.</p></div>", "<div className=\"intro-copy\"><h3>Review and submit</h3><p>Make sure the information below looks right. COR will handle the remaining state verification steps after submission.</p></div>", 1)

# Direct field UX, independent of older patch styling.
old = """            <div><label>EIN <span className=\"required-star\">*</span></label><input required value={form.ein} onChange={update('ein')} placeholder=\"12-3456789\" /></div>\n            <div><label>Year founded <span className=\"required-star\">*</span></label><input required value={form.yearFounded} onChange={update('yearFounded')} /></div>\n            <div><label>Is this business a sole proprietorship? <span className=\"required-star\">*</span></label><select required value={form.isSoleProprietorship} onChange={update('isSoleProprietorship')}><option value=\"\">Select yes or no</option><option value=\"yes\">Yes</option><option value=\"no\">No</option></select></div>\n            <div><label>Does the business have a DBA? <span className=\"required-star\">*</span></label><select value={form.hasDba} onChange={(e) => setForm((old) => ({ ...old, hasDba: e.target.value, dbaName: e.target.value === 'yes' ? old.dbaName : '' }))} required><option value=\"\">Select yes or no</option><option value=\"yes\">Yes</option><option value=\"no\">No</option></select></div>\n            {form.hasDba === 'yes' && <div><label>What is the DBA name? <span className=\"required-star\">*</span></label><input value={form.dbaName} onChange={update('dbaName')} required /></div>}\n            <div><label>Full-time employees <span className=\"required-star\">*</span></label><input required type=\"number\" min=\"0\" value={form.fullTimeEmployees} onChange={update('fullTimeEmployees')} placeholder=\"0\" /></div>\n            <div><label>Part-time employees <span className=\"required-star\">*</span></label><input required type=\"number\" min=\"0\" value={form.partTimeEmployees} onChange={update('partTimeEmployees')} placeholder=\"0\" /></div>"""
new = """            <div><label>EIN <span className=\"required-star\">*</span></label><input required inputMode=\"numeric\" value={form.ein} onChange={(e) => { const d=e.target.value.replace(/\\D/g,'').slice(0,9); setForm((old)=>({...old,ein:d.length>2?`${d.slice(0,2)}-${d.slice(2)}`:d})); }} maxLength=\"10\" placeholder=\"12-3456789\" /></div>\n            <div><label>Year founded <span className=\"required-star\">*</span></label><input required inputMode=\"numeric\" maxLength=\"4\" value={form.yearFounded} onChange={(e) => setForm((old)=>({...old,yearFounded:e.target.value.replace(/\\D/g,'').slice(0,4)}))} /></div>\n            <div><label>Is this business a sole proprietorship? <span className=\"required-star\">*</span></label><div className=\"cor-inline-radios\"><label className=\"cor-radio-option\"><input type=\"radio\" name=\"soleProp\" value=\"yes\" checked={form.isSoleProprietorship==='yes'} onChange={update('isSoleProprietorship')} required />Yes</label><label className=\"cor-radio-option\"><input type=\"radio\" name=\"soleProp\" value=\"no\" checked={form.isSoleProprietorship==='no'} onChange={update('isSoleProprietorship')} />No</label></div></div>\n            <div><label>Does the business have a DBA? <span className=\"required-star\">*</span></label><div className=\"cor-inline-radios\"><label className=\"cor-radio-option\"><input type=\"radio\" name=\"hasDba\" value=\"yes\" checked={form.hasDba==='yes'} onChange={(e)=>setForm((old)=>({...old,hasDba:e.target.value}))} required />Yes</label><label className=\"cor-radio-option\"><input type=\"radio\" name=\"hasDba\" value=\"no\" checked={form.hasDba==='no'} onChange={(e)=>setForm((old)=>({...old,hasDba:e.target.value,dbaName:''}))} />No</label></div></div>\n            {form.hasDba === 'yes' && <div><label>What is the DBA name? <span className=\"required-star\">*</span></label><input value={form.dbaName} onChange={update('dbaName')} required /></div>}\n            <div><label>Full-time employees <span className=\"required-star\">*</span></label><input required inputMode=\"numeric\" maxLength=\"3\" value={form.fullTimeEmployees} onChange={(e)=>setForm((old)=>({...old,fullTimeEmployees:e.target.value.replace(/\\D/g,'').slice(0,3)}))} /></div>\n            <div><label>Part-time employees <span className=\"required-star\">*</span></label><input required inputMode=\"numeric\" maxLength=\"3\" value={form.partTimeEmployees} onChange={(e)=>setForm((old)=>({...old,partTimeEmployees:e.target.value.replace(/\\D/g,'').slice(0,3)}))} /></div>"""
if old in s: s = s.replace(old, new, 1)

# Forgot password link and password-reset success notice.
needle = """              <button type=\"submit\" className=\"primary login-submit\" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>\n            </form>"""
repl = """              <button type=\"submit\" className=\"primary login-submit\" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>\n              <a className=\"forgot-password-link\" href=\"/forgot-password\">Forgot password?</a>\n            </form>"""
if needle not in s: raise SystemExit('Missing forgot password anchor')
s = s.replace(needle, repl, 1)

# The old CSS hiding nth card is no longer needed after physical removal, but harmless.
p.write_text(s)

# ---------------- AdminPage.jsx ----------------
p = Path('src/AdminPage.jsx')
s = p.read_text()
s = s.replace("<div className=\"admin-top-actions\"><a href=\"/\" target=\"_blank\" rel=\"noreferrer\">Open applicant site</a><button onClick={handleSignOut}>Sign out</button></div>", "<div className=\"admin-top-actions\"><a href=\"/admin/email-settings\">Email settings</a><a href=\"/\" target=\"_blank\" rel=\"noreferrer\">Open applicant site</a><button onClick={handleSignOut}>Log out</button></div>", 1)
s = s.replace("setMessage('BRC marked not found. The applicant can see the BRC instructions and upload button.');", "setMessage('BRC marked not found. COR will handle the follow-up; the applicant is not being asked to upload a BRC.');", 1)
# Remove obsolete mailto BRC button if present.
s = s.replace("              {detail.application.brc_status === 'not_found' && <a className=\"secondary admin-email-button\" href={emailApplicantHref}>Email applicant BRC instructions</a>}\n", "", 1)
p.write_text(s)

# ---------------- backend/routes/uez.js ----------------
p = Path('backend/routes/uez.js')
s = p.read_text()

anchor = "const { decryptCredential, ensureMyNjCredentials } = require('../services/uezMyNj');"
if anchor not in s: raise SystemExit('Missing email import anchor')
s = s.replace(anchor, anchor + "\nconst { safeSendApplicationEmail } = require('../services/uezEmail');", 1)

mount = "router.use('/brc-live', require('./uezBrcLive'));"
if mount not in s: raise SystemExit('Missing email router mount anchor')
s = s.replace(mount, mount + "\nrouter.use('/email', require('./uezEmail'));", 1)

# Applicant may no longer upload a BRC.
anchor = """    const documentType = String(req.body?.documentType || 'supporting').trim().toLowerCase();\n    if (documentType === 'tax_clearance' && req.user.role !== 'admin') {"""
replace = """    const documentType = String(req.body?.documentType || 'supporting').trim().toLowerCase();\n    if (documentType === 'brc' && req.user.role !== 'admin') {\n      return res.status(403).json({ error: 'COR handles the Business Registration Certificate lookup for you.' });\n    }\n    if (documentType === 'tax_clearance' && req.user.role !== 'admin') {"""
if anchor not in s: raise SystemExit('Missing BRC upload block anchor')
s = s.replace(anchor, replace, 1)

# Submission email.
anchor = """    await addStatusEvent(\n      application.id,\n      'submitted_for_review',\n      'Application submitted',\n      'COR received your application and will review your documents and verify your Business Registration Certificate.',\n      req.user.id,\n      true\n    );\n\n    res.json(data);"""
replace = """    await addStatusEvent(\n      application.id,\n      'submitted_for_review',\n      'Application submitted',\n      'COR received your application and will begin processing after payment is confirmed.',\n      req.user.id,\n      true\n    );\n    await safeSendApplicationEmail(data, 'submission_received', {\n      dedupeKey: `submission_received:${application.id}`\n    });\n\n    res.json(data);"""
if anchor not in s: raise SystemExit('Missing submission email anchor')
s = s.replace(anchor, replace, 1)

# PBS select full credential and email on first transition.
s = s.replace("""    const { data: credential, error: credentialError } = await supabase.from('uez_credentials')\n      .select('id')""", """    const { data: credential, error: credentialError } = await supabase.from('uez_credentials')\n      .select('*')""", 1)
anchor = """    if (!application.pbs_account_created && application.pbs_status !== 'account_created') {\n      await addStatusEvent(\n        application.id,\n        'waiting_for_uez_approval',\n        'PBS account created',\n        \"Your PBS account is ready. Upload the 'Notice of Certification Application Approved' email from UEZdonotreply@dca.nj.gov when you receive it.\",\n        req.user.id,\n        true\n      );\n    }\n\n    res.json(data);"""
replace = """    if (!application.pbs_account_created && application.pbs_status !== 'account_created') {\n      await addStatusEvent(\n        application.id,\n        'waiting_for_uez_approval',\n        'PBS account created',\n        \"Your PBS account is ready. Upload the 'Notice of Certification Application Approved' email from UEZdonotreply@dca.nj.gov when you receive it.\",\n        req.user.id,\n        true\n      );\n      const credentials = decryptCredential(credential);\n      await safeSendApplicationEmail(data, 'pbs_account_created', {\n        dedupeKey: `pbs_account_created:${application.id}`,\n        extra: {\n          pbs_username: credentials.username,\n          pbs_password: credentials.password,\n          challenge_question: credentials.challengeQuestion,\n          challenge_answer: credentials.challengeAnswer\n        }\n      });\n    }\n\n    res.json(data);"""
if anchor not in s: raise SystemExit('Missing PBS email anchor')
s = s.replace(anchor, replace, 1)

# Formation rejected email.
anchor = """    await addStatusEvent(\n      application.id,\n      eventStatus,\n      eventLabel,\n      decision === 'approved'\n        ? `${document.filename} was reviewed and approved by COR.`\n        : `${document.filename} was reviewed and marked as the wrong document.`,\n      req.user.id,\n      false\n    );\n\n    res.json({ application: updated, document, decision });"""
replace = """    await addStatusEvent(\n      application.id,\n      eventStatus,\n      eventLabel,\n      decision === 'approved'\n        ? `${document.filename} was reviewed and approved by COR.`\n        : `${document.filename} was reviewed and marked as the wrong document.`,\n      req.user.id,\n      false\n    );\n    if (document.document_type === 'formation' && decision === 'rejected') {\n      await safeSendApplicationEmail(updated, 'formation_rejected', {\n        dedupeKey: `formation_rejected:${application.id}:${document.id}`\n      });\n    }\n\n    res.json({ application: updated, document, decision });"""
if anchor not in s: raise SystemExit('Missing formation email anchor')
s = s.replace(anchor, replace, 1)

# UEZ applied transition email in process flags.
anchor = """    const { data, error } = await supabase.from('uez_applications').update(patch).eq('id', application.id).select('*').single();\n    if (error) throw error;\n    res.json(data);"""
replace = """    const { data, error } = await supabase.from('uez_applications').update(patch).eq('id', application.id).select('*').single();\n    if (error) throw error;\n    if (body.uezApplicationStatus === 'applied' && application.uez_application_status !== 'applied') {\n      await safeSendApplicationEmail(data, 'uez_application_submitted', {\n        dedupeKey: `uez_application_submitted:${application.id}`\n      });\n    }\n    res.json(data);"""
# This anchor may occur elsewhere; target only after process-flags start.
pos = s.find("router.patch('/admin/applications/:id/process-flags'")
idx = s.find(anchor, pos)
if idx == -1: raise SystemExit('Missing process flags email anchor')
s = s[:idx] + s[idx:].replace(anchor, replace, 1)

# Payment email only on transition to paid.
anchor = """    if (status === 'paid') await addStatusEvent(application.id, 'payment_recorded', 'Client payment recorded', 'COR confirmed that your payment was received.', req.user.id, true);\n    res.json(result);"""
replace = """    if (status === 'paid') {\n      await addStatusEvent(application.id, 'payment_recorded', 'Client payment recorded', 'COR confirmed that your payment was received.', req.user.id, true);\n      if (existing?.status !== 'paid') {\n        await safeSendApplicationEmail(application, 'payment_received', {\n          dedupeKey: `payment_received:${application.id}`\n        });\n      }\n    }\n    res.json(result);"""
if anchor not in s: raise SystemExit('Missing payment email anchor')
s = s.replace(anchor, replace, 1)

# BRC not found stays admin-side; no applicant upload instruction.
s = s.replace("""      'Business Registration Certificate needed',\n      'We could not locate your New Jersey Business Registration Certificate. Please complete NJ business/tax registration, then upload your BRC in your COR account.',\n      req.user.id,\n      true""", """      'BRC follow-up in progress',\n      'COR is handling the New Jersey Business Registration Certificate follow-up.',\n      req.user.id,\n      false""", 1)

# Grant submitted email.
anchor = """    await addStatusEvent(\n      application.id,\n      status,\n      req.body?.label || 'Application updated',\n      req.body?.message || 'COR updated your application.',\n      req.user.id,\n      req.body?.visibleToApplicant !== false\n    );\n\n    res.json(data);"""
replace = """    await addStatusEvent(\n      application.id,\n      status,\n      req.body?.label || 'Application updated',\n      req.body?.message || 'COR updated your application.',\n      req.user.id,\n      req.body?.visibleToApplicant !== false\n    );\n    if (status === 'grant_submitted') {\n      await safeSendApplicationEmail(data, 'grant_submitted', {\n        dedupeKey: `grant_submitted:${application.id}`\n      });\n    }\n\n    res.json(data);"""
if anchor not in s: raise SystemExit('Missing grant email anchor')
s = s.replace(anchor, replace, 1)

p.write_text(s)

print('Final UEZ auth/email patch applied')
