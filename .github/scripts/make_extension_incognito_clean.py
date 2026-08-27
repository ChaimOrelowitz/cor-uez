from pathlib import Path
import json


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

bg_path = Path('brc-helper-extension/background.js')
bg = bg_path.read_text()

helper_anchor = "async function startWorkflow(message, sender) {\n"
helpers = r'''const CLEAN_WORKFLOW_COOKIE_DOMAINS = [
  'state.nj.us',
  'nj.gov',
  'njportal.com',
  'jotform.com',
  'lakewoodnj.gov'
];

function isIncognitoAllowed() {
  return new Promise((resolve) => {
    chrome.extension.isAllowedIncognitoAccess((allowed) => resolve(Boolean(allowed)));
  });
}

async function cookieStoreForTab(tabId) {
  const stores = await chrome.cookies.getAllCookieStores();
  return stores.find((store) => (store.tabIds || []).includes(tabId))?.id || null;
}

function workflowCookieDomain(cookieDomain) {
  const host = String(cookieDomain || '').replace(/^\./, '').toLowerCase();
  return CLEAN_WORKFLOW_COOKIE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

async function clearIncognitoWorkflowCookies(tabId) {
  const storeId = await cookieStoreForTab(tabId);
  if (!storeId) throw new Error('COR could not identify the clean incognito cookie store.');
  const cookies = await chrome.cookies.getAll({ storeId });
  const relevant = cookies.filter((cookie) => workflowCookieDomain(cookie.domain));
  await Promise.all(relevant.map(async (cookie) => {
    const host = String(cookie.domain || '').replace(/^\./, '');
    const scheme = cookie.secure ? 'https' : 'http';
    const path = cookie.path || '/';
    await chrome.cookies.remove({
      url: `${scheme}://${host}${path}`,
      name: cookie.name,
      storeId
    }).catch(() => null);
  }));
  return relevant.length;
}

'''
bg = replace_once(bg, helper_anchor, helpers + helper_anchor, 'incognito helpers')

credentials_anchor = "  if (job.workflow === 'tax_clearance' || job.workflow === 'pbs_login') {\n    const result = await api(job, `/api/uez/applications/${job.applicationId}/credentials/mynj`);\n    if (!result.exists || !result.credentials) throw new Error('MyNJ / PBS login information is missing.');\n    job.credentials = result.credentials;\n  }\n  await setJob(job);\n"
credentials_new = "  if (job.workflow === 'tax_clearance' || job.workflow === 'pbs_login') {\n    const result = await api(job, `/api/uez/applications/${job.applicationId}/credentials/mynj`);\n    if (!result.exists || !result.credentials) throw new Error('MyNJ / PBS login information is missing.');\n    job.credentials = result.credentials;\n  }\n  const incognitoAllowed = await isIncognitoAllowed();\n  if (!incognitoAllowed) {\n    throw new Error('COR workflows require Incognito access. Open chrome://extensions, choose COR UEZ Document Helper → Details, turn on Allow in Incognito, then try again.');\n  }\n  await setJob(job);\n"
bg = replace_once(bg, credentials_anchor, credentials_new, 'incognito permission check')

popup_old = "  const popup = await chrome.windows.create({ url, type: 'popup', width: 1200, height: 900, focused: true });\n  const tab = popup.tabs?.[0];\n  job = { ...job, tabId: tab?.id || null, windowId: popup.id };\n  const openingStatus = job.workflow === 'brc' ? 'opening_brc' : (job.workflow === 'tax_clearance' || job.workflow === 'pbs_login') ? 'opening_pbs' : job.workflow === 'pbs_signup' ? 'opening_pbs_signup' : job.workflow === 'ldc_jotform' ? 'opening_ldc_form' : 'opening_lakewood_portal';\n  await notify(job, openingStatus);\n  if (tab?.id && !['ldc_jotform', 'lakewood_portal'].includes(job.workflow)) await injectNjHelper(tab.id).catch(() => {});\n"
popup_new = "  let popup;\n  try {\n    popup = await chrome.windows.create({ url: 'about:blank', type: 'popup', incognito: true, width: 1200, height: 900, focused: true });\n  } catch (error) {\n    await setJob(null);\n    throw new Error('COR could not open a clean Incognito window. In chrome://extensions → COR UEZ Document Helper → Details, turn on Allow in Incognito, then try again.');\n  }\n  const tab = popup.tabs?.[0];\n  if (!tab?.id) {\n    if (popup.id) await chrome.windows.remove(popup.id).catch(() => {});\n    await setJob(null);\n    throw new Error('COR could not create the clean Incognito workflow tab.');\n  }\n  job = { ...job, tabId: tab.id, windowId: popup.id, incognito: true };\n  await setJob(job);\n  try {\n    await clearIncognitoWorkflowCookies(tab.id);\n    await chrome.tabs.update(tab.id, { url });\n  } catch (error) {\n    if (popup.id) await chrome.windows.remove(popup.id).catch(() => {});\n    await setJob(null);\n    throw error;\n  }\n  const openingStatus = job.workflow === 'brc' ? 'opening_brc' : (job.workflow === 'tax_clearance' || job.workflow === 'pbs_login') ? 'opening_pbs' : job.workflow === 'pbs_signup' ? 'opening_pbs_signup' : job.workflow === 'ldc_jotform' ? 'opening_ldc_form' : 'opening_lakewood_portal';\n  await notify(job, openingStatus);\n"
bg = replace_once(bg, popup_old, popup_new, 'incognito popup creation')

bg_path.write_text(bg)

manifest_path = Path('brc-helper-extension/manifest.json')
manifest = json.loads(manifest_path.read_text())
if manifest.get('version') != '1.3.11':
    raise SystemExit(f"manifest version: expected 1.3.11, found {manifest.get('version')}")
manifest['version'] = '1.3.12'
permissions = list(manifest.get('permissions') or [])
if 'cookies' not in permissions:
    permissions.append('cookies')
manifest['permissions'] = permissions
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
