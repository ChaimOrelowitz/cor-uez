const API_BASE = 'https://cor-uez-api.onrender.com';
const APP_URLS = ['https://cor-uez.vercel.app/*', 'https://uez.corsolutions.io/*'];
const ACTIVE_JOB_KEY = 'corUezActiveJob';

async function getJob() { return (await chrome.storage.session.get(ACTIVE_JOB_KEY))[ACTIVE_JOB_KEY] || null; }
async function setJob(job) { if (job) await chrome.storage.session.set({ [ACTIVE_JOB_KEY]: job }); else await chrome.storage.session.remove(ACTIVE_JOB_KEY); }

async function api(job, path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { Authorization: `Bearer ${job.accessToken}`, ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `UEZ returned ${response.status}.`);
  return data;
}

async function notify(job, status, extra = {}) {
  const updated = { ...job, status, updatedAt: Date.now() };
  await setJob(updated);
  const tabs = await chrome.tabs.query({ url: APP_URLS });
  await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { source: 'cor-uez-background', type: 'COR_UEZ_STATUS', jobId: updated.id, workflow: updated.workflow, status, ...extra }).catch(() => {})));
  return updated;
}

async function fail(job, error) {
  await notify(job, 'error', { error: error?.message || String(error || 'The document retrieval did not finish.') });
  await setJob(null);
}

async function uploadTaxPdf(job, base64, filename) {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const body = new FormData();
  body.append('documentType', 'tax_clearance');
  body.append('file', new Blob([bytes], { type: 'application/pdf' }), filename || 'NJ-Tax-Clearance.pdf');
  await api(job, `/api/uez/applications/${job.applicationId}/documents`, { method: 'POST', body });
}

async function startWorkflow(message, sender) {
  const senderOrigin = sender.tab?.url ? new URL(sender.tab.url).origin : '';
  if (!['https://cor-uez.vercel.app', 'https://uez.corsolutions.io'].includes(senderOrigin)) throw new Error('Open this helper from the COR UEZ admin app.');
  if (!['brc', 'tax_clearance'].includes(message.workflow)) throw new Error('Unknown COR workflow.');
  const existing = await getJob();
  if (existing && Date.now() - existing.createdAt < 30 * 60 * 1000) throw new Error('A COR document retrieval is already running. Finish it first.');
  if (existing) await setJob(null);

  let job = { id: String(message.requestId || crypto.randomUUID()), workflow: message.workflow, applicationId: String(message.payload?.applicationId || ''), businessName: String(message.payload?.businessName || ''), ein: String(message.payload?.ein || ''), accessToken: String(message.payload?.accessToken || ''), status: 'starting', createdAt: Date.now() };
  if (!job.applicationId || !job.businessName || !job.accessToken) throw new Error('The selected UEZ application is incomplete.');
  if (job.workflow === 'tax_clearance') {
    const result = await api(job, `/api/uez/applications/${job.applicationId}/credentials/mynj`);
    if (!result.exists || !result.credentials) throw new Error('MyNJ / PBS login information is missing.');
    job.credentials = result.credentials;
  }
  await setJob(job);
  const url = job.workflow === 'brc' ? 'https://www1.state.nj.us/TYTR_BRC/jsp/BRCLoginJsp.jsp' : 'https://www16.state.nj.us/NJ_PREMIER_EBIZ/jsp/home.jsp';
  const tab = await chrome.tabs.create({ url, active: true });
  job = { ...job, tabId: tab.id };
  await notify(job, job.workflow === 'brc' ? 'opening_brc' : 'opening_pbs');
  return { ok: true, jobId: job.id };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'COR_UEZ_PING') return { ok: true, version: chrome.runtime.getManifest().version };
    if (message?.type === 'COR_UEZ_START') return startWorkflow(message, sender);
    const job = await getJob();
    if (!job) return { ok: false, error: 'No COR workflow is active.' };
    if (message?.type === 'COR_NJ_GET_JOB') return { ok: true, job: { id: job.id, workflow: job.workflow, applicationId: job.applicationId, businessName: job.businessName, ein: job.ein, status: job.status, credentials: job.credentials || null } };
    if (message?.type === 'COR_NJ_STATUS') { await notify(job, message.status || job.status); return { ok: true }; }
    if (message?.type === 'COR_BRC_NOT_FOUND') {
      await api(job, `/api/uez/admin/applications/${job.applicationId}/brc-not-found`, { method: 'POST' });
      await notify(job, 'not_found'); await setJob(null); return { ok: true };
    }
    if (message?.type === 'COR_BRC_FOUND') {
      await notify(job, 'saving_brc');
      await api(job, `/api/uez/brc/${job.applicationId}/admin/captured-certificate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ result: message.result, html: message.html }) });
      await notify(job, 'complete'); await setJob(null); return { ok: true };
    }
    if (message?.type === 'COR_TAX_PDF') {
      await notify(job, 'uploading_tax_clearance');
      await uploadTaxPdf(job, message.base64, message.filename);
      await notify(job, 'complete'); await setJob(null); return { ok: true };
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
