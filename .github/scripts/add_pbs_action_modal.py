from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing {label}')
    return text.replace(old, new, 1)

p = Path('src/AdminPage.jsx')
s = p.read_text()

s = replace_once(
    s,
    "const NJ_REGISTRATION_URL = 'https://www.njportal.com/dor/businessregistration';",
    "const NJ_REGISTRATION_URL = 'https://www.njportal.com/dor/businessregistration';\nconst NJ_PBS_URL = 'https://www-njlib.nj.gov/NJ_PREMIER_EBIZ/jsp/home.jsp';",
    'PBS URL constant'
)

s = replace_once(
    s,
    "  const [previewBusy, setPreviewBusy] = useState(false);",
    "  const [previewBusy, setPreviewBusy] = useState(false);\n  const [pbsModalOpen, setPbsModalOpen] = useState(false);",
    'PBS modal state'
)

old_actions = """                  <button className={`ops-action ${docFor(detail, 'brc') ? 'success-action' : 'primary'}`} onClick={runBrcLookup} disabled={busy}><span>FETCH</span><strong>BRC</strong></button>
                  <button className={`ops-action ${docFor(detail, 'tax_clearance') ? 'success-action' : 'primary'}`} onClick={runTaxClearance} disabled={busy || !myNjCredentials}><span>FETCH</span><strong>TAX CLEARANCE</strong></button>"""
new_actions = """                  <button className={`ops-action ${docFor(detail, 'brc') ? 'success-action' : 'primary'}`} onClick={runBrcLookup} disabled={busy}><span>FETCH</span><strong>BRC</strong></button>
                  <button className={`ops-action ${detail.application.pbs_account_created ? 'success-action' : 'primary'}`} onClick={() => setPbsModalOpen(true)} disabled={busy}><span>OPEN</span><strong>PBS</strong></button>
                  <button className={`ops-action ${docFor(detail, 'tax_clearance') ? 'success-action' : 'primary'}`} onClick={runTaxClearance} disabled={busy || !myNjCredentials}><span>FETCH</span><strong>TAX CLEARANCE</strong></button>"""
s = replace_once(s, old_actions, new_actions, 'PBS action button')

modal_anchor = """        {previewDoc && <div className=\"document-modal-backdrop\" onMouseDown={(e) => { if (e.target === e.currentTarget) closePreview(); }}>"""
pbs_modal = """        {pbsModalOpen && <div className=\"document-modal-backdrop pbs-modal-backdrop\" onMouseDown={(e) => { if (e.target === e.currentTarget) setPbsModalOpen(false); }}>
          <div className=\"document-modal pbs-modal\" role=\"dialog\" aria-modal=\"true\" aria-label=\"NJ Premier Business Services\">
            <div className=\"document-modal-head\"><div><strong>NJ Premier Business Services</strong><small>Create / manage the applicant's PBS account</small></div><button onClick={() => setPbsModalOpen(false)} aria-label=\"Close PBS\">×</button></div>
            <div className=\"document-modal-body pbs-modal-body\"><iframe src={NJ_PBS_URL} title=\"NJ Premier Business Services\" /></div>
            <div className=\"document-modal-footer\"><div><a href={NJ_PBS_URL} target=\"_blank\" rel=\"noreferrer\">Open PBS in new tab</a><small className=\"pbs-frame-note\">If New Jersey blocks the embedded page, use this link.</small></div><button className=\"secondary\" onClick={() => setPbsModalOpen(false)}>Close</button></div>
          </div>
        </div>}
""" + modal_anchor
s = replace_once(s, modal_anchor, pbs_modal, 'PBS modal')
p.write_text(s)

p = Path('src/workflow.css')
css = p.read_text()
css += """

/* PBS admin action modal */
.pbs-modal { width: min(1180px, 96vw); height: min(900px, 92vh); }
.pbs-modal-body { min-height: 70vh; padding: 0 !important; background: #fff; }
.pbs-modal-body iframe { display: block; width: 100%; height: 70vh; border: 0; background: #fff; }
.pbs-modal .document-modal-footer { align-items: center; }
.pbs-modal .document-modal-footer > div { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.pbs-frame-note { color: #8b91a2; font-size: 11px; }
@media (max-width: 700px) {
  .pbs-modal { width: 98vw; height: 94vh; }
  .pbs-modal-body iframe { height: 72vh; }
}
"""
p.write_text(css)
