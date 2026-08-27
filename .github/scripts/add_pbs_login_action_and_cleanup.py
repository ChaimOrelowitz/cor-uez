from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Missing expected snippet: {label}")
    return text.replace(old, new, 1)

# Admin: rename the account-creation action and add a login-only PBS action.
admin_path = Path('src/AdminPage.jsx')
admin = admin_path.read_text()

admin = replace_once(
    admin,
    "  async function runTaxClearance() {",
    """  async function runPbsLogin() {
    setBusy(true);
    setMessage('Starting the COR Chrome extension…');
    try {
      const currentSession = await getApplicantSession();
      if (!currentSession?.access_token) throw new Error('Please sign in again before opening PBS.');
      if (!myNjCredentials) throw new Error('MyNJ / PBS login information is missing.');

      const outcome = await runExtensionWorkflow('pbs_login', {
        applicationId: detail.application.id,
        businessName: detail.application.registered_business_name || detail.application.brc_registered_name || detail.application.business_name_input,
        ein: detail.application.ein,
        accessToken: currentSession.access_token
      });
      if (outcome.status !== 'complete') throw new Error(outcome.error || 'PBS login did not finish.');
      setMessage('PBS is open and signed in.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runTaxClearance() {""",
    'insert PBS login-only function'
)

old_action = """                  <button className={`ops-action ${detail.application.pbs_account_created ? 'success-action' : 'primary'}`} onClick={runPbsSignup} disabled={busy || !myNjCredentials}><span>OPEN</span><strong>PBS</strong></button>"""
new_action = """                  <button className={`ops-action ${detail.application.pbs_account_created ? 'success-action' : 'primary'}`} onClick={runPbsSignup} disabled={busy || !myNjCredentials}><span>OPEN</span><strong>PBS ACCOUNT</strong></button>
                  <button className="ops-action primary" onClick={runPbsLogin} disabled={busy || !myNjCredentials}><span>OPEN</span><strong>PBS</strong></button>"""
admin = replace_once(admin, old_action, new_action, 'PBS action buttons')
admin_path.write_text(admin)

# Applicant signup: on Address, keep only the functional Back-to-intro control.
app_path = Path('src/App.jsx')
app = app_path.read_text()
old_back = """          <button className="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>Back</button>"""
new_back = """          {step > 0 && <button className="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={busy}>Back</button>}"""
app = replace_once(app, old_back, new_back, 'hide disabled Address Back button')
app_path.write_text(app)

# Extension background: add a login-only PBS workflow using stored MyNJ credentials.
bg_path = Path('brc-helper-extension/background.js')
bg = bg_path.read_text()
bg = replace_once(
    bg,
    "['brc', 'tax_clearance', 'pbs_signup', 'ldc_jotform', 'lakewood_portal']",
    "['brc', 'tax_clearance', 'pbs_signup', 'pbs_login', 'ldc_jotform', 'lakewood_portal']",
    'workflow allowlist'
)
bg = replace_once(
    bg,
    "if (job.workflow === 'tax_clearance') {",
    "if (job.workflow === 'tax_clearance' || job.workflow === 'pbs_login') {",
    'load credentials for PBS login'
)
bg = replace_once(
    bg,
    """    : job.workflow === 'tax_clearance'
      ? 'https://www16.state.nj.us/NJ_PREMIER_EBIZ/jsp/home.jsp'
      : job.workflow === 'pbs_signup'""",
    """    : job.workflow === 'tax_clearance' || job.workflow === 'pbs_login'
      ? 'https://www16.state.nj.us/NJ_PREMIER_EBIZ/jsp/home.jsp'
      : job.workflow === 'pbs_signup'""",
    'PBS login start URL'
)
bg = replace_once(
    bg,
    """  const openingStatus = job.workflow === 'brc' ? 'opening_brc' : job.workflow === 'tax_clearance' ? 'opening_pbs' : job.workflow === 'pbs_signup' ? 'opening_pbs_signup' : job.workflow === 'ldc_jotform' ? 'opening_ldc_form' : 'opening_lakewood_portal';""",
    """  const openingStatus = job.workflow === 'brc' ? 'opening_brc' : (job.workflow === 'tax_clearance' || job.workflow === 'pbs_login') ? 'opening_pbs' : job.workflow === 'pbs_signup' ? 'opening_pbs_signup' : job.workflow === 'ldc_jotform' ? 'opening_ldc_form' : 'opening_lakewood_portal';""",
    'PBS login opening status'
)
handler_marker = """    if (message?.type === 'COR_PBS_NEEDS_ATTENTION') {"""
handler = """    if (message?.type === 'COR_PBS_LOGIN_COMPLETE') {
      if (job.workflow !== 'pbs_login' || String(message.jobId || '') !== job.id) return { ok: false, error: 'No matching PBS login workflow is active.' };
      await notify(job, 'complete');
      await setJob(null);
      return { ok: true };
    }
    if (message?.type === 'COR_PBS_NEEDS_ATTENTION') {"""
bg = replace_once(bg, handler_marker, handler, 'PBS login completion handler')
bg_path.write_text(bg)

# Generic NJ helper: log in to PBS and then stop without opening any downstream tool.
content_path = Path('brc-helper-extension/content.js')
content = content_path.read_text()
login_branch_marker = """    if (job.workflow === 'tax_clearance') {"""
login_branch = r'''    if (job.workflow === 'pbs_login') {
      const usernameInput = document.querySelector('input[name="IDToken1"]');
      const passwordInput = document.querySelector('input[name="IDToken2"]');

      if (usernameInput && passwordInput && job.credentials) {
        const loginKey = `corPbsLogin:${job.id}`;
        if (!sessionStorage.getItem(loginKey)) {
          sessionStorage.setItem(loginKey, '1');
          setValue(usernameInput, job.credentials.username || '');
          setValue(passwordInput, job.credentials.password || '');
          notice('COR filled the stored MyNJ login and is signing in to PBS.');
          await send({ type: 'COR_NJ_STATUS', status: 'signing_in_to_pbs' });
          const submitBtn = document.querySelector('input[name="Login.Submit"], input[type="submit"], button[type="submit"]');
          submitBtn?.click();
        }
        return;
      }

      if (usernameInput && !passwordInput && job.credentials?.challengeAnswer && /challenge|security question|secret question/i.test(text)) {
        const challengeKey = `corPbsLoginChallenge:${job.id}`;
        if (!sessionStorage.getItem(challengeKey)) {
          sessionStorage.setItem(challengeKey, '1');
          setValue(usernameInput, job.credentials.challengeAnswer);
          notice('COR filled the MyNJ challenge answer and is continuing.');
          await send({ type: 'COR_NJ_STATUS', status: 'signing_in_to_pbs' });
          const submitBtn = document.querySelector('input[type="submit"], button[type="submit"]');
          submitBtn?.click();
        }
        return;
      }

      const pbsLoginLink = document.querySelector('a[href*="my.nj.gov/aui/Login"]');
      if (pbsLoginLink) {
        const linkKey = `corPbsLoginLink:${job.id}`;
        if (!sessionStorage.getItem(linkKey)) {
          sessionStorage.setItem(linkKey, '1');
          notice('COR is opening the MyNJ login.');
          await send({ type: 'COR_NJ_STATUS', status: 'opening_mynj_login' });
          navigateLink(pbsLoginLink);
        }
        return;
      }

      const onPbs = /NJ_PREMIER_EBIZ/i.test(location.pathname) || /Premier Business Services/i.test(text);
      const signedInSignal = [...document.querySelectorAll('a')].some((link) =>
        /Tax & Revenue Center|Add a Business|Manage Business|Sign Out|Log Out/i.test(link.textContent || '')
      );
      if (onPbs && signedInSignal) {
        sent = true;
        notice('PBS is open and signed in. COR stopped here.');
        await send({ type: 'COR_PBS_LOGIN_COMPLETE', jobId: job.id });
        return;
      }

      notice('COR is waiting for PBS to finish signing in.');
      await send({ type: 'COR_NJ_STATUS', status: 'waiting_for_pbs_page' });
      return;
    }

    if (job.workflow === 'tax_clearance') {'''
content = replace_once(content, login_branch_marker, login_branch, 'PBS login-only content workflow')
content_path.write_text(content)

# Bump extension version so the required reload is obvious.
manifest_path = Path('brc-helper-extension/manifest.json')
manifest = manifest_path.read_text()
manifest = replace_once(manifest, '"version": "1.3.8"', '"version": "1.3.9"', 'extension version')
manifest_path.write_text(manifest)
