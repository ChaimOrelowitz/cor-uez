from pathlib import Path


def rep(path, old, new, label):
    p=Path(path); s=p.read_text()
    if old not in s: raise SystemExit(f'missing {label} in {path}')
    p.write_text(s.replace(old,new,1))

# Admin: make OPEN PBS launch extension workflow.
rep('src/AdminPage.jsx',
"""      waiting_for_lakewood_submit: 'Grant packet ready. Review it and click the final Submit Form button.'""",
"""      waiting_for_lakewood_submit: 'Grant packet ready. Review it and click the final Submit Form button.',
      opening_pbs_signup: 'Opening New Jersey Premier Business Services…',
      pbs_opening_identification: 'Starting the PBS account setup…',
      pbs_filling_contact: 'COR is filling the PBS contact information…',
      pbs_creating_mynj: 'Creating the applicant’s myNewJersey login…',
      pbs_account_opened: 'PBS account opened. Moving to Add a Business…',
      pbs_opening_business_information: 'Opening PBS Business Information…',
      waiting_for_pbs_business_type: 'COR filled the PBS business information. Select Business Type in the NJ window, then click Continue.',
      waiting_for_pbs_verification: 'Complete New Jersey’s security verification in the visible PBS window.',
      waiting_for_pbs_human_step: 'COR reached a PBS step that was not completed in the HAR. Review and continue manually.',
      waiting_for_pbs_page: 'Waiting for the next PBS page…',
      pbs_needs_attention: 'PBS needs your attention in the visible NJ window.'""",
'PBS status messages')

anchor="""  async function runTaxClearance() {"""
func="""  async function runPbsSignup() {
    setBusy(true);
    setMessage('Starting the COR Chrome extension…');
    try {
      const currentSession = await getApplicantSession();
      if (!currentSession?.access_token) throw new Error('Please sign in again before opening PBS.');
      const primary = detail.owners?.[0];
      if (!primary) throw new Error('A primary owner is required before opening PBS.');
      if (!primary.title) throw new Error('The primary owner needs a title before opening PBS.');
      if (!myNjCredentials) throw new Error('MyNJ login information is missing. Confirm the BRC and generate the MyNJ login first.');

      const outcome = await runExtensionWorkflow('pbs_signup', {
        applicationId: detail.application.id,
        businessName: detail.application.registered_business_name || detail.application.brc_registered_name || detail.application.business_name_input,
        ein: detail.application.ein,
        accessToken: currentSession.access_token
      });
      if (outcome.status !== 'complete') throw new Error(outcome.error || 'The PBS workflow did not finish.');
      await refreshList(detail.application.id);
      setMessage('PBS account and business setup completed.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

"""+anchor
rep('src/AdminPage.jsx',anchor,func,'runPbsSignup')
rep('src/AdminPage.jsx',
"""<button className={`ops-action ${detail.application.pbs_account_created ? 'success-action' : 'primary'}`} onClick={() => setPbsModalOpen(true)} disabled={busy}><span>OPEN</span><strong>PBS</strong></button>""",
"""<button className={`ops-action ${detail.application.pbs_account_created ? 'success-action' : 'primary'}`} onClick={runPbsSignup} disabled={busy || !myNjCredentials}><span>OPEN</span><strong>PBS</strong></button>""",
'PBS button')

# Backend admin detail: expose title mapping to admin/extension.
rep('backend/routes/uez.js',
"""      ownerOrder: owner.owner_order,
      firstName: owner.first_name,""",
"""      ownerOrder: owner.owner_order,
      title: owner.honorific_title,
      firstName: owner.first_name,""",
'admin owner title mapping')

# Background: allow pbs workflow, launch correct URL, dynamic data fetch, completion + attention.
rep('brc-helper-extension/background.js',
"""  if (!['brc', 'tax_clearance', 'ldc_jotform', 'lakewood_portal'].includes(message.workflow)) throw new Error('Unknown COR workflow.');""",
"""  if (!['brc', 'tax_clearance', 'pbs_signup', 'ldc_jotform', 'lakewood_portal'].includes(message.workflow)) throw new Error('Unknown COR workflow.');""",
'allow pbs workflow')
rep('brc-helper-extension/background.js',
"""  const url = job.workflow === 'brc'
    ? 'https://www1.state.nj.us/TYTR_BRC/jsp/BRCLoginJsp.jsp'
    : job.workflow === 'tax_clearance'
      ? 'https://www16.state.nj.us/NJ_PREMIER_EBIZ/jsp/home.jsp'
      : job.workflow === 'ldc_jotform'""",
"""  const url = job.workflow === 'brc'
    ? 'https://www1.state.nj.us/TYTR_BRC/jsp/BRCLoginJsp.jsp'
    : job.workflow === 'tax_clearance'
      ? 'https://www16.state.nj.us/NJ_PREMIER_EBIZ/jsp/home.jsp'
      : job.workflow === 'pbs_signup'
        ? 'https://www-njlib.nj.gov/NJ_PREMIER_EBIZ/'
      : job.workflow === 'ldc_jotform'""",
'pbs URL')
rep('brc-helper-extension/background.js',
"""  const openingStatus = job.workflow === 'brc' ? 'opening_brc' : job.workflow === 'tax_clearance' ? 'opening_pbs' : job.workflow === 'ldc_jotform' ? 'opening_ldc_form' : 'opening_lakewood_portal';""",
"""  const openingStatus = job.workflow === 'brc' ? 'opening_brc' : job.workflow === 'tax_clearance' ? 'opening_pbs' : job.workflow === 'pbs_signup' ? 'opening_pbs_signup' : job.workflow === 'ldc_jotform' ? 'opening_ldc_form' : 'opening_lakewood_portal';""",
'pbs opening status')

anchor="""    if (message?.type === 'COR_JOTFORM_GET_DATA') {"""
block="""    if (message?.type === 'COR_PBS_GET_DATA') {
      if (job.workflow !== 'pbs_signup' || String(message.jobId || '') !== job.id) return { ok: false, error: 'No matching PBS workflow is active.' };
      const detail = await api(job, `/api/uez/admin/applications/${job.applicationId}`);
      const application = detail.application || {};
      const owner = detail.owners?.[0] || {};
      const credentialResult = await api(job, `/api/uez/applications/${job.applicationId}/credentials/mynj`);
      if (!credentialResult.exists || !credentialResult.credentials) throw new Error('MyNJ login information is missing.');
      const einDigits = String(application.ein || '').replace(/\\D/g, '').slice(0, 9);
      if (einDigits.length !== 9) throw new Error('A valid 9-digit EIN is required for PBS.');
      return {
        ok: true,
        data: {
          owner: {
            title: owner.title || '', firstName: owner.firstName || '', lastName: owner.lastName || '',
            addressLine1: owner.addressLine1 || '', addressLine2: owner.addressLine2 || '', city: owner.city || '',
            state: owner.state || '', zip: owner.zip || '', phone: owner.phone || '', email: owner.email || ''
          },
          business: {
            einNo: `${einDigits}000`,
            businessName: application.registered_business_name || application.brc_registered_name || application.business_name_input || '',
            yearFounded: String(application.year_founded || ''),
            taxZip: '08701'
          },
          credentials: credentialResult.credentials
        }
      };
    }
"""+anchor
rep('brc-helper-extension/background.js',anchor,block,'PBS data message')

anchor="""    if (message?.type === 'COR_NJ_STATUS') { await notify(job, message.status || job.status); return { ok: true }; }"""
block="""    if (message?.type === 'COR_PBS_NEEDS_ATTENTION') {
      if (job.workflow !== 'pbs_signup') return { ok: false, error: 'No matching PBS workflow is active.' };
      await notify(job, 'pbs_needs_attention', { reason: message.reason || '' });
      return { ok: true };
    }
    if (message?.type === 'COR_PBS_COMPLETE') {
      if (job.workflow !== 'pbs_signup' || String(message.jobId || '') !== job.id) return { ok: false, error: 'No matching PBS workflow is active.' };
      await api(job, `/api/uez/admin/applications/${job.applicationId}/pbs-account-created`, { method: 'POST' });
      await notify(job, 'complete');
      await setJob(null);
      return { ok: true };
    }
"""+anchor
rep('brc-helper-extension/background.js',anchor,block,'PBS completion handlers')

# Inject pbs.js only for PBS workflow; keep content.js for BRC/tax.
rep('brc-helper-extension/background.js',
"""async function injectNjHelper(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] }).catch(() => {});
}""",
"""async function injectNjHelper(tabId) {
  const job = await getJob().catch(() => null);
  const file = job?.workflow === 'pbs_signup' ? 'pbs.js' : 'content.js';
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [file] }).catch(() => {});
}""",
'workflow helper injection')

# Manifest version + explicit PBS content script so navigation/redirect pages keep helper loaded.
rep('brc-helper-extension/manifest.json','"version": "1.3.6"','"version": "1.3.7"','extension version')
rep('brc-helper-extension/manifest.json',
"""    {
      "matches": [
        "https://*.state.nj.us/*",
        "https://*.nj.gov/*",
        "https://my.nj.gov/*"
      ],
      "js": [
        "content.js"
      ],
      "run_at": "document_idle",
      "all_frames": true,
      "match_about_blank": true
    },""",
"""    {
      "matches": [
        "https://*.state.nj.us/*",
        "https://*.nj.gov/*",
        "https://my.nj.gov/*"
      ],
      "js": [
        "content.js"
      ],
      "run_at": "document_idle",
      "all_frames": true,
      "match_about_blank": true
    },
    {
      "matches": [
        "https://www-njlib.nj.gov/*",
        "https://my.nj.gov/*"
      ],
      "js": [
        "pbs.js"
      ],
      "run_at": "document_idle",
      "all_frames": true,
      "match_about_blank": true
    },""",
'pbs manifest script')
