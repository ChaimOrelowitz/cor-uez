import React, { useEffect, useMemo, useState } from 'react';
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
  reviewAdminDocument,
  sendAdminApplicationEmail,
  updateAdminCaseNote,
  uploadApplicationDocument,
  whoAmI
} from './api';
import {
  adminQueueInfo,
  applicationDraftFrom,
  attentionItems,
  docFor,
  documentLabel,
  filterAndSortApplications,
  formationSatisfied,
  formatTimestamp,
  grantSubmissionLikelyDetected,
  nameControl,
  njTaxId,
  ownerDraftFrom,
  packetReady,
  paymentStatusLabel,
  queueCounts,
  readyDocumentCount,
  statusLabel
} from './admin/caseLogic';
import ActivityPanel from './admin/ActivityPanel';
import AdminSidebar from './admin/AdminSidebar';
import BrcDetailsCard from './admin/BrcDetailsCard';
import BusinessDetailsCard from './admin/BusinessDetailsCard';
import DocumentsPanel from './admin/DocumentsPanel';
import EmailComposer from './admin/EmailComposer';
import MyNjPbsCard from './admin/MyNjPbsCard';
import NotesPanel from './admin/NotesPanel';
import OwnersCard from './admin/OwnersCard';
import PaymentCard from './admin/PaymentCard';
import RecommendedActionBanner from './admin/RecommendedActionBanner';

const NJ_BRC_LOOKUP_URL = 'https://www1.state.nj.us/TYTR_BRC/servlet/common/BRCLogin';
const NJ_REGISTRATION_URL = 'https://www.njportal.com/dor/businessregistration';
const NJ_PBS_URL = 'https://my.nj.gov/aui/Login?goto=https://www-njlib.nj.gov/NJ_PREMIER_EBIZ/OEGController?actionToPerform=login';

function openOfficialBrcLookup(application) {
  const target = `cor-brc-${application.id}`;
  const popup = window.open('about:blank', target, 'width=1050,height=850,resizable=yes,scrollbars=yes');
  if (!popup) throw new Error('Your browser blocked the NJ lookup window. Allow pop-ups for COR admin and try again.');

  popup.document.write('<title>NJ BRC Lookup</title><p style="font:16px system-ui;padding:30px">Opening New Jersey BRC lookup…</p>');

  const fields = {
    pinnctl: nameControl(application.business_name_input),
    pinidnum: njTaxId(application.ein),
    pincorpid: '',
    pincasinoid: '',
    submit: '  Submit  '
  };

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = NJ_BRC_LOOKUP_URL;
  form.target = target;
  form.style.display = 'none';

  Object.entries(fields).forEach(([key, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = value;
    form.appendChild(input);
  });

  document.body.appendChild(form);
  // The NJ form requires a field named "submit", which shadows form.submit.
  // Call the native method directly so the targeted popup actually navigates.
  HTMLFormElement.prototype.submit.call(form);
  form.remove();
  popup.focus();
}

export default function AdminPage() {
  const [session, setSession] = useState(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [profile, setProfile] = useState(null);
  const [login, setLogin] = useState({ email: '', password: '' });
  const [applications, setApplications] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [filter, setFilter] = useState('needs');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
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
  const [pbsModalOpen, setPbsModalOpen] = useState(false);
  const [manualDocType, setManualDocType] = useState('supporting');
  const [manualDocFile, setManualDocFile] = useState(null);
  const [manualDocUploading, setManualDocUploading] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteEditingId, setNoteEditingId] = useState(null);
  const [noteEditDraft, setNoteEditDraft] = useState('');
  const [emailComposer, setEmailComposer] = useState(null);
  const [dragStatusKey, setDragStatusKey] = useState(null);
  const [statusOrder, setStatusOrder] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('cor_uez_admin_status_order') || 'null');
      return Array.isArray(stored) && stored.length === 4 ? stored : ['pbs','uez','tax','payment'];
    } catch (_) { return ['pbs','uez','tax','payment']; }
  });

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

  // No blind interval here on purpose — every mutation already calls refreshList()
  // itself with the exact result of what just happened, so a timer re-fetching
  // everything every few seconds was only ever fighting whatever you were doing
  // (typing a note, editing a field) and making the page feel unstable. The one
  // case a timer doesn't cover — something changed outside this tab (another
  // admin, an applicant upload, an extension callback landing late) — is handled
  // by refreshing once when you come back to the tab, not by polling while you're on it.
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
      await refreshList();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshList(preferredId) {
    const rows = await getAdminApplications();
    setApplications(rows || []);
    const id = preferredId || selectedId || rows?.[0]?.id;
    if (id) await openApplication(id);
  }

  async function openApplication(id) {
    setSelectedId(id);
    setMessage('');
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
    } catch (err) {
      setMessage(err.message);
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
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await signOutApplicant();
    window.location.href = '/admin';
  }

  function saveStatusOrder(next) {
    setStatusOrder(next);
    localStorage.setItem('cor_uez_admin_status_order', JSON.stringify(next));
  }

  function dropStatus(targetKey) {
    if (!dragStatusKey || dragStatusKey === targetKey) return setDragStatusKey(null);
    const next = statusOrder.filter((key) => key !== dragStatusKey);
    next.splice(next.indexOf(targetKey), 0, dragStatusKey);
    saveStatusOrder(next);
    setDragStatusKey(null);
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
      setMessage(err.message);
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
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openDoc(doc) {
    try {
      const result = await getDocumentUrl(detail.application.id, doc.id);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setMessage(err.message);
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
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runExtensionWorkflow(workflow, payload) {
    const statusMessages = {
      starting: 'Starting the COR Chrome extension…',
      nj_page_open: 'The COR extension is active on the New Jersey page…',
      opening_brc: 'Opening the New Jersey BRC lookup…',
      waiting_for_verification: 'Complete the NJ verification in the checker window. UEZ will import the result automatically.',
      saving_brc: 'BRC found. Creating and saving the applicant’s PDF…',
      opening_pbs: 'Opening New Jersey PBS…',
      opening_mynj_login: 'Opening the MyNJ login…',
      signing_in_to_pbs: 'Signing into PBS with the stored MyNJ login…',
      opening_tax_revenue_center: 'Opening Tax & Revenue Center…',
      waiting_for_human_verification: 'Complete New Jersey’s verification in the visible PBS window.',
      requesting_tax_clearance_pdf: 'Selecting the Department of Community Affairs and requesting the letter…',
      uploading_tax_clearance: 'Tax clearance received. Adding it directly to the applicant’s UEZ file…',
      capturing_tax_issue: 'NJ reported a tax-clearance problem. Capturing the error screenshot…',
      sending_tax_issue_email: 'Saving the screenshot and emailing the client the tax-clearance instructions…',
      opening_ldc_form: 'Opening the Lakewood LDC incentive application…',
      filling_ldc_form: 'COR is filling the Lakewood LDC application…',
      starting_ldc_sign: 'Opening JotForm Sign so the required signature can be added…',
      waiting_for_signature: 'Application filled. Add the required signature in the JotForm popup.',
      generating_ldc_preview: 'Signature received. Generating the JotForm PDF preview…',
      waiting_for_final_submit: 'Review the generated application and click the final Submit button in JotForm.',
      downloading_ldc_pdf: 'Application submitted. Downloading JotForm’s signed PDF…',
      uploading_ldc_application: 'Saving the signed LDC application PDF to this UEZ file…',
      opening_lakewood_portal: 'Opening the Lakewood UEZ grant application…',
      filling_lakewood_portal: 'COR is filling the Lakewood grant application…',
      attaching_lakewood_documents: 'COR is attaching the required grant documents…',
      waiting_for_lakewood_submit: 'Grant packet ready. Review it and click the final Submit Form button.',
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
      pbs_needs_attention: 'PBS needs your attention in the visible NJ window.'
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
      };
      window.addEventListener('message', onMessage);
      window.postMessage({ source: 'cor-uez-app', type: 'COR_UEZ_START', requestId, workflow, payload }, window.location.origin);
      setMessage('Starting the COR Chrome extension…');
    });
  }

  async function runBrcLookup() {
    setBusy(true);
    setMessage('Starting the COR Chrome extension…');
    try {
      const currentSession = await getApplicantSession();
      if (!currentSession?.access_token) throw new Error('Please sign in again before running the BRC check.');

      const outcome = await runExtensionWorkflow('brc', {
        applicationId: detail.application.id,
        businessName: detail.application.business_name_input,
        ein: detail.application.ein,
        accessToken: currentSession.access_token
      });
      await refreshList(detail.application.id);

      if (outcome.status === 'complete') {
        setMessage('BRC confirmed. The PDF and certificate details were added directly to this applicant’s UEZ file.');
      } else if (outcome.status === 'not_found') {
        setMessage('NJ did not find a matching BRC.');
      } else {
        throw new Error(outcome.error || 'The BRC check did not finish.');
      }
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runPbsSignup() {
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

  async function runPbsLogin() {
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

  async function runTaxClearance() {
    setBusy(true);
    setMessage('Starting the COR Chrome extension…');
    try {
      const currentSession = await getApplicantSession();
      if (!currentSession?.access_token) throw new Error('Please sign in again before retrieving tax clearance.');

      const outcome = await runExtensionWorkflow('tax_clearance', {
        applicationId: detail.application.id,
        businessName: detail.application.registered_business_name || detail.application.business_name_input,
        accessToken: currentSession.access_token
      });
      if (outcome.status !== 'complete') throw new Error(outcome.error || 'The tax-clearance download did not finish.');
      await refreshList(detail.application.id);
      setMessage(outcome.taxIssue
        ? 'NJ could not issue the tax clearance. The error screenshot was saved and the client was emailed the follow-up instructions.'
        : 'Tax-clearance letter downloaded and added directly to this applicant’s UEZ file.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadManualAdminDocument() {
    if (!manualDocFile) { setMessage('Choose a file to upload.'); return; }
    setManualDocUploading(true);
    setMessage('Uploading document…');
    try {
      await uploadApplicationDocument(detail.application.id, manualDocType, manualDocFile);
      await refreshList(detail.application.id);
      setManualDocFile(null);
      setMessage('Document added to the applicant file.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setManualDocUploading(false);
    }
  }

  async function runLdcJotform() {
    setBusy(true);
    setMessage('Starting the COR Chrome extension…');
    try {
      const currentSession = await getApplicantSession();
      if (!currentSession?.access_token) throw new Error('Please sign in again before opening the LDC application.');

      const outcome = await runExtensionWorkflow('ldc_jotform', {
        applicationId: detail.application.id,
        businessName: detail.application.registered_business_name || detail.application.business_name_input,
        accessToken: currentSession.access_token
      });
      if (outcome.status !== 'complete') throw new Error(outcome.error || 'The LDC application workflow did not finish.');
      await refreshList(detail.application.id);
      setMessage('LDC application submitted. The signed JotForm PDF is saved in this applicant’s Documents.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runLakewoodGrantPortal() {
    setBusy(true);
    setMessage('Starting the COR Chrome extension…');
    try {
      const currentSession = await getApplicantSession();
      if (!currentSession?.access_token) throw new Error('Please sign in again before opening the Lakewood grant application.');

      const outcome = await runExtensionWorkflow('lakewood_portal', {
        applicationId: detail.application.id,
        businessName: detail.application.registered_business_name || detail.application.business_name_input,
        accessToken: currentSession.access_token
      });
      if (outcome.status !== 'complete') throw new Error(outcome.error || 'The Lakewood grant workflow did not finish.');
      await refreshList(detail.application.id);
      setMessage(outcome.ambiguous
        ? 'COR saw what looks like a successful Lakewood submission, but there was no submission ID to confirm it automatically. Review the confirmation page, then click "Confirm grant submitted" below.'
        : 'Lakewood UEZ Technology Grant submitted successfully.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
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
      setMessage(err.message);
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
      setMessage('An application must keep at least one owner. Delete the application instead if it should be removed entirely.');
      return;
    }
    setOwnerDrafts((old) => old.filter((_, ownerIndex) => ownerIndex !== index));
  }

  async function saveAdminEdits() {
    const ownershipTotal = ownerDrafts.reduce((sum, owner) => sum + (Number(owner.ownershipPercent) || 0), 0);
    if (Math.abs(ownershipTotal - 100) > 0.001) {
      setMessage(`Ownership percentages must total exactly 100%. They currently total ${ownershipTotal}%.`);
      return;
    }
    if (!applicationDraft.businessName.trim() || !applicationDraft.contactEmail.trim()) {
      setMessage('Business name and contact email are required.');
      return;
    }
    if (ownerDrafts.some((owner) => !String(owner.title || '').trim())) {
      setMessage('Choose a title for each owner before saving.');
      return;
    }
    if (!applicationDraft.hasDba || (applicationDraft.hasDba === 'yes' && !applicationDraft.dbaName.trim())) {
      setMessage('Complete the DBA information before saving.');
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
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteApplication() {
    const confirmation = window.prompt(
      `This permanently deletes ${detail.application.business_name_input}, its owners, documents, and application history. Type DELETE to continue.`
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
      setMessage('The UEZ application and its documents were permanently deleted. The person’s login was not deleted.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }


  async function saveExistingPbsAnswer() {
    if (!pbsAnswerDraft) return setMessage('Choose Yes or No for the PBS account question.');
    if (pbsAnswerDraft === 'yes' && (!pbsLoginDraft.username.trim() || !pbsLoginDraft.password)) return setMessage('Enter the existing MyNJ username and password.');
    setBusy(true); setMessage('Saving PBS account answer…');
    try {
      await savePbsAccountInfo(detail.application.id, { hasExistingPbsAccount: pbsAnswerDraft === 'yes', username: pbsAnswerDraft === 'yes' ? pbsLoginDraft.username.trim() : '', password: pbsAnswerDraft === 'yes' ? pbsLoginDraft.password : '' });
      await refreshList(detail.application.id);
      setMessage('PBS account answer saved.');
    } catch (err) { setMessage(err.message); } finally { setBusy(false); }
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
      setMessage(err.message);
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
      setMessage(err.message);
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
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyCredential(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied.`);
    } catch (_) {
      setMessage(`Could not copy ${label.toLowerCase()}. Select it manually.`);
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
      setMessage(err.message);
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
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  function sendBrcProblemEmail() {
    openEmailComposer('brc_not_found');
  }

  function sendFormationRejectedEmail() {
    openEmailComposer('formation_rejected');
  }

  async function openEmailComposer(templateKey) {
    const applicationId = detail?.application?.id;
    if (!applicationId) return;
    setEmailComposer({ templateKey, recipient: '', subject: '', body: '', attachments: [], loading: true, sending: false, error: '', sentResult: null });
    try {
      const preview = await getAdminEmailPreview(applicationId, templateKey);
      setEmailComposer((prev) => (prev && prev.templateKey === templateKey) ? { ...prev, ...preview, loading: false } : prev);
    } catch (err) {
      setEmailComposer((prev) => (prev && prev.templateKey === templateKey) ? { ...prev, loading: false, error: err.message } : prev);
    }
  }

  function closeEmailComposer() {
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
      if (result?.sent) await refreshList(applicationId);
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
      setMessage(err.message);
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
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  async function addCaseNote() {
    const applicationId = detail?.application?.id;
    const body = noteDraft.trim();
    if (!applicationId || !body) return;
    setNoteBusy(true);
    try {
      const note = await addAdminCaseNote(applicationId, body);
      setDetail((prev) => (prev && prev.application.id === applicationId)
        ? { ...prev, notes: [note, ...(prev.notes || [])] }
        : prev);
      setNoteDraft('');
    } catch (err) {
      setMessage(err.message);
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
      setMessage(err.message);
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
      setMessage(err.message);
    } finally {
      setNoteBusy(false);
    }
  }

  async function markReadyForLdc() {
    setBusy(true);
    setMessage('');
    try {
      await updateAdminApplicationStatus(detail.application.id, {
        status: 'ready_for_ldc',
        label: 'Ready for grant processing',
        message: 'COR completed the initial review and is preparing the next application step.'
      });
      await refreshList(detail.application.id);
      setMessage('Application marked ready for grant processing.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(
    () => filterAndSortApplications(applications, filter, search),
    [applications, filter, search]
  );

  const counts = useMemo(() => queueCounts(applications), [applications]);

  function selectApplication(id) {
    setMobileDetailOpen(true);
    openApplication(id);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  const emailApplicantHref = detail ? `mailto:${encodeURIComponent(detail.application.contact_email || '')}?subject=${encodeURIComponent('Your New Jersey Business Registration Certificate is needed')}&body=${encodeURIComponent(
    `Hi,\n\nWe reviewed your COR UEZ application and could not locate a current New Jersey Business Registration Certificate (BRC).\n\nPlease complete New Jersey business/tax registration here:\n${NJ_REGISTRATION_URL}\n\nOnce your BRC is available, sign back into your COR account and upload it. We will continue your application from there.\n\nCOR Solutions`
  )}` : '#';

  if (!authResolved || (session && !profile)) {
    return <div className="app-shell auth-loading-shell"><div className="auth-loading-card">Loading admin…</div></div>;
  }

  if (!session || profile?.role !== 'admin') {
    return <div className="app-shell admin-login-shell">
      <header className="topbar"><div className="brand-mark">COR</div><div><div className="brand-name">COR Solutions</div><div className="brand-subtitle">UEZ Admin</div></div></header>
      <main className="admin-login-wrap">
        <div className="wizard-card admin-login-card">
          <div className="content-block">
            <div className="intro-copy"><h3>UEZ Admin</h3><p>Sign in with your COR admin account.</p></div>
            <form onSubmit={handleLogin}>
              <label>Email</label><input type="email" value={login.email} onChange={(e) => setLogin((old) => ({ ...old, email: e.target.value }))} />
              <label>Password</label><input type="password" value={login.password} onChange={(e) => setLogin((old) => ({ ...old, password: e.target.value }))} />
              <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            </form>
            {message && <div className="validation-error">{message}</div>}
          </div>
        </div>
      </main>
    </div>;
  }

  return <div className="admin-shell">
    <header className="admin-topbar">
      <div className="admin-brand"><div className="brand-mark">COR</div><div><strong>COR UEZ</strong><span>Admin</span></div></div>
      <div className="admin-top-actions admin-desktop-actions"><a href="/admin/email-settings" className="email-settings-primary">EMAIL SETTINGS</a><a href="/admin/signup-layout">SIGNUP LAYOUT</a><a href="/admin/demo-client" target="_blank" rel="noreferrer">DEMO CLIENT</a><a href="/" target="_blank" rel="noreferrer">Open applicant site</a><button onClick={handleSignOut}>Log out</button></div>
      <details className="admin-mobile-menu">
        <summary aria-label="Open admin menu">•••</summary>
        <div className="admin-mobile-menu-popover">
          <a href="/admin/email-settings">Email settings</a>
          <a href="/admin/signup-layout">Signup layout</a>
          <a href="/admin/demo-client" target="_blank" rel="noreferrer">Demo client</a>
          <a href="/" target="_blank" rel="noreferrer">Applicant site</a>
          <button onClick={handleSignOut}>Log out</button>
        </div>
      </details>
    </header>

    <main className={`admin-layout ${mobileDetailOpen ? 'mobile-detail-open' : 'mobile-list-open'}`}>
      <AdminSidebar
        applications={applications}
        filtered={filtered}
        counts={counts}
        filter={filter}
        search={search}
        selectedId={selectedId}
        onFilterChange={setFilter}
        onSearchChange={setSearch}
        onSelectApplication={selectApplication}
      />

      <section className="admin-detail">
        {detail && <div className="mobile-detail-nav">
          <button type="button" onClick={() => { setMobileDetailOpen(false); window.scrollTo({ top: 0, behavior: 'instant' }); }}>‹ Applicants</button>
          <div><strong>{detail.application.business_name_input || 'Application'}</strong><small>{readyDocumentCount(detail)}/5 docs · {paymentStatusLabel(detail.payments?.[detail.payments.length - 1]?.status)}</small></div>
        </div>}
        {message && <div className="admin-message">{message}</div>}
        {!detail && <div className="admin-empty"><h2>Select an application</h2><p>New submissions will appear on the left.</p></div>}

        {detail && <>
          <div className="admin-detail-header cockpit-header">
            <div><span className="eyebrow">UEZ APPLICATION</span><h1>{detail.application.business_name_input}</h1><p>{detail.application.contact_email} · {detail.application.contact_phone || 'No phone'}{detail.owners?.[0] ? ` · ${detail.owners[0].firstName} ${detail.owners[0].lastName}` : ''}</p></div>
            <div className="cockpit-header-chips">
              <span className={`cockpit-chip ${detail.application.status === 'applied' ? 'good' : ''}`}>{statusLabel(detail.application.status)}</span>
              <span className="cockpit-chip">{readyDocumentCount(detail)}/5 docs</span>
              <span className={`cockpit-chip ${detail.payments?.[detail.payments.length - 1]?.status === 'paid' ? 'good' : detail.payments?.[detail.payments.length - 1]?.status === 'client_reported' ? 'warn' : ''}`}>{paymentStatusLabel(detail.payments?.[detail.payments.length - 1]?.status)}</span>
            </div>
          </div>

          <div className="admin-edit-actions">
            {editMode ? <>
              <button className="primary" onClick={saveAdminEdits} disabled={busy}>{busy ? 'Saving…' : 'Save all changes'}</button>
              <button className="secondary" onClick={cancelEditing} disabled={busy}>Cancel</button>
            </> : <button className="secondary" onClick={startEditing} disabled={busy}>Edit application</button>}
            <button className="admin-delete-button" onClick={deleteApplication} disabled={busy}>Delete application</button>
          </div>

          <RecommendedActionBanner queue={adminQueueInfo(detail.application)} />

          <section className="ops-cockpit">
            {attentionItems(detail).length > 0 && <div className="ops-attention-strip">
              <strong>Needs attention</strong>
              <div>{attentionItems(detail).map((item) => <span key={item}>{item}</span>)}</div>
            </div>}

            <div className="ops-cockpit-grid">
              <div className="ops-panel status-panel">
                <div className="ops-panel-head"><h3>Status</h3></div>
                <div className="compact-status-grid status-sort-list">
                  {statusOrder.map((key) => {
                    const row = key === 'pbs' ? <><span>PBS</span><div className="tiny-toggle"><button className={detail.application.pbs_account_created ? 'active-good' : ''} onClick={() => setProcessFlag('pbsAccountCreated', true)} disabled={busy}>Yes</button><button className={!detail.application.pbs_account_created ? 'active-neutral' : ''} onClick={() => setProcessFlag('pbsAccountCreated', false)} disabled={busy}>No</button></div></>
                      : key === 'uez' ? <><span>UEZ</span><select value={detail.application.uez_application_status || 'not_started'} onChange={(e) => setProcessFlag('uezApplicationStatus', e.target.value)} disabled={busy}><option value="not_started">Not Started</option><option value="applied">Applied</option><option value="approved">Approved</option></select></>
                      : key === 'tax' ? <><span>Tax clearance{detail.application.tax_clearance_recheck_requested_at ? <small className="tax-recheck-note">Client says resolved</small> : null}</span><div className="tiny-toggle tax-tristate"><button className={(detail.application.tax_clearance_status || (detail.application.tax_clearance_good ? 'good' : 'no')) === 'no' ? 'active-neutral' : ''} onClick={() => setProcessFlag('taxClearanceStatus', 'no')} disabled={busy}>No</button><button className={(detail.application.tax_clearance_status || 'no') === 'issue' ? 'active-warn' : ''} onClick={() => setProcessFlag('taxClearanceStatus', 'issue')} disabled={busy}>Issue</button><button className={(detail.application.tax_clearance_status || (detail.application.tax_clearance_good ? 'good' : 'no')) === 'good' ? 'active-good' : ''} onClick={() => setProcessFlag('taxClearanceStatus', 'good')} disabled={busy}>Good</button></div></>
                      : <><span>Payment</span><div className="status-payment-value"><strong className={detail.payments?.[detail.payments.length - 1]?.status === 'paid' ? 'text-good' : detail.payments?.[detail.payments.length - 1]?.status === 'client_reported' ? 'text-warn' : ''}>{paymentStatusLabel(detail.payments?.[detail.payments.length - 1]?.status)}</strong>{detail.payments?.[detail.payments.length - 1]?.status === 'client_reported' && <button className="tiny-confirm" onClick={confirmPayment} disabled={busy}>Confirm</button>}</div></>;
                    return <div key={key} className="compact-status-item sortable-status-row" draggable onDragStart={() => setDragStatusKey(key)} onDragOver={(e) => e.preventDefault()} onDrop={() => dropStatus(key)}><i className="drag-handle" title="Drag to reorder">⋮⋮</i>{row}</div>;
                  })}
                </div>
              </div>

              <div className="ops-panel documents-panel">
                <div className="ops-panel-head"><h3>Documents</h3><span>{readyDocumentCount(detail)}/5 ready</span></div>
                <div className="ops-doc-list">
                  {(() => {
                    const formation = docFor(detail, 'formation');
                    const sole = detail.application.is_sole_proprietorship;
                    const review = detail.application.formation_review_status || 'not_reviewed';
                    return <>
                      <div className={`ops-doc-row reviewable-doc ${formationSatisfied(detail) ? 'ready' : review === 'rejected' ? 'bad' : formation ? 'review-pending' : ''}`}><button className="ops-doc-name" onClick={() => formation && previewDocument(formation)} disabled={!formation}><b>{formationSatisfied(detail) ? '✓' : formation ? '!' : '○'}</b><span>Certificate of Formation</span></button><small>{sole && !formation ? 'Not required (sole prop)' : !formation ? 'Missing' : review === 'approved' ? 'Approved' : review === 'rejected' ? 'Wrong document' : 'Review'}</small></div>
                      {review === 'rejected' && <button type="button" className="tiny-confirm" onClick={sendFormationRejectedEmail} disabled={busy}>Send replacement request email</button>}
                    </>;
                  })()}
                  {(() => {
                    const approval = docFor(detail, 'uez_approval_email');
                    const review = detail.application.uez_approval_review_status || 'not_reviewed';
                    return <div className={`ops-doc-row reviewable-doc ${review === 'approved' ? 'ready' : review === 'rejected' ? 'bad' : approval ? 'review-pending' : ''}`}><button className="ops-doc-name" onClick={() => approval && previewDocument(approval)} disabled={!approval}><b>{review === 'approved' ? '✓' : approval ? '!' : '○'}</b><span>UEZ Approval Email</span></button><small>{!approval ? 'Missing' : review === 'approved' ? 'Approved' : review === 'rejected' ? 'Wrong document' : 'Review'}</small></div>;
                  })()}
                  {[
                    ['brc', 'BRC'],
                    ['tax_clearance', 'Tax Clearance'],
                    ['ldc_application', 'Signed LDC Application']
                  ].map(([type, label]) => {
                    const doc = docFor(detail, type);
                    return <div key={type} className={`ops-doc-row ${doc ? 'ready' : ''}`}><button className="ops-doc-name" onClick={() => doc && previewDocument(doc)} disabled={!doc}><b>{doc ? '✓' : '○'}</b><span>{label}</span></button><small>{doc ? 'Received' : 'Missing'}</small></div>;
                  })}
                </div>
                <div className="admin-manual-upload">
                  <div className="admin-manual-upload-head"><strong>Manual document upload</strong><small>Fallback / records</small></div>
                  <select value={manualDocType} onChange={(e) => setManualDocType(e.target.value)}>
                    <option value="formation">Certificate of Formation</option>
                    <option value="brc">Business Registration Certificate</option>
                    <option value="uez_pending_certification">UEZ Pending Certification Application</option>
                    <option value="uez_approval_email">UEZ Approval Email</option>
                    <option value="tax_clearance">Tax Clearance Letter</option>
                    <option value="tax_clearance_issue">Tax Clearance Issue Screenshot</option>
                    <option value="ldc_application">Signed LDC Application</option>
                    <option value="supporting">Other / Supporting Document</option>
                  </select>
                  <input type="file" accept=".pdf,.eml,image/*" onChange={(e) => setManualDocFile(e.target.files?.[0] || null)} />
                  <button className="secondary" onClick={uploadManualAdminDocument} disabled={manualDocUploading || !manualDocFile}>{manualDocUploading ? 'Uploading…' : 'Upload document'}</button>
                </div>
              </div>

              <div className="ops-panel actions-panel">
                <div className="mobile-desktop-workflow-note">Desktop automation · These workflow buttons use the COR Chrome extension.</div>
                <div className="ops-action-grid clean-action-grid">
                  <button className={`ops-action ${docFor(detail, 'brc') ? 'success-action' : 'primary'}`} onClick={runBrcLookup} disabled={busy}><span>FETCH</span><strong>BRC</strong></button>
                  <button className={`ops-action ${detail.application.pbs_account_created ? 'success-action' : 'primary'}`} onClick={runPbsSignup} disabled={busy || !myNjCredentials}><span>OPEN</span><strong>PBS ACCOUNT</strong></button>
                  <button className="ops-action primary" onClick={runPbsLogin} disabled={busy || !myNjCredentials}><span>OPEN</span><strong>PBS</strong></button>
                  <button className={`ops-action ${docFor(detail, 'tax_clearance') ? 'success-action' : 'primary'}`} onClick={runTaxClearance} disabled={busy || !myNjCredentials}><span>FETCH</span><strong>TAX CLEARANCE</strong></button>
                  <button className={`ops-action ${docFor(detail, 'ldc_application') ? 'success-action' : 'primary'}`} onClick={runLdcJotform} disabled={busy}><span>FILL OUT</span><strong>LDC APP</strong></button>
                  <button className={`ops-action ${detail.application.status === 'applied' ? 'success-action' : packetReady(detail) ? 'ready-action' : ''}`} onClick={runLakewoodGrantPortal} disabled={busy || !packetReady(detail) || detail.application.status === 'applied'}><span>SUBMIT</span><strong>GRANT APP</strong></button>
                </div>
                {grantSubmissionLikelyDetected(detail) && <div className="grant-confirm-banner">
                  <span>COR saw what looks like a successful Lakewood submission, but couldn't confirm it automatically (no submission ID on that flow).</span>
                  <button className="warning-button" onClick={confirmGrantSubmitted} disabled={busy}>Confirm grant submitted</button>
                </div>}
              </div>
            </div>
          </section>

          <div className="admin-card-grid case-workbench-grid">
            <NotesPanel
              notes={detail.notes}
              draft={noteDraft}
              busy={noteBusy}
              editingId={noteEditingId}
              editDraft={noteEditDraft}
              onDraftChange={setNoteDraft}
              onAdd={addCaseNote}
              onStartEdit={startEditingNote}
              onCancelEdit={cancelEditingNote}
              onEditDraftChange={setNoteEditDraft}
              onSaveEdit={saveCaseNoteEdit}
              onDelete={removeCaseNote}
            />
            <ActivityPanel events={detail.statusEvents} />
          </div>

          <div className="admin-details-heading"><span>DETAILS</span><small>Reference information and manual overrides</small></div>

          <div className="admin-card-grid">
            <BusinessDetailsCard
              application={detail.application}
              editMode={editMode}
              draft={applicationDraft}
              onChangeField={updateApplicationDraft}
            />

            <PaymentCard payments={detail.payments} draft={paymentDraft} busy={busy} onDraftChange={setPaymentDraft} onConfirm={confirmPayment} />

            <BrcDetailsCard
              application={detail.application}
              brcForm={brcForm}
              busy={busy}
              onChangeBrcForm={setBrcForm}
              onBrcFound={saveBrcFound}
              onBrcNotFound={saveBrcNotFound}
              onSendBrcProblemEmail={sendBrcProblemEmail}
            />

            <MyNjPbsCard
              application={detail.application}
              myNjCredentials={myNjCredentials}
              pbsAnswerDraft={pbsAnswerDraft}
              pbsLoginDraft={pbsLoginDraft}
              myNjEditMode={myNjEditMode}
              myNjDraft={myNjDraft}
              showMyNjSecrets={showMyNjSecrets}
              busy={busy}
              onChangePbsAnswer={changePbsAnswerDraft}
              onChangePbsLoginDraft={setPbsLoginDraft}
              onSavePbsAnswer={saveExistingPbsAnswer}
              onChangeMyNjDraft={setMyNjDraft}
              onSaveMyNjCredentials={saveMyNjCredentials}
              onStartMyNjEdit={startMyNjEdit}
              onCancelMyNjEdit={cancelMyNjEdit}
              onToggleShowSecrets={toggleShowMyNjSecrets}
              onCopyCredential={copyCredential}
              onMarkPbsAccountCreated={markPbsAccountCreated}
              onCreateMyNjCredentials={createMyNjCredentials}
            />

            <OwnersCard
              owners={detail.owners}
              editMode={editMode}
              ownerDrafts={ownerDrafts}
              onChangeOwnerField={updateOwnerDraft}
              onAddOwner={addOwner}
              onRemoveOwner={removeOwner}
            />

            <DocumentsPanel documents={detail.documents} busy={busy} onOpen={openDoc} onDelete={handleDeleteDoc} />
          </div>
        </>}
        {pbsModalOpen && <div className="document-modal-backdrop pbs-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setPbsModalOpen(false); }}>
          <div className="document-modal pbs-modal" role="dialog" aria-modal="true" aria-label="NJ Premier Business Services">
            <div className="document-modal-head"><div><strong>NJ Premier Business Services</strong><small>Create / manage the applicant's PBS account</small></div><button onClick={() => setPbsModalOpen(false)} aria-label="Close PBS">×</button></div>
            <div className="document-modal-body pbs-modal-body"><iframe src={NJ_PBS_URL} title="NJ Premier Business Services" /></div>
            <div className="document-modal-footer"><div><a href={NJ_PBS_URL} target="_blank" rel="noreferrer">Open PBS in new tab</a><small className="pbs-frame-note">If New Jersey blocks the embedded page, use this link.</small></div><button className="secondary" onClick={() => setPbsModalOpen(false)}>Close</button></div>
          </div>
        </div>}
        {previewDoc && <div className="document-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closePreview(); }}>
          <div className="document-modal" role="dialog" aria-modal="true" aria-label={documentLabel(previewDoc.document_type)}>
            <div className="document-modal-head"><div><strong>{documentLabel(previewDoc.document_type)}</strong><small>{previewDoc.filename}</small></div><button onClick={closePreview} aria-label="Close document">×</button></div>
            <div className="document-modal-body">{previewBusy ? <div className="document-modal-loading">Loading document…</div> : previewUrl ? <iframe src={previewUrl} title={previewDoc.filename} /> : null}</div>
            <div className="document-modal-footer">
              <div>{previewUrl && <a href={previewUrl} target="_blank" rel="noreferrer">Open in new tab</a>}</div>
              {(previewDoc.document_type === 'formation' || previewDoc.document_type === 'uez_approval_email') && <div className="document-review-actions"><button className="warning-button" onClick={() => reviewPreviewDoc('rejected')} disabled={busy}>Wrong document</button><button className="success-button" onClick={() => reviewPreviewDoc('approved')} disabled={busy}>✓ Approve</button></div>}
            </div>
          </div>
        </div>}
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
