from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

# Admin frontend
path = Path('src/AdminPage.jsx')
text = path.read_text()
text = replace_once(text,
"  reviewAdminDocument,\n  whoAmI\n} from './api';",
"  reviewAdminDocument,\n  uploadApplicationDocument,\n  whoAmI\n} from './api';",
'admin import')
text = replace_once(text,
"  const [pbsModalOpen, setPbsModalOpen] = useState(false);\n  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);",
"  const [pbsModalOpen, setPbsModalOpen] = useState(false);\n  const [manualDocType, setManualDocType] = useState('supporting');\n  const [manualDocFile, setManualDocFile] = useState(null);\n  const [manualDocUploading, setManualDocUploading] = useState(false);\n  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);",
'admin upload state')
text = replace_once(text,
"  async function runLdcJotform() {",
"  async function uploadManualAdminDocument() {\n    if (!manualDocFile) { setMessage('Choose a file to upload.'); return; }\n    setManualDocUploading(true);\n    setMessage('Uploading document…');\n    try {\n      await uploadApplicationDocument(detail.application.id, manualDocType, manualDocFile);\n      await refreshList(detail.application.id);\n      setManualDocFile(null);\n      setMessage('Document added to the applicant file.');\n    } catch (err) {\n      setMessage(err.message);\n    } finally {\n      setManualDocUploading(false);\n    }\n  }\n\n  async function runLdcJotform() {",
'admin upload function')
text = replace_once(text,
"      requesting_tax_clearance_pdf: 'Selecting the Department of Community Affairs and requesting the letter…',\n      uploading_tax_clearance: 'Tax clearance received. Adding it directly to the applicant’s UEZ file…',",
"      requesting_tax_clearance_pdf: 'Selecting the Department of Community Affairs and requesting the letter…',\n      uploading_tax_clearance: 'Tax clearance received. Adding it directly to the applicant’s UEZ file…',\n      capturing_tax_issue: 'NJ reported a tax-clearance problem. Capturing the error screenshot…',\n      sending_tax_issue_email: 'Saving the screenshot and emailing the client the tax-clearance instructions…',",
'tax status messages')
text = replace_once(text,
"        if (message.status === 'complete') finish(null, { status: 'complete' });",
"        if (message.status === 'complete') finish(null, { status: 'complete', taxIssue: Boolean(message.taxIssue) });",
'tax outcome passthrough')
text = replace_once(text,
"      if (outcome.status !== 'complete') throw new Error(outcome.error || 'The tax-clearance download did not finish.');\n      await refreshList(detail.application.id);\n      setMessage('Tax-clearance letter downloaded and added directly to this applicant’s UEZ file.');",
"      if (outcome.status !== 'complete') throw new Error(outcome.error || 'The tax-clearance download did not finish.');\n      await refreshList(detail.application.id);\n      setMessage(outcome.taxIssue\n        ? 'NJ could not issue the tax clearance. The error screenshot was saved and the client was emailed the follow-up instructions.'\n        : 'Tax-clearance letter downloaded and added directly to this applicant’s UEZ file.');",
'tax admin result')
text = replace_once(text,
"                </div>\n              </div>\n\n              <div className=\"ops-panel actions-panel\">",
"                </div>\n                <div className=\"admin-manual-upload\">\n                  <div className=\"admin-manual-upload-head\"><strong>Manual document upload</strong><small>Fallback / records</small></div>\n                  <select value={manualDocType} onChange={(e) => setManualDocType(e.target.value)}>\n                    <option value=\"formation\">Certificate of Formation</option>\n                    <option value=\"brc\">Business Registration Certificate</option>\n                    <option value=\"uez_pending_certification\">UEZ Pending Certification Application</option>\n                    <option value=\"uez_approval_email\">UEZ Approval Email</option>\n                    <option value=\"tax_clearance\">Tax Clearance Letter</option>\n                    <option value=\"tax_clearance_issue\">Tax Clearance Issue Screenshot</option>\n                    <option value=\"ldc_application\">Signed LDC Application</option>\n                    <option value=\"supporting\">Other / Supporting Document</option>\n                  </select>\n                  <input type=\"file\" accept=\".pdf,.eml,image/*\" onChange={(e) => setManualDocFile(e.target.files?.[0] || null)} />\n                  <button className=\"secondary\" onClick={uploadManualAdminDocument} disabled={manualDocUploading || !manualDocFile}>{manualDocUploading ? 'Uploading…' : 'Upload document'}</button>\n                </div>\n              </div>\n\n              <div className=\"ops-panel actions-panel\">",
'manual upload ui')
path.write_text(text)

# Email service: support attachments
path = Path('backend/services/uezEmail.js')
text = path.read_text()
text = replace_once(text,
"      body: JSON.stringify({\n        from: FROM_EMAIL,\n        to: [recipient],\n        reply_to: REPLY_TO,\n        subject,\n        text: body,\n        html: textToHtml(body)\n      })",
"      body: JSON.stringify({\n        from: FROM_EMAIL,\n        to: [recipient],\n        reply_to: REPLY_TO,\n        subject,\n        text: body,\n        html: textToHtml(body),\n        ...(Array.isArray(options.attachments) && options.attachments.length\n          ? { attachments: options.attachments.map((item) => ({ filename: item.filename, content: item.content })) }\n          : {})\n      })",
'email attachments')
path.write_text(text)

# Backend endpoint: persist screenshot, mark bad, email client with screenshot attached
path = Path('backend/routes/uez.js')
text = path.read_text()
anchor = "router.get('/applications/:id/documents/:documentId/url', async (req, res) => {"
endpoint = r'''router.post('/admin/applications/:id/tax-clearance-issue', requireUezAdmin, upload.single('file'), async (req, res) => {
  try {
    const application = await getOwnedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (!req.file) return res.status(400).json({ error: 'Tax-clearance screenshot is required.' });
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Tax-clearance issue evidence must be an image.' });
    }

    const storagePath = `${application.applicant_user_id}/${application.id}/${Date.now()}-${crypto.randomUUID()}-${safeFilename(req.file.originalname || 'NJ-Tax-Clearance-Issue.png')}`;
    const { error: storageError } = await supabase.storage.from(DOCUMENT_BUCKET).upload(storagePath, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: false
    });
    if (storageError) throw storageError;

    const { data: document, error: documentError } = await supabase.from('uez_documents').insert({
      application_id: application.id,
      document_type: 'tax_clearance_issue',
      storage_path: storagePath,
      filename: req.file.originalname || 'NJ-Tax-Clearance-Issue.png',
      source: 'extension_capture',
      status: 'received',
      metadata: { mimeType: req.file.mimetype, size: req.file.size, referenceOnly: true },
      created_by: req.user.id
    }).select('id, document_type, filename, source, status, metadata, created_at').single();
    if (documentError) throw documentError;

    const { error: appError } = await supabase.from('uez_applications').update({
      tax_clearance_good: false,
      updated_at: new Date().toISOString()
    }).eq('id', application.id);
    if (appError) throw appError;

    await addStatusEvent(
      application.id,
      'tax_clearance_issue',
      'Tax clearance follow-up needed',
      'New Jersey could not issue the Tax Clearance Certificate. COR saved the state error and sent follow-up instructions.',
      req.user.id,
      true
    );

    const emailResult = await safeSendApplicationEmail(application, 'tax_issue', {
      attachments: [{ filename: req.file.originalname || 'NJ-Tax-Clearance-Issue.png', content: req.file.buffer.toString('base64') }],
      dedupeKey: `tax_issue:${application.id}:${document.id}`
    });

    res.status(201).json({ document, email: emailResult });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

'''
if anchor not in text:
    raise SystemExit('tax issue backend anchor missing')
text = text.replace(anchor, endpoint + anchor, 1)
path.write_text(text)

# Extension content: recognize exact bad tax clearance response before retrying the button.
path = Path('brc-helper-extension/content.js')
text = path.read_text()
anchor = "      // Step E: Business Incentive Tax Clearance Button\n      const incentiveBtn = document.querySelector('input[name=\"Submit\"][value=\"Business Incentive Tax Clearance\"]');"
replacement = "      // Bad tax-clearance result: NJ returns to this same screen with an eligibility error.\n      if (/We cannot verify that you are eligible to receive a Tax Clearance Certificate at this time/i.test(text)) {\n        sent = true;\n        const issue = [...document.querySelectorAll('td, div, table, section, form')].find((element) =>\n          /We cannot verify that you are eligible to receive a Tax Clearance Certificate at this time/i.test(element.innerText || '')\n        );\n        issue?.scrollIntoView({ block: 'start', inline: 'nearest' });\n        await new Promise((resolve) => setTimeout(resolve, 180));\n        notice('NJ could not issue the tax clearance. COR is saving this screen and notifying the client.');\n        await send({ type: 'COR_TAX_ISSUE_CAPTURE_REQUEST', jobId: job.id });\n        return;\n      }\n\n      // Step E: Business Incentive Tax Clearance Button\n      const incentiveBtn = document.querySelector('input[name=\"Submit\"][value=\"Business Incentive Tax Clearance\"]');"
text = replace_once(text, anchor, replacement, 'tax bad page detection')
path.write_text(text)

# Extension background: capture visible NJ error, upload it, and complete as taxIssue.
path = Path('brc-helper-extension/background.js')
text = path.read_text()
text = replace_once(text,
"async function uploadTaxPdf(job, base64, filename) {\n  await uploadPdf(job, 'tax_clearance', base64, filename || 'NJ-Tax-Clearance.pdf');\n}\n",
"async function uploadTaxPdf(job, base64, filename) {\n  await uploadPdf(job, 'tax_clearance', base64, filename || 'NJ-Tax-Clearance.pdf');\n}\n\nasync function reportTaxClearanceIssue(job, base64) {\n  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));\n  const body = new FormData();\n  body.append('file', new Blob([bytes], { type: 'image/png' }), 'NJ-Tax-Clearance-Issue.png');\n  return api(job, `/api/uez/admin/applications/${job.applicationId}/tax-clearance-issue`, { method: 'POST', body });\n}\n",
'background tax issue upload helper')
text = replace_once(text,
"    if (message?.type === 'COR_TAX_PDF') {\n      await notify(job, 'uploading_tax_clearance');",
"    if (message?.type === 'COR_TAX_ISSUE_CAPTURE_REQUEST') {\n      if (job.workflow !== 'tax_clearance' || String(message.jobId || '') !== job.id) return { ok: false, error: 'No matching tax-clearance workflow is active.' };\n      await notify(job, 'capturing_tax_issue');\n      try {\n        const dataUrl = await chrome.tabs.captureVisibleTab(job.windowId, { format: 'png' });\n        const base64 = String(dataUrl || '').split(',')[1] || '';\n        if (!base64) throw new Error('COR could not capture the New Jersey tax-clearance error.');\n        await notify(job, 'sending_tax_issue_email');\n        await reportTaxClearanceIssue(job, base64);\n        await notify(job, 'complete', { taxIssue: true });\n        if (job.windowId) setTimeout(() => chrome.windows.remove(job.windowId).catch(() => {}), 1800);\n      } catch (err) {\n        await fail(job, err);\n      }\n      await setJob(null);\n      return { ok: true };\n    }\n    if (message?.type === 'COR_TAX_PDF') {\n      await notify(job, 'uploading_tax_clearance');",
'background tax issue handler')
path.write_text(text)

# Extension version bump
path = Path('brc-helper-extension/manifest.json')
text = path.read_text()
text = replace_once(text, '"version": "1.3.9"', '"version": "1.3.10"', 'manifest version')
path.write_text(text)

# Styles
path = Path('src/workflow.css')
text = path.read_text()
marker = '/* Admin manual document fallback */'
if marker in text:
    raise SystemExit('manual upload styles already present')
text += r'''

/* Admin manual document fallback */
.admin-manual-upload{margin:12px 10px 10px;padding:12px;border:1px dashed #d9dde8;border-radius:12px;background:#fafbfe;display:grid;grid-template-columns:minmax(150px,1fr) minmax(180px,1.4fr) auto;gap:8px;align-items:end}.admin-manual-upload-head{grid-column:1/-1;display:flex;justify-content:space-between;gap:10px;align-items:center}.admin-manual-upload-head strong{font-size:12px}.admin-manual-upload-head small{font-size:9px;color:#8b91a2;text-transform:uppercase;font-weight:800}.admin-manual-upload select,.admin-manual-upload input{margin:0;min-height:40px;padding:8px 10px;border-radius:9px}.admin-manual-upload button{min-height:40px;margin:0;white-space:nowrap}@media(max-width:767px){.admin-manual-upload{grid-template-columns:1fr}.admin-manual-upload-head{grid-column:auto}.admin-manual-upload button{width:100%}}
'''
path.write_text(text)
