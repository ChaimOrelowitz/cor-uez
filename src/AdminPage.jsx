import React, { useEffect, useMemo, useState } from 'react';
import {
  createAdminMyNjCredentials,
  deleteDocument,
  getAdminApplication,
  getAdminApplications,
  getApplicantSession,
  getDocumentUrl,
  getMyNjCredentials,
  deleteAdminApplication,
  markAdminBrcFound,
  markAdminBrcNotFound,
  markAdminPbsAccountCreated,
  saveOwners,
  signInApplicant,
  signOutApplicant,
  updateAdminApplication,
  updateAdminMyNjCredentials,
  updateAdminApplicationStatus,
  updateAdminProcessFlags,
  saveAdminPayment,
  reviewAdminDocument,
  whoAmI
} from './api';

const NJ_BRC_LOOKUP_URL = 'https://www1.state.nj.us/TYTR_BRC/servlet/common/BRCLogin';
const NJ_REGISTRATION_URL = 'https://www.njportal.com/dor/businessregistration';
const NJ_PBS_URL = 'https://www-njlib.nj.gov/NJ_PREMIER_EBIZ/jsp/home.jsp';

function statusLabel(status) {
  return status === 'applied' || status === 'grant_submitted' ? 'Applied' : 'In Progress';
}

const REQUIRED_GRANT_DOCUMENTS = [
  ['formation', 'Certificate of Formation'],
  ['tax_clearance', 'Tax Clearance Letter'],
  ['ldc_application', 'Signed LDC Application'],
  ['brc', 'Business Registration Certificate'],
  ['uez_approval_email', 'UEZ Approval Email']
];

function programLabel(code) {
  return code === 'lakewood_technology_grant' ? 'Lakewood LDC Technology Grant' : (code || 'UEZ enrollment');
}

function documentLabel(type) {
  if (type === 'formation') return 'Formation document';
  if (type === 'brc') return 'BRC';
  if (type === 'uez_approval_email') return 'UEZ approval email';
  if (type === 'tax_clearance') return 'Tax-clearance letter';
  if (type === 'ldc_application') return 'LDC incentive application';
  if (type === 'supporting') return 'Supporting';
  return type;
}

function nameControl(name) {
  return String(name || '').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase();
}

function njTaxId(ein) {
  const digits = String(ein || '').replace(/\D/g, '').slice(0, 9);
  return digits.length === 9 ? `${digits}000` : '';
}

function formatSsn(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 9) return value || '—';
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function formatPhoneInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function formatSsnInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function formatDob(value) {
  const text = String(value || '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  return text;
}

function formatDobInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function uezStatusLabel(value) {
  if (value === 'approved') return 'Approved';
  if (value === 'applied') return 'Applied';
  return 'Not Started';
}

function paymentStatusLabel(value) {
  if (value === 'paid') return 'Paid';
  if (value === 'client_reported') return 'Client says paid';
  return 'Not recorded';
}

function docFor(detail, type) {
  return [...(detail?.documents || [])].reverse().find((doc) => doc.document_type === type) || null;
}

function formationSatisfied(detail) {
  const formation = docFor(detail, 'formation');
  if (!formation) return Boolean(detail?.application?.is_sole_proprietorship);
  return detail?.application?.formation_review_status === 'approved';
}

function packetReady(detail) {
  return formationSatisfied(detail)
    && Boolean(docFor(detail, 'brc'))
    && Boolean(docFor(detail, 'uez_approval_email'))
    && detail?.application?.uez_approval_review_status === 'approved'
    && Boolean(docFor(detail, 'tax_clearance'))
    && Boolean(docFor(detail, 'ldc_application'));
}

function readyDocumentCount(detail) {
  return (formationSatisfied(detail) ? 1 : 0)
    + (docFor(detail, 'brc') ? 1 : 0)
    + (docFor(detail, 'uez_approval_email') && detail?.application?.uez_approval_review_status === 'approved' ? 1 : 0)
    + (docFor(detail, 'tax_clearance') ? 1 : 0)
    + (docFor(detail, 'ldc_application') ? 1 : 0);
}

function attentionItems(detail) {
  if (!detail) return [];
  const items = [];
  const payment = detail.payments?.[detail.payments.length - 1];
  const formation = docFor(detail, 'formation');
  const approval = docFor(detail, 'uez_approval_email');
  if (payment?.status === 'client_reported') items.push('Client says payment was sent');
  if (detail.application.brc_status === 'client_created') items.push('Client says BRC was created — recheck BRC');
  if (formation && detail.application.formation_review_status === 'not_reviewed') items.push('Review Certificate of Formation');
  if (formation && detail.application.formation_review_status === 'rejected') items.push('Certificate of Formation marked wrong');
  if (approval && (detail.application.uez_approval_review_status || 'not_reviewed') === 'not_reviewed') items.push('Review UEZ approval email');
  return items;
}

function applicationDraftFrom(app) {
  return {
    contactEmail: app.contact_email || '',
    contactPhone: formatPhoneInput(app.contact_phone),
    businessName: app.business_name_input || '',
    registeredBusinessName: app.registered_business_name || '',
    ein: app.ein || '',
    businessDescription: app.business_description || '',
    yearFounded: app.year_founded ?? '',
    isSoleProprietorship: app.is_sole_proprietorship === true,
    fullTimeEmployees: app.full_time_employees ?? '',
    partTimeEmployees: app.part_time_employees ?? '',
    hasDba: app.has_dba == null ? '' : (app.has_dba ? 'yes' : 'no'),
    dbaName: app.dba_name || '',
    grantAmountRequested: app.grant_amount_requested ?? (app.program_code === 'lakewood_technology_grant' ? 5000 : ''),
    addressLine1: app.address_line1 || '',
    addressLine2: app.address_line2 || '',
    city: app.city || '',
    state: app.state || 'NJ',
    zip: app.zip || ''
  };
}

function ownerDraftFrom(owner = {}) {
  return {
    title: owner.title || '',
    firstName: owner.firstName || '',
    lastName: owner.lastName || '',
    email: owner.email || '',
    phone: formatPhoneInput(owner.phone),
    dob: formatDob(owner.dob),
    ssn: formatSsnInput(owner.ssn),
    ownershipPercent: owner.ownershipPercent ?? '',
    positionTitle: owner.positionTitle || '',
    addressLine1: owner.addressLine1 || '',
    addressLine2: owner.addressLine2 || '',
    city: owner.city || '',
    state: owner.state || 'NJ',
    zip: owner.zip || ''
  };
}

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
  const [filter, setFilter] = useState('progress');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
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
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
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

  useEffect(() => {
    if (!session || profile?.role !== 'admin') return undefined;
    let active = true;
    const refresh = async () => {
      if (!active || document.visibilityState !== 'visible' || busy || editMode || myNjEditMode || previewDoc) return;
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
    const timer = window.setInterval(refresh, 4000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [session, profile?.role, selectedId, busy, editMode, myNjEditMode, previewDoc]);

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
        if (message.status === 'complete') finish(null, { status: 'complete' });
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
      setMessage('Tax-clearance letter downloaded and added directly to this applicant’s UEZ file.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
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
      setMessage('Lakewood UEZ Technology Grant submitted successfully.');
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return applications.filter((app) => {
      const matchesSearch = !q || [app.business_name_input, app.registered_business_name, app.contact_email, app.ein]
        .some((value) => String(value || '').toLowerCase().includes(q));
      if (!matchesSearch) return false;
      if (filter === 'all') return true;
      if (filter === 'progress') return app.status !== 'applied';
      if (filter === 'applied') return app.status === 'applied';
      return true;
    });
  }, [applications, filter, search]);

  const counts = useMemo(() => ({
    progress: applications.filter((app) => app.status !== 'applied').length,
    applied: applications.filter((app) => app.status === 'applied').length,
    all: applications.length
  }), [applications]);

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
      <aside className="admin-sidebar">
        <div className="admin-sidebar-head">
          <div><span>APPLICATIONS</span><strong>{applications.length}</strong></div>
          <input placeholder="Search business, email, EIN" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="admin-filter-row">
          {[
            ['progress', 'In Progress', counts.progress],
            ['applied', 'Applied', counts.applied],
            ['all', 'All', counts.all]
          ].map(([key, label, count]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}<span>{count}</span></button>)}
        </div>

        <div className="application-list">
          {filtered.map((app) => {
            const needsAttention = app.payment_status === 'client_reported'
              || app.brc_status === 'client_created'
              || ((app.document_types || []).includes('formation') && app.formation_review_status !== 'approved')
              || ((app.document_types || []).includes('uez_approval_email') && (app.uez_approval_review_status || 'not_reviewed') === 'not_reviewed');
            return <button key={app.id} className={`application-list-item ops-list-item ${selectedId === app.id ? 'active' : ''}`} onClick={() => { setMobileDetailOpen(true); openApplication(app.id); window.scrollTo({ top: 0, behavior: 'instant' }); }}>
              <div className="ops-list-main"><strong>{app.business_name_input || 'Unnamed business'}{needsAttention && <i className="attention-dot" title="Needs attention" />}</strong><small>{app.required_document_ready_count || 0}/5 docs · UEZ {uezStatusLabel(app.uez_application_status)}</small></div>
              <div className="list-item-meta"><span className={`mini-status ${app.payment_status === 'paid' ? 'good' : app.payment_status === 'client_reported' ? 'warn' : ''}`}>{paymentStatusLabel(app.payment_status)}</span><small>{statusLabel(app.status)}</small></div>
            </button>;
          })}
          {filtered.length === 0 && <div className="empty-list">No applications in this view.</div>}
        </div>
      </aside>

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
                      : key === 'tax' ? <><span>Tax clearance</span><div className="tiny-toggle"><button className={detail.application.tax_clearance_good ? 'active-good' : ''} onClick={() => setProcessFlag('taxClearanceGood', true)} disabled={busy}>Good</button><button className={!detail.application.tax_clearance_good ? 'active-neutral' : ''} onClick={() => setProcessFlag('taxClearanceGood', false)} disabled={busy}>No</button></div></>
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
                    return <div className={`ops-doc-row reviewable-doc ${formationSatisfied(detail) ? 'ready' : review === 'rejected' ? 'bad' : formation ? 'review-pending' : ''}`}><button className="ops-doc-name" onClick={() => formation && previewDocument(formation)} disabled={!formation}><b>{formationSatisfied(detail) ? '✓' : formation ? '!' : '○'}</b><span>Certificate of Formation</span></button><small>{sole && !formation ? 'Not required (sole prop)' : !formation ? 'Missing' : review === 'approved' ? 'Approved' : review === 'rejected' ? 'Wrong document' : 'Review'}</small></div>;
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
              </div>
            </div>
          </section>

          <div className="admin-details-heading"><span>DETAILS</span><small>Reference information and manual overrides</small></div>

          <div className="admin-card-grid">
            <details className="admin-accordion"><summary><strong>Business details</strong><span>{detail.application.ein || 'No EIN'}</span></summary><section className="admin-card admin-business-card admin-secondary-card">
              <div className="admin-card-head"><h3>Business</h3><span>{programLabel(detail.application.program_code)}</span></div>
              {editMode ? <div className="admin-edit-grid">
                <div><label>Business name <span className="required-star">*</span></label><input value={applicationDraft.businessName} onChange={(e) => updateApplicationDraft('businessName', e.target.value)} /></div>
                <div><label>Registered business name</label><input value={applicationDraft.registeredBusinessName} onChange={(e) => updateApplicationDraft('registeredBusinessName', e.target.value)} /></div>
                <div><label>Contact email <span className="required-star">*</span></label><input type="email" value={applicationDraft.contactEmail} onChange={(e) => updateApplicationDraft('contactEmail', e.target.value)} /></div>
                <div><label>Contact phone</label><input inputMode="tel" value={applicationDraft.contactPhone} onChange={(e) => updateApplicationDraft('contactPhone', formatPhoneInput(e.target.value))} /></div>
                <div><label>EIN <span className="required-star">*</span></label><input inputMode="numeric" value={applicationDraft.ein} onChange={(e) => updateApplicationDraft('ein', e.target.value.replace(/\D/g, '').slice(0, 9))} /></div>
                <div><label>Year founded</label><input type="number" value={applicationDraft.yearFounded} onChange={(e) => updateApplicationDraft('yearFounded', e.target.value)} /></div>
                <div><label>Full-time employees</label><input type="number" min="0" value={applicationDraft.fullTimeEmployees} onChange={(e) => updateApplicationDraft('fullTimeEmployees', e.target.value)} /></div>
                <div><label>Part-time employees</label><input type="number" min="0" value={applicationDraft.partTimeEmployees} onChange={(e) => updateApplicationDraft('partTimeEmployees', e.target.value)} /></div>
                <div><label>Does the business have a DBA? <span className="required-star">*</span></label><select value={applicationDraft.hasDba} onChange={(e) => updateApplicationDraft('hasDba', e.target.value)}><option value="">Select yes or no</option><option value="yes">Yes</option><option value="no">No</option></select></div>
                {applicationDraft.hasDba === 'yes' && <div><label>DBA name <span className="required-star">*</span></label><input value={applicationDraft.dbaName} onChange={(e) => updateApplicationDraft('dbaName', e.target.value)} /></div>}
                <div><label>Grant amount requested</label><input type="number" min="0" step="0.01" value={applicationDraft.grantAmountRequested} onChange={(e) => updateApplicationDraft('grantAmountRequested', e.target.value)} /></div>
                <div className="admin-edit-wide"><label>Address <span className="required-star">*</span></label><input value={applicationDraft.addressLine1} onChange={(e) => updateApplicationDraft('addressLine1', e.target.value)} /></div>
                <div className="admin-edit-wide"><label>Address line 2</label><input value={applicationDraft.addressLine2} onChange={(e) => updateApplicationDraft('addressLine2', e.target.value)} /></div>
                <div><label>City</label><input value={applicationDraft.city} onChange={(e) => updateApplicationDraft('city', e.target.value)} /></div>
                <div><label>State</label><input maxLength="2" value={applicationDraft.state} onChange={(e) => updateApplicationDraft('state', e.target.value.toUpperCase())} /></div>
                <div><label>ZIP</label><input value={applicationDraft.zip} onChange={(e) => updateApplicationDraft('zip', e.target.value)} /></div>
                <label className="admin-checkbox"><input type="checkbox" checked={applicationDraft.isSoleProprietorship} onChange={(e) => updateApplicationDraft('isSoleProprietorship', e.target.checked)} /> Sole proprietorship</label>
                <div className="admin-edit-wide"><label>Business description</label><textarea rows="4" value={applicationDraft.businessDescription} onChange={(e) => updateApplicationDraft('businessDescription', e.target.value)} /></div>
              </div> : <dl className="data-grid">
                <div><dt>Business name</dt><dd>{detail.application.business_name_input}</dd></div>
                <div><dt>Registered name</dt><dd>{detail.application.registered_business_name || '—'}</dd></div>
                <div><dt>Contact email</dt><dd>{detail.application.contact_email || '—'}</dd></div>
                <div><dt>Contact phone</dt><dd>{detail.application.contact_phone || '—'}</dd></div>
                <div><dt>EIN</dt><dd>{detail.application.ein || '—'}</dd></div>
                <div><dt>Address</dt><dd>{[detail.application.address_line1, detail.application.address_line2, detail.application.city, detail.application.state, detail.application.zip].filter(Boolean).join(', ') || '—'}</dd></div>
                <div><dt>UEZ</dt><dd>{detail.application.zone_name || '—'}</dd></div>
                <div><dt>Founded</dt><dd>{detail.application.year_founded || '—'}</dd></div>
                <div><dt>Employees</dt><dd>{detail.application.full_time_employees ?? 0} FT · {detail.application.part_time_employees ?? 0} PT</dd></div>
                <div><dt>Business type</dt><dd>{detail.application.is_sole_proprietorship ? 'Sole proprietorship' : 'Entity'}</dd></div>
                <div><dt>DBA</dt><dd>{detail.application.has_dba == null ? '—' : detail.application.has_dba ? (detail.application.dba_name || 'Yes') : 'No'}</dd></div>
                <div><dt>Grant amount</dt><dd>{detail.application.grant_amount_requested == null ? '—' : `$${Number(detail.application.grant_amount_requested).toLocaleString()}`}</dd></div>
                <div className="data-wide"><dt>Description</dt><dd>{detail.application.business_description || '—'}</dd></div>
              </dl>}
            </section></details>

            <details className="admin-accordion"><summary><strong>Payment details</strong><span>{paymentStatusLabel(detail.payments?.[detail.payments.length - 1]?.status)}</span></summary><section className="admin-card payment-admin-card admin-secondary-card">
              <div className="admin-card-head"><h3>Payment details</h3><span>{detail.payments?.[detail.payments.length - 1]?.status === 'paid' ? 'PAID' : detail.payments?.[detail.payments.length - 1]?.status === 'client_reported' ? 'CLIENT SAYS PAID' : 'NOT RECORDED'}</span></div>
              {detail.payments?.[detail.payments.length - 1]?.status === 'client_reported' && <div className="admin-alert">Client says payment was sent. Check your bank before confirming.</div>}
              <div className="admin-edit-grid"><div><label>Amount</label><input type="number" value={paymentDraft.amount} onChange={(e) => setPaymentDraft((old) => ({...old, amount:e.target.value}))} /></div><div><label>Date</label><input type="date" value={paymentDraft.paymentDate} onChange={(e) => setPaymentDraft((old) => ({...old, paymentDate:e.target.value}))} /></div><div><label>Method</label><input value={paymentDraft.paymentMethod} onChange={(e) => setPaymentDraft((old) => ({...old, paymentMethod:e.target.value}))} /></div><div><label>Reference</label><input value={paymentDraft.reference} onChange={(e) => setPaymentDraft((old) => ({...old, reference:e.target.value}))} /></div><div className="admin-edit-wide"><label>Notes</label><input value={paymentDraft.notes} onChange={(e) => setPaymentDraft((old) => ({...old, notes:e.target.value}))} /></div></div>
              {detail.payments?.[detail.payments.length - 1]?.status !== 'paid' && <button className="success-button admin-full-button" onClick={confirmPayment} disabled={busy}>✓ Confirm payment received</button>}
            </section></details>

            <details className="admin-accordion"><summary><strong>BRC details</strong><span>{detail.application.brc_status === 'found' ? 'Found' : (detail.application.brc_status || 'Pending')}</span></summary><section className="admin-card brc-admin-card admin-secondary-card">
              <div className="admin-card-head"><h3>BRC details</h3><span className={`status-pill ${detail.application.brc_status === 'found' ? 'good' : detail.application.status === 'waiting_for_brc' ? 'warn' : ''}`}>{detail.application.brc_status || 'pending'}</span></div>

              <div className="brc-result-form">
                <label>Registered business name</label><input value={brcForm.registeredBusinessName} onChange={(e) => setBrcForm((old) => ({ ...old, registeredBusinessName: e.target.value }))} />
                <label>DBA / trade name</label><input value={brcForm.tradeName} onChange={(e) => setBrcForm((old) => ({ ...old, tradeName: e.target.value }))} />
                <label>Business address</label><input value={brcForm.address} onChange={(e) => setBrcForm((old) => ({ ...old, address: e.target.value }))} />
              </div>

              <div className="admin-action-row">
                <button className="success-button" onClick={saveBrcFound} disabled={busy}>✓ BRC found</button>
                <button className="warning-button" onClick={saveBrcNotFound} disabled={busy}>No BRC found</button>
              </div>

            </section></details>

            <details className="admin-accordion"><summary><strong>MyNJ / PBS</strong><span>{myNjCredentials ? 'Login ready' : 'Not created'}</span></summary><section className="admin-card mynj-card admin-account-card admin-secondary-card">
              <div className="admin-card-head"><h3>MyNJ / PBS account</h3><span>{detail.application.pbs_status === 'account_created' || detail.application.pbs_status === 'uez_approval_uploaded' ? 'ACCOUNT CREATED' : myNjCredentials ? 'LOGIN READY' : 'NOT CREATED'}</span></div>
              {myNjCredentials ? <>
                {myNjEditMode ? <div className="credential-edit-grid">
                  <label>MyNJ username <span className="required-star">*</span><input value={myNjDraft?.username || ''} onChange={(e) => setMyNjDraft((old) => ({ ...old, username: e.target.value }))} /></label>
                  <label>MyNJ password <span className="required-star">*</span><input value={myNjDraft?.password || ''} onChange={(e) => setMyNjDraft((old) => ({ ...old, password: e.target.value }))} /></label>
                  <label>Challenge question <span className="required-star">*</span><input value={myNjDraft?.challengeQuestion || ''} onChange={(e) => setMyNjDraft((old) => ({ ...old, challengeQuestion: e.target.value }))} /></label>
                  <label>Challenge answer <span className="required-star">*</span><input value={myNjDraft?.challengeAnswer || ''} onChange={(e) => setMyNjDraft((old) => ({ ...old, challengeAnswer: e.target.value }))} /></label>
                  <div className="admin-action-row">
                    <button className="primary" onClick={saveMyNjCredentials} disabled={busy}>Save login information</button>
                    <button className="secondary" onClick={() => { setMyNjDraft(myNjCredentials); setMyNjEditMode(false); }} disabled={busy}>Cancel</button>
                  </div>
                </div> : <>
                  <div className="credential-grid">
                    <div><span>MyNJ username</span><strong>{myNjCredentials.username}</strong><button onClick={() => copyCredential(myNjCredentials.username, 'Username')}>Copy</button></div>
                    <div><span>MyNJ password</span><strong>{showMyNjSecrets ? myNjCredentials.password : '••••••••••••'}</strong><button onClick={() => copyCredential(myNjCredentials.password, 'Password')}>Copy</button></div>
                    <div><span>Challenge question</span><strong>{myNjCredentials.challengeQuestion}</strong><button onClick={() => copyCredential(myNjCredentials.challengeQuestion, 'Challenge question')}>Copy</button></div>
                    <div><span>Challenge answer</span><strong>{showMyNjSecrets ? myNjCredentials.challengeAnswer : '••••••••'}</strong><button onClick={() => copyCredential(myNjCredentials.challengeAnswer, 'Challenge answer')}>Copy</button></div>
                  </div>
                  <button className="secondary admin-full-button" onClick={() => setShowMyNjSecrets((shown) => !shown)}>{showMyNjSecrets ? 'Hide password and answer' : 'Reveal password and answer'}</button>
                  <button className="secondary admin-full-button" onClick={() => { setMyNjDraft(myNjCredentials); setMyNjEditMode(true); setShowMyNjSecrets(true); }}>Edit login information</button>
                </>}
                <p className="admin-help">Stored encrypted in the UEZ application. The applicant sees the same MyNJ information in their portal.</p>
                {detail.application.pbs_status !== 'account_created' && detail.application.pbs_status !== 'uez_approval_uploaded' && <button className="success-button admin-full-button" onClick={markPbsAccountCreated} disabled={busy}>✓ PBS account has been created</button>}
                {(detail.application.pbs_status === 'account_created' || detail.application.status === 'waiting_for_uez_approval') && <p className="admin-help">Waiting for the applicant to upload the required UEZ approval email.</p>}
                {detail.application.pbs_status === 'uez_approval_uploaded' && <p className="admin-help">The applicant uploaded the UEZ approval email. Open it in Documents below.</p>}
              </> : <>
                <p className="admin-help mynj-intro">This login is generated automatically as soon as the BRC is confirmed. If an earlier confirmation did not generate it, retry here.</p>
                <button
                  className="primary admin-full-button"
                  onClick={createMyNjCredentials}
                  disabled={busy || detail.application.brc_status !== 'found'}
                >Generate missing MyNJ login</button>
                {detail.application.brc_status !== 'found' && <p className="admin-help">The BRC must be confirmed first.</p>}
              </>}
            </section></details>

            <details className="admin-accordion"><summary><strong>Owners</strong><span>{`${detail.owners.length} owner${detail.owners.length === 1 ? '' : 's'}`}</span></summary><section className="admin-card admin-wide admin-owners-card admin-secondary-card">
              <div className="admin-card-head"><h3>Owners</h3><span>{editMode ? ownerDrafts.length : detail.owners.length}</span></div>
              {editMode ? <>
                <div className="owner-admin-list owner-edit-list">
                  {ownerDrafts.map((owner, index) => <div className="owner-admin-card" key={`owner-edit-${index}`}>
                    <div className="owner-admin-title">
                      <strong>Owner {index + 1}</strong>
                      <button className="owner-remove-button" type="button" onClick={() => removeOwner(index)}>Remove owner</button>
                    </div>
                    <div className="admin-edit-grid owner-edit-grid">
                      <div><label>Title (Mr., Mrs., etc.) <span className="required-star">*</span></label><select value={owner.title || ''} onChange={(e) => updateOwnerDraft(index, 'title', e.target.value)}><option value="">Select title</option><option value="Mr.">Mr.</option><option value="Mrs.">Mrs.</option><option value="Ms.">Ms.</option><option value="Dr.">Dr.</option><option value="Rabbi">Rabbi</option>{owner.title && !['Mr.','Mrs.','Ms.','Dr.','Rabbi'].includes(owner.title) && <option value={owner.title}>{owner.title}</option>}</select></div>
                      <div><label>First name <span className="required-star">*</span></label><input value={owner.firstName} onChange={(e) => updateOwnerDraft(index, 'firstName', e.target.value)} /></div>
                      <div><label>Last name <span className="required-star">*</span></label><input value={owner.lastName} onChange={(e) => updateOwnerDraft(index, 'lastName', e.target.value)} /></div>
                      <div><label>Email <span className="required-star">*</span></label><input type="email" value={owner.email} onChange={(e) => updateOwnerDraft(index, 'email', e.target.value)} /></div>
                      <div><label>Phone <span className="required-star">*</span></label><input inputMode="tel" value={owner.phone} onChange={(e) => updateOwnerDraft(index, 'phone', formatPhoneInput(e.target.value))} /></div>
                      <div><label>Date of birth (MM/DD/YYYY) <span className="required-star">*</span></label><input inputMode="numeric" placeholder="MM/DD/YYYY" value={owner.dob} onChange={(e) => updateOwnerDraft(index, 'dob', formatDobInput(e.target.value))} /></div>
                      <div><label>SSN <span className="required-star">*</span></label><input inputMode="numeric" placeholder="###-##-####" value={owner.ssn} onChange={(e) => updateOwnerDraft(index, 'ssn', formatSsnInput(e.target.value))} /></div>
                      <div><label>Ownership percentage <span className="required-star">*</span></label><input type="number" min="0.01" max="100" step="0.01" value={owner.ownershipPercent} onChange={(e) => updateOwnerDraft(index, 'ownershipPercent', e.target.value)} /></div>
                      <div><label>Position / title</label><input value={owner.positionTitle} onChange={(e) => updateOwnerDraft(index, 'positionTitle', e.target.value)} placeholder={ownerDrafts.length === 1 ? 'Owner' : 'Partner'} /></div>
                      <div><label>Address <span className="required-star">*</span></label><input value={owner.addressLine1} onChange={(e) => updateOwnerDraft(index, 'addressLine1', e.target.value)} /></div>
                      <div><label>Address line 2</label><input value={owner.addressLine2} onChange={(e) => updateOwnerDraft(index, 'addressLine2', e.target.value)} /></div>
                      <div><label>City <span className="required-star">*</span></label><input value={owner.city} onChange={(e) => updateOwnerDraft(index, 'city', e.target.value)} /></div>
                      <div><label>State <span className="required-star">*</span></label><input maxLength="2" value={owner.state} onChange={(e) => updateOwnerDraft(index, 'state', e.target.value.toUpperCase())} /></div>
                      <div><label>ZIP <span className="required-star">*</span></label><input value={owner.zip} onChange={(e) => updateOwnerDraft(index, 'zip', e.target.value)} /></div>
                    </div>
                  </div>)}
                </div>
                <button className="secondary admin-add-owner" type="button" onClick={addOwner}>+ Add owner</button>
              </> : <div className="owner-admin-list">
                {detail.owners.map((owner) => <div className="owner-admin-card" key={owner.id}>
                  <div className="owner-admin-title"><strong>{owner.firstName} {owner.lastName}</strong><span>{owner.ownershipPercent}%</span></div>
                  <dl className="data-grid compact-data">
                    <div><dt>Title</dt><dd>{owner.title || '—'}</dd></div>
                    <div><dt>Email</dt><dd>{owner.email || '—'}</dd></div>
                    <div><dt>Phone</dt><dd>{owner.phone || '—'}</dd></div>
                    <div><dt>Position / title</dt><dd>{owner.positionTitle || (detail.owners.length === 1 ? 'Owner' : 'Partner')}</dd></div>
                    <div><dt>DOB</dt><dd>{formatDob(owner.dob) || '—'}</dd></div>
                    <div><dt>SSN</dt><dd>{formatSsn(owner.ssn)}</dd></div>
                    <div className="data-wide"><dt>Address</dt><dd>{[owner.addressLine1, owner.addressLine2, owner.city, owner.state, owner.zip].filter(Boolean).join(', ') || '—'}</dd></div>
                  </dl>
                </div>)}
              </div>}
            </section></details>

            <details className="admin-accordion"><summary><strong>Documents</strong><span>{`${detail.documents.length} files`}</span></summary><section className="admin-card admin-documents-card admin-secondary-card">
              <div className="admin-card-head"><h3>Documents</h3><span>{detail.documents.length}</span></div>
              <div className="admin-document-list">
                {detail.documents.map((doc) => (
                  <div key={doc.id} className="admin-doc-row">
                    <button type="button" className="admin-doc-open-btn" onClick={() => openDoc(doc)}>
                      <span><strong>{documentLabel(doc.document_type)}</strong><small>{doc.filename}</small></span>
                      <b>Open</b>
                    </button>
                    <button type="button" className="admin-doc-delete-btn" onClick={() => handleDeleteDoc(doc)} disabled={busy} title="Delete document">
                      Delete
                    </button>
                  </div>
                ))}
                {detail.documents.length === 0 && <p className="muted">No documents uploaded.</p>}
              </div>
            </section></details>
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
      </section>
    </main>
  </div>;
}
