import React, { useEffect, useMemo, useState } from 'react';
import { checkUezEligibility, suggestNjAddresses } from './eligibility';
import UezMap from './UezMap';
import {
  createApplication,
  getApplicantSession,
  getApplication,
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
  reportApplicantPayment,
  reportBrcCreated
} from './api';

const steps = ['Address', 'Eligibility', 'Account', 'Business', 'Owners', 'Documents', 'Review'];
const NJ_REGISTRATION_URL = 'https://www.njportal.com/dor/businessregistration';
const blankOwner = () => ({ title: '', titleOther: '', firstName: '', lastName: '', email: '', phone: '', dob: '', ssn: '', ownershipPercent: '', addressLine1: '', addressLine2: '', city: '', state: '', zip: '' });

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
  const [brcBusy, setBrcBusy] = useState(false);
  const app = bundle.application;
  const latestDocument = (type) => [...(bundle.documents || [])].reverse().find((doc) => doc.document_type === type) || null;
  const formation = latestDocument('formation');
  const formationRequired = !app.is_sole_proprietorship;
  const formationReview = app.formation_review_status || 'not_reviewed';
  const approval = latestDocument('uez_approval_email');
  const approvalReview = app.uez_approval_review_status || 'not_reviewed';
  const needsBrc = ['not_found', 'missing', 'required'].includes(app.brc_status) || app.status === 'waiting_for_brc';
  const brcConfirmed = app.brc_status === 'found' || app.status === 'brc_confirmed';
  const latestPayment = [...(bundle.payments || [])].reverse()[0] || null;
  const approvalStageReached = app.pbs_status === 'account_created' || app.pbs_status === 'uez_approval_uploaded' || app.status === 'waiting_for_uez_approval' || Boolean(approval);


  useEffect(() => {
    let active = true;
    getMyNjCredentials(app.id).then((result) => {
      if (active) setMyNjCredentials(result.exists ? result.credentials : null);
    }).catch(() => {});
    return () => { active = false; };
  }, [app.id]);

  useEffect(() => {
    let active = true;
    const refresh = () => { if (active && document.visibilityState === 'visible') onRefresh().catch(() => {}); };
    const timer = window.setInterval(refresh, 4000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [app.id, onRefresh]);

  async function uploadFormation(file) {
    if (!file) return;
    setUploading(true);
    setMessage('');
    try {
      await uploadApplicationDocument(app.id, 'formation', file);
      await onRefresh();
      setMessage('Certificate of Formation uploaded.');
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
      setMessage('UEZ approval email uploaded.');
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
      setMessage('Payment reported. Your account will update when it is confirmed.');
    } catch (err) { setMessage(err.message); }
    finally { setPaymentBusy(false); }
  }

  async function reportBrcMade() {
    setBrcBusy(true); setMessage('');
    try {
      await reportBrcCreated(app.id);
      await onRefresh();
      setMessage('Thanks. Your BRC will be rechecked.');
    } catch (err) { setMessage(err.message); }
    finally { setBrcBusy(false); }
  }



  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark">COR</div>
      <div><div className="brand-name">COR Solutions</div><div className="brand-subtitle">UEZ Application Portal</div></div>
      <button className="signin-link" onClick={onSignOut}>Log out</button>
    </header>
    <main className="page-wrap portal-wrap">
      <section className="hero portal-hero">
        <div className="eyebrow">YOUR UEZ APPLICATION</div>
        <h1>{app.business_name_input || 'Your application'}</h1>
        <p>Your next steps and application updates appear here.</p>
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

          <div className="portal-section-head"><h3>What you need to do</h3></div>

          {formationRequired && !formation && <div className="action-panel warn-panel">
            <h3>Upload your Certificate of Formation <span className="required-star">*</span></h3>
            <p>Upload your Certificate of Formation to continue.</p>
            <label className="primary compact inline-button file-button">
              {uploading ? 'Uploading…' : 'Upload Certificate of Formation'}
              <input type="file" accept=".pdf,image/*" disabled={uploading} onChange={(e) => uploadFormation(e.target.files?.[0])} />
            </label>
          </div>}

          {formationRequired && formation && formationReview === 'not_reviewed' && <div className="action-panel">
            <h3>Certificate of Formation uploaded</h3>
            <p>Under review.</p>
          </div>}

          {formationRequired && formation && formationReview === 'approved' && <div className="action-panel good-panel">
            <h3>✓ Certificate of Formation accepted</h3>
          </div>}

          {formationRequired && formationReview === 'rejected' && <div className="action-panel warn-panel">
            <h3>Certificate of Formation needs replacement</h3>
            <p>Please upload a new Certificate of Formation.</p>
            <label className="primary compact inline-button file-button">
              {uploading ? 'Uploading…' : 'Upload replacement Certificate of Formation'}
              <input type="file" accept=".pdf,image/*" disabled={uploading} onChange={(e) => uploadFormation(e.target.files?.[0])} />
            </label>
          </div>}

          {needsBrc && <div className="action-panel warn-panel">
            <h3>Business Registration Certificate needed</h3>
            <p>Create/register for your New Jersey BRC, then come back here and tell us when you're done. You do not need to upload it.</p>
            <a className="primary compact inline-button" href={NJ_REGISTRATION_URL} target="_blank" rel="noreferrer">Create my BRC</a>
            <button className="secondary compact inline-button" onClick={reportBrcMade} disabled={brcBusy}>{brcBusy ? 'Saving…' : 'I created my BRC'}</button>
          </div>}

          {approvalStageReached && !approval && <div className="action-panel warn-panel">
            <h3>Upload your UEZ approval email <span className="required-star">*</span></h3>
            <p>Upload the “Notice of Certification Application Approved” email you received from UEZdonotreply@dca.nj.gov.</p>
            <label className="primary compact inline-button file-button">
              {uploading ? 'Uploading…' : 'Upload UEZ approval email'}
              <input type="file" accept=".pdf,.eml,image/*" disabled={uploading} onChange={(e) => uploadApprovalEmail(e.target.files?.[0])} />
            </label>
          </div>}

          {approval && approvalReview === 'not_reviewed' && <div className="action-panel">
            <h3>UEZ approval email uploaded</h3>
            <p>Under review.</p>
          </div>}

          {approval && approvalReview === 'approved' && <div className="action-panel good-panel">
            <h3>✓ UEZ approval email accepted</h3>
          </div>}

          {approvalReview === 'rejected' && <div className="action-panel warn-panel">
            <h3>UEZ approval email needs replacement</h3>
            <p>Please upload the correct “Notice of Certification Application Approved” email.</p>
            <label className="primary compact inline-button file-button">
              {uploading ? 'Uploading…' : 'Upload replacement approval email'}
              <input type="file" accept=".pdf,.eml,image/*" disabled={uploading} onChange={(e) => uploadApprovalEmail(e.target.files?.[0])} />
            </label>
          </div>}

          {message && <div className="form-message portal-message">{message}</div>}
        </section>

        <section className="wizard-card portal-card">
          <div className="portal-section-head"><h3>Payment</h3><span>$500</span></div>
          {latestPayment?.status === 'paid' ? <div className="action-panel good-panel"><h3>✓ Payment received</h3></div>
            : latestPayment?.status === 'client_reported' ? <div className="action-panel"><h3>Payment reported</h3><p>You told COR the payment was sent. We are verifying it.</p></div>
            : <><p className="muted">After you send the $500 payment, click below.</p><button className="primary admin-full-button" onClick={reportPaymentSent} disabled={paymentBusy}>{paymentBusy ? 'Saving…' : 'I sent my payment'}</button></>}
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
          <p className="muted credential-note">Keep this login information private. You may need it to access New Jersey services related to your application.</p>
        </section>}

        <section className="wizard-card portal-card portal-wide">
          <div className="portal-section-head"><h3>Updates</h3></div>
          <div className="timeline">
            {[...bundle.statusEvents].reverse().map((event) => <div className="timeline-item" key={event.id}>
              <span className="timeline-dot"></span>
              <div><strong>{event.label || statusLabel(event.status)}</strong><small>{new Date(event.created_at).toLocaleString()}</small></div>
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
  const [signInMode, setSignInMode] = useState(() => new URLSearchParams(window.location.search).get('login') === '1');
  const [showServiceIntro, setShowServiceIntro] = useState(true);
  const [session, setSession] = useState(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [addressMagicKey, setAddressMagicKey] = useState(null);
  const [showAddressSuggestions, setShowAddressSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [documents, setDocuments] = useState([]);
  const [uploadingType, setUploadingType] = useState('');
  const [form, setForm] = useState({
    address: '', email: '', password: '', businessName: '', businessDescription: '', ein: '', yearFounded: '',
    isSoleProprietorship: '', fullTimeEmployees: '', partTimeEmployees: '', hasDba: '', dbaName: '',
    owners: [blankOwner()]
  });

  const progress = useMemo(() => `${step + 1} of ${steps.length}`, [step]);
  const ownershipTotal = useMemo(() => form.owners.reduce((sum, owner) => sum + (Number(owner.ownershipPercent) || 0), 0), [form.owners]);
  const primaryIs100 = form.owners.length === 1 && form.owners[0].ownershipPercent === '100';
  const primaryOwnershipSelection = form.owners.length === 1 && !form.owners[0].ownershipPercent ? '' : (primaryIs100 ? 'yes' : 'no');
  const eligibleProgramName = eligibility?.programs?.[0]?.name || programNameFromCode(bundle?.application?.program_code);
  const hasFormation = documents.some((doc) => doc.document_type === 'formation');
  const update = (key) => (e) => setForm((old) => ({ ...old, [key]: e.target.value }));

  useEffect(() => {
    let active = true;
    getApplicantSession().then(async (current) => {
      if (!active) return;
      if (current) {
        await loadLatestApplication().catch(() => {});
        if (active) setSession(current);
      } else if (active) {
        setSession(null);
      }
    }).catch(() => {}).finally(() => { if (active) setAuthResolved(true); });
    return () => { active = false; };
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
            title: ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Rabbi'].includes(owner.honorific_title) ? owner.honorific_title : (owner.honorific_title ? 'Other' : ''),
            titleOther: ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Rabbi'].includes(owner.honorific_title) ? '' : (owner.honorific_title || ''),
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
        addressLine1: eligibility?.addressLine1 || eligibility?.matchedAddress || form.address,
        city: eligibility?.city || null,
        state: eligibility?.state || 'NJ',
        zip: eligibility?.zip || null,
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
    setAuthResolved(false);
    setMessage('');
    try {
      const auth = await signInApplicant(form.email.trim(), form.password);
      const loaded = await loadLatestApplication();
      setSession(auth.session || null);
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
            addressLine1: pendingEligibility?.addressLine1 || pendingAddress,
            city: pendingEligibility?.city || null,
            state: pendingEligibility?.state || 'NJ',
            zip: pendingEligibility?.zip || null,
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
      setAuthResolved(true);
      setBusy(false);
    }
  }

  async function saveBusinessStep() {
    const einDigits = form.ein.replace(/\D/g, '');
    const foundedDigits = String(form.yearFounded || '').replace(/\D/g, '');
    if (
      !form.businessName.trim() || !form.businessDescription.trim() || einDigits.length !== 9 ||
      foundedDigits.length !== 4 || form.fullTimeEmployees === '' || form.partTimeEmployees === '' ||
      !form.isSoleProprietorship || !form.hasDba || (form.hasDba === 'yes' && !form.dbaName.trim())
    ) {
      setMessage('Complete every business field before continuing. All fields are required.');
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
      !owner.title || (owner.title === 'Other' && !owner.titleOther?.trim()) || !owner.firstName || !owner.lastName || !owner.email || !owner.phone || !owner.dob ||
      String(owner.ssn || '').replace(/\D/g, '').length !== 9 || !owner.ownershipPercent ||
      !owner.addressLine1?.trim() || !owner.city?.trim() || !owner.state?.trim() || !owner.zip?.trim()
    );
    if (incomplete) {
      setOwnerError('Complete each owner’s name, email, phone, date of birth, 9-digit SSN, ownership, and home address before continuing.');
      return;
    }

    setBusy(true);
    setOwnerError('');
    try {
      const ownersPayload = ownersForSave.map((owner) => ({
        ...owner,
        title: owner.title === 'Other' ? owner.titleOther.trim() : owner.title
      }));
      await saveOwners(applicationId, ownersPayload);
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
  }

  if (!authResolved) {
    return <div className="app-shell auth-loading-shell"><div className="auth-loading-card">Loading…</div></div>;
  }

  if (!session && signInMode) {
    return <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark">COR</div>
        <div><div className="brand-name">COR Solutions</div><div className="brand-subtitle">UEZ Enrollment & Grant Support</div></div>
        <button className="signin-link" onClick={() => { setSignInMode(false); setMessage(''); }}>Back to signup</button>
      </header>
      <main className="login-page-wrap">
        <section className="wizard-card login-card">
          <div className="content-block">
            <div className="intro-copy"><h3>Log in</h3><p>Access your UEZ application, documents, payment status, and updates.</p></div>
            <form onSubmit={(e) => { e.preventDefault(); signInAndResume(); }}>
              <label>Email</label><input type="email" value={form.email} onChange={update('email')} autoComplete="email" required />
              <label>Password</label><input type="password" value={form.password} onChange={update('password')} autoComplete="current-password" required />
              <button type="submit" className="primary login-submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
              <a className="forgot-password-link" href="/forgot-password">Forgot password?</a>
            </form>
            {message && <div className="form-message">{message}</div>}
          </div>
        </section>
      </main>
    </div>;
  }

  if (portalBundle) {
    return <ApplicantPortal bundle={portalBundle} onRefresh={refreshPortal} onSignOut={handleSignOut} />;
  }

  if (!session && showServiceIntro) {
    return <div className="app-shell service-intro-shell">
      <header className="topbar">
        <div className="brand-mark">COR</div>
        <div><div className="brand-name">COR Solutions</div><div className="brand-subtitle">UEZ Enrollment & Grant Support</div></div>
        <button className="signin-link" onClick={openSignIn}>Log in</button>
      </header>
      <main className="service-intro-wrap">
        <section className="service-intro-hero">
          <div className="eyebrow">LAKEWOOD UEZ SIGNUP & GRANT SUPPORT</div>
          <h1>UEZ signup and grant applications, without figuring it all out yourself.</h1>
          <p>COR Solutions provides a start-to-finish application service for eligible Lakewood businesses. Start with a quick address check, complete one intake, and use your account to follow the application as it moves forward.</p>
          <div className="service-intro-actions">
            <button className="primary" onClick={() => { setShowServiceIntro(false); setMessage(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Check my business address</button>
            <a className="secondary service-link-button" href="tel:+17329300739">Call 732-930-0739</a>
          </div>
        </section>

        <section className="service-explainer-grid" aria-label="About the service">
          <article><span>WHAT</span><h3>UEZ enrollment + grant application</h3><p>One intake for your New Jersey UEZ enrollment and the available Lakewood grant application.</p></article>
          <article><span>WHO</span><h3>Eligible Lakewood businesses</h3><p>The first step checks whether your business location is inside the UEZ. If it is, you can continue directly into the application.</p></article>
          <article><span>HOW</span><h3>Complete one online intake</h3><p>Provide the requested business and ownership information, upload your Certificate of Formation when applicable, and respond to any action items that appear in your account.</p></article>
          <article><span>COST</span><h3>$500 service fee</h3><p>The $500 service fee covers UEZ signup and the grant application service. If the LDC rejects the application, the fee is refunded; after LDC approval it is non-refundable.</p></article>
        </section>

        <section className="service-faq-card">
          <div className="service-faq-head"><div><span className="eyebrow">FAQ</span><h2>Questions before you start?</h2></div><p>Open any question below, or reach out directly.</p></div>
          <div className="service-faq-list">
            <details><summary>What is the UEZ?</summary><p>New Jersey's Urban Enterprise Zone program provides benefits to qualifying businesses located within designated UEZ areas. This service starts by checking your business location against the UEZ map.</p></details>
            <details><summary>What does COR Solutions do?</summary><p>COR Solutions collects the information needed for the process, prepares the UEZ enrollment and applicable Lakewood grant application, and gives you an online account where you can see updates and anything that still needs your attention.</p></details>
            <details><summary>What will I need to provide?</summary><p>You will enter basic business and owner information. If the business is not a sole proprietorship, you will also upload its Certificate of Formation. If another item is needed later, it will appear clearly in your account.</p></details>
            <details><summary>How do I know if my business is eligible?</summary><p>Click “Check my business address.” The next page checks the location against the UEZ map before you create an account or complete the full intake.</p></details>
            <details><summary>Is a grant guaranteed?</summary><p>No. Eligibility and final approval are determined by the applicable government and grant agencies. COR Solutions provides the application service but cannot guarantee an approval or award.</p></details>
            <details><summary>What happens after I submit?</summary><p>You can log back into your COR account at any time. Your activity tracker shows the application moving forward, and any item you need to provide or replace will appear as an action in your account.</p></details>
          </div>
        </section>

        <section className="service-contact-card">
          <div><span className="eyebrow">QUESTIONS?</span><h2>Talk to Chaim before you apply.</h2><p>Call, text, or WhatsApp and ask anything you need to know about the service or the UEZ process.</p></div>
          <div className="service-contact-actions">
            <a href="tel:+17329300739">Call</a>
            <a href="sms:+17329300739">Text</a>
            <a href="https://wa.me/17329300739" target="_blank" rel="noreferrer">WhatsApp</a>
          </div>
          <strong className="service-phone">732-930-0739</strong>
        </section>
      </main>
    </div>;
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark">COR</div>
      <div><div className="brand-name">COR Solutions</div><div className="brand-subtitle">UEZ Enrollment & Grant Support</div></div>
      {!session && <button className="signin-link" onClick={openSignIn}>Log in</button>}
      {session && <button className="signin-link" onClick={handleSignOut}>Log out</button>}
    </header>

    <main className={`page-wrap intake-page ${step === 0 ? 'intake-first-screen' : ''}`}>
      <section className="hero">
        <div className="eyebrow">NEW JERSEY UEZ SERVICES</div>
        <h1>We handle your UEZ signup and grant application.</h1>
        <p>Start with your business address. COR will check eligibility, collect what we need, and handle the applications for you.</p>
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
          <p className="offer-description">Complete one intake. COR will review your documents, handle the New Jersey verification steps, enroll the business in the UEZ, and process the available grant application when applicable.</p>
        </div>}

        {step === 2 && <form className="content-block" onSubmit={(e) => { e.preventDefault(); createAccountAndCase(); }}>
          <div className="intro-copy">
            <h3>Create your COR account</h3>
            <p>Your account keeps your application, documents, and status in one place.</p>
          </div>
          <div className="field-grid">
            <div><label>Email <span className="required-star">*</span></label><input type="email" value={form.email} onChange={update('email')} required /></div>
            <div><label>Password <span className="required-star">*</span></label><input type="password" value={form.password} onChange={update('password')} required minLength="6" /></div>
          </div>
          <button type="submit" className="primary account-submit" disabled={busy}>{busy ? 'Please wait…' : 'Create account'}</button>
        </form>}

        {step === 3 && <div className="content-block">
          <div className="intro-copy"><h3>Tell us about the business</h3><p>We’ll use this information for your UEZ enrollment and available grant application.</p></div>
          <label>Business name <span className="required-star">*</span></label><input required value={form.businessName} onChange={update('businessName')} />
          <label>In a few words, what does the business do? <span className="required-star">*</span></label><textarea value={form.businessDescription} onChange={update('businessDescription')} placeholder="Example: HVAC installation and repair" required />
          <div className="field-grid">
            <div><label>EIN <span className="required-star">*</span></label><input required inputMode="numeric" value={form.ein} onChange={(e) => { const d=e.target.value.replace(/\D/g,'').slice(0,9); setForm((old)=>({...old,ein:d.length>2?`${d.slice(0,2)}-${d.slice(2)}`:d})); }} maxLength="10" placeholder="12-3456789" /></div>
            <div><label>Year founded <span className="required-star">*</span></label><input required inputMode="numeric" maxLength="4" value={form.yearFounded} onChange={(e) => setForm((old)=>({...old,yearFounded:e.target.value.replace(/\D/g,'').slice(0,4)}))} /></div>
            <div><label>Is this business a sole proprietorship? <span className="required-star">*</span></label><div className="cor-inline-radios"><label className="cor-radio-option"><input type="radio" name="soleProp" value="yes" checked={form.isSoleProprietorship==='yes'} onChange={update('isSoleProprietorship')} required />Yes</label><label className="cor-radio-option"><input type="radio" name="soleProp" value="no" checked={form.isSoleProprietorship==='no'} onChange={update('isSoleProprietorship')} />No</label></div></div>
            <div><label>Does the business have a DBA? <span className="required-star">*</span></label><div className="cor-inline-radios"><label className="cor-radio-option"><input type="radio" name="hasDba" value="yes" checked={form.hasDba==='yes'} onChange={(e)=>setForm((old)=>({...old,hasDba:e.target.value}))} required />Yes</label><label className="cor-radio-option"><input type="radio" name="hasDba" value="no" checked={form.hasDba==='no'} onChange={(e)=>setForm((old)=>({...old,hasDba:e.target.value,dbaName:''}))} />No</label></div></div>
            {form.hasDba === 'yes' && <div><label>What is the DBA name? <span className="required-star">*</span></label><input value={form.dbaName} onChange={update('dbaName')} required /></div>}
            <div><label>Full-time employees <span className="required-star">*</span></label><input required inputMode="numeric" maxLength="3" value={form.fullTimeEmployees} onChange={(e)=>setForm((old)=>({...old,fullTimeEmployees:e.target.value.replace(/\D/g,'').slice(0,3)}))} /></div>
            <div><label>Part-time employees <span className="required-star">*</span></label><input required inputMode="numeric" maxLength="3" value={form.partTimeEmployees} onChange={(e)=>setForm((old)=>({...old,partTimeEmployees:e.target.value.replace(/\D/g,'').slice(0,3)}))} /></div>
          </div>
        </div>}

        {step === 4 && <div className="content-block">
          <div className="intro-copy"><h3>Business ownership</h3><p>List every owner of the business.</p></div>
          <div className="hint"><strong>Why we ask for DOB and SSN:</strong> The grant application requires this information for each business owner. COR collects it only so we can prepare and submit the required application information on your behalf.</div>
          <div className="field-grid"><div><label>Is the primary owner the 100% owner? <span className="required-star">*</span></label><select required value={primaryOwnershipSelection} onChange={(e) => setPrimaryOwnershipMode(e.target.value)}><option value="" disabled>Select yes or no</option><option value="yes">Yes</option><option value="no">No</option></select></div></div>
          {!primaryIs100 && <div className="ownership-summary"><span>Ownership accounted for</span><strong className={Math.abs(ownershipTotal - 100) < 0.001 ? 'ownership-ok' : ''}>{ownershipTotal}% / 100%</strong></div>}
          {form.owners.map((owner, index) => <div className="owner-card" key={index}>
            <div className="owner-card-head"><strong>{index === 0 ? 'Primary owner' : `Additional owner ${index + 1}`}</strong>{index > 0 && <button className="owner-remove" type="button" onClick={() => removeOwner(index)}>Remove</button>}</div>
            <div className="field-grid">
              <div><label>Title <span className="required-star">*</span></label><select required value={owner.title || ''} onChange={updateOwner(index, 'title')}><option value="" disabled>Select title</option><option value="Mr.">Mr.</option><option value="Mrs.">Mrs.</option><option value="Ms.">Ms.</option><option value="Dr.">Dr.</option><option value="Rabbi">Rabbi</option><option value="Other">Other</option></select></div>
              {owner.title === 'Other' && <div><label>Other title <span className="required-star">*</span></label><input required value={owner.titleOther || ''} onChange={updateOwner(index, 'titleOther')} /></div>}
              <div><label>First name <span className="required-star">*</span></label><input required value={owner.firstName} onChange={updateOwner(index, 'firstName')} /></div>
              <div><label>Last name <span className="required-star">*</span></label><input required value={owner.lastName} onChange={updateOwner(index, 'lastName')} /></div>
              <div><label>Email <span className="required-star">*</span></label><input required type="email" value={owner.email} onChange={updateOwner(index, 'email')} /></div>
              <div><label>Best phone <span className="required-star">*</span></label><input required inputMode="tel" value={owner.phone} onChange={updateOwner(index, 'phone')} /></div>
              <div><label>Date of birth <span className="required-star">*</span></label><input required inputMode="numeric" placeholder="MM/DD/YYYY" value={owner.dob} onChange={updateOwner(index, 'dob')} /></div>
              <div><label>SSN <span className="required-star">*</span></label><input required inputMode="numeric" value={owner.ssn} onChange={updateOwner(index, 'ssn')} placeholder="•••-••-••••" /></div>
              {!primaryIs100 && <div><label>Ownership percentage <span className="required-star">*</span></label><input required type="number" min="0.01" max="100" step="0.01" value={owner.ownershipPercent} onChange={updateOwner(index, 'ownershipPercent')} /></div>}
              <div className="owner-address-heading"><strong>Home address</strong></div>
              <div><label>Street address <span className="required-star">*</span></label><input required autoComplete="street-address" value={owner.addressLine1 || ''} onChange={updateOwner(index, 'addressLine1')} /></div>
              <div><label>Address line 2</label><input value={owner.addressLine2 || ''} onChange={updateOwner(index, 'addressLine2')} /></div>
              <div><label>City <span className="required-star">*</span></label><input required value={owner.city || ''} onChange={updateOwner(index, 'city')} /></div>
              <div><label>State <span className="required-star">*</span></label><input required maxLength="2" value={owner.state || ''} onChange={(e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0,2); updateOwner(index, 'state')(e); }} /></div>
              <div><label>ZIP <span className="required-star">*</span></label><input required inputMode="numeric" maxLength="5" value={owner.zip || ''} onChange={(e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0,5); updateOwner(index, 'zip')(e); }} /></div>
            </div>
          </div>)}
          {!primaryIs100 && ownershipTotal < 100 && <button className="secondary add-owner" type="button" onClick={addOwner}>+ Add another owner</button>}
          {ownerError && <div className="validation-error">{ownerError}</div>}
        </div>}

        {step === 5 && <div className="content-block">
          <div className="intro-copy"><h3>Documents</h3><p>Upload your formation document and any other supporting documents you want COR to have.</p></div>

          <div className="upload-card">
            <div><strong>Certificate of Formation / formation document {form.isSoleProprietorship !== 'yes' && <span className="required-star">*</span>}</strong><p>{form.isSoleProprietorship === 'yes' ? 'Optional for a sole proprietorship.' : 'Required before submission.'}</p></div>
            <label className="secondary inline-button file-button">
              {uploadingType === 'formation' ? 'Uploading…' : hasFormation ? 'Replace / add another' : 'Upload document'}
              <input type="file" accept=".pdf,image/*" disabled={Boolean(uploadingType)} onChange={(e) => uploadDoc('formation', e.target.files?.[0])} />
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
          <div className="intro-copy"><h3>Review and submit</h3><p>Make sure the information below looks right. COR will handle the remaining state verification steps after submission.</p></div>
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
