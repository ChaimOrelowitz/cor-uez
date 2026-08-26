from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing {label}')
    return text.replace(old, new, 1)

# backend/routes/uezBrc.js
p = Path('backend/routes/uezBrc.js')
s = p.read_text()
s = replace_once(s,
"const { ensureMyNjCredentials } = require('../services/uezMyNj');",
"const { ensureMyNjCredentials } = require('../services/uezMyNj');\nconst { safeSendApplicationEmail } = require('../services/uezEmail');",
'uezBrc email import')

marker = "router.use(requireUezAuth);\n"
insert = """router.use(requireUezAuth);\n\nrouter.post('/:id/client-created', async (req, res) => {\n  try {\n    const application = await ownedApplication(req.params.id, req.user);\n    if (!application) return res.status(404).json({ error: 'Application not found' });\n    const now = new Date().toISOString();\n    const { data, error } = await supabase.from('uez_applications').update({\n      brc_status: 'client_created',\n      brc_last_error: null,\n      updated_at: now\n    }).eq('id', application.id).select('*').single();\n    if (error) throw error;\n    await safeStatusEvent(application.id, 'brc_client_created', 'Client says BRC was created', 'You told COR that you completed the New Jersey BRC registration. COR will recheck it.', req.user.id, true);\n    res.json(data);\n  } catch (err) {\n    res.status(400).json({ error: err.message });\n  }\n});\n"""
s = replace_once(s, marker, insert, 'client-created route')

old = """      await safeStatusEvent(application.id, 'waiting_for_brc', 'BRC needed', 'We could not find a current New Jersey Business Registration Certificate. Please register for one, then return here and tell us when it is complete.', req.user.id, true);\n      return res.json({ application: data, outcome: 'not_found' });"""
new = """      await safeStatusEvent(application.id, 'waiting_for_brc', 'BRC needed', 'We could not find a current New Jersey Business Registration Certificate. Please register for one, then return here and tell us when it is complete.', req.user.id, true);\n      await safeSendApplicationEmail(data, 'brc_not_found', { dedupeKey: `brc_not_found:${application.id}` });\n      return res.json({ application: data, outcome: 'not_found' });"""
if old in s:
    s = s.replace(old, new, 1)
p.write_text(s)

# backend/routes/uez.js: extension/manual not-found path also sends email
p = Path('backend/routes/uez.js')
s = p.read_text()
pattern = re.compile(r"(router\.post\('/admin/applications/:id/brc-not-found'.*?const \{ data, error \} = await supabase\.from\('uez_applications'\)\.update\(\{.*?\}\)\.eq\('id', application\.id\)\.select\('\*'\)\.single\(\);.*?if \(error\) throw error;)(.*?res\.json\(data\);)", re.S)
m = pattern.search(s)
if m and "brc_not_found:${application.id}" not in m.group(0):
    replacement = m.group(1) + "\n    await safeSendApplicationEmail(data, 'brc_not_found', { dedupeKey: `brc_not_found:${application.id}` });" + m.group(2)
    s = s[:m.start()] + replacement + s[m.end():]
p.write_text(s)

# src/api.js
p = Path('src/api.js')
s = p.read_text()
anchor = "export function reportApplicantPayment(applicationId) {\n  return request(`/api/uez/applications/${applicationId}/payment-reported`, { method: 'POST' });\n}\n"
addition = anchor + "\nexport function reportBrcCreated(applicationId) {\n  return request(`/api/uez/brc/${applicationId}/client-created`, { method: 'POST' });\n}\n"
s = replace_once(s, anchor, addition, 'api reportBrcCreated')
p.write_text(s)

# src/App.jsx
p = Path('src/App.jsx')
s = p.read_text()
s = replace_once(s, "  reportApplicantPayment\n} from './api';", "  reportApplicantPayment,\n  reportBrcCreated\n} from './api';", 'App import')
s = replace_once(s, "  const [paymentBusy, setPaymentBusy] = useState(false);", "  const [paymentBusy, setPaymentBusy] = useState(false);\n  const [brcBusy, setBrcBusy] = useState(false);", 'brc busy state')
anchor = """  async function reportPaymentSent() {\n    setPaymentBusy(true); setMessage('');\n    try {\n      await reportApplicantPayment(app.id);\n      await onRefresh();\n      setMessage('Thanks. COR will verify the payment and update your account.');\n    } catch (err) { setMessage(err.message); }\n    finally { setPaymentBusy(false); }\n  }\n"""
addition = anchor + """\n  async function reportBrcMade() {\n    setBrcBusy(true); setMessage('');\n    try {\n      await reportBrcCreated(app.id);\n      await onRefresh();\n      setMessage('Thanks. COR was notified and will recheck your BRC.');\n    } catch (err) { setMessage(err.message); }\n    finally { setBrcBusy(false); }\n  }\n"""
s = replace_once(s, anchor, addition, 'reportBrcMade function')
portal_anchor = """          {brcConfirmed && <div className=\"action-panel good-panel\">\n            <h3>✓ BRC confirmed</h3>\n            <p>{app.registered_business_name || app.brc_registered_name || app.business_name_input}</p>\n          </div>}\n"""
portal_add = portal_anchor + """\n          {needsBrc && <div className=\"action-panel warn-panel\">\n            <h3>Business Registration Certificate needed</h3>\n            <p>COR could not locate a current New Jersey BRC. Create/register for it with New Jersey, then come back here and tell us when you're done. You do not need to upload the BRC.</p>\n            <a className=\"primary compact inline-button\" href={NJ_REGISTRATION_URL} target=\"_blank\" rel=\"noreferrer\">Create my BRC</a>\n            <button className=\"secondary compact inline-button\" onClick={reportBrcMade} disabled={brcBusy}>{brcBusy ? 'Saving…' : 'I created my BRC'}</button>\n          </div>}\n"""
s = replace_once(s, portal_anchor, portal_add, 'BRC portal panel')
p.write_text(s)

# src/AdminPage.jsx
p = Path('src/AdminPage.jsx')
s = p.read_text()
s = replace_once(s, "  if (payment?.status === 'client_reported') items.push('Client says payment was sent');", "  if (payment?.status === 'client_reported') items.push('Client says payment was sent');\n  if (detail.application.brc_status === 'client_created') items.push('Client says BRC was created — recheck BRC');", 'admin attention detail')
s = replace_once(s, "            const needsAttention = app.payment_status === 'client_reported'", "            const needsAttention = app.payment_status === 'client_reported'\n              || app.brc_status === 'client_created'", 'admin list attention')
s = replace_once(s, "<div className=\"admin-top-actions\"><a href=\"/\" target=\"_blank\" rel=\"noreferrer\">Open applicant site</a><button onClick={handleSignOut}>Log out</button></div>", "<div className=\"admin-top-actions\"><a href=\"/admin/email-settings\" className=\"email-settings-primary\">EMAIL SETTINGS</a><a href=\"/\" target=\"_blank\" rel=\"noreferrer\">Open applicant site</a><button onClick={handleSignOut}>Log out</button></div>", 'admin email settings nav')
p.write_text(s)

# CSS: don't hide the new BRC client action panel
p = Path('src/intakePolish.css')
s = p.read_text()
s = s.replace('.portal-card .action-panel:has(a[href*="njportal.com/dor/businessregistration"]){display:none!important}\n', '')
s += '\n.email-settings-primary{font-weight:900!important;padding:9px 13px!important;border-radius:10px!important;background:#fff!important;color:#4f57c8!important}.warn-panel .inline-button{margin-right:10px;margin-top:10px}\n'
p.write_text(s)
