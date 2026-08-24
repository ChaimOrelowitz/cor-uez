import React, { useMemo, useState } from 'react';
import { checkUezEligibility } from './eligibility';
import { createApplication, getMyApplications, saveBusiness, saveOwners, signInApplicant, signUpApplicant } from './api';

const steps = ['Eligibility', 'Account', 'Business', 'Owners', 'BRC', 'Review'];
const blankOwner = () => ({ firstName: '', lastName: '', email: '', phone: '', dob: '', ssn: '', ownershipPercent: '' });

function App() {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [eligibility, setEligibility] = useState(null);
  const [applicationId, setApplicationId] = useState(null);
  const [ownerError, setOwnerError] = useState('');
  const [signInMode, setSignInMode] = useState(false);
  const [form, setForm] = useState({
    address: '', email: '', password: '', businessName: '', businessDescription: '', ein: '', yearFounded: '',
    isSoleProprietorship: '', fullTimeEmployees: '', partTimeEmployees: '',
    owners: [{ ...blankOwner(), ownershipPercent: '100' }]
  });

  const progress = useMemo(() => `${step + 1} of ${steps.length}`, [step]);
  const ownershipTotal = useMemo(() => form.owners.reduce((sum, owner) => sum + (Number(owner.ownershipPercent) || 0), 0), [form.owners]);
  const isLakewoodGrant = eligibility?.programs?.some((program) => program.code === 'lakewood_technology_grant');
  const update = (key) => (e) => setForm((old) => ({ ...old, [key]: e.target.value }));
  const updateOwner = (index, key) => (e) => {
    const value = e.target.value;
    setForm((old) => ({ ...old, owners: old.owners.map((owner, i) => i === index ? { ...owner, [key]: value } : owner) }));
    setOwnerError('');
  };

  async function runAddressCheck(e) {
    e.preventDefault();
    setBusy(true); setMessage('');
    try { setEligibility(await checkUezEligibility(form.address.trim())); }
    catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  async function createAccountAndCase() {
    setBusy(true); setMessage('');
    try {
      const auth = await signUpApplicant(form.email.trim(), form.password);
      if (!auth.session) {
        setSignInMode(true);
        setMessage('Check your email to confirm your account. Then come back here and sign in with the same email and password.');
        return;
      }
      const app = await createApplication({
        contactEmail: form.email.trim(),
        address: eligibility?.matchedAddress || form.address,
        zoneIdentifier: eligibility?.zoneIdentifier,
        zoneName: eligibility?.zoneName,
        zoneEligible: eligibility?.eligible === true,
        programCode: eligibility?.programs?.[0]?.code || null
      });
      setApplicationId(app.id);
      setStep(2);
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  async function signInAndResume() {
    setBusy(true); setMessage('');
    try {
      await signInApplicant(form.email.trim(), form.password);
      const applications = await getMyApplications();
      const latest = applications?.[0];
      if (!latest) {
        setSignInMode(false);
        setStep(0);
        setMessage('Signed in. Check your business address to start an application.');
        return;
      }
      setApplicationId(latest.id);
      setForm((old) => ({
        ...old,
        address: latest.address_line1 || old.address,
        businessName: latest.business_name_input || old.businessName,
        businessDescription: latest.business_description || old.businessDescription,
        ein: latest.ein || old.ein,
        yearFounded: latest.year_founded ?? old.yearFounded,
        isSoleProprietorship: latest.is_sole_proprietorship == null ? old.isSoleProprietorship : (latest.is_sole_proprietorship ? 'yes' : 'no'),
        fullTimeEmployees: latest.full_time_employees ?? old.fullTimeEmployees,
        partTimeEmployees: latest.part_time_employees ?? old.partTimeEmployees
      }));
      setSignInMode(false);
      setStep(latest.business_name_input ? 3 : 2);
      setMessage('Welcome back. Your application is loaded.');
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  async function saveBusinessStep() {
    if (!applicationId) return setMessage('Your application has not been created yet.');
    setBusy(true); setMessage('');
    try {
      await saveBusiness(applicationId, {
        businessName: form.businessName,
        businessDescription: form.businessDescription,
        ein: form.ein,
        yearFounded: form.yearFounded,
        isSoleProprietorship: form.isSoleProprietorship === 'yes',
        fullTimeEmployees: form.fullTimeEmployees,
        partTimeEmployees: form.partTimeEmployees,
        contactPhone: form.owners[0]?.phone || null
      });
      setStep(3);
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  async function saveOwnerStep() {
    if (Math.abs(ownershipTotal - 100) > 0.001) {
      setOwnerError(`Ownership currently totals ${ownershipTotal}%. Please account for exactly 100% before continuing.`);
      return;
    }
    if (form.owners.some((owner) => !owner.firstName || !owner.lastName || !owner.ownershipPercent)) {
      setOwnerError('Please complete each owner’s name and ownership percentage before continuing.');
      return;
    }
    setBusy(true); setMessage('');
    try {
      await saveOwners(applicationId, form.owners);
      setStep(4);
    } catch (err) { setOwnerError(err.message); }
    finally { setBusy(false); }
  }

  function setPrimaryOwnershipMode(value) {
    if (value === 'yes') setForm((old) => ({ ...old, owners: [{ ...old.owners[0], ownershipPercent: '100' }] }));
    else setForm((old) => ({ ...old, owners: old.owners.length > 1 ? old.owners : [{ ...old.owners[0], ownershipPercent: '' }, blankOwner()] }));
  }

  function addOwner() { setForm((old) => ({ ...old, owners: [...old.owners, blankOwner()] })); }
  function removeOwner(index) { if (index) setForm((old) => ({ ...old, owners: old.owners.filter((_, i) => i !== index) })); }

  function continueFromEligibility() {
    if (!eligibility) return setMessage('Check your business address first.');
    if (eligibility.status === 'address_not_found') return setMessage('We could not confidently match that address. Please check it and try again.');
    if (!eligibility.eligible) return setMessage('This address does not appear to be inside a New Jersey Urban Enterprise Zone.');
    setSignInMode(false); setMessage(''); setStep(1);
  }

  function openSignIn() {
    setSignInMode(true);
    setMessage('');
    setStep(1);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark">COR</div><div><div className="brand-name">COR Solutions</div><div className="brand-subtitle">UEZ Enrollment & Grant Support</div></div>
        <button className="signin-link" onClick={openSignIn}>Already registered? Sign in</button>
      </header>

      <main className="page-wrap">
        <section className="hero"><div className="eyebrow">NEW JERSEY UEZ SERVICES</div><h1>We’ll guide you through the process.</h1><p>Start with your business address. We’ll identify your UEZ zone, show you what programs are available, and keep everything organized in one place.</p></section>

        <div className="wizard-card">
          <div className="wizard-head"><div><span className="step-count">Step {progress}</span><h2>{steps[step]}</h2></div>{isLakewoodGrant && <div className="fee-pill">Lakewood service · $500</div>}</div>
          <div className="progress-row">{steps.map((name, index) => <div key={name} className={`progress-item ${index <= step ? 'active' : ''}`}><span>{index + 1}</span><small>{name}</small></div>)}</div>

          {step === 0 && <div className="content-block">
            <form onSubmit={runAddressCheck}>
              <div className="intro-copy"><h3>Is your business in a UEZ?</h3><p>Enter the registered business address. We’ll determine the municipality and UEZ zone automatically.</p></div>
              <label>Registered business address</label><input value={form.address} onChange={update('address')} placeholder="123 Main Street, Lakewood, NJ 08701" required />
              <button className="primary" disabled={busy}>{busy ? 'Checking…' : 'Check my address'}</button>
            </form>
            {eligibility?.mapUrl && <div className="map-card">
              <iframe title="NJ UEZ map" src={eligibility.mapUrl} className="uez-map" loading="lazy" />
              <div className="result-strip"><div className={`result-icon ${eligibility.eligible ? 'good' : 'bad'}`}>{eligibility.eligible ? '✓' : '!'}</div><div>
                <h4>{eligibility.eligible ? `Your business is inside the ${eligibility.zoneName}` : 'This address is not inside a UEZ'}</h4>
                <p>{eligibility.matchedAddress}</p>
                {eligibility.programs?.length > 0 && <span className="grant-pill">Lakewood Technology Grant available</span>}
                {eligibility.eligible && eligibility.programs?.length === 0 && <span className="neutral-pill">UEZ enrollment available · no COR local grant currently configured</span>}
              </div></div>
            </div>}
          </div>}

          {step === 1 && <div className="content-block"><div className="intro-copy"><h3>{signInMode ? 'Sign in to your COR account' : 'Create your COR account'}</h3><p>{signInMode ? 'Use the email and password for your COR account to resume your application.' : 'Your account lets you save progress, upload documents, and see exactly where your application stands.'}</p></div><div className="field-grid"><div><label>Email</label><input type="email" value={form.email} onChange={update('email')} /></div><div><label>Password</label><input type="password" value={form.password} onChange={update('password')} /></div></div>{signInMode && <button type="button" className="signin-link" onClick={() => { setSignInMode(false); setMessage(''); }}>Need an account? Create one</button>}</div>}

          {step === 2 && <div className="content-block"><div className="intro-copy"><h3>Tell us about the business</h3><p>We’ll use this information for your UEZ enrollment and grant application.</p></div>
            <label>Business name</label><input value={form.businessName} onChange={update('businessName')} />
            <label>In a few words, what does the business do?</label><textarea value={form.businessDescription} onChange={update('businessDescription')} placeholder="Example: HVAC installation and repair" required />
            <div className="field-grid"><div><label>EIN</label><input value={form.ein} onChange={update('ein')} placeholder="12-3456789" /></div><div><label>Year founded</label><input value={form.yearFounded} onChange={update('yearFounded')} /></div><div><label>Is this business a sole proprietorship?</label><select value={form.isSoleProprietorship} onChange={update('isSoleProprietorship')}><option value="">Select yes or no</option><option value="yes">Yes</option><option value="no">No</option></select></div><div></div><div><label>Full-time employees</label><input type="number" min="0" value={form.fullTimeEmployees} onChange={update('fullTimeEmployees')} placeholder="0" /></div><div><label>Part-time employees</label><input type="number" min="0" value={form.partTimeEmployees} onChange={update('partTimeEmployees')} placeholder="0" /></div></div>
            <div className="hint">There is no right or wrong employee count. Once the EIN is entered, the system will begin the BRC lookup in the background.</div>
          </div>}

          {step === 3 && <div className="content-block"><div className="intro-copy"><h3>Business ownership</h3><p>List every owner and their percentage. The ownership percentages must add up to exactly 100%.</p></div>
            <div className="hint"><strong>Why we ask for DOB and SSN:</strong> The LDC application requires this information for each business owner in order to apply. COR collects it only so we can prepare and submit the required application information on your behalf.</div>
            <div className="ownership-summary"><span>Ownership accounted for</span><strong className={Math.abs(ownershipTotal - 100) < 0.001 ? 'ownership-ok' : ''}>{ownershipTotal}% / 100%</strong></div>
            <div className="field-grid"><div><label>Is the primary owner the 100% owner?</label><select value={form.owners.length === 1 && form.owners[0].ownershipPercent === '100' ? 'yes' : 'no'} onChange={(e) => setPrimaryOwnershipMode(e.target.value)}><option value="yes">Yes</option><option value="no">No</option></select></div></div>
            {form.owners.map((owner, index) => <div className="owner-card" key={index}><div className="owner-card-head"><strong>{index === 0 ? 'Primary owner' : `Additional owner ${index + 1}`}</strong>{index > 0 && <button className="owner-remove" type="button" onClick={() => removeOwner(index)}>Remove</button>}</div><div className="field-grid"><div><label>First name</label><input value={owner.firstName} onChange={updateOwner(index, 'firstName')} /></div><div><label>Last name</label><input value={owner.lastName} onChange={updateOwner(index, 'lastName')} /></div><div><label>Email</label><input type="email" value={owner.email} onChange={updateOwner(index, 'email')} /></div><div><label>Best phone</label><input value={owner.phone} onChange={updateOwner(index, 'phone')} /></div><div><label>Date of birth</label><input type="date" value={owner.dob} onChange={updateOwner(index, 'dob')} /></div><div><label>SSN</label><input value={owner.ssn} onChange={updateOwner(index, 'ssn')} placeholder="•••-••-••••" /></div><div><label>Ownership percentage</label><input type="number" min="0.01" max="100" step="0.01" value={owner.ownershipPercent} onChange={updateOwner(index, 'ownershipPercent')} placeholder="50" /></div></div></div>)}
            {ownershipTotal < 100 && <button className="secondary add-owner" type="button" onClick={addOwner}>+ Add another owner</button>}{ownerError && <div className="validation-error">{ownerError}</div>}
          </div>}

          {step === 4 && <div className="content-block centered"><div className="status-icon">✓</div><h3>BRC lookup</h3><p>We now have the information needed to check for the New Jersey Business Registration Certificate and continue the application workflow.</p></div>}
          {step === 5 && <div className="content-block centered"><div className="status-icon">✓</div><h3>Your intake is saved.</h3><p>Your COR account will show each next step, outstanding document, payment status, and application update.</p></div>}

          {message && <div className="form-message">{message}</div>}
          <div className="wizard-footer">
            <button className="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>Back</button>
            {step === 0 && <button className="primary compact" onClick={continueFromEligibility} disabled={busy}>Continue</button>}
            {step === 1 && <button className="primary compact" onClick={signInMode ? signInAndResume : createAccountAndCase} disabled={busy}>{busy ? (signInMode ? 'Signing in…' : 'Creating…') : (signInMode ? 'Sign in & continue' : 'Create account & continue')}</button>}
            {step === 2 && <button className="primary compact" onClick={saveBusinessStep} disabled={busy}>{busy ? 'Saving…' : 'Save & continue'}</button>}
            {step === 3 && <button className="primary compact" onClick={saveOwnerStep} disabled={busy}>{busy ? 'Saving…' : 'Save owners & continue'}</button>}
            {step === 4 && <button className="primary compact" onClick={() => setStep(5)}>Continue</button>}
          </div>
        </div>
        <div className="trust-row"><span>Secure application</span><span>•</span><span>Private document storage</span><span>•</span><span>Progress saved to your account</span></div>
      </main>
    </div>
  );
}

export default App;
