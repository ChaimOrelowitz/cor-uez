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

async function startWorkflow(message, sender) {
  const senderOrigin = sender.tab?.url ? new URL(sender.tab.url).origin : '';
  if (!isAllowedOrigin(senderOrigin)) throw new Error('Open this helper from the COR UEZ admin app.');
  if (!['brc', 'tax_clearance', 'ldc_jotform'].includes(message.workflow)) throw new Error('Unknown COR workflow.');
  const existing = await getJob();
  if (existing && Date.now() - (existing.createdAt || 0) < 30 * 60 * 1000 && existing.status !== 'complete' && existing.status !== 'error') {
    throw new Error('A COR document retrieval is already running. Finish it first.');
  }
  await setJob(null);

  let job = { id: String(message.requestId || crypto.randomUUID()), workflow: message.workflow, applicationId: String(message.payload?.applicationId || ''), businessName: String(message.payload?.businessName || ''), ein: String(message.payload?.ein || ''), accessToken: String(message.payload?.accessToken || ''), status: 'starting', createdAt: Date.now() };
  if (!job.applicationId || !job.businessName || !job.accessToken) throw new Error('The selected UEZ application is incomplete.');
  if (job.workflow === 'tax_clearance') {
    const result = await api(job, `/api/uez/applications/${job.applicationId}/credentials/mynj`);
    if (!result.exists || !result.credentials) throw new Error('MyNJ / PBS login information is missing.');
    job.credentials = result.credentials;
  }
  await setJob(job);
  const url = job.workflow === 'brc'
    ? 'https://www1.state.nj.us/TYTR_BRC/jsp/BRCLoginJsp.jsp'
    : job.workflow === 'tax_clearance'
      ? 'https://www16.state.nj.us/NJ_PREMIER_EBIZ/jsp/home.jsp'
      : 'https://form.jotform.com/241936732268060';
  const popup = await chrome.windows.create({ url, type: 'popup', width: 1200, height: 900, focused: true });
  const tab = popup.tabs?.[0];
  job = { ...job, tabId: tab?.id || null, windowId: popup.id };
  const openingStatus = job.workflow === 'brc' ? 'opening_brc' : job.workflow === 'tax_clearance' ? 'opening_pbs' : 'opening_ldc_form';
  await notify(job, openingStatus);
  if (tab?.id && job.workflow !== 'ldc_jotform') await injectNjHelper(tab.id).catch(() => {});
  return { ok: true, jobId: job.id };
}

async function injectNjHelper(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'COR_UEZ_PING') return { ok: true, version: chrome.runtime.getManifest().version };
    if (message?.type === 'COR_UEZ_START') return startWorkflow(message, sender);
    const job = await getJob();
    if (!job) return { ok: false, error: 'No COR workflow is active.' };
    if (message?.type === 'COR_NJ_GET_JOB') return { ok: true, job: { id: job.id, workflow: job.workflow, applicationId: job.applicationId, businessName: job.businessName, ein: job.ein, status: job.status, credentials: job.credentials || null } };
    if (message?.type === 'COR_JOTFORM_GET_DATA') {
      if (job.workflow !== 'ldc_jotform' || String(message.jobId || '') !== job.id) return { ok: false, error: 'No matching LDC form workflow is active.' };
      const detail = await api(job, `/api/uez/admin/applications/${job.applicationId}`);
      return { ok: true, detail };
    }
    if (message?.type === 'COR_NJ_STATUS') { await notify(job, message.status || job.status); return { ok: true }; }
    if (message?.type === 'COR_BRC_NOT_FOUND') {
      await api(job, `/api/uez/admin/applications/${job.applicationId}/brc-not-found`, { method: 'POST' });
      await notify(job, 'not_found');
      if (job.windowId) setTimeout(() => chrome.windows.remove(job.windowId).catch(() => {}), 1500);
      await setJob(null);
      return { ok: true };
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
