from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

# 1) Extension: retry Tax & Revenue navigation until it actually leaves PBS,
# and capture bad-tax screenshots from the absolute top with COR UI hidden.
content_path = Path('brc-helper-extension/content.js')
content = content_path.read_text()

old_tax_link = """      const taxLink = [...document.querySelectorAll('a')].find((link) =>
        /Tax & Revenue Center/i.test(link.textContent || '') ||
        /TYTR_ACE_App\\/servlet\\/common\\/portalRequest/i.test(link.href || '')
      );
      if (taxLink) {
        const centerKey = `corTaxCenter:${job.id}`;
        if (!sessionStorage.getItem(centerKey)) {
          sessionStorage.setItem(centerKey, '1');
          notice('COR is opening Tax & Revenue Center.');
          await send({ type: 'COR_NJ_STATUS', status: 'opening_tax_revenue_center' });
          navigateLink(taxLink);
        }
        return;
      }
"""

new_tax_link = """      const taxLink = [...document.querySelectorAll('a')].find((link) =>
        /Tax & Revenue Center/i.test(link.textContent || '') ||
        /TYTR_ACE_App\\/servlet\\/common\\/portalRequest/i.test(link.href || '')
      );
      if (taxLink) {
        // Do not permanently mark this step complete until navigation actually succeeds.
        // Retry every two seconds while the Tax & Revenue link is still on the page.
        const centerKey = `corTaxCenterAttempt:${job.id}`;
        const lastAttempt = Number(sessionStorage.getItem(centerKey) || 0);
        if (!lastAttempt || Date.now() - lastAttempt > 2000) {
          sessionStorage.setItem(centerKey, String(Date.now()));
          notice('COR is opening Tax & Revenue Center.');
          await send({ type: 'COR_NJ_STATUS', status: 'opening_tax_revenue_center' });
          navigateLink(taxLink);
        }
        return;
      }
"""
content = replace_once(content, old_tax_link, new_tax_link, 'Tax & Revenue retry block')

old_bad_tax = """      // Bad tax-clearance result: NJ returns to this same screen with an eligibility error.
      if (/We cannot verify that you are eligible to receive a Tax Clearance Certificate at this time/i.test(text)) {
        sent = true;
        const issue = [...document.querySelectorAll('td, div, table, section, form')].find((element) =>
          /We cannot verify that you are eligible to receive a Tax Clearance Certificate at this time/i.test(element.innerText || '')
        );
        issue?.scrollIntoView({ block: 'start', inline: 'nearest' });
        await new Promise((resolve) => setTimeout(resolve, 180));
        notice('NJ could not issue the tax clearance. COR is saving this screen and notifying the client.');
        await send({ type: 'COR_TAX_ISSUE_CAPTURE_REQUEST', jobId: job.id });
        return;
      }
"""

new_bad_tax = """      // Bad tax-clearance result: NJ returns to this same screen with an eligibility error.
      if (/We cannot verify that you are eligible to receive a Tax Clearance Certificate at this time/i.test(text)) {
        sent = true;

        // This screenshot becomes part of the client's permanent record. Hide COR's helper
        // notice and capture from the absolute top so the NJ header, Representative line,
        // red error message, and Registration Status are all visible with no COR overlay.
        const helperNotice = document.getElementById('cor-uez-helper-notice');
        if (helperNotice) helperNotice.style.display = 'none';
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        if (document.documentElement) document.documentElement.scrollTop = 0;
        if (document.body) document.body.scrollTop = 0;
        await new Promise((resolve) => setTimeout(resolve, 400));

        await send({ type: 'COR_TAX_ISSUE_CAPTURE_REQUEST', jobId: job.id });
        return;
      }
"""
content = replace_once(content, old_bad_tax, new_bad_tax, 'bad tax screenshot block')
content_path.write_text(content)

# 2) Manual Tax Clearance Issue email: attach latest saved screenshot automatically.
route_path = Path('backend/routes/uezEmail.js')
route = route_path.read_text()

route = replace_once(
    route,
    "const router = express.Router();\nrouter.use(requireUezAuth);",
    "const router = express.Router();\nconst DOCUMENT_BUCKET = 'uez-documents';\nrouter.use(requireUezAuth);",
    'document bucket constant'
)

insert_after = """async function credentialVars(applicationId) {
  const { data, error } = await supabase.from('uez_credentials')
    .select('*').eq('application_id', applicationId).eq('provider', 'mynj').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('MyNJ / PBS credentials have not been created yet.');
  const credentials = decryptCredential(data);
  return {
    pbs_username: credentials.username,
    pbs_password: credentials.password,
    challenge_question: credentials.challengeQuestion,
    challenge_answer: credentials.challengeAnswer
  };
}
"""

attachment_helper = insert_after + """

async function latestTaxIssueAttachment(applicationId) {
  const { data: document, error } = await supabase.from('uez_documents')
    .select('storage_path, filename, created_at')
    .eq('application_id', applicationId)
    .eq('document_type', 'tax_clearance_issue')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!document?.storage_path) return null;

  const { data: file, error: downloadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .download(document.storage_path);
  if (downloadError) throw downloadError;
  const bytes = Buffer.from(await file.arrayBuffer());
  return {
    filename: document.filename || 'NJ-Tax-Clearance-Issue.png',
    content: bytes.toString('base64')
  };
}
"""
route = replace_once(route, insert_after, attachment_helper, 'tax screenshot attachment helper')

old_send = """    let extra = req.body?.extra && typeof req.body.extra === 'object' ? { ...req.body.extra } : {};
    if (req.params.key === 'pbs_account_created') {
      extra = { ...extra, ...(await credentialVars(application.id)) };
    }

    const result = await sendApplicationEmail(application, req.params.key, {
      mode: 'manual',
      extra
    });
"""

new_send = """    let extra = req.body?.extra && typeof req.body.extra === 'object' ? { ...req.body.extra } : {};
    if (req.params.key === 'pbs_account_created') {
      extra = { ...extra, ...(await credentialVars(application.id)) };
    }

    const attachments = [];
    if (req.params.key === 'tax_issue') {
      const screenshot = await latestTaxIssueAttachment(application.id);
      if (screenshot) attachments.push(screenshot);
    }

    const result = await sendApplicationEmail(application, req.params.key, {
      mode: 'manual',
      extra,
      attachments
    });
"""
route = replace_once(route, old_send, new_send, 'manual email attachment block')
route_path.write_text(route)

# 3) Bump extension version once.
manifest_path = Path('brc-helper-extension/manifest.json')
manifest = manifest_path.read_text()
manifest = replace_once(manifest, '"version": "1.3.10"', '"version": "1.3.11"', 'extension version')
manifest_path.write_text(manifest)
