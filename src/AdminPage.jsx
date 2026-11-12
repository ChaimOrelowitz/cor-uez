import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addAdminCaseNote,
  createAdminMyNjCredentials,
  deleteAdminCaseNote,
  deleteDocument,
  getAdminApplication,
  getAdminApplications,
  getAdminEmailPreview,
  getApplicantSession,
  getDocumentUrl,
  getMyNjCredentials,
  deleteAdminApplication,
  markAdminBrcFound,
  markAdminBrcNotFound,
  markAdminPbsAccountCreated,
  saveOwners,
  savePbsAccountInfo,
  signInApplicant,
  signOutApplicant,
  updateAdminApplication,
  updateAdminMyNjCredentials,
  updateAdminApplicationStatus,
  updateAdminProcessFlags,
  saveAdminPayment,
  requestAdminPayment,
  reviewAdminDocument,
  sendAdminApplicationEmail,
  updateAdminCaseNote,
  updateAdminProcessStep,
  resetAdminProcessStep,
  uploadApplicationDocument,
  whoAmI
} from './api';
import {
  applicationDraftFrom,
  attentionItems,
  displayBusinessName,
  docsFor,
  documentLabel,
  njTaxId,
  ownerDraftFrom,
  paymentStatusLabel,
  readyDocumentCount
} from './admin/caseLogic';

import AdminSidebar, { groupCounts } from './admin/AdminSidebar';
import EmailComposer from './admin/EmailComposer';
import CaseDetailTabs from './admin/CaseDetailTabs';

// Each business gets its own URL — /admin/businesses/:id — so a refresh (or a
// bookmark, or the back button) lands back on the same business instead of
// whatever the list API happens to return first.
function businessIdFromPath() {
  const match = window.location.pathname.match(/^\/admin\/businesses\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function businessUrl(id) {
  return `/admin/businesses/${encodeURIComponent(id)}`;
}

// Small copy-to-clipboard icon button used next to identity fields (business
// name, EIN, phone) in the case header — briefly swaps to a checkmark so the
// click has visible feedback instead of just trusting the clipboard worked.
function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      className="copy-field-btn"
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(String(value));
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // Clipboard API can be denied/unavailable — silently no-op rather
          // than surfacing an error banner for a convenience button.
        }
      }}
    >
      {copied
        ? <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        : <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>}
    </button>
  );
}

export default function AdminPage() {
  const [session, setSession] = useState(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('adminDarkMode') === '1');
  const [profile, setProfile] = useState(null);
  const [login, setLogin] = useState({ email: '', password: '' });
  const [applications, setApplications] = useState([]);
  const applicationCounts = useMemo(() => groupCounts(applications), [applications]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessageText] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);
  // The one Chrome-extension automation in flight, if any. Tracked per job
  // instead of the global `busy` so the rest of the admin stays usable while
  // NJ's captcha sits there - and so a job finishing doesn't yank the view
  // back to the case it was started on.
  const [runningJob, setRunningJob] = useState(null);
  const selectedIdRef = useRef(null);
  const emailSentCallbackRef = useRef(null);
  const [pbsAnswerDraft, setPbsAnswerDraft] = useState('');
  const [pbsLoginDraft, setPbsLoginDraft] = useState({ username: '', password: '' });
  const [editMode, setEditMode] = useState(false);
  const [applicationDraft, setApplicationDraft] = useState(null);
  const [ownerDrafts, setOwnerDrafts] = useState([]);
  const [myNjCredentials, setMyNjCredentials] = useState(null);
  const [myNjEditMode, setMyNjEditMode] = useState(false);
  const [myNjDraft, setMyNjDraft] = useState(null);
  const [showMyNjSecrets, setShowMyNjSecrets] = useState(false);
  const [brcForm, setBrcForm] = useState({ registeredBusinessName: '', tradeName: '', address: '' });
  const [paymentDraft, setPaymentDraft] = useState({ amount: '500', paymentDate: new Date().toISOString().slice(0,10), paymentMethod: 'Zelle', reference: '', notes: '' });
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [manualDocType, setManualDocType] = useState('supporting');
  const [manualDocFile, setManualDocFile] = useState(null);
  const [manualDocUploading, setManualDocUploading] = useState(false);
  const [directUploadType, setDirectUploadType] = useState('');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  // Applications list: docked beside the case on wide screens (>=1280px) by
  // default, remembered per browser; below that, or when undocked, it's the
  // overlay drawer that `sidebarOpen` controls.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarDocked, setSidebarDocked] = useState(() => {
    try { return localStorage.getItem('adminSidebarDocked') !== '0'; } catch { return true; }
  });
  const [noteDraft, setNoteDraft] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteEditingId, setNoteEditingId] = useState(null);
  const [noteEditDraft, setNoteEditDraft] = useState('');
  const [emailComposer, setEmailComposer] = useState(null);

  function setMessage(text) {
    setMessageText(text);
    setMessageIsError(false);
  }

  function showError(text) {
    setMessageText(text);
    setMessageIsError(true);
  }

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // Results fade on their own; errors, and progress while something is still
  // running, stay until replaced or dismissed.
  useEffect(() => {
    if (!message || messageIsError || busy || runningJob) return undefined;
    const timer = window.setTimeout(() => setMessageText(''), 5000);
    return () => window.clearTimeout(timer);
  }, [message, messageIsError, busy, runningJob]);

  useEffect(() => {
    let active = true;
    getApplicantSession().then(async (current) => {
      if (!active) return;
      if (current) {
        setSession(current);
        await bootstrap();
      }
    }).catch(() => {}).finally(() => { if (active) setAuthResolved(true); });
    return () => { active = false; };
  }, []);

  // Back/forward between /admin/businesses/:id URLs switches businesses —
  // openApplication() only replaces the URL, so this is the only path that
  // needs to react to the browser's own navigation.
  useEffect(() => {
    function onPopState() {
      const id = businessIdFromPath();
      if (id && id !== selectedId) openApplication(id);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // No blind interval here on purpose — every mutation already calls refreshList()
  // itself with the exact result of what just happened, so a timer re-fetching
  // everything every few seconds was only ever fighting whatever you were doing
  // (typing a note, editing a field) and making the page feel unstable. The one
  // case a timer doesn't cover — something changed outside this tab (another
  // admin, an applicant upload, an extension callback landing late) — is handled
  // by refreshing once when you come back to the tab, not by polling while you're on it.
  // Auto-promote to "Ready for Submission" when all 5 docs are in and admin
  // has confirmed payment — only nudges forward (never demotes a submitted app).
  useEffect(() => {
    if (!detail) return;
    const status = detail.application?.status;
    const safeStatuses = ['applied', 'grant_submitted', 'submitted', 'ready_for_submission', 'cancelled'];
    if (safeStatuses.includes(status)) return;
    const allDocs = readyDocumentCount(detail) >= 5;
    const adminPaid = detail.application?.payment_status === 'paid';
    if (allDocs && adminPaid) {
      setGlobalStatus('ready_for_submission');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.application?.status, detail?.application?.payment_status, detail?.documents]);

  useEffect(() => {
    if (!session || profile?.role !== 'admin') return undefined;
    let active = true;
    const refresh = async () => {
      if (!active || document.visibilityState !== 'visible' || busy || editMode || myNjEditMode || previewDoc || noteEditingId) return;
      try {
        const rows = await getAdminApplications();
        if (!active) return;
        setApplications(rows || []);
        if (selectedId) {
          const data = await getAdminApplication(selectedId);
          if (active) setDetail(data);
        }
      } catch (_) {}
    };
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [session, profile?.role, selectedId, busy, editMode, myNjEditMode, previewDoc, noteEditingId]);

  async function bootstrap() {
    setBusy(true);
    setMessage('');
    try {
      const me = await whoAmI();
      setProfile(me);
      if (me.role !== 'admin') throw new Error('This account does not have UEZ admin access.');
      await refreshList(businessIdFromPath());
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshList(preferredId) {
    const rows = await getAdminApplications();
    setApplications(rows || []);
    const id = preferredId || selectedId || rows?.[0]?.id;
    return id ? await openApplication(id) : null;
  }

  // Refreshes after something finished for `applicationId` - the list always,
  // the open case only if it's still the one on screen. Background jobs use
  // this so finishing one never switches the view out from under you.
  async function refreshCase(applicationId) {
    const rows = await getAdminApplications();
    setApplications(rows || []);
    if (selectedIdRef.current === applicationId) {
      const data = await getAdminApplication(applicationId);
      if (selectedIdRef.current === applicationId) setDetail(data);
    }
  }

  // Shared wrapper for every Chrome-extension automation: one at a time, the
  // case is captured up front, and results/errors are labelled with the
  // business so they still make sense if you've moved to another case.
  async function runJob(label, work) {
    if (runningJob) return showError(`${runningJob.label} is still running for ${runningJob.name}. Finish or close it first.`);
    const application = detail.application;
    const name = displayBusinessName(application);
    setRunningJob({ label, name, applicationId: application.id });
    setMessage('Starting the COR Chrome extension…');
    try {
      const currentSession = await getApplicantSession();
      if (!currentSession?.access_token) throw new Error(`Please sign in again before running ${label}.`);
      const result = await work(application, currentSession.access_token);
      if (result) setMessage(`${name}: ${result}`);
    } catch (err) {
      showError(`${name}: ${err.message}`);
    } finally {
      setRunningJob(null);
    }
  }

  async function openApplication(id) {
    setSelectedId(id);
    setMessage('');
    // Keep the URL in sync with whatever business is actually loaded — a plain
    // correction (replaceState), not a new history entry. selectApplication()
    // below pushes a real entry for deliberate sidebar clicks.
    const url = businessUrl(id);
    if (window.location.pathname !== url) window.history.replaceState(null, '', url);
    try {
      const data = await getAdminApplication(id);
      setDetail(data);
      const myNj = await getMyNjCredentials(id).catch(() => ({ exists: false, credentials: null }));
      setMyNjCredentials(myNj.exists ? myNj.credentials : null);
      setMyNjDraft(myNj.exists ? myNj.credentials : null);
      setMyNjEditMode(false);
      setShowMyNjSecrets(false);
      const app = data.application;
      setApplicationDraft(applicationDraftFrom(app));
      setOwnerDrafts((data.owners || []).map(ownerDraftFrom));
      setEditMode(false);
      const brc = app.brc_data || {};
      setBrcForm({
        registeredBusinessName: app.brc_registered_name || app.registered_business_name || app.business_name_input || '',
        tradeName: brc.tradeName || '',
        address: brc.address || ''
      });
      const latestPayment = [...(data.payments || [])].reverse()[0];
      setPaymentDraft({
        amount: String(latestPayment?.amount ?? app.payment_expected_amount ?? 500),
        paymentDate: latestPayment?.payment_date || new Date().toISOString().slice(0,10),
        paymentMethod: latestPayment?.payment_method || 'Zelle', reference: latestPayment?.reference || '', notes: latestPayment?.notes || ''
      });
      return data;
    } catch (err) {
      showError(err.message);
      return null;
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const auth = await signInApplicant(login.email.trim(), login.password);
      setSession(auth.session || null);
      await bootstrap();
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await signOutApplicant();
    window.location.href = '/admin';
  }

  async function previewDocument(doc) {
    if (!doc) return;
    setPreviewDoc(doc);
    setPreviewUrl('');
    setPreviewBusy(true);
    try {
      const result = await getDocumentUrl(detail.application.id, doc.id);
      setPreviewUrl(result.url);
    } catch (err) {
      showError(err.message);
      setPreviewDoc(null);
    } finally { setPreviewBusy(false); }
  }

  function closePreview() {
    setPreviewDoc(null);
    setPreviewUrl('');
    setPreviewBusy(false);
  }

  async function reviewPreviewDoc(result) {
    if (!previewDoc) return;
    setBusy(true);
    setMessage(result === 'approved' ? 'Approving document…' : 'Marking document as wrong…');
    try {
      await reviewAdminDocument(detail.application.id, previewDoc.id, result);
      await refreshList(detail.application.id);
      setMessage(result === 'approved' ? 'Document approved.' : 'Document marked as wrong.');
      closePreview();
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Approve or reject the formation doc directly from the inline preview —
  // same API call as reviewPreviewDoc but without requiring the modal.
  async function reviewFormationDoc(decision) {
    const formation = [...(detail?.documents || [])].reverse().find((d) => d.document_type === 'formation');
    if (!formation) return;
    setBusy(true);
    setMessage(decision === 'approved' ? 'Approving formation document…' : 'Marking formation document as wrong…');
    try {
      await reviewAdminDocument(detail.application.id, formation.id, decision);
      await refreshList(detail.application.id);
      setMessage(decision === 'approved' ? '✓ Formation document approved.' : 'Marked wrong — send the replacement request email below.');
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openDoc(doc) {
    try {
      const result = await getDocumentUrl(detail.application.id, doc.id);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      showError(err.message);
    }
  }

  async function handleDeleteDoc(doc) {
    if (!window.confirm(`Permanently delete "${doc.filename}"?`)) return;
    setBusy(true);
    setMessage(`Deleting ${doc.filename}…`);
    try {
      await deleteDocument(detail.application.id, doc.id);
      await refreshList(detail.application.id);
      setMessage(`Deleted ${doc.filename}.`);
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Deletes whichever document the preview modal is currently showing, then
  // hops to the next document of that same type (or the previous one, or
  // just closes) so deleting doesn't dump the admin back out to the list.
  async function deletePreviewDoc() {
    if (!previewDoc) return;
    if (!window.confirm(`Permanently delete "${previewDoc.filename}"?`)) return;
    const type = previewDoc.document_type;
    const gallery = docsFor(detail, type);
    const idx = gallery.findIndex((d) => d.id === previewDoc.id);
    setBusy(true);
    setMessage(`Deleting ${previewDoc.filename}…`);
    try {
      await deleteDocument(detail.application.id, previewDoc.id);
      const refreshed = await refreshList(detail.application.id);
      const remaining = refreshed ? docsFor(refreshed, type) : [];
      if (remaining.length) previewDocument(remaining[Math.min(idx, remaining.length - 1)]);
      else closePreview();
      setMessage('Document deleted.');
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Uploads straight into a specific document-type slot on a step panel
  // (e.g. the Formation tab's doc container), skipping the generic "pick a
  // type from a dropdown" uploader in the case-file drawer.
  async function uploadDocumentDirect(docType, file) {
    if (!file) return;
    setDirectUploadType(docType);
    setMessage('Uploading document…');
    try {
      await uploadApplicationDocument(detail.application.id, docType, file);
      await refreshList(detail.application.id);
      setMessage('Document added to the applicant file.');
    } catch (err) {
      showError(err.message);
    } finally {
      setDirectUploadType('');
    }
  }

  async function runExtensionWorkflow(workflow, payload) {
    const statusMessages = {
      starting: 'Starting the COR Chrome extension…',
      nj_page_open: 'The COR extension is active on the New Jersey page…',
      opening_brc: 'Opening the New Jersey BRC lookup…',
      waiting_for_verification: 'Complete the NJ verification in the checker window. UEZ will import the result automatically.',
      saving_brc: "BRC found. Creating and saving the applicant's PDF…",
      opening_pbs: 'Opening New Jersey PBS…',
      opening_mynj_login: 'Opening the MyNJ login…',
      signing_in_to_pbs: 'Signing into PBS with the stored MyNJ login…',
      opening_tax_revenue_center: 'Opening Tax & Revenue Center…',
      waiting_for_human_verification: "Complete New Jersey's verification in the visible PBS window.",
      requesting_tax_clearance_pdf: 'Selecting the Department of Community Affairs and requesting the letter…',
      uploading_tax_clearance: "Tax clearance received. Adding it directly to the applicant's UEZ file…",
      capturing_tax_issue: 'NJ reported a tax-clearance problem. Capturing the error screenshot…',
      sending_tax_issue_email: 'Saving the screenshot and emailing the client the tax-clearance instructions…',
      opening_ldc_form: 'Opening the Lakewood LDC incentive application…',
      filling_ldc_form: 'COR is filling the Lakewood LDC application…',
      starting_ldc_sign: 'Opening JotForm Sign so the required signature can be added…',
      waiting_for_signature: 'Application filled. Add the required signature in the JotForm popup.',
      generating_ldc_preview: 'Signature received. Generating the JotForm PDF preview…',
      waiting_for_final_submit: 'Review the generated application and click the final Submit button in JotForm.',
      downloading_ldc_pdf: "Application submitted. Downloading JotForm's signed PDF…",
      uploading_ldc_application: 'Saving the signed LDC application PDF to this UEZ file…',
      opening_lakewood_portal: 'Opening the Lakewood UEZ grant application…',
      filling_lakewood_portal: 'COR is filling the Lakewood grant application…',
      attaching_lakewood_documents: 'COR is attaching the required grant documents…',
      waiting_for_lakewood_submit: 'Grant packet ready. Review it and click the final Submit Form button.',
      opening_pbs_signup: 'Opening New Jersey Premier Business Services…',
      pbs_opening_identification: 'Starting the PBS account setup…',
      pbs_filling_contact: 'COR is filling the PBS contact information…',
      pbs_creating_mynj: "Creating the applicant's myNewJersey login…",
      pbs_account_opened: 'PBS account opened. Moving to Add a Business…',
      pbs_opening_business_information: 'Opening PBS Business Information…',
      waiting_for_pbs_business_type: 'COR filled the PBS business information. Select Business Type in the NJ window, then click Continue.',
      waiting_for_pbs_verification: "Complete New Jersey's security verification in the visible PBS window.",
      waiting_for_pbs_human_step: 'COR reached a PBS step that was not completed in the HAR. Review and continue manually.',
      waiting_for_pbs_page: 'Waiting for the next PBS page…',
      pbs_needs_attention: 'PBS needs your attention in the visible NJ window.',
      opening_uez_application: 'Opening the NJ UEZ Certification Application…',
      saving_uez_application: 'Capturing the UEZ application page…',
      uploading_uez_application: "Saving the captured page as the pending certificate…"
    };
    const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    return new Promise((resolve, reject) => {
      let timer = window.setTimeout(() => finish(new Error('The COR Chrome extension is not installed or is not enabled.')), 2500);
      const finish = (error, result) => {
        window.clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (error) reject(error); else resolve(result);
      };
      const onMessage = (event) => {
        if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== 'cor-uez-extension') return;
        const message = event.data;
        if (message.requestId === requestId && message.type === 'COR_UEZ_START_RESULT') {
          if (!message.ok) return finish(new Error(message.error || 'The COR Chrome extension could not start.'));
          window.clearTimeout(timer);
          timer = window.setTimeout(() => finish(new Error('The COR workflow session timed out. Start it again when ready.')), 25 * 60 * 1000);
          return;
        }
        if (message.jobId !== requestId || message.type !== 'COR_UEZ_STATUS') return;
        if (statusMessages[message.status]) setMessage(statusMessages[message.status]);
        if (message.status === 'complete') finish(null, { status: 'complete', taxIssue: Boolean(message.taxIssue), ambiguous: Boolean(message.ambiguous) });
        if (message.status === 'not_found') finish(null, { status: 'not_found' });
        if (message.status === 'error') finish(new Error(message.error || 'The document retrieval did not finish.'));
        // The extension closes this out with status 'cancelled' when the admin
        // closes its popup window before the workflow finished (background.js's
        // chrome.windows.onRemoved listener). Without this branch the promise
        // above never settles, which used to leave `busy` — and the in-progress
        // status message — stuck indefinitely.
        if (message.status === 'cancelled') finish(null, { status: 'cancelled' });
      };
      window.addEventListener('message', onMessage);
      window.postMessage({ source: 'cor-uez-app', type: 'COR_UEZ_START', requestId, workflow, payload }, window.location.origin);
      setMessage('Starting the COR Chrome extension…');
    });
  }

  function runBrcLookup() {
    return runJob('BRC check', async (application, accessToken) => {
      const outcome = await runExtensionWorkflow('brc', {
        applicationId: application.id,
        businessName: application.business_name_input,
        ein: application.ein,
        accessToken
      });
      if (outcome.status === 'cancelled') return 'BRC check window closed before it finished. Nothing was saved — start it again when ready.';
      if (outcome.status === 'not_found') {
        await markAdminBrcNotFound(application.id);
        await refreshCase(application.id);
        return 'NJ did not find a matching BRC — marked as not found automatically.';
      }
      if (outcome.status !== 'complete') throw new Error(outcome.error || 'The BRC check did not finish.');
      await refreshCase(application.id);
      return "BRC confirmed. The PDF and certificate details were added directly to this applicant's UEZ file.";
    });
  }

  function runPbsSignup() {
    const primary = detail.owners?.[0];
    if (!primary) return showError('A primary owner is required before opening PBS.');
    if (!primary.title) return showError('The primary owner needs a title before opening PBS.');
    if (!myNjCredentials) return showError('MyNJ login information is missing. Confirm the BRC and generate the MyNJ login first.');
    return runJob('PBS setup', async (application, accessToken) => {
      const outcome = await runExtensionWorkflow('pbs_signup', {
        applicationId: application.id,
        businessName: application.registered_business_name || application.brc_registered_name || application.business_name_input,
        ein: application.ein,
        accessToken
      });
      if (outcome.status === 'cancelled') return 'PBS setup window closed before it finished. Nothing was saved — start it again when ready.';
      if (outcome.status !== 'complete') throw new Error(outcome.error || 'The PBS workflow did not finish.');
      await refreshCase(application.id);
      return 'PBS account and business setup completed.';
    });
  }

  function runPbsLogin() {
    if (!myNjCredentials) return showError('MyNJ / PBS login information is missing.');
    return runJob('PBS login', async (application, accessToken) => {
      const outcome = await runExtensionWorkflow('pbs_login', {
        applicationId: application.id,
        businessName: application.registered_business_name || application.brc_registered_name || application.business_name_input,
        ein: application.ein,
        accessToken
      });
      if (outcome.status === 'cancelled') return 'PBS login window closed before it finished.';
      if (outcome.status !== 'complete') throw new Error(outcome.error || 'PBS login did not finish.');
      return 'PBS is open and signed in.';
    });
  }

  function runTaxClearance() {
    return runJob('Tax clearance', async (application, accessToken) => {
      const outcome = await runExtensionWorkflow('tax_clearance', {
        applicationId: application.id,
        businessName: application.registered_business_name || application.business_name_input,
        accessToken
      });
      if (outcome.status === 'cancelled') return 'Tax-clearance window closed before it finished. Nothing was saved — start it again when ready.';
      if (outcome.status !== 'complete') throw new Error(outcome.error || 'The tax-clearance download did not finish.');
      await refreshCase(application.id);
      return outcome.taxIssue
        ? 'NJ could not issue the tax clearance. The error screenshot was saved and the client was emailed the follow-up instructions.'
        : "Tax-clearance letter downloaded and added directly to this applicant's UEZ file.";
    });
  }

  async function uploadManualAdminDocument() {
    if (!manualDocFile) { showError('Choose a file to upload.'); return; }
    setManualDocUploading(true);
    setMessage('Uploading document…');
    try {
      await uploadApplicationDocument(detail.application.id, manualDocType, manualDocFile);
      await refreshList(detail.application.id);
      setManualDocFile(null);
      setMessage('Document added to the applicant file.');
    } catch (err) {
      showError(err.message);
    } finally {
      setManualDocUploading(false);
    }
  }

  function runLdcJotform() {
    return runJob('LDC application', async (application, accessToken) => {
      const outcome = await runExtensionWorkflow('ldc_jotform', {
        applicationId: application.id,
        businessName: application.registered_business_name || application.business_name_input,
        accessToken
      });
      if (outcome.status === 'cancelled') return 'LDC application window closed before it finished. Nothing was saved — start it again when ready.';
      if (outcome.status !== 'complete') throw new Error(outcome.error || 'The LDC application workflow did not finish.');
      await refreshCase(application.id);
      return "LDC application submitted. The signed JotForm PDF is saved in this applicant's Documents.";
    });
  }

  function runUezEnrollment() {
    return runJob('UEZ application', async (application, accessToken) => {
      const outcome = await runExtensionWorkflow('uez_enrollment', {
        applicationId: application.id,
        businessName: application.registered_business_name || application.business_name_input,
        accessToken
      });
      if (outcome.status === 'cancelled') return 'UEZ application window closed before it finished. Nothing was saved — start it again when ready.';
      if (outcome.status !== 'complete') throw new Error(outcome.error || 'The UEZ application workflow did not finish.');
      await refreshCase(application.id);
      return 'UEZ Certification Application captured and saved as the pending certificate.';
    });
  }

  function runLakewoodGrantPortal() {
    return runJob('Lakewood grant submission', async (application, accessToken) => {
      const outcome = await runExtensionWorkflow('lakewood_portal', {
        applicationId: application.id,
        businessName: application.registered_business_name || application.business_name_input,
        accessToken
      });
      if (outcome.status === 'cancelled') return 'Lakewood grant window closed before it finished. Nothing was saved — start it again when ready.';
      if (outcome.status !== 'complete') throw new Error(outcome.error || 'The Lakewood grant workflow did not finish.');
      await refreshCase(application.id);
      return outcome.ambiguous
        ? 'COR saw what looks like a successful Lakewood submission, but there was no submission ID to confirm it automatically. Review the confirmation page, then click "Confirm grant submitted" below.'
        : 'Lakewood UEZ Technology Grant submitted successfully.';
    });
  }

  async function confirmGrantSubmitted() {
    const applicationId = detail?.application?.id;
    if (!applicationId) return;
    setBusy(true);
    setMessage('Confirming grant submission…');
    try {
      await updateAdminApplicationStatus(applicationId, {
        status: 'grant_submitted',
        label: 'Grant application submitted',
        message: 'Chaim confirmed the Lakewood UEZ Technology Grant application was submitted.'
      });
      await refreshList(applicationId);
      setMessage('Grant submission confirmed.');
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function updateApplicationDraft(field, value) {
    setApplicationDraft((old) => ({ ...old, [field]: value }));
  }

  function updateOwnerDraft(index, field, value) {
    setOwnerDrafts((old) => old.map((owner, ownerIndex) => (
      ownerIndex === index ? { ...owner, [field]: value } : owner
    )));
  }

  function startEditing() {
    setApplicationDraft(applicationDraftFrom(detail.application));
    setOwnerDrafts((detail.owners || []).map(ownerDraftFrom));
    setMessage('');
    setEditMode(true);
  }

  function cancelEditing() {
    setApplicationDraft(applicationDraftFrom(detail.application));
    setOwnerDrafts((detail.owners || []).map(ownerDraftFrom));
    setMessage('');
    setEditMode(false);
  }

  function addOwner() {
    setOwnerDrafts((old) => [...old, ownerDraftFrom()]);
  }

  function removeOwner(index) {
    if (ownerDrafts.length === 1) {
      showError('An application must keep at least one owner. Delete the application instead if it should be removed entirely.');
      return;
    }
    setOwnerDrafts((old) => old.filter((_, ownerIndex) => ownerIndex !== index));
  }

  async function saveAdminEdits() {
    const ownershipTotal = ownerDrafts.reduce((sum, owner) => sum + (Number(owner.ownershipPercent) || 0), 0);
    if (Math.abs(ownershipTotal - 100) > 0.001) {
      showError(`Ownership percentages must total exactly 100%. They currently total ${ownershipTotal}%.`);
      return;
    }
    if (!applicationDraft.businessName.trim() || !applicationDraft.contactEmail.trim()) {
      showError('Business name and contact email are required.');
      return;
    }
    if (ownerDrafts.some((owner) => !String(owner.title || '').trim())) {
      showError('Choose a title for each owner before saving.');
      return;
    }
    if (!applicationDraft.hasDba || (applicationDraft.hasDba === 'yes' && !applicationDraft.dbaName.trim())) {
      showError('Complete the DBA information before saving.');
      return;
    }

    setBusy(true);
    setMessage('Saving application changes…');
    try {
      await saveOwners(detail.application.id, ownerDrafts);
      await updateAdminApplication(detail.application.id, {
        ...applicationDraft,
        hasDba: applicationDraft.hasDba === 'yes',
        dbaName: applicationDraft.hasDba === 'yes' ? applicationDraft.dbaName : ''
      });
      await refreshList(detail.application.id);
      setEditMode(false);
      setMessage('All applicant and owner changes were saved.');
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteApplication() {
    const confirmation = window.prompt(
      `This permanently deletes ${displayBusinessName(detail.application)}, its owners, documents, and application history. Type DELETE to continue.`
    );
    if (confirmation !== 'DELETE') return;

    setBusy(true);
    setMessage('Deleting the UEZ application…');
    try {
      await deleteAdminApplication(detail.application.id);
      const rows = await getAdminApplications();
      setApplications(rows || []);
      setSelectedId(null);
      setDetail(null);
      setMobileDetailOpen(false);
      setEditMode(false);
      if (rows?.[0]?.id) await openApplication(rows[0].id);
      setMessage("The UEZ application and its documents were permanently deleted. The person's login was not deleted.");
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }


  async function saveExistingPbsAnswer() {
    if (!pbsAnswerDraft) return showError('Choose Yes or No for the PBS account question.');
    if (pbsAnswerDraft === 'yes' && (!pbsLoginDraft.username.trim() || !pbsLoginDraft.password)) return showError('Enter the existing MyNJ username and password.');
    setBusy(true); setMessage('Saving PBS account answer…');
    try {
      await savePbsAccountInfo(detail.application.id, { hasExistingPbsAccount: pbsAnswerDraft === 'yes', username: pbsAnswerDraft === 'yes' ? pbsLoginDraft.username.trim() : '', password: pbsAnswerDraft === 'yes' ? pbsLoginDraft.password : '' });
      await refreshList(detail.application.id);
      setMessage('PBS account answer saved.');
    } catch (err) { showError(err.message); } finally { setBusy(false); }
  }

  async function createMyNjCredentials() {
    setBusy(true);
    setMessage('Creating encrypted MyNJ account information…');
    try {
      const result = await createAdminMyNjCredentials(detail.application.id);
      await refreshList(detail.application.id);
      setMyNjCredentials(result.credentials);
      setShowMyNjSecrets(true);
      setMessage('MyNJ account information is ready for the admin and applicant.');
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveMyNjCredentials() {
    setBusy(true);
    setMessage('Saving encrypted MyNJ account information…');
    try {
      const result = await updateAdminMyNjCredentials(detail.application.id, myNjDraft);
      setMyNjCredentials(result.credentials);
      setMyNjDraft(result.credentials);
      setMyNjEditMode(false);
      setShowMyNjSecrets(true);
      setMessage('MyNJ / PBS login information was updated for the admin and applicant.');
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function markPbsAccountCreated() {
    setBusy(true);
    setMessage('Saving PBS account status…');
    try {
      await markAdminPbsAccountCreated(detail.application.id);
      await refreshList(detail.application.id);
      setMessage('PBS account marked created.');
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyCredential(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied.`);
    } catch (_) {
      showError(`Could not copy ${label.toLowerCase()}. Select it manually.`);
    }
  }

  function changePbsAnswerDraft(value) {
    setPbsAnswerDraft(value);
    if (value === 'no') setPbsLoginDraft({ username: '', password: '' });
  }

  function startMyNjEdit() {
    setMyNjDraft(myNjCredentials);
    setMyNjEditMode(true);
    setShowMyNjSecrets(true);
  }

  function cancelMyNjEdit() {
    setMyNjDraft(myNjCredentials);
    setMyNjEditMode(false);
  }

  function toggleShowMyNjSecrets() {
    setShowMyNjSecrets((shown) => !shown);
  }

  async function saveBrcFound() {
    setBusy(true);
    setMessage('');
    try {
      await markAdminBrcFound(detail.application.id, brcForm);
      await refreshList(detail.application.id);
      setMessage('BRC confirmed and the application was updated.');
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveBrcNotFound() {
    setBusy(true);
    setMessage('');
    try {
      await markAdminBrcNotFound(detail.application.id);
      await refreshList(detail.application.id);
      setMessage('BRC marked not found. COR will handle the follow-up; the applicant is not being asked to upload a BRC.');
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // `onSent` runs only once the email actually goes out - closing the
  // composer without sending leaves the step exactly as it was.
  function sendBrcProblemEmail(onSent) {
    openEmailComposer('brc_not_found', onSent);
  }

  function sendBrcWrongAddressEmail(onSent) {
    openEmailComposer('brc_wrong_address', onSent);
  }

  function sendFormationRejectedEmail(onSent) {
    openEmailComposer('formation_rejected', onSent);
  }

  // The rest of the per-step "send the email for this step" actions, same
  // preview-then-send flow via openEmailComposer/EmailComposer. None of these
  // send automatically (see backend/routes/uez.js) — every one of them is
  // click "Send email" → preview what will actually go out → click Send.
  // The only two emails that still fire on their own are the welcome email
  // (on application submit) and payment_received (on payment confirmation).
  function sendPbsAccountCreatedEmail() {
    openEmailComposer('pbs_account_created');
  }

  function sendPbsExistingAccountEmail(onSent) {
    openEmailComposer('pbs_existing_account', async () => {
      await setProcessFlag('pbsStatus', 'creds_requested');
      await onSent?.();
    });
  }

  function sendTaxIssueEmail() {
    openEmailComposer('tax_issue');
  }

  function sendUezApplicationSubmittedEmail() {
    openEmailComposer('uez_application_submitted');
  }

  function sendPaymentRequestedEmail() {
    openEmailComposer('payment_requested');
  }

  function sendPaymentReceivedEmail() {
    openEmailComposer('payment_received');
  }

  function sendGrantSubmittedEmail() {
    openEmailComposer('grant_submitted');
  }

  async function openEmailComposer(templateKey, onSent) {
    const applicationId = detail?.application?.id;
    if (!applicationId) return;
    emailSentCallbackRef.current = onSent || null;
    setEmailComposer({ templateKey, recipient: '', subject: '', body: '', attachments: [], loading: true, sending: false, error: '', sentResult: null });
    try {
      const preview = await getAdminEmailPreview(applicationId, templateKey);
      setEmailComposer((prev) => (prev && prev.templateKey === templateKey) ? { ...prev, ...preview, loading: false } : prev);
    } catch (err) {
      setEmailComposer((prev) => (prev && prev.templateKey === templateKey) ? { ...prev, loading: false, error: err.message } : prev);
    }
  }

  function closeEmailComposer() {
    emailSentCallbackRef.current = null;
    setEmailComposer(null);
  }

  async function sendComposedEmail() {
    const applicationId = detail?.application?.id;
    if (!applicationId || !emailComposer) return;
    setEmailComposer((prev) => (prev ? { ...prev, sending: true, error: '' } : prev));
    try {
      const result = await sendAdminApplicationEmail(applicationId, emailComposer.templateKey, {
        subject: emailComposer.subject,
        body: emailComposer.body
      });
      setEmailComposer((prev) => (prev ? { ...prev, sending: false, sentResult: result } : prev));
      if (result?.sent) {
        const onSent = emailSentCallbackRef.current;
        emailSentCallbackRef.current = null;
        if (onSent) await onSent();
        await refreshList(applicationId);
      }
    } catch (err) {
      setEmailComposer((prev) => (prev ? { ...prev, sending: false, error: err.message } : prev));
    }
  }

  async function setProcessFlag(key, value) {
    setBusy(true);
    setMessage('Saving process status…');
    try {
      await updateAdminProcessFlags(detail.application.id, { [key]: value });
      await refreshList(detail.application.id);
      setMessage('Process status updated.');
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmPayment() {
    setBusy(true); setMessage('Recording payment…');
    try {
      await saveAdminPayment(detail.application.id, { ...paymentDraft, status: 'paid' });
      await refreshList(detail.application.id);
      setMessage('Client payment recorded.');
    } catch (err) { showError(err.message); }
    finally { setBusy(false); }
  }

  // Payment is penultimate now - the client sees no payment ask in their
  // portal at all until this fires (payment_requested_at gates the whole
  // payment card client-side, plus the server strips every other status/
  // credential detail from their view until it's actually paid). Safe to
  // click again later: it just re-sends the request and re-stamps the
  // timestamp, the email itself is deduped by application id.
  async function requestPayment() {
    setBusy(true); setMessage('Requesting payment…');
    try {
      await requestAdminPayment(detail.application.id);
      await refreshList(detail.application.id);
      setMessage('');
    } catch (err) { showError(err.message); return; }
    finally { setBusy(false); }
    // Open the email composer so admin can preview/edit before sending
    openEmailComposer('payment_requested');
  }

  async function saveProcessStep(stepKey, patch) {
    const applicationId = detail?.application?.id;
    if (!applicationId) return;
    const updated = await updateAdminProcessStep(applicationId, stepKey, patch);
    setDetail((prev) => (prev && prev.application.id === applicationId)
      ? { ...prev, processSteps: [...(prev.processSteps || []).filter((s) => s.step_key !== stepKey), updated] }
      : prev);
  }

  async function resetProcessStep(stepKey) {
    const applicationId = detail?.application?.id;
    if (!applicationId) return;
    await resetAdminProcessStep(applicationId, stepKey);
    setDetail((prev) => (prev && prev.application.id === applicationId)
      ? { ...prev, processSteps: (prev.processSteps || []).filter((s) => s.step_key !== stepKey) }
      : prev);
  }

  async function addCaseNote(bodyArg) {
    const applicationId = detail?.application?.id;
    const body = (bodyArg !== undefined ? bodyArg : noteDraft).trim();
    if (!applicationId || !body) return;
    setNoteBusy(true);
    try {
      const note = await addAdminCaseNote(applicationId, body);
      setDetail((prev) => (prev && prev.application.id === applicationId)
        ? { ...prev, notes: [note, ...(prev.notes || [])] }
        : prev);
      if (bodyArg === undefined) setNoteDraft(''); // only clear parent draft when called without arg
    } catch (err) {
      showError(err.message);
      throw err; // re-throw so the caller (CaseDetailTabs) can keep its draft on failure
    } finally {
      setNoteBusy(false);
    }
  }

  function startEditingNote(note) {
    setNoteEditingId(note.id);
    setNoteEditDraft(note.body);
  }

  function cancelEditingNote() {
    setNoteEditingId(null);
    setNoteEditDraft('');
  }

  async function saveCaseNoteEdit(noteId) {
    const applicationId = detail?.application?.id;
    const body = noteEditDraft.trim();
    if (!applicationId || !body) return;
    setNoteBusy(true);
    try {
      const note = await updateAdminCaseNote(applicationId, noteId, body);
      setDetail((prev) => (prev && prev.application.id === applicationId)
        ? { ...prev, notes: (prev.notes || []).map((n) => (n.id === noteId ? note : n)) }
        : prev);
      setNoteEditingId(null);
      setNoteEditDraft('');
    } catch (err) {
      showError(err.message);
    } finally {
      setNoteBusy(false);
    }
  }

  async function removeCaseNote(noteId) {
    const applicationId = detail?.application?.id;
    if (!applicationId) return;
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    setNoteBusy(true);
    try {
      await deleteAdminCaseNote(applicationId, noteId);
      setDetail((prev) => (prev && prev.application.id === applicationId)
        ? { ...prev, notes: (prev.notes || []).filter((n) => n.id !== noteId) }
        : prev);
    } catch (err) {
      showError(err.message);
    } finally {
      setNoteBusy(false);
    }
  }

  async function setGlobalStatus(status) {
    if (!detail?.application?.id) return;
    setBusy(true);
    setMessage('');
    try {
      await updateAdminApplicationStatus(detail.application.id, { status });
      await refreshList(detail.application.id);
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Normalize current DB status → one of our 5 canonical select values
  function globalStatusValue(status) {
    if (status === 'applied' || status === 'grant_submitted' || status === 'submitted') return 'applied';
    if (status === 'cancelled') return 'cancelled';
    if (status === 'call_state') return 'call_state';
    if (status === 'ready_for_submission') return 'ready_for_submission';
    if (status === 'in_progress' || status === 'ready_for_ldc') return 'in_progress';
    return 'not_started';
  }

  function isWideScreen() {
    return window.matchMedia('(min-width: 1280px)').matches;
  }

  // ☰ docks/undocks on wide screens, opens/closes the drawer otherwise.
  function toggleSidebar() {
    if (isWideScreen()) {
      setSidebarOpen(false);
      setSidebarDocked((docked) => {
        try { localStorage.setItem('adminSidebarDocked', docked ? '0' : '1'); } catch {}
        return !docked;
      });
    } else {
      setSidebarOpen((open) => !open);
    }
  }

  function selectApplication(id) {
    setMobileDetailOpen(true);
    setSidebarOpen(false);
    // A deliberate click gets a real history entry so back/forward moves
    // between businesses; openApplication() only ever replaces the URL.
    if (id !== selectedId) window.history.pushState(null, '', businessUrl(id));
    openApplication(id);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  if (!authResolved || (session && !profile)) {
    return <div className="app-shell auth-loading-shell admin-loading"><div className="auth-loading-card">Loading admin…</div></div>;
  }

  if (!session || profile?.role !== 'admin') {
    return <div className="app-shell admin-login-shell">
      <header className="topbar admin-login-topbar"><div className="brand-mark">COR</div><div><div className="brand-name">COR Solutions</div><div className="brand-subtitle">UEZ Admin</div></div></header>
      <main className="admin-login-wrap">
        <div className="wizard-card admin-login-card">
          <div className="content-block">
            <div className="intro-copy"><h3>UEZ Admin</h3><p>Sign in with your COR admin account.</p></div>
            <form onSubmit={handleLogin}>
              <label>Email</label><input type="email" value={login.email} onChange={(e) => setLogin((old) => ({ ...old, email: e.target.value }))} />
              <label>Password</label><input type="password" value={login.password} onChange={(e) => setLogin((old) => ({ ...old, password: e.target.value }))} />
              <button className="primary">{busy ? 'Signing in…' : 'Sign in'}</button>
            </form>
            {message && <div className="validation-error">{message}</div>}
          </div>
        </div>
      </main>
    </div>;
  }

  function toggleDarkMode() {
    setDarkMode((d) => {
      const next = !d;
      localStorage.setItem('adminDarkMode', next ? '1' : '0');
      return next;
    });
  }

  return <div className={`admin-shell${darkMode ? ' dark' : ''}`} data-theme={darkMode ? undefined : 'light'}>
    <header className="admin-topbar">
      <div className="admin-topbar-left">
        <div className="admin-brand">
          <button
            type="button"
            className="sidebar-toggle-btn"
            onClick={toggleSidebar}
            title="Show / hide applications list"
            aria-label="Show / hide applications list"
            aria-expanded={sidebarOpen || sidebarDocked}
          >☰</button>
          <div className="brand-mark">COR</div><div><strong>COR UEZ</strong><span>Admin</span></div>
        </div>
        <div className="topbar-stats">
          <span className="topbar-stat"><strong>{applications.length}</strong><small>Total</small></span>
          <span className="topbar-stat"><strong>{applicationCounts.in_progress}</strong><small>In progress</small></span>
          <span className="topbar-stat"><strong>{applicationCounts.ready}</strong><small>Ready</small></span>
          <span className="topbar-stat"><strong>{applicationCounts.submitted}</strong><small>Submitted</small></span>
        </div>
      </div>
      <div className="admin-top-actions admin-desktop-actions">
        {runningJob && <span className="running-job-pill" title="A Chrome-extension automation is running">Running: {runningJob.label} — {runningJob.name}</span>}
        {/* Rarely-needed pages live behind one menu instead of seven links. */}
        <details className="admin-settings-menu">
          <summary title="Admin pages" aria-label="Admin pages">⚙</summary>
          <div className="admin-settings-popover">
            <a href="/admin/email-settings">Email settings</a>
            <a href="/admin/signup-layout">Signup layout</a>
            <a href="/admin/home-stats">Home stats</a>
            <a href="/admin/accounts">Accounts</a>
            <a href="/admin/jotform-test">JotForm test</a>
            <a href="/admin/demo-client" target="_blank" rel="noreferrer">Demo client ↗</a>
            <a href="/" target="_blank" rel="noreferrer">Applicant site ↗</a>
          </div>
        </details>
        <button className="dark-mode-toggle" onClick={toggleDarkMode} title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>{darkMode ? '☀' : '🌙'}</button>
        <button onClick={handleSignOut}>Log out</button>
      </div>
      <details className="admin-mobile-menu">
        <summary aria-label="Open admin menu">•••</summary>
        <div className="admin-mobile-menu-popover">
          <a href="/admin/email-settings">Email settings</a>
          <a href="/admin/signup-layout">Signup layout</a>
          <a href="/admin/home-stats">Home stats</a>
          <a href="/admin/jotform-test">JotForm test</a>
          <a href="/admin/accounts">Accounts</a>
          <a href="/admin/demo-client" target="_blank" rel="noreferrer">Demo client</a>
          <a href="/" target="_blank" rel="noreferrer">Applicant site</a>
          <button onClick={handleSignOut}>Log out</button>
        </div>
      </details>
    </header>

    <main className={`admin-layout ${mobileDetailOpen ? 'mobile-detail-open' : 'mobile-list-open'} ${sidebarOpen ? 'sidebar-open' : 'sidebar-collapsed'}${sidebarDocked ? ' sidebar-docked' : ''}`}>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <AdminSidebar
        applications={applications}
        selectedId={selectedId}
        search={search}
        onSearchChange={setSearch}
        onSelectApplication={selectApplication}
      />

      <section className="admin-detail">
        {detail && <div className="mobile-detail-nav">
          <button type="button" onClick={() => { setMobileDetailOpen(false); window.scrollTo({ top: 0, behavior: 'instant' }); }}>‹ Applicants</button>
          <div><strong>{displayBusinessName(detail.application) || 'Application'}</strong><small>{readyDocumentCount(detail)}/5 docs · {paymentStatusLabel(detail.payments?.[detail.payments.length - 1]?.status)}</small></div>
        </div>}
        {message && <div className={`admin-message${messageIsError ? ' admin-message-error' : ''}`}>
          <span>{message}</span>
          <button type="button" className="admin-message-close" onClick={() => setMessageText('')} aria-label="Dismiss message">×</button>
        </div>}
        {!detail && <div className="admin-empty"><h2>Select an application</h2><p>New submissions will appear on the left.</p></div>}

        {detail && <>
          <div className="admin-detail-header cockpit-header">
            <div className="cockpit-strip">
              <div className="cockpit-identity">
                <span className="eyebrow">UEZ APPLICATION</span>
                <h1 title={displayBusinessName(detail.application)}>
                  {displayBusinessName(detail.application)}
                  <CopyButton value={displayBusinessName(detail.application)} label="business name" />
                </h1>
                <div className="cockpit-meta-grid">
                  {detail.application.ein && <div className="cockpit-meta-item">
                    <span className="cockpit-meta-label">EIN</span>
                    <div className="cockpit-meta-value">{detail.application.ein}<CopyButton value={njTaxId(detail.application.ein)} label="EIN" /></div>
                  </div>}
                  {detail.application.contact_phone && <div className="cockpit-meta-item">
                    <span className="cockpit-meta-label">Phone</span>
                    <div className="cockpit-meta-value">{detail.application.contact_phone}<CopyButton value={detail.application.contact_phone} label="phone number" /></div>
                  </div>}
                  {detail.application.contact_email && <div className="cockpit-meta-item">
                    <span className="cockpit-meta-label">Email</span>
                    <div className="cockpit-meta-value">{detail.application.contact_email}<CopyButton value={detail.application.contact_email} label="email" /></div>
                  </div>}
                  {detail.owners?.[0] && <div className="cockpit-meta-item">
                    <span className="cockpit-meta-label">Primary owner</span>
                    <div className="cockpit-meta-value">{detail.owners[0].firstName} {detail.owners[0].lastName}</div>
                  </div>}
                </div>
              </div>
              <div className="cockpit-controls">
                <select
                  className={`cockpit-status-select gs-${globalStatusValue(detail.application.status)}`}
                  value={globalStatusValue(detail.application.status)}
                  onChange={(e) => setGlobalStatus(e.target.value)}
                  title="Set application status"
                >
                  <option value="not_started">Not Started</option>
                  <option value="in_progress">In Progress</option>
                  <option value="ready_for_submission">Ready for Submission</option>
                  <option value="applied">Submitted</option>
                  <option value="call_state">Call State</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <div className="cockpit-chips-row">
                  {detail.application.ldc_board_approved_at && <span className="cockpit-chip good" title={`Recorded ${new Date(detail.application.ldc_board_approved_at).toLocaleString()} from the LDC's Airtable. Per COR's terms the fee is no longer refundable.`}>
                    LDC approved{detail.application.ldc_board_meeting_date ? ` ${detail.application.ldc_board_meeting_date}` : ''} · non-refundable
                  </span>}
                  <span className="cockpit-chip">{readyDocumentCount(detail)}/5 docs</span>
                  <span className={`cockpit-chip ${detail.payments?.[detail.payments.length - 1]?.status === 'paid' ? 'good' : detail.payments?.[detail.payments.length - 1]?.status === 'client_reported' ? 'warn' : ''}`}>{paymentStatusLabel(detail.payments?.[detail.payments.length - 1]?.status)}</span>
                  <button
                    className="cockpit-open-pbs-btn"
                    onClick={runPbsLogin}
                    disabled={!myNjCredentials}
                    title={!myNjCredentials ? 'MyNJ credentials required' : 'Open PBS and log in'}
                  >Open PBS</button>
                </div>
              </div>
            </div>
          </div>

          {/* attentionItems' checks are the same URGENT_REVIEW_ITEMS
              definition (caseLogic.js) that used to also drive the
              recommended-action banner before it was replaced above — this
              strip shows every open urgent item that needs a human look. */}
          {attentionItems(detail).length > 0 && <div className="ops-attention-strip">
            <strong>Needs attention</strong>
            <div>{attentionItems(detail).map((item) => <span key={item}>{item}</span>)}</div>
          </div>}

          <CaseDetailTabs
            detail={detail}
            busy={busy}
            myNjCredentials={myNjCredentials}
            brcForm={brcForm}
            setBrcForm={setBrcForm}
            paymentDraft={paymentDraft}
            setPaymentDraft={setPaymentDraft}
            pbsAnswerDraft={pbsAnswerDraft}
            pbsLoginDraft={pbsLoginDraft}
            setPbsLoginDraft={setPbsLoginDraft}
            myNjEditMode={myNjEditMode}
            myNjDraft={myNjDraft}
            setMyNjDraft={setMyNjDraft}
            showMyNjSecrets={showMyNjSecrets}
            editMode={editMode}
            applicationDraft={applicationDraft}
            ownerDrafts={ownerDrafts}
            noteDraft={noteDraft}
            setNoteDraft={setNoteDraft}
            noteBusy={noteBusy}
            noteEditingId={noteEditingId}
            noteEditDraft={noteEditDraft}
            setNoteEditDraft={setNoteEditDraft}
            manualDocType={manualDocType}
            setManualDocType={setManualDocType}
            manualDocFile={manualDocFile}
            setManualDocFile={setManualDocFile}
            manualDocUploading={manualDocUploading}
            previewDocument={previewDocument}
            reviewFormationDoc={reviewFormationDoc}
            sendFormationRejectedEmail={sendFormationRejectedEmail}
            runBrcLookup={runBrcLookup}
            sendBrcProblemEmail={sendBrcProblemEmail}
            sendBrcWrongAddressEmail={sendBrcWrongAddressEmail}
            markPbsAccountCreated={markPbsAccountCreated}
            setProcessFlag={setProcessFlag}
            runPbsSignup={runPbsSignup}
            sendPbsAccountCreatedEmail={sendPbsAccountCreatedEmail}
            sendPbsExistingAccountEmail={sendPbsExistingAccountEmail}
            runTaxClearance={runTaxClearance}
            sendTaxIssueEmail={sendTaxIssueEmail}
            sendUezApplicationSubmittedEmail={sendUezApplicationSubmittedEmail}
            runLdcJotform={runLdcJotform}
            runUezEnrollment={runUezEnrollment}
            runningJob={runningJob}
            requestPayment={requestPayment}
            confirmPayment={confirmPayment}
            sendPaymentRequestedEmail={sendPaymentRequestedEmail}
            sendPaymentReceivedEmail={sendPaymentReceivedEmail}
            runLakewoodGrantPortal={runLakewoodGrantPortal}
            confirmGrantSubmitted={confirmGrantSubmitted}
            sendGrantSubmittedEmail={sendGrantSubmittedEmail}
            changePbsAnswerDraft={changePbsAnswerDraft}
            saveExistingPbsAnswer={saveExistingPbsAnswer}
            saveMyNjCredentials={saveMyNjCredentials}
            startMyNjEdit={startMyNjEdit}
            cancelMyNjEdit={cancelMyNjEdit}
            toggleShowMyNjSecrets={toggleShowMyNjSecrets}
            copyCredential={copyCredential}
            createMyNjCredentials={createMyNjCredentials}
            addCaseNote={addCaseNote}
            startEditingNote={startEditingNote}
            cancelEditingNote={cancelEditingNote}
            saveCaseNoteEdit={saveCaseNoteEdit}
            removeCaseNote={removeCaseNote}
            openDoc={openDoc}
            handleDeleteDoc={handleDeleteDoc}
            uploadManualAdminDocument={uploadManualAdminDocument}
            uploadDocumentDirect={uploadDocumentDirect}
            directUploadType={directUploadType}
            updateApplicationDraft={updateApplicationDraft}
            updateOwnerDraft={updateOwnerDraft}
            addOwner={addOwner}
            removeOwner={removeOwner}
            saveBrcFound={saveBrcFound}
            saveBrcNotFound={saveBrcNotFound}
            saveProcessStep={saveProcessStep}
            resetProcessStep={resetProcessStep}
            startEditing={startEditing}
            saveAdminEdits={saveAdminEdits}
            cancelEditing={cancelEditing}
            deleteApplication={deleteApplication}
          />

        </>}
        {previewDoc && (() => {
          const gallery = docsFor(detail, previewDoc.document_type);
          const idx = gallery.findIndex((d) => d.id === previewDoc.id);
          return <div className="document-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closePreview(); }}>
            <div className="document-modal" role="dialog" aria-modal="true" aria-label={documentLabel(previewDoc.document_type)}>
              <div className="document-modal-head"><div><strong>{documentLabel(previewDoc.document_type)}</strong><small>{previewDoc.filename}{gallery.length > 1 ? ` · ${idx + 1} of ${gallery.length}` : ''}</small></div><button onClick={closePreview} aria-label="Close document">×</button></div>
              <div className="document-modal-body">
                {gallery.length > 1 && idx > 0 && <button type="button" className="document-modal-nav document-modal-nav-prev" aria-label="Previous document" onClick={() => previewDocument(gallery[idx - 1])}>‹</button>}
                {previewBusy ? <div className="document-modal-loading">Loading document…</div> : previewUrl ? <iframe src={previewUrl} title={previewDoc.filename} /> : null}
                {gallery.length > 1 && idx < gallery.length - 1 && <button type="button" className="document-modal-nav document-modal-nav-next" aria-label="Next document" onClick={() => previewDocument(gallery[idx + 1])}>›</button>}
              </div>
              <div className="document-modal-footer">
                <div>{previewUrl && <a href={previewUrl} target="_blank" rel="noreferrer">Open in new tab</a>}</div>
                <div className="document-review-actions">
                  {(previewDoc.document_type === 'formation' || previewDoc.document_type === 'uez_approval_email') && <><button className="warning-button" onClick={() => reviewPreviewDoc('rejected')}>Wrong document</button><button className="success-button" onClick={() => reviewPreviewDoc('approved')}>✓ Approve</button></>}
                  <button type="button" className="danger-button" onClick={deletePreviewDoc}>Delete</button>
                </div>
              </div>
            </div>
          </div>;
        })()}
        <EmailComposer
          composer={emailComposer}
          onChangeSubject={(value) => setEmailComposer((prev) => ({ ...prev, subject: value }))}
          onChangeBody={(value) => setEmailComposer((prev) => ({ ...prev, body: value }))}
          onSend={sendComposedEmail}
          onClose={closeEmailComposer}
        />
      </section>
    </main>
  </div>;
}
