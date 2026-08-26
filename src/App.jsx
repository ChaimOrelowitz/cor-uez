import React, { useEffect, useMemo, useState } from 'react';
import { checkUezEligibility, suggestNjAddresses } from './eligibility';
import UezMap from './UezMap';
import {
  createApplication,
  getApplicantSession,
  getApplication,
  getDocumentUrl,
  getMyApplications,
  getMyNjCredentials,
  saveBusiness,
  saveOwners,
  signInApplicant,
  signOutApplicant,
  signUpApplicant,
  submitApplication,
  uploadApplicationDocument,
  deleteDocument,
  reportApplicantPayment
} from './api';

const steps = ['Address', 'Eligibility', 'Account', 'Business', 'Owners', 'Documents', 'Review'];
const NJ_REGISTRATION_URL = 'https://www.njportal.com/dor/businessregistration';
const blankOwner = () => ({ firstName: '', lastName: '', email: '', phone: '', dob: '', ssn: '', ownershipPercent: '' });

function programNameFromCode(code) {
  if (code === 'lakewood_technology_grant') return 'Lakewood LDC Technology Grant';
  return 'UEZ enrollment';
}

function statusLabel(status) {
  return status === 'applied' ? 'Applied' : 'In Progress';
}


function documentLabel(type) {
  const labels = {
    formation: 'Certificate of Formation / formation document',
    brc: 'Business Registration Certificate',
    uez_approval_email: 'Notice of Certification Application Approved email',
    tax_clearance: 'New Jersey tax-clearance letter',
    ldc_application: 'Lakewood LDC incentive application',
    supporting: 'Supporting document'
  };
  return labels[type] || type;
}

function formatPhone(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0,3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
}
function formatSsn(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0,3)}-${digits.slice(3)}`;
  return `${digits.slice(0,3)}-${digits.slice(3,5)}-${digits.slice(5)}`;
}
function formatDob(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0,2)}/${digits.slice(2)}`;
  return `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`;
}

function ApplicantPortal({ bundle, onRefresh, onSignOut }) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [myNjCredentials, setMyNjCredentials] = useState(null);
  const [showMyNjSecrets, setShowMyNjSecrets] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const app = bundle.application;
  const needsBrc = ['not_found', 'missing', 'required'].includes(app.brc_status) || app.status === 'waiting_for_brc';
  const brcUploaded = app.brc_status === 'uploaded' || app.status === 'brc_uploaded';
  const brcConfirmed = app.brc_status === 'found' || app.status === 'brc_confirmed';
  const approvalUploaded = bundle.documents.some((doc) => doc.document_type === 'uez_approval_email');
  const latestPayment = [...(bundle.payments || [])].reverse()[0] || null;
  const needsApprovalEmail = app.pbs_status === 'account_created' || app.status === 'waiting_for_uez_approval';

  useEffect(() => {
    let active = true;
    getMyNjCredentials(app.id).then((result) => {
      if (active) setMyNjCredentials(result.exists ? result.credentials : null);
    }).catch(() => {});
    return () => { active = false; };
  }, [app.id]);

  async function uploadBrc(file) {
    if (!file) return;
    setUploading(true);
    setMessage('');
    try {
      await uploadApplicationDocument(app.id, 'brc', file);
      await onRefresh();
      setMessage('BRC uploaded. COR will review it.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function uploadApprovalEmail(file) {
    if (!file) return;
    setUploading(true);
    setMessage('');
    try {
      await uploadApplicationDocument(app.id, 'uez_approval_email', file);
      await onRefresh();
      setMessage('Your UEZ approval email was uploaded. COR will verify it.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function reportPaymentSent() {
    setPaymentBusy(true); setMessage('');
    try {
      await reportApplicantPayment(app.id);
      await onRefresh();
      setMessage('Thanks. COR will verify the payment and update your account.');
    } catch (err) { setMessage(err.message); }
    finally { setPaymentBusy(false); }
  }

  async function openDocument(doc) {
    try {
      const result = await getDocumentUrl(app.id, doc.id);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setMessage(err.message);
    }
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark">COR</div>
      <div><div className="brand-name">COR Solutions</div><div className="brand-subtitle">UEZ Application Portal</div></div>
      <button className="signin-link" onClick={onSignOut}>Sign out</button>
    </header>
    <main className="page-wrap portal-wrap">
      <section className="hero portal-hero">
        <div className="eyebrow">YOUR UEZ APPLICATION</div>
        <h1>{app.business_name_input || 'Your application'}</h1>
        <p>COR will post each next step here as your application moves forward.</p>
      </section>

      <div className="portal-grid">
        <section className="wizard-card portal-card">
          <div className="portal-status-row">
            <div>
              <span className="step-count">CURRENT STATUS</span>
              <h2>{statusLabel(app.status)}</h2>
            </div>
            <span className={`status-pill ${brcConfirmed ? 'good' : needsBrc ? 'warn' : ''}`}>{statusLabel(app.status)}</span>
          </div>

          {needsBrc && <div className="action-panel warn-panel">
            <h3>We need your New Jersey BRC</h3>
            <p>COR could not locate a current Business Registration Certificate. Complete New Jersey business/tax registration, then upload the BRC here.</p>
            <div className="action-row">
              <a className="primary compact inline-button" href={NJ_REGISTRATION_URL} target="_blank" rel="noreferrer">Register with New Jersey</a>
              <label className="secondary inline-button file-button">
                {uploading ? 'Uploading…' : 'Upload completed BRC'}
                <input type="file" accept=".pdf,image/*" disabled={uploading} onChange={(e) => uploadBrc(e.target.files?.[0])} />
              </label>
            </div>
          </div>}

          {brcUploaded && <div className="action-panel">
            <h3>BRC received</h3>
            <p>Your certificate is in your account. COR will verify it and continue your application.</p>
          </div>}

          {brcConfirmed && <div className="action-panel good-panel">
            <h3>✓ BRC confirmed</h3>
            <p>{app.registered_business_name || app.brc_registered_name || app.business_name_input}</p>
          </div>}

          {needsApprovalEmail && !approvalUploaded && <div className="action-panel warn-panel">
            <h3>Upload your UEZ approval email <span className="required-star">*</span></h3>
            <p>Upload the “Notice of Certification Application Approved” email you received from UEZdonotreply@dca.nj.gov as proof that the business is registered in the program.</p>
            <label className="primary compact inline-button file-button">
              {uploading ? 'Uploading…' : 'Upload required approval email'}
              <input type="file" accept=".pdf,.eml,image/*" disabled={uploading} onChange={(e) => uploadApprovalEmail(e.target.files?.[0])} />
            </label>
          </div>}

          {approvalUploaded && <div className="action-panel good-panel">
            <h3>✓ UEZ approval email received</h3>
            <p>COR will verify the notice and continue your application.</p>
          </div>}

          {message && <div className="form-message portal-message">{message}</div>}
        </section>

        <section className="wizard-card portal-card">
          <div className="portal-section-head"><h3>Documents</h3><span>{bundle.documents.length}</span></div>
          <div className="document-list">
            {bundle.documents.length === 0 && <p className="muted">No documents uploaded yet.</p>}
            {bundle.documents.map((doc) => <button className="document-row" key={doc.id} onClick={() => openDocument(doc)}>
              <span><strong>{documentLabel(doc.document_type)}</strong><small>{doc.filename}</small></span>
              <b>Open</b>
            </button>)}
          </div>
        </section>

        <section className="wizard-card portal-card">
          <div className="portal-section-head"><h3>Payment</h3><span>$500</span></div>
          {latestPayment?.status === 'paid' ? <div className="action-panel good-panel"><h3>✓ Client payment recorded</h3><p>COR confirmed that your payment was received.</p></div>
            : latestPayment?.status === 'client_reported' ? <div className="action-panel"><h3>Payment reported</h3><p>You told COR the payment was sent. We are verifying it.</p></div>
            : <><p className="muted">After you send the $500 payment, click below so COR knows to check for it.</p><button className="primary admin-full-button" onClick={reportPaymentSent} disabled={paymentBusy}>{paymentBusy ? 'Saving…' : 'I sent my payment'}</button></>}
        </section>

        {myNjCredentials && <section className="wizard-card portal-card portal-wide mynj-card">
          <div className="portal-section-head"><h3>MyNJ / PBS account information</h3><span>✓</span></div>
          <div className="credential-grid applicant-credential-grid">
            <div><span>MyNJ username</span><strong>{myNjCredentials.username}</strong></div>
            <div><span>MyNJ password</span><strong>{showMyNjSecrets ? myNjCredentials.password : '••••••••••••'}</strong></div>
            <div><span>Challenge question</span><strong>{myNjCredentials.challengeQuestion}</strong></div>
            <div><span>Challenge answer</span><strong>{showMyNjSecrets ? myNjCredentials.challengeAnswer : '••••••••'}</strong></div>
          </div>
          <button className="secondary portal-secret-button" onClick={() => setShowMyNjSecrets((shown) => !shown)}>{showMyNjSecrets ? 'Hide password and answer' : 'Reveal password and answer'}</button>
          <p className="muted credential-note">Keep this information private. COR can also access it while completing your PBS account.</p>
        </section>}

        <section className="wizard-card portal-card portal-wide">
          <div className="portal-section-head"><h3>Updates</h3></div>
          <div className="timeline">
            {[...bundle.statusEvents].reverse().map((event) => <div className="timeline-item" key={event.id}>
              <span className="timeline-dot"></span>
              <div><strong>{event.label || statusLabel(event.status)}</strong><p>{event.message}</p><small>{new Date(event.created_at).toLocaleString()}</small></div>
            </div>)}
          </div>
        </section>
      </div>
    </main>
  </div>;
}

export default function App() {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [eligibility, setEligibility] = useState(null);
  const [applicationId, setApplicationId] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [portalBundle, setPortalBundle] = useState(null);
  const [ownerError, setOwnerError] = useState('');
  const [signInMode, setSignInMode] = useState(false);
  const [session, setSession] = useState(null);
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [addressMagicKey, setAddressMagicKey] = useState(null);
  const [showAddressSuggestions, setShowAddressSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [documents, setDocuments] = useState([]);
  const [uploadingType, setUploadingType] = useState('');
  const [form, setForm] = useState({
    address: '', email: '', password: '', businessName: '', businessDescription: '', ein: '', yearFounded: '',
    isSoleProprietorship: '', fullTimeEmployees: '', partTimeEmployees: '', hasDba: '', dbaName: '',
    owners: [{ ...blankOwner(), ownershipPercent: '100' }]
  });

  const progress = useMemo(() => `${step + 1} of ${steps.length}`, [step]);
  const ownershipTotal = useMemo(() => form.owners.reduce((sum, owner) => sum + (Number(owner.ownershipPercent) || 0), 0), [form.owners]);
  const primaryIs100 = form.owners.length === 1 && form.owners[0].ownershipPercent === '100';
  const eligibleProgramName = eligibility?.programs?.[0]?.name || programNameFromCode(bundle?.application?.program_code);
  const hasFormation = documents.some((doc) => doc.document_type === 'formation');
  const update = (key) => (e) => setForm((old) => ({ ...old, [key]: e.target.value }));

  useEffect(() => {
    getApplicantSession().then((current) => {
      setSession(current || null);
      if (current) loadLatestApplication().catch(() => {});
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (step !== 0 || addressMagicKey || form.address.trim().length < 3) {
      setAddressSuggestions([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const suggestions = await suggestNjAddresses(form.address);
        if (!cancelled) {
          setAddressSuggestions(suggestions);
          setShowAddressSuggestions(suggestions.length > 0);
          setActiveSuggestionIndex(-1);
        }
      } catch (_) {
        if (!cancelled) setAddressSuggestions([]);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [form.address, addressMagicKey, step]);

  async function loadLatestApplication() {
    const applications = await getMyApplications();
    const latest = applications?.[0];
    if (!latest) return null;

    const full = await getApplication(latest.id);
    setBundle(full);
    setApplicationId(latest.id);
    setDocuments(full.documents || []);
    setForm((old) => ({
      ...old,
      email: latest.contact_email || old.email,
      address: latest.address_line1 || old.address,
      businessName: latest.business_name_input || old.businessName,
      businessDescription: latest.business_description || old.businessDescription,
      ein: latest.ein || old.ein,
      yearFounded: latest.year_founded ?? old.yearFounded,
      isSoleProprietorship: latest.is_sole_proprietorship == null ? old.isSoleProprietorship : (latest.is_sole_proprietorship ? 'yes' : 'no'),
      fullTimeEmployees: latest.full_time_employees ?? old.fullTimeEmployees,
      partTimeEmployees: latest.part_time_employees ?? old.partTimeEmployees,
      hasDba: latest.has_dba == null ? old.hasDba : (latest.has_dba ? 'yes' : 'no'),
      dbaName: latest.dba_name || old.dbaName,
      owners: full.owners?.length
        ? full.owners.map((owner) => ({
            firstName: owner.first_name || '',
            lastName: owner.last_name || '',
            email: owner.email || '',
            phone: owner.phone || '',
            dob: '',
            ssn: '',
            ownershipPercent: String(owner.ownership_percent ?? '')
          }))
        : old.owners
    }));

    if (latest.submitted_at) {
      setPortalBundle(full);
      return full;
    }

    setEligibility(latest.zone_eligible ? {
      eligible: true,
      matchedAddress: latest.address_line1,
      zoneIdentifier: latest.zone_identifier,
      zoneName: latest.zone_name,
      programs: latest.program_code ? [{ code: latest.program_code, name: programNameFromCode(latest.program_code) }] : []
    } : null);

    if (latest.business_name_input && full.owners?.length) setStep((full.documents || []).length ? 6 : 5);
    else if (latest.business_name_input) setStep(4);
    else setStep(3);
    return full;
  }

  function updateOwner(index, key) {
    return (e) => {
      const raw = e.target.value;
      const value = key === 'phone' ? formatPhone(raw) : key === 'ssn' ? formatSsn(raw) : key === 'dob' ? formatDob(raw) : raw;
      setForm((old) => ({ ...old, owners: old.owners.map((owner, i) => i === index ? { ...owner, [key]: value } : owner) }));
      setOwnerError('');
    };
  }

  function handleAddressKeyDown(e) {
    if (!showAddressSuggestions || !addressSuggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSuggestionIndex((i) => Math.min(i + 1, addressSuggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSuggestionIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && activeSuggestionIndex >= 0) { e.preventDefault(); selectAddressSuggestion(addressSuggestions[activeSuggestionIndex]); }
    else if (e.key === 'Escape') { setShowAddressSuggestions(false); setActiveSuggestionIndex(-1); }
  }

  function updateAddress(e) {
    const value = e.target.value;
    setForm((old) => ({ ...old, address: value }));
    setAddressMagicKey(null);
    setEligibility(null);
    setShowAddressSuggestions(true);
    setMessage('');
  }

  function selectAddressSuggestion(suggestion) {
    setForm((old) => ({ ...old, address: suggestion.text }));
    setAddressMagicKey(suggestion.magicKey || null);
    setAddressSuggestions([]);
    setShowAddressSuggestions(false);
    setActiveSuggestionIndex(-1);
    setEligibility(null);
    setMessage('');
  }

  async function runAddressCheck(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    setShowAddressSuggestions(false);
    try {
      const result = await checkUezEligibility(form.address.trim(), addressMagicKey);
      setEligibility(result);
      if (result?.matchedAddress) setForm((old) => ({ ...old, address: result.matchedAddress }));
      if (result?.status === 'address_not_found') setMessage('We could not confidently match that address. Please choose a suggested address or check the spelling.');
      else if (!result?.eligible) setMessage('This address does not appear to be inside a New Jersey Urban Enterprise Zone.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createAccountAndCase() {
    if (!form.email.trim() || !form.password || form.password.length < 6) {
      setMessage('Enter your email and a password of at least 6 characters.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      localStorage.setItem('uez_pending_application', JSON.stringify({
        email: form.email.trim(),
        address: eligibility?.matchedAddress || form.address,
        eligibility
      }));
      const auth = await signUpApplicant(form.email.trim(), form.password);
      if (!auth.session) {
        setSignInMode(true);
        setMessage('Check your email to confirm your account. Then return here and sign in.');
        return;
      }
      setSession(auth.session);
      const app = await createApplication({
        contactEmail: form.email.trim(),
        address: eligibility?.matchedAddress || form.address,
        zoneIdentifier: eligibility?.zoneIdentifier,
        zoneName: eligibility?.zoneName,
        zoneEligible: eligibility?.eligible === true,
        programCode: eligibility?.programs?.[0]?.code || null
      });
      setApplicationId(app.id);
      localStorage.removeItem('uez_pending_application');
      setForm((old) => ({
        ...old,
        owners: old.owners.map((owner, index) => index === 0 && !owner.email ? { ...owner, email: old.email } : owner)
      }));
      setStep(3);
    } catch (err) {
      if (/already|registered|exists/i.test(err.message)) setSignInMode(true);
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function signInAndResume() {
    if (!form.email.trim() || !form.password) {
      setMessage('Enter your email and password.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const auth = await signInApplicant(form.email.trim(), form.password);
      setSession(auth.session || null);
      const loaded = await loadLatestApplication();
      if (!loaded) {
        let pending = null;
        try {
          pending = JSON.parse(localStorage.getItem('uez_pending_application') || 'null');
        } catch (_) {}

        const pendingEligibility = pending?.eligibility || eligibility;
        const pendingAddress = pending?.address || pendingEligibility?.matchedAddress || form.address;

        if (pendingEligibility?.eligible && pendingAddress) {
          setEligibility(pendingEligibility);
          setForm((old) => ({
            ...old,
            address: pendingAddress,
            email: pending?.email || old.email,
            owners: old.owners.map((owner, index) => index === 0 && !owner.email
              ? { ...owner, email: pending?.email || old.email }
              : owner)
          }));

          const app = await createApplication({
            contactEmail: pending?.email || form.email.trim(),
            address: pendingAddress,
            zoneIdentifier: pendingEligibility?.zoneIdentifier,
            zoneName: pendingEligibility?.zoneName,
            zoneEligible: pendingEligibility?.eligible === true,
            programCode: pendingEligibility?.programs?.[0]?.code || null
          });
          setApplicationId(app.id);
          localStorage.removeItem('uez_pending_application');
          setSignInMode(false);
          setStep(3);
          setMessage('Account confirmed. Continue with your business information.');
        } else {
          setSignInMode(false);
          setStep(0);
          setMessage('Signed in. Start by checking your business address.');
        }
      }
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveBusinessStep() {
    const einDigits = form.ein.replace(/\D/g, '');
    if (!form.businessName.trim() || !form.businessDescription.trim() || einDigits.length !== 9 || !form.isSoleProprietorship || !form.hasDba || (form.hasDba === 'yes' && !form.dbaName.trim())) {
      setMessage('Complete the business name, description, 9-digit EIN, business type, and DBA information before continuing.');
      return;
    }
    if (!applicationId) {
      setMessage('Your application has not been created yet.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      await saveBusiness(applicationId, {
        businessName: form.businessName,
        businessDescription: form.businessDescription,
        ein: form.ein,
        yearFounded: form.yearFounded,
        isSoleProprietorship: form.isSoleProprietorship === 'yes',
        fullTimeEmployees: form.fullTimeEmployees,
        partTimeEmployees: form.partTimeEmployees,
        hasDba: form.hasDba === 'yes',
        dbaName: form.hasDba === 'yes' ? form.dbaName.trim() : '',
        contactPhone: form.owners[0]?.phone || null
      });
      setStep(4);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveOwnerStep() {
    const ownersForSave = primaryIs100 ? [{ ...form.owners[0], ownershipPercent: '100' }] : form.owners;
    const total = ownersForSave.reduce((sum, owner) => sum + (Number(owner.ownershipPercent) || 0), 0);
    if (Math.abs(total - 100) > 0.001) {
      setOwnerError(`Ownership currently totals ${total}%. Please account for exactly 100% before continuing.`);
      return;
    }

    const incomplete = ownersForSave.some((owner) =>
      !owner.firstName || !owner.lastName || !owner.email || !owner.phone || !owner.dob ||
      String(owner.ssn || '').replace(/\D/g, '').length !== 9 || !owner.ownershipPercent
    );
    if (incomplete) {
      setOwnerError('Complete each owner’s name, email, phone, date of birth, 9-digit SSN, and ownership before continuing.');
      return;
    }

    setBusy(true);
    setOwnerError('');
    try {
      await saveOwners(applicationId, ownersForSave);
      const refreshed = await getApplication(applicationId);
      setBundle(refreshed);
      setDocuments(refreshed.documents || []);
      setStep(5);
    } catch (err) {
      setOwnerError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function setPrimaryOwnershipMode(value) {
    if (value === 'yes') {
      setForm((old) => ({ ...old, owners: [{ ...old.owners[0], ownershipPercent: '100' }] }));
    } else {
      setForm((old) => ({
        ...old,
        owners: old.owners.length > 1 ? old.owners : [{ ...old.owners[0], ownershipPercent: '' }, blankOwner()]
      }));
    }
  }

  function addOwner() {
    setForm((old) => ({ ...old, owners: [...old.owners, blankOwner()] }));
  }

  function removeOwner(index) {
    if (index) setForm((old) => ({ ...old, owners: old.owners.filter((_, i) => i !== index) }));
  }

  async function uploadDoc(type, file) {
    if (!file || !applicationId) return;
    setUploadingType(type);
    setMessage('');
    try {
      await uploadApplicationDocument(applicationId, type, file);
      const refreshed = await getApplication(applicationId);
      setBundle(refreshed);
      setDocuments(refreshed.documents || []);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setUploadingType('');
    }
  }

  async function removeUploadedDocument(doc) {
    setUploadingType('remove'); setMessage('');
    try {
      await deleteDocument(applicationId, doc.id);
      const refreshed = await getApplication(applicationId);
      setBundle(refreshed); setDocuments(refreshed.documents || []);
    } catch (err) { setMessage(err.message); }
    finally { setUploadingType(''); }
  }

  function continueFromAddress() {
    if (!eligibility) return setMessage('Check your business address first.');
    if (eligibility.status === 'address_not_found') return setMessage('We could not confidently match that address. Please check it and try again.');
    if (!eligibility.eligible) return setMessage('This address does not appear to be inside a New Jersey Urban Enterprise Zone.');
    setMessage('');
    setStep(1);
  }

  function continueFromDocuments() {
    if (form.isSoleProprietorship !== 'yes' && !hasFormation) {
      setMessage('Upload the Certificate of Formation or formation document before continuing.');
      return;
    }
    setMessage('');
    setStep(6);
  }

  async function submitFinal() {
    setBusy(true);
    setMessage('');
    try {
      await submitApplication(applicationId);
      const refreshed = await getApplication(applicationId);
      setPortalBundle(refreshed);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshPortal() {
    if (!portalBundle?.application?.id) return;
    const refreshed = await getApplication(portalBundle.application.id);
    setPortalBundle(refreshed);
  }

  async function handleSignOut() {
    await signOutApplicant();
    window.location.href = '/';
  }

  function openSignIn() {
    setSignInMode(true);
    setMessage('');
    setStep(2);
  }

  if (portalBundle) {
    return <ApplicantPortal bundle={portalBundle} onRefresh={refreshPortal} onSignOut={handleSignOut} />;
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark">COR</div>
      <div><div className="brand-name">COR Solutions</div><div className="brand-subtitle">UEZ Enrollment & Grant Support</div></div>
      {!session && <button className="signin-link" onClick={openSignIn}>Already registered? Sign in</button>}
      {session && <button className="signin-link" onClick={handleSignOut}>Sign out</button>}
    </header>

    <main className="page-wrap">
      <section className="hero">
        <div className="eyebrow">NEW JERSEY UEZ SERVICES</div>
        <h1>We’ll guide you through the process.</h1>
        <p>Start with your business address. We’ll identify your UEZ zone and show you which programs are available.</p>
      </section>

      <div className="wizard-card">
        <div className="wizard-head"><div><span className="step-count">Step {progress}</span><h2>{steps[step]}</h2></div></div>
        <div className="progress-row seven">{steps.map((name, index) => <div key={name} className={`progress-item ${index <= step ? 'active' : ''}`}><span>{index + 1}</span><small>{name}</small></div>)}</div>

        {step === 0 && <div className="content-block">
          <form onSubmit={runAddressCheck}>
            <div className="intro-copy"><h3>Find your business</h3><p>Start typing the registered business address and choose the matching New Jersey address.</p></div>
            <label>Registered business address <span className="required-star">*</span></label>
            <div className="address-autocomplete">
              <input value={form.address} onChange={updateAddress} onFocus={() => setShowAddressSuggestions(addressSuggestions.length > 0)} onKeyDown={handleAddressKeyDown} autoComplete="off" placeholder="Start typing an NJ business address" required />
              {showAddressSuggestions && addressSuggestions.length > 0 && <div className="address-suggestions">{addressSuggestions.map((suggestion, index) => <button key={`${suggestion.text}-${suggestion.magicKey || ''}`} className={index === activeSuggestionIndex ? 'active' : ''} type="button" onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActiveSuggestionIndex(index)} onClick={() => selectAddressSuggestion(suggestion)}>{suggestion.text}</button>)}</div>}
            </div>
            <button className="primary" disabled={busy}>{busy ? 'Checking…' : 'Check my address'}</button>
          </form>
          {eligibility?.matchedAddress && <div className="map-card">
            {eligibility.latitude && <UezMap latitude={eligibility.latitude} longitude={eligibility.longitude} zoneGeometry={eligibility.zoneGeometry} address={eligibility.matchedAddress} />}
            <div className="result-strip">
              <div className={`result-icon ${eligibility.eligible ? 'good' : 'bad'}`}>{eligibility.eligible ? '✓' : '!'}</div>
              <div><h4>{eligibility.eligible ? `Your business is inside the ${eligibility.zoneName}.` : 'This address is not inside a UEZ.'}</h4><p>{eligibility.matchedAddress}</p>{eligibility.programs?.length > 0 && <span className="grant-pill">{eligibleProgramName} available</span>}</div>
            </div>
          </div>}
        </div>}

        {step === 1 && <div className="content-block eligibility-offer compact-offer">
          <h3>Your business is eligible.</h3>
          <div className="offer-row"><span>Available program</span><strong>{eligibleProgramName}</strong></div>
          <div className="offer-row"><span>Available COR Solutions services</span><strong>{eligibility?.programs?.length ? 'UEZ enrollment & grant application · $500' : 'UEZ enrollment support'}</strong></div>
          <p className="offer-description">Complete one intake. COR will review your documents, verify your New Jersey Business Registration Certificate after submission, enroll the business in the UEZ, and handle the available grant application when applicable. If a BRC is missing, we’ll tell you exactly what to do next.</p>
        </div>}

        {step === 2 && <form className="content-block" onSubmit={(e) => { e.preventDefault(); (signInMode ? signInAndResume : createAccountAndCase)(); }}>
          <div className="intro-copy">
            <h3>{signInMode ? 'Sign in to your COR account' : 'Create your COR account'}</h3>
            <p>{signInMode ? 'Use your email and password to continue your application.' : 'Your account keeps your application, documents, and status in one place.'}</p>
          </div>
          <div className="field-grid">
            <div><label>Email <span className="required-star">*</span></label><input type="email" value={form.email} onChange={update('email')} required /></div>
            <div><label>Password <span className="required-star">*</span></label><input type="password" value={form.password} onChange={update('password')} required minLength="6" /></div>
          </div>
          <button type="button" className="text-button" onClick={() => { setSignInMode((old) => !old); setMessage(''); }}>{signInMode ? 'Need to create an account?' : 'Already have an account?'}</button>
          <button type="submit" className="primary account-submit" disabled={busy}>{busy ? 'Please wait…' : signInMode ? 'Sign in' : 'Create account'}</button>
        </form>}

        {step === 3 && <div className="content-block">
          <div className="intro-copy"><h3>Tell us about the business</h3><p>We’ll use this information for your UEZ enrollment and available grant application.</p></div>
          <label>Business name <span className="required-star">*</span></label><input required value={form.businessName} onChange={update('businessName')} />
          <label>In a few words, what does the business do? <span className="required-star">*</span></label><textarea value={form.businessDescription} onChange={update('businessDescription')} placeholder="Example: HVAC installation and repair" required />
          <div className="field-grid">
            <div><label>EIN <span className="required-star">*</span></label><input required value={form.ein} onChange={update('ein')} placeholder="12-3456789" /></div>
            <div><label>Year founded <span className="required-star">*</span></label><input required value={form.yearFounded} onChange={update('yearFounded')} /></div>
            <div><label>Is this business a sole proprietorship? <span className="required-star">*</span></label><select required value={form.isSoleProprietorship} onChange={update('isSoleProprietorship')}><option value="">Select yes or no</option><option value="yes">Yes</option><option value="no">No</option></select></div>
            <div><label>Does the business have a DBA? <span className="required-star">*</span></label><select value={form.hasDba} onChange={(e) => setForm((old) => ({ ...old, hasDba: e.target.value, dbaName: e.target.value === 'yes' ? old.dbaName : '' }))} required><option value="">Select yes or no</option><option value="yes">Yes</option><option value="no">No</option></select></div>
            {form.hasDba === 'yes' && <div><label>What is the DBA name? <span className="required-star">*</span></label><input value={form.dbaName} onChange={update('dbaName')} required /></div>}
            <div><label>Full-time employees <span className="required-star">*</span></label><input required type="number" min="0" value={form.fullTimeEmployees} onChange={update('fullTimeEmployees')} placeholder="0" /></div>
            <div><label>Part-time employees <span className="required-star">*</span></label><input required type="number" min="0" value={form.partTimeEmployees} onChange={update('partTimeEmployees')} placeholder="0" /></div>
          </div>
        </div>}

        {step === 4 && <div className="content-block">
          <div className="intro-copy"><h3>Business ownership</h3><p>List every owner of the business.</p></div>
          <div className="hint"><strong>Why we ask for DOB and SSN:</strong> The grant application requires this information for each business owner. COR collects it only so we can prepare and submit the required application information on your behalf.</div>
          <div className="field-grid"><div><label>Is the primary owner the 100% owner? <span className="required-star">*</span></label><select required value={primaryIs100 ? 'yes' : 'no'} onChange={(e) => setPrimaryOwnershipMode(e.target.value)}><option value="yes">Yes</option><option value="no">No</option></select></div></div>
          {!primaryIs100 && <div className="ownership-summary"><span>Ownership accounted for</span><strong className={Math.abs(ownershipTotal - 100) < 0.001 ? 'ownership-ok' : ''}>{ownershipTotal}% / 100%</strong></div>}
          {form.owners.map((owner, index) => <div className="owner-card" key={index}>
            <div className="owner-card-head"><strong>{index === 0 ? 'Primary owner' : `Additional owner ${index + 1}`}</strong>{index > 0 && <button className="owner-remove" type="button" onClick={() => removeOwner(index)}>Remove</button>}</div>
            <div className="field-grid">
              <div><label>First name <span className="required-star">*</span></label><input required value={owner.firstName} onChange={updateOwner(index, 'firstName')} /></div>
              <div><label>Last name <span className="required-star">*</span></label><input required value={owner.lastName} onChange={updateOwner(index, 'lastName')} /></div>
              <div><label>Email <span className="required-star">*</span></label><input required type="email" value={owner.email} onChange={updateOwner(index, 'email')} /></div>
              <div><label>Best phone <span className="required-star">*</span></label><input required inputMode="tel" value={owner.phone} onChange={updateOwner(index, 'phone')} /></div>
              <div><label>Date of birth <span className="required-star">*</span></label><input required inputMode="numeric" placeholder="MM/DD/YYYY" value={owner.dob} onChange={updateOwner(index, 'dob')} /></div>
              <div><label>SSN <span className="required-star">*</span></label><input required inputMode="numeric" value={owner.ssn} onChange={updateOwner(index, 'ssn')} placeholder="•••-••-••••" /></div>
              {!primaryIs100 && <div><label>Ownership percentage <span className="required-star">*</span></label><input required type="number" min="0.01" max="100" step="0.01" value={owner.ownershipPercent} onChange={updateOwner(index, 'ownershipPercent')} /></div>}
            </div>
          </div>)}
          {!primaryIs100 && ownershipTotal < 100 && <button className="secondary add-owner" type="button" onClick={addOwner}>+ Add another owner</button>}
          {ownerError && <div className="validation-error">{ownerError}</div>}
        </div>}

        {step === 5 && <div className="content-block">
          <div className="intro-copy"><h3>Documents</h3><p>Upload what you already have. COR will handle the BRC check after you submit.</p></div>

          <div className="upload-card">
            <div><strong>Certificate of Formation / formation document {form.isSoleProprietorship !== 'yes' && <span className="required-star">*</span>}</strong><p>{form.isSoleProprietorship === 'yes' ? 'Optional for a sole proprietorship.' : 'Required before submission.'}</p></div>
            <label className="secondary inline-button file-button">
              {uploadingType === 'formation' ? 'Uploading…' : hasFormation ? 'Replace / add another' : 'Upload document'}
              <input type="file" accept=".pdf,image/*" disabled={Boolean(uploadingType)} onChange={(e) => uploadDoc('formation', e.target.files?.[0])} />
            </label>
          </div>

          <div className="upload-card">
            <div><strong>Business Registration Certificate (BRC)</strong><p>Optional. If you already have it, upload it. If not, COR will check after submission.</p></div>
            <label className="secondary inline-button file-button">
              {uploadingType === 'brc' ? 'Uploading…' : 'Upload BRC'}
              <input type="file" accept=".pdf,image/*" disabled={Boolean(uploadingType)} onChange={(e) => uploadDoc('brc', e.target.files?.[0])} />
            </label>
          </div>

          <div className="upload-card">
            <div><strong>Other supporting document</strong><p>Optional. Add anything you think COR should have for this application.</p></div>
            <label className="secondary inline-button file-button">
              {uploadingType === 'supporting' ? 'Uploading…' : 'Upload another file'}
              <input type="file" accept=".pdf,image/*" disabled={Boolean(uploadingType)} onChange={(e) => uploadDoc('supporting', e.target.files?.[0])} />
            </label>
          </div>

          {documents.length > 0 && <div className="uploaded-docs">
            <h4>Uploaded</h4>
            {documents.map((doc) => <div className="uploaded-doc-row" key={doc.id}><span>{documentLabel(doc.document_type)}</span><strong>{doc.filename}</strong><button type="button" className="owner-remove" onClick={() => removeUploadedDocument(doc)} disabled={Boolean(uploadingType)}>Remove</button></div>)}
          </div>}
        </div>}

        {step === 6 && <div className="content-block review-block">
          <div className="intro-copy"><h3>Review and submit</h3><p>Make sure the information below looks right. COR will verify the BRC after submission.</p></div>
          <div className="review-grid">
            <div><span>Business</span><strong>{form.businessName}</strong><small>{form.address}</small></div>
            <div><span>Program</span><strong>{eligibleProgramName}</strong></div>
            <div><span>Owners</span><strong>{form.owners.length}</strong><small>{ownershipTotal}% ownership accounted for</small></div>
            <div><span>Documents</span><strong>{documents.length}</strong><small>{hasFormation ? 'Formation document received' : 'No formation document uploaded'}</small></div>
          </div>
          <div className="hint review-consent">By submitting, you authorize COR Solutions to use the information and documents provided to prepare and process your UEZ enrollment and applicable grant application.</div>
        </div>}

        {message && <div className="form-message">{message}</div>}

        <div className="wizard-footer">
          <button className="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>Back</button>
          {step === 0 && <button className="primary compact" onClick={continueFromAddress} disabled={busy}>Continue</button>}
          {step === 1 && <button className="primary compact" onClick={() => { setMessage(''); setStep(2); }}>Continue</button>}
          {step === 3 && <button className="primary compact" onClick={saveBusinessStep} disabled={busy}>Continue</button>}
          {step === 4 && <button className="primary compact" onClick={saveOwnerStep} disabled={busy}>Continue</button>}
          {step === 5 && <button className="primary compact" onClick={continueFromDocuments} disabled={busy || Boolean(uploadingType)}>Continue</button>}
          {step === 6 && <button className="primary compact" onClick={submitFinal} disabled={busy}>{busy ? 'Submitting…' : 'Submit application'}</button>}
        </div>
      </div>

      <div className="trust-row"><span>Secure application</span><span>•</span><span>Private document storage</span><span>•</span><span>Progress saved to your account</span></div>
    </main>
  </div>;
}
