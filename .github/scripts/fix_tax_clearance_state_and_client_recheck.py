from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

# ---------- backend ----------
p = Path('backend/routes/uez.js')
s = p.read_text()

s = replace_once(
    s,
    "    if (documentType === 'tax_clearance') {\n      await supabase.from('uez_applications').update({ tax_clearance_good: true, updated_at: new Date().toISOString() }).eq('id', application.id);",
    "    if (documentType === 'tax_clearance') {\n      await supabase.from('uez_applications').update({ tax_clearance_good: true, tax_clearance_status: 'good', tax_clearance_recheck_requested_at: null, updated_at: new Date().toISOString() }).eq('id', application.id);",
    'tax clearance upload marks good'
)

s = replace_once(
    s,
    "    }\n\n    res.status(201).json(data);\n  } catch (err) {",
    "    }\n\n    if (documentType === 'tax_clearance_issue') {\n      await supabase.from('uez_applications').update({\n        tax_clearance_good: false,\n        tax_clearance_status: 'issue',\n        tax_clearance_recheck_requested_at: null,\n        updated_at: new Date().toISOString()\n      }).eq('id', application.id);\n    }\n\n    res.status(201).json(data);\n  } catch (err) {",
    'manual issue upload marks issue'
)

s = replace_once(
    s,
    "    const { error: appError } = await supabase.from('uez_applications').update({\n      tax_clearance_good: false,\n      updated_at: new Date().toISOString()\n    }).eq('id', application.id);",
    "    const { error: appError } = await supabase.from('uez_applications').update({\n      tax_clearance_good: false,\n      tax_clearance_status: 'issue',\n      tax_clearance_recheck_requested_at: null,\n      updated_at: new Date().toISOString()\n    }).eq('id', application.id);",
    'captured issue marks issue'
)

payment_anchor = "router.put('/admin/applications/:id/payment', requireUezAdmin, async (req, res) => {"
insert = """router.post('/applications/:id/tax-clearance-resolved', async (req, res) => {
  try {
    const application = await getOwnedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if ((application.tax_clearance_status || 'no') !== 'issue') {
      return res.status(400).json({ error: 'There is no open tax-clearance issue to report as resolved.' });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase.from('uez_applications').update({
      tax_clearance_recheck_requested_at: now,
      updated_at: now
    }).eq('id', application.id).select('*').single();
    if (error) throw error;

    await addStatusEvent(
      application.id,
      'tax_clearance_client_resolved',
      'Tax-clearance issue reported resolved',
      'You told COR that New Jersey says the tax-clearance issue is resolved. COR will recheck the Tax Clearance Certificate.',
      req.user.id,
      true
    );

    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

""" + payment_anchor
s = replace_once(s, payment_anchor, insert, 'client tax resolved endpoint')

s = replace_once(
    s,
    "    if (typeof body.taxClearanceGood === 'boolean') patch.tax_clearance_good = body.taxClearanceGood;",
    "    if (typeof body.taxClearanceGood === 'boolean') {\n      patch.tax_clearance_good = body.taxClearanceGood;\n      patch.tax_clearance_status = body.taxClearanceGood ? 'good' : 'no';\n      patch.tax_clearance_recheck_requested_at = null;\n    }\n    if (['no', 'issue', 'good'].includes(body.taxClearanceStatus)) {\n      patch.tax_clearance_status = body.taxClearanceStatus;\n      patch.tax_clearance_good = body.taxClearanceStatus === 'good';\n      patch.tax_clearance_recheck_requested_at = null;\n    }",
    'process flags tax tri state'
)

p.write_text(s)

# ---------- API ----------
p = Path('src/api.js')
s = p.read_text()
s = replace_once(
    s,
    "export function reportBrcCreated(applicationId) {\n  return request(`/api/uez/brc/${applicationId}/client-created`, { method: 'POST' });\n}\n",
    "export function reportBrcCreated(applicationId) {\n  return request(`/api/uez/brc/${applicationId}/client-created`, { method: 'POST' });\n}\n\nexport function reportTaxClearanceResolved(applicationId) {\n  return request(`/api/uez/applications/${applicationId}/tax-clearance-resolved`, { method: 'POST' });\n}\n",
    'api report tax resolved'
)
p.write_text(s)

# ---------- Applicant portal ----------
p = Path('src/App.jsx')
s = p.read_text()
s = replace_once(
    s,
    "  reportApplicantPayment,\n  reportBrcCreated,\n  whoAmI,",
    "  reportApplicantPayment,\n  reportBrcCreated,\n  reportTaxClearanceResolved,\n  whoAmI,",
    'app import'
)
s = replace_once(
    s,
    "  const [brcBusy, setBrcBusy] = useState(false);\n  const app = bundle.application;",
    "  const [brcBusy, setBrcBusy] = useState(false);\n  const [taxBusy, setTaxBusy] = useState(false);\n  const app = bundle.application;",
    'tax busy state'
)
s = replace_once(
    s,
    "  const approvalStageReached = app.pbs_status === 'account_created' || app.pbs_status === 'uez_approval_uploaded' || app.status === 'waiting_for_uez_approval' || Boolean(approval);",
    "  const approvalStageReached = app.pbs_status === 'account_created' || app.pbs_status === 'uez_approval_uploaded' || app.status === 'waiting_for_uez_approval' || Boolean(approval);\n  const taxIssueOpen = (app.tax_clearance_status || 'no') === 'issue';\n  const taxRecheckRequested = Boolean(app.tax_clearance_recheck_requested_at);",
    'tax portal derived state'
)

s = replace_once(
    s,
    "  async function reportBrcMade() {\n    if (demoMode) { setMessage('Demo only: BRC follow-up simulated. Nothing was saved.'); return; }\n    setBrcBusy(true); setMessage('');\n    try {\n      await reportBrcCreated(app.id);\n      await onRefresh();\n      setMessage('Thanks. Your BRC will be rechecked.');\n    } catch (err) { setMessage(err.message); }\n    finally { setBrcBusy(false); }\n  }\n\n\n\n  return <div className=\"app-shell\">",
    "  async function reportBrcMade() {\n    if (demoMode) { setMessage('Demo only: BRC follow-up simulated. Nothing was saved.'); return; }\n    setBrcBusy(true); setMessage('');\n    try {\n      await reportBrcCreated(app.id);\n      await onRefresh();\n      setMessage('Thanks. Your BRC will be rechecked.');\n    } catch (err) { setMessage(err.message); }\n    finally { setBrcBusy(false); }\n  }\n\n  async function reportTaxResolved() {\n    if (demoMode) { setMessage('Demo only: tax-clearance recheck request simulated. Nothing was saved.'); return; }\n    setTaxBusy(true); setMessage('');\n    try {\n      await reportTaxClearanceResolved(app.id);\n      await onRefresh();\n      setMessage('Thanks. COR will recheck your Tax Clearance Certificate.');\n    } catch (err) { setMessage(err.message); }\n    finally { setTaxBusy(false); }\n  }\n\n\n\n  return <div className=\"app-shell\">",
    'client report resolved function'
)

portal_anchor = "          {approvalStageReached && !approval && <div className=\"action-panel warn-panel\">"
tax_panel = """          {taxIssueOpen && <div className=\"action-panel warn-panel tax-issue-client-panel\">
            <h3>Tax Clearance issue</h3>
            {taxRecheckRequested ? <>
              <p>You told COR that the State says this issue is resolved. We will recheck your Tax Clearance Certificate.</p>
              <span className=\"status-pill warn\">Recheck requested</span>
            </> : <>
              <p>New Jersey could not issue your Tax Clearance Certificate. Please follow the instructions COR sent you. Once the State tells you the issue is resolved, click below.</p>
              <button className=\"primary compact inline-button\" onClick={reportTaxResolved} disabled={taxBusy}>{taxBusy ? 'Saving…' : 'The state says my tax issue is resolved'}</button>
            </>}
          </div>}

""" + portal_anchor
s = replace_once(s, portal_anchor, tax_panel, 'client tax issue panel')
p.write_text(s)

# ---------- Admin ----------
p = Path('src/AdminPage.jsx')
s = p.read_text()
s = replace_once(
    s,
    "  if (app.payment_status === 'client_reported') return { bucket: 'needs', action: 'Confirm payment', tone: 'danger', stage, rank: 1 };",
    "  if (app.tax_clearance_recheck_requested_at) return { bucket: 'needs', action: 'Recheck Tax Clearance', tone: 'danger', stage, rank: 0 };\n  if (app.payment_status === 'client_reported') return { bucket: 'needs', action: 'Confirm payment', tone: 'danger', stage, rank: 1 };",
    'queue recheck priority'
)
s = replace_once(
    s,
    "  if (!app.tax_clearance_good || !types.has('tax_clearance')) {\n    if (types.has('tax_clearance_issue')) return { bucket: 'waiting', action: 'Tax clearance issue — waiting on client', tone: 'warn', stage, rank: 51 };\n    return { bucket: 'needs', action: 'Fetch tax clearance', tone: 'danger', stage, rank: 8 };\n  }",
    "  if ((app.tax_clearance_status || (app.tax_clearance_good ? 'good' : 'no')) !== 'good' || !types.has('tax_clearance')) {\n    if ((app.tax_clearance_status || 'no') === 'issue' || types.has('tax_clearance_issue')) return { bucket: 'waiting', action: 'Tax clearance issue — waiting on client', tone: 'warn', stage, rank: 51 };\n    return { bucket: 'needs', action: 'Fetch tax clearance', tone: 'danger', stage, rank: 8 };\n  }",
    'queue issue state'
)

s = replace_once(
    s,
    "  if (detail.application.brc_status === 'client_created') items.push('Client says BRC was created — recheck BRC');",
    "  if (detail.application.brc_status === 'client_created') items.push('Client says BRC was created — recheck BRC');\n  if (detail.application.tax_clearance_recheck_requested_at) items.push('Client says the tax-clearance issue is resolved — recheck Tax Clearance');",
    'attention tax recheck'
)

old_tax = "key === 'tax' ? <><span>Tax clearance</span><div className=\"tiny-toggle\"><button className={detail.application.tax_clearance_good ? 'active-good' : ''} onClick={() => setProcessFlag('taxClearanceGood', true)} disabled={busy}>Good</button><button className={!detail.application.tax_clearance_good ? 'active-neutral' : ''} onClick={() => setProcessFlag('taxClearanceGood', false)} disabled={busy}>No</button></div></>"
new_tax = "key === 'tax' ? <><span>Tax clearance{detail.application.tax_clearance_recheck_requested_at ? <small className=\"tax-recheck-note\">Client says resolved</small> : null}</span><div className=\"tiny-toggle tax-tristate\"><button className={(detail.application.tax_clearance_status || (detail.application.tax_clearance_good ? 'good' : 'no')) === 'no' ? 'active-neutral' : ''} onClick={() => setProcessFlag('taxClearanceStatus', 'no')} disabled={busy}>No</button><button className={(detail.application.tax_clearance_status || 'no') === 'issue' ? 'active-warn' : ''} onClick={() => setProcessFlag('taxClearanceStatus', 'issue')} disabled={busy}>Issue</button><button className={(detail.application.tax_clearance_status || (detail.application.tax_clearance_good ? 'good' : 'no')) === 'good' ? 'active-good' : ''} onClick={() => setProcessFlag('taxClearanceStatus', 'good')} disabled={busy}>Good</button></div></>"
s = replace_once(s, old_tax, new_tax, 'admin tax tri state')
p.write_text(s)

# ---------- CSS ----------
p = Path('src/workflow.css')
s = p.read_text()
marker = '/* Tax clearance tri-state and client recheck */'
if marker in s:
    raise SystemExit('tax tri-state CSS already exists')
s += r'''

/* Tax clearance tri-state and client recheck */
.tax-tristate button.active-warn{background:#fff0d8!important;color:#9d6115!important;border-color:#e9c982!important}.tax-recheck-note{display:block;margin-top:3px;color:#a66718;font-size:8px;font-weight:850;text-transform:uppercase;letter-spacing:.04em}.tax-issue-client-panel .status-pill{margin-top:12px}.tax-issue-client-panel button{margin-top:14px}
'''
p.write_text(s)
