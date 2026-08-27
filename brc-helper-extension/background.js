const API_BASE = 'https://cor-uez-api.onrender.com';
const ACTIVE_JOB_KEY = 'corUezActiveJob';
const EXTENSION_KEY = 'cor-uez-extension-sec-2026';

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (origin === 'https://cor-uez.vercel.app' || origin === 'https://uez.corsolutions.io') return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  if (/^https:\/\/cor-uez-[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true;
  return false;
}

async function getJob() {
  const local = await chrome.storage.local.get(ACTIVE_JOB_KEY).catch(() => ({}));
  return local[ACTIVE_JOB_KEY] || null;
}

async function setJob(job) {
  if (job) {
    await chrome.storage.local.set({ [ACTIVE_JOB_KEY]: job }).catch(() => {});
  } else {
    await chrome.storage.local.remove(ACTIVE_JOB_KEY).catch(() => {});
  }
}

async function api(job, path, options = {}) {
  const headers = {
    Authorization: `Bearer ${job.accessToken}`,
    'X-COR-Extension-Key': EXTENSION_KEY,
    ...(options.headers || {})
  };
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `UEZ returned ${response.status}.`);
  return data;
}

async function notify(job, status, extra = {}) {
  const updated = { ...job, status, updatedAt: Date.now() };
  await setJob(updated);
  const tabs = await chrome.tabs.query({});
  const appTabs = tabs.filter((t) => t.url && isAllowedOrigin(new URL(t.url).origin));
  await Promise.all(appTabs.map((tab) => chrome.tabs.sendMessage(tab.id, { source: 'cor-uez-background', type: 'COR_UEZ_STATUS', jobId: updated.id, workflow: updated.workflow, status, ...extra }).catch(() => {})));
  return updated;
}

async function fail(job, error) {
  await notify(job, 'error', { error: error?.message || String(error || 'The document retrieval did not finish.') });
  await setJob(null);
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

async function cropVisibleTabCapture(windowId, rect, viewport) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scaleX = bitmap.width / Math.max(1, Number(viewport?.width || bitmap.width));
  const scaleY = bitmap.height / Math.max(1, Number(viewport?.height || bitmap.height));
  const sx = Math.max(0, Math.round(Number(rect?.left || 0) * scaleX));
  const sy = Math.max(0, Math.round(Number(rect?.top || 0) * scaleY));
  const sw = Math.min(bitmap.width - sx, Math.max(1, Math.round(Number(rect?.width || bitmap.width) * scaleX)));
  const sh = Math.min(bitmap.height - sy, Math.max(1, Math.round(Number(rect?.height || bitmap.height) * scaleY)));
  const canvas = new OffscreenCanvas(sw, sh);
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close?.();
  return blobToBase64(await canvas.convertToBlob({ type: 'image/png' }));
}

async function uploadPdf(job, documentType, base64, filename) {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const body = new FormData();
  body.append('documentType', documentType);
  body.append('file', new Blob([bytes], { type: 'application/pdf' }), filename);
  await api(job, `/api/uez/applications/${job.applicationId}/documents`, { method: 'POST', body });
}

async function uploadTaxPdf(job, base64, filename) {
  await uploadPdf(job, 'tax_clearance', base64, filename || 'NJ-Tax-Clearance.pdf');
}

async function reportTaxClearanceIssue(job, base64) {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const body = new FormData();
  body.append('file', new Blob([bytes], { type: 'image/png' }), 'NJ-Tax-Clearance-Issue.png');
  return api(job, `/api/uez/admin/applications/${job.applicationId}/tax-clearance-issue`, { method: 'POST', body });
}

async function uploadLdcPdf(job, base64, filename, submissionId) {
  await uploadPdf(job, 'ldc_application', base64, filename || `Lakewood-LDC-Incentive-Application-${submissionId || 'submitted'}.pdf`);
  await api(job, `/api/uez/admin/applications/${job.applicationId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'ldc_submitted',
      label: 'LDC application submitted',
      message: submissionId
        ? `The Lakewood LDC incentive application was submitted successfully. JotForm submission ID: ${submissionId}.`
        : 'The Lakewood LDC incentive application was submitted successfully.'
    })
  });
}

const CLEAN_WORKFLOW_COOKIE_DOMAINS = [
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

async function startWorkflow(message, sender) {
  const senderOrigin = sender.tab?.url ? new URL(sender.tab.url).origin : '';
  if (!isAllowedOrigin(senderOrigin)) throw new Error('Open this helper from the COR UEZ admin app.');
  if (!['brc', 'tax_clearance', 'pbs_signup', 'pbs_login', 'ldc_jotform', 'lakewood_portal'].includes(message.workflow)) throw new Error('Unknown COR workflow.');
  const existing = await getJob();
  if (existing && Date.now() - (existing.createdAt || 0) < 30 * 60 * 1000 && existing.status !== 'complete' && existing.status !== 'error') {
    throw new Error('A COR document retrieval is already running. Finish it first.');
  }
  await setJob(null);

  let job = { id: String(message.requestId || crypto.randomUUID()), workflow: message.workflow, applicationId: String(message.payload?.applicationId || ''), businessName: String(message.payload?.businessName || ''), ein: String(message.payload?.ein || ''), accessToken: String(message.payload?.accessToken || ''), status: 'starting', createdAt: Date.now() };
  if (!job.applicationId || !job.businessName || !job.accessToken) throw new Error('The selected UEZ application is incomplete.');
  if (job.workflow === 'tax_clearance' || job.workflow === 'pbs_login') {
    const result = await api(job, `/api/uez/applications/${job.applicationId}/credentials/mynj`);
    if (!result.exists || !result.credentials) throw new Error('MyNJ / PBS login information is missing.');
    job.credentials = result.credentials;
  }
  const incognitoAllowed = await isIncognitoAllowed();
  if (!incognitoAllowed) {
    throw new Error('COR workflows require Incognito access. Open chrome://extensions, choose COR UEZ Document Helper → Details, turn on Allow in Incognito, then try again.');
  }
  await setJob(job);
  const url = job.workflow === 'brc'
    ? 'https://www1.state.nj.us/TYTR_BRC/jsp/BRCLoginJsp.jsp'
    : job.workflow === 'tax_clearance' || job.workflow === 'pbs_login'
      ? 'https://www16.state.nj.us/NJ_PREMIER_EBIZ/jsp/home.jsp'
      : job.workflow === 'pbs_signup'
        ? 'https://www-njlib.nj.gov/NJ_PREMIER_EBIZ/'
      : job.workflow === 'ldc_jotform'
        ? 'https://form.jotform.com/241936732268060'
        : 'https://form.jotform.com/222748639284165';
  let popup;
  try {
    popup = await chrome.windows.create({ url: 'about:blank', type: 'popup', incognito: true, width: 1200, height: 900, focused: true });
  } catch (error) {
    await setJob(null);
    throw new Error('COR could not open a clean Incognito window. In chrome://extensions → COR UEZ Document Helper → Details, turn on Allow in Incognito, then try again.');
  }
  const tab = popup.tabs?.[0];
  if (!tab?.id) {
    if (popup.id) await chrome.windows.remove(popup.id).catch(() => {});
    await setJob(null);
    throw new Error('COR could not create the clean Incognito workflow tab.');
  }
  job = { ...job, tabId: tab.id, windowId: popup.id, incognito: true };
  await setJob(job);
  try {
    await clearIncognitoWorkflowCookies(tab.id);
    await chrome.tabs.update(tab.id, { url });
  } catch (error) {
    if (popup.id) await chrome.windows.remove(popup.id).catch(() => {});
    await setJob(null);
    throw error;
  }
  const openingStatus = job.workflow === 'brc' ? 'opening_brc' : (job.workflow === 'tax_clearance' || job.workflow === 'pbs_login') ? 'opening_pbs' : job.workflow === 'pbs_signup' ? 'opening_pbs_signup' : job.workflow === 'ldc_jotform' ? 'opening_ldc_form' : 'opening_lakewood_portal';
  await notify(job, openingStatus);
  return { ok: true, jobId: job.id };
}

async function injectNjHelper(tabId) {
  const job = await getJob().catch(() => null);
  const file = job?.workflow === 'pbs_signup' ? 'pbs.js' : 'content.js';
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [file] }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'COR_UEZ_PING') return { ok: true, version: chrome.runtime.getManifest().version };
    if (message?.type === 'COR_UEZ_START') return startWorkflow(message, sender);
    const job = await getJob();
    if (!job) return { ok: false, error: 'No COR workflow is active.' };
    if (message?.type === 'COR_NJ_GET_JOB') return { ok: true, job: { id: job.id, workflow: job.workflow, applicationId: job.applicationId, businessName: job.businessName, ein: job.ein, status: job.status, credentials: job.credentials || null } };
    if (message?.type === 'COR_PBS_GET_DATA') {
      if (job.workflow !== 'pbs_signup' || String(message.jobId || '') !== job.id) return { ok: false, error: 'No matching PBS workflow is active.' };
      const detail = await api(job, `/api/uez/admin/applications/${job.applicationId}`);
      const application = detail.application || {};
      const owner = detail.owners?.[0] || {};
      const credentialResult = await api(job, `/api/uez/applications/${job.applicationId}/credentials/mynj`);
      if (!credentialResult.exists || !credentialResult.credentials) throw new Error('MyNJ login information is missing.');
      const einDigits = String(application.ein || '').replace(/\D/g, '').slice(0, 9);
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
    if (message?.type === 'COR_JOTFORM_GET_DATA') {
      if (job.workflow !== 'ldc_jotform' || String(message.jobId || '') !== job.id) return { ok: false, error: 'No matching LDC form workflow is active.' };
      const detail = await api(job, `/api/uez/admin/applications/${job.applicationId}`);
      return { ok: true, detail };
    }
    if (message?.type === 'COR_LAKEWOOD_GET_DATA') {
      if (job.workflow !== 'lakewood_portal' || String(message.jobId || '') !== job.id) return { ok: false, error: 'No matching Lakewood grant workflow is active.' };
      const detail = await api(job, `/api/uez/admin/applications/${job.applicationId}`);
      const application = detail.application || {};
      const owners = detail.owners || [];
      const primary = owners[0] || {};
      return {
        ok: true,
        detail: {
          application: {
            businessName: application.registered_business_name || application.brc_registered_name || application.business_name_input || '',
            businessPhone: application.contact_phone || primary.phone || '',
            businessEmail: application.contact_email || primary.email || '',
            addressLine1: application.address_line1 || '',
            addressLine2: application.address_line2 || '',
            city: application.city || '',
            state: application.state || 'NJ',
            zip: application.zip || ''
          },
          contact: {
            firstName: primary.firstName || '',
            lastName: primary.lastName || '',
            phone: primary.phone || application.contact_phone || '',
            email: primary.email || application.contact_email || ''
          },
          documents: (detail.documents || []).map((doc) => ({
            id: doc.id,
            documentType: doc.document_type,
            filename: doc.filename,
            createdAt: doc.created_at
          }))
        }
      };
    }
    if (message?.type === 'COR_LAKEWOOD_GET_DOCUMENT') {
      if (job.workflow !== 'lakewood_portal' || String(message.jobId || '') !== job.id) return { ok: false, error: 'No matching Lakewood grant workflow is active.' };
      const documentId = String(message.documentId || '');
      const signed = await api(job, `/api/uez/applications/${job.applicationId}/documents/${encodeURIComponent(documentId)}/url`);
      const response = await fetch(signed.url);
      if (!response.ok) throw new Error(`COR could not download ${signed.filename || 'the document'}.`);
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      return {
        ok: true,
        base64: btoa(binary),
        filename: signed.filename || 'document',
        mimeType: response.headers.get('content-type') || 'application/octet-stream'
      };
    }
    if (message?.type === 'COR_LAKEWOOD_SUBMITTED') {
      if (job.workflow !== 'lakewood_portal' || String(message.jobId || '') !== job.id) return { ok: false, error: 'No matching Lakewood grant workflow is active.' };
      await api(job, `/api/uez/admin/applications/${job.applicationId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'grant_submitted',
          label: 'Grant application submitted',
          message: 'The Lakewood UEZ Technology Grant application was submitted successfully.'
        })
      });
      await notify(job, 'complete');
      if (job.windowId) setTimeout(() => chrome.windows.remove(job.windowId).catch(() => {}), 1800);
      await setJob(null);
      return { ok: true };
    }
    if (message?.type === 'COR_PBS_LOGIN_COMPLETE') {
      if (job.workflow !== 'pbs_login' || String(message.jobId || '') !== job.id) return { ok: false, error: 'No matching PBS login workflow is active.' };
      await notify(job, 'complete');
      await setJob(null);
      return { ok: true };
    }
    if (message?.type === 'COR_PBS_NEEDS_ATTENTION') {
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
    if (message?.type === 'COR_NJ_STATUS') { await notify(job, message.status || job.status); return { ok: true }; }
    if (message?.type === 'COR_BRC_NOT_FOUND') {
      await api(job, `/api/uez/admin/applications/${job.applicationId}/brc-not-found`, { method: 'POST' });
      await notify(job, 'not_found');
      if (job.windowId) setTimeout(() => chrome.windows.remove(job.windowId).catch(() => {}), 1500);
      await setJob(null);
      return { ok: true };
    }
    if (message?.type === 'COR_BRC_CAPTURE_REQUEST') {
      if (job.workflow !== 'brc') return { ok: false, error: 'No matching BRC workflow is active.' };
      await notify(job, 'saving_brc');
      try {
        const windowId = sender.tab?.windowId || job.windowId;
        if (!windowId) throw new Error('COR could not identify the BRC browser window.');
        const screenshotBase64 = await cropVisibleTabCapture(windowId, message.rect, message.viewport);
        await api(job, `/api/uez/brc/${job.applicationId}/admin/captured-certificate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ result: message.result, screenshotBase64 })
        });
        await notify(job, 'complete');
        if (job.windowId) setTimeout(() => chrome.windows.remove(job.windowId).catch(() => {}), 1200);
        await setJob(null);
        return { ok: true };
      } catch (err) {
        await fail(job, err);
        await setJob(null);
        return { ok: false, error: err.message };
      }
    }
    if (message?.type === 'COR_BRC_FOUND') {
      await notify(job, 'saving_brc');
      try {
        await api(job, `/api/uez/brc/${job.applicationId}/admin/captured-certificate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ result: message.result, html: message.html }) });
        await notify(job, 'complete');
        if (job.windowId) setTimeout(() => chrome.windows.remove(job.windowId).catch(() => {}), 1500);
      } catch (err) {
        await fail(job, err);
      }
      await setJob(null);
      return { ok: true };
    }
    if (message?.type === 'COR_TAX_ISSUE_CAPTURE_REQUEST') {
      if (job.workflow !== 'tax_clearance' || String(message.jobId || '') !== job.id) return { ok: false, error: 'No matching tax-clearance workflow is active.' };
      await notify(job, 'capturing_tax_issue');
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(job.windowId, { format: 'png' });
        const base64 = String(dataUrl || '').split(',')[1] || '';
        if (!base64) throw new Error('COR could not capture the New Jersey tax-clearance error.');
        await notify(job, 'sending_tax_issue_email');
        await reportTaxClearanceIssue(job, base64);
        await notify(job, 'complete', { taxIssue: true });
        if (job.windowId) setTimeout(() => chrome.windows.remove(job.windowId).catch(() => {}), 1800);
      } catch (err) {
        await fail(job, err);
      }
      await setJob(null);
      return { ok: true };
    }
    if (message?.type === 'COR_TAX_PDF') {
      await notify(job, 'uploading_tax_clearance');
      try {
        await uploadTaxPdf(job, message.base64, message.filename);
        await notify(job, 'complete');
        if (job.windowId) setTimeout(() => chrome.windows.remove(job.windowId).catch(() => {}), 1500);
      } catch (err) {
        await fail(job, err);
      }
      await setJob(null);
      return { ok: true };
    }
    if (message?.type === 'COR_LDC_PDF') {
      if (job.workflow !== 'ldc_jotform' || String(message.jobId || '') !== job.id) return { ok: false, error: 'No matching LDC form workflow is active.' };
      await notify(job, 'uploading_ldc_application');
      try {
        await uploadLdcPdf(job, message.base64, message.filename, message.submissionId);
        await notify(job, 'complete', { submissionId: message.submissionId || null });
        if (job.windowId) setTimeout(() => chrome.windows.remove(job.windowId).catch(() => {}), 1800);
      } catch (err) {
        await fail(job, err);
      }
      await setJob(null);
      return { ok: true };
    }
    if (message?.type === 'COR_NJ_ERROR') { await fail(job, new Error(message.error || 'New Jersey returned an error.')); return { ok: true }; }
    return { ok: false };
  })().then(sendResponse).catch(async (error) => {
    const job = await getJob().catch(() => null);
    if (job) await fail(job, error).catch(() => {});
    sendResponse({ ok: false, error: error.message || 'The COR extension failed.' });
  });
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  const host = new URL(tab.url).hostname.toLowerCase();
  if (host.includes('nj.us') || host.includes('nj.gov')) {
    const job = await getJob();
    if (!job) return;
    await injectNjHelper(tabId).catch(() => {});
  }
});
