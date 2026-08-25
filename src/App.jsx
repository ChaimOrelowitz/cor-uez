import React, { useEffect, useMemo, useState } from 'react';
import { checkUezEligibility, suggestNjAddresses } from './eligibility';
import UezMap from './UezMap';
import { checkBrcTest, createApplication, getMyApplications, saveBusiness, saveOwners, signInApplicant, signUpApplicant } from './api';

const TEST_MODE = true;
const steps = ['Address', 'Eligibility', 'Account', 'Business', 'Owners', 'BRC', 'Review'];
const blankOwner = () => ({ firstName: '', lastName: '', email: '', phone: '', dob: '', ssn: '', ownershipPercent: '' });

function BrcTestPage() {
  const [businessName, setBusinessName] = useState('');
  const [ein, setEin] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function runLookup(e) {
    e.preventDefault();
    setBusy(true); setError(''); setResult(null);
    try {
      setResult(await checkBrcTest(businessName.trim(), ein.trim()));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="app-shell">
    <header className="topbar"><div className="brand-mark">COR</div><div><div className="brand-name">COR Solutions</div><div className="brand-subtitle">BRC Lookup Test</div></div></header>
    <main className="page-wrap brc-test-wrap">
      <div className="wizard-card">
        <div className="wizard-head"><div><span className="step-count">TEST TOOL</span><h2>New Jersey BRC Lookup</h2></div></div>
        <form className="content-block" onSubmit={runLookup}>
          <div className="intro-copy"><h3>Check a business registration certificate</h3><p>Enter the business name and 9-digit EIN exactly as you know them.</p></div>
          <label>Business name</label><input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required />
          <label>EIN</label><input value={ein} onChange={(e) => setEin(e.target.value)} placeholder="12-3456789" required />
          <button className="primary" disabled={busy}>{busy ? 'Checking…' : 'Check BRC'}</button>
          {error && <div className="validation-error">{error}</div>}
          {result && <div className={`brc-test-result ${result.outcome}`}>
            <strong>{result.outcome === 'found' ? 'BRC found' : result.outcome === 'not_found' ? 'No BRC match found' : result.outcome === 'manual_verification_required' ? 'Manual verification required' : 'Lookup result'}</strong>
            {result.lookup && <p>Name control: {result.lookup.nameControl} · NJ Tax ID: {result.lookup.njTaxId}</p>}
            {result.result?.taxpayerName && <p><b>Registered name:</b> {result.result.taxpayerName}</p>}
            {result.result?.tradeName && <p><b>Trade name:</b> {result.result.tradeName}</p>}
            {result.result?.address && <p><b>Address:</b> {result.result.address}</p>}
            {result.result?.certificateNumber && <p><b>Certificate #:</b> {result.result.certificateNumber}</p>}
          </div>}
        </form>
      </div>
    </main>
  </div>;
}

function App() {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [eligibility, setEligibility] = useState(null);
  const [applicationId, setApplicationId] = useState(null);
  const [ownerError, setOwnerError] = useState('');
  const [signInMode, setSignInMode] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [addressMagicKey, setAddressMagicKey] = useState(null);
  const [showAddressSuggestions, setShowAddressSuggestions] = useState(false);
  const [form, setForm] = useState({
    address: '', email: '', password: '', businessName: '', businessDescription: '', ein: '', yearFounded: '',
    isSoleProprietorship: '', fullTimeEmployees: '', partTimeEmployees: '',
    owners: [{ ...blankOwner(), ownershipPercent: '100' }]
  });

  const progress = useMemo(() => `${step + 1} of ${steps.length}`, [step]);
  const ownershipTotal = useMemo(() => form.owners.reduce((sum, owner) => sum + (Number(owner.ownershipPercent) || 0), 0), [form.owners]);
  const primaryIs100 = form.owners.length === 1 && form.owners[0].ownershipPercent === '100';
  const eligibleProgramName = eligibility?.programs?.[0]?.name || 'UEZ enrollment';
  const update = (key) => (e) => setForm((old) => ({ ...old, [key]: e.target.value }));
  const updateOwner = (index, key) => (e) => {
    const value = e.target.value;
    setForm((old) => ({ ...old, owners: old.owners.map((owner, i) => i === index ? { ...owner, [key]: value } : owner) }));
    setOwnerError('');
  };

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
        }
      } catch (_) {
        if (!cancelled) setAddressSuggestions([]);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [form.address, addressMagicKey, step]);

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
    setEligibility(null);
    setMessage('');
  }

  async function runAddressCheck(e) {
    e.preventDefault();
    setBusy(true); setMessage(''); setShowAddressSuggestions(false);
    try {
      const result = await checkUezEligibility(form.address.trim(), addressMagicKey);
      setEligibility(result);
      if (result?.matchedAddress) setForm((old) => ({ ...old, address: result.matchedAddress }));
      if (result?.status === 'address_not_found') setMessage('We could not confidently match that address. Please choose a suggested address or check the spelling.');
      else if (!result?.eligible) setMessage('This address does not appear to be inside a New Jersey Urban Enterprise Zone.');
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  async function createAccountAndCase() {
    if (TEST_MODE) {
      if (!form.email.trim()) return setMessage('Enter any email address to continue testing.');
      setApplicationId('test-mode'); setMessage(''); setStep(3); return;
    }
    setBusy(true); setMessage('');
    try {
      const auth = await signUpApplicant(form.email.trim(), form.password);
      if (!auth.session) {
        setSignInMode(true);
        setMessage('Check your email to confirm your account. Then come back here and sign in with the same email and password.');
        return;
      }
      const app = await createApplication({ contactEmail: form.email.trim(), address: eligibility?.matchedAddress || form.address, zoneIdentifier: eligibility?.zoneIdentifier, zoneName: eligibility?.zoneName, zoneEligible: eligibility?.eligible === true, programCode: eligibility?.programs?.[0]?.code || null });
      setApplicationId(app.id); setStep(3);
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  async function signInAndResume() {
    setBusy(true); setMessage('');
    try {
      await signInApplicant(form.email.trim(), form.password);
      const applications = await getMyApplications();
      const latest = applications?.[0];
      if (!latest) { setSignInMode(false); setStep(0); setMessage('Signed in. Check your business address to start an application.'); return; }
      setApplicationId(latest.id);
      setForm((old) => ({ ...old, address: latest.address_line1 || old.address, businessName: latest.business_name_input || old.businessName, businessDescription: latest.business_description || old.businessDescription, ein: latest.ein || old.ein, yearFounded: latest.year_founded ?? old.yearFounded, isSoleProprietorship: latest.is_sole_proprietorship == null ? old.isSoleProprietorship : (latest.is_sole_proprietorship ? 'yes' : 'no'), fullTimeEmployees: latest.full_time_employees ?? old.fullTimeEmployees, partTimeEmployees: latest.part_time_employees ?? old.partTimeEmployees }));
      setSignInMode(false); setStep(latest.business_name_input ? 4 : 3); setMessage('Welcome back. Your application is loaded.');
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  async function saveBusinessStep() {
    if (TEST_MODE) { setMessage(''); setStep(4); return; }
    if (!applicationId) return setMessage('Your application has not been created yet.');
    setBusy(true); setMessage('');
    try {
      await saveBusiness(applicationId, { businessName: form.businessName, businessDescription: form.businessDescription, ein: form.ein, yearFounded: form.yearFounded, isSoleProprietorship: form.isSoleProprietorship === 'yes', fullTimeEmployees: form.fullTimeEmployees, partTimeEmployees: form.partTimeEmployees, contactPhone: form.owners[0]?.phone || null });
      setStep(4);
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  async function saveOwnerStep() {
    const ownersForSave = primaryIs100 ? [{ ...form.owners[0], ownershipPercent: '100' }] : form.owners;
    const total = ownersForSave.reduce((sum, owner) => sum + (Number(owner.ownershipPercent) || 0), 0);
    if (Math.abs(total - 100) > 0.001) { setOwnerError(`Ownership currently totals ${total}%. Please account for exactly 100% before continuing.`); return; }
    if (ownersForSave.some((owner) => !owner.firstName || !owner.lastName || !owner.ownershipPercent)) { setOwnerError('Please complete each owner’s name and ownership percentage before continuing.'); return; }
    if (TEST_MODE) { setOwnerError(''); setStep(5); return; }
    setBusy(true); setMessage('');
    try { await saveOwners(applicationId, ownersForSave); setStep(5); }
    catch (err) { setOwnerError(err.message); }
    finally { setBusy(false); }
  }

  function setPrimaryOwnershipMode(value) {
    if (value === 'yes') setForm((old) => ({ ...old, owners: [{ ...old.owners[0], ownershipPercent: '100' }] }));
    else setForm((old) => ({ ...old, owners: old.owners.length > 1 ? old.owners : [{ ...old.owners[0], ownershipPercent: '' }, blankOwner()] }));
  }
  function addOwner() { setForm((old) => ({ ...old, owners: [...old.owners, blankOwner()] })); }
  function removeOwner(index) { if (index) setForm((old) => ({ ...old, owners: old.owners.filter((_, i) => i !== index) })); }
  function continueFromAddress() {
    if (!eligibility) return setMessage('Check your business address first.');
    if (eligibility.status === 'address_not_found') return setMessage('We could not confidently match that address. Please check it and try again.');
    if (!eligibility.eligible) return setMessage('This address does not appear to be inside a New Jersey Urban Enterprise Zone.');
    setMessage(''); setStep(1);
  }
  function continueFromOffer() { setSignInMode(false); setMessage(''); setStep(2); }
  function openSignIn() { if (!TEST_MODE) { setSignInMode(true); setMessage(''); setStep(2); } }

  return <div className="app-shell">
    <header className="topbar"><div className="brand-mark">COR</div><div><div className="brand-name">COR Solutions</div><div className="brand-subtitle">UEZ Enrollment & Grant Support</div></div>{!TEST_MODE && <button className="signin-link" onClick={openSignIn}>Already registered? Sign in</button>}</header>
    <main className="page-wrap">
      <section className="hero"><div className="eyebrow">NEW JERSEY UEZ SERVICES</div><h1>We’ll guide you through the process.</h1><p>Start with your business address. We’ll identify your UEZ zone and show you which programs are available.</p></section>
      <div className="wizard-card">
        <div className="wizard-head"><div><span className="step-count">Step {progress}</span><h2>{steps[step]}</h2></div></div>
        <div className="progress-row seven">{steps.map((name, index) => <div key={name} className={`progress-item ${index <= step ? 'active' : ''}`}><span>{index + 1}</span><small>{name}</small></div>)}</div>

        {step === 0 && <div className="content-block">
          <form onSubmit={runAddressCheck}><div className="intro-copy"><h3>Find your business</h3><p>Start typing the registered business address and choose the matching New Jersey address.</p></div><label>Registered business address</label><div className="address-autocomplete"><input value={form.address} onChange={updateAddress} onFocus={() => setShowAddressSuggestions(addressSuggestions.length > 0)} autoComplete="off" placeholder="Start typing an NJ business address" required />{showAddressSuggestions && addressSuggestions.length > 0 && <div className="address-suggestions">{addressSuggestions.map((suggestion) => <button key={`${suggestion.text}-${suggestion.magicKey || ''}`} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => selectAddressSuggestion(suggestion)}>{suggestion.text}</button>)}</div>}</div><button className="primary" disabled={busy}>{busy ? 'Checking…' : 'Check my address'}</button></form>
          {eligibility?.matchedAddress && <div className="map-card"><UezMap latitude={eligibility.latitude} longitude={eligibility.longitude} zoneGeometry={eligibility.zoneGeometry} address={eligibility.matchedAddress} /><div className="result-strip"><div className={`result-icon ${eligibility.eligible ? 'good' : 'bad'}`}>{eligibility.eligible ? '✓' : '!'}</div><div><h4>{eligibility.eligible ? `Your business is inside the ${eligibility.zoneName}.` : 'This address is not inside a UEZ.'}</h4><p>{eligibility.matchedAddress}</p>{eligibility.programs?.length > 0 && <span className="grant-pill">{eligibleProgramName} available</span>}</div></div></div>}
        </div>}

        {step === 1 && <div className="content-block eligibility-offer compact-offer">
          <h3>Your business is eligible.</h3>
          <div className="offer-row"><span>Available program</span><strong>{eligibleProgramName}</strong></div>
          <div className="offer-row"><span>Available COR Solutions services</span><strong>UEZ enrollment & grant application · $500</strong></div>
          <p className="offer-description">COR Solutions will register your business with the UEZ and apply for the {eligibleProgramName}. This service begins after your business has a BRC. We will check whether you have a BRC; if you do not, we will guide you on getting one. Please click Continue below.</p>
        </div>}

        {step === 2 && <div className="content-block"><div className="intro-copy"><h3>{TEST_MODE ? 'Contact email' : (signInMode ? 'Sign in to your COR account' : 'Create your COR account')}</h3><p>{TEST_MODE ? 'Testing mode is on. Enter any email address to continue.' : (signInMode ? 'Use the email and password for your COR account to resume your application.' : 'Create an account so your progress, documents, and application status stay together.')}</p></div><div className="field-grid"><div><label>Email</label><input type="email" value={form.email} onChange={update('email')} placeholder="test@example.com" /></div>{!TEST_MODE && <div><label>Password</label><input type="password" value={form.password} onChange={update('password')} /></div>}</div></div>}

        {step === 3 && <div className="content-block"><div className="intro-copy"><h3>Tell us about the business</h3><p>We’ll use this information for your UEZ enrollment and grant application.</p></div><label>Business name</label><input value={form.businessName} onChange={update('businessName')} /><label>In a few words, what does the business do?</label><textarea value={form.businessDescription} onChange={update('businessDescription')} placeholder="Example: HVAC installation and repair" required /><div className="field-grid"><div><label>EIN</label><input value={form.ein} onChange={update('ein')} placeholder="12-3456789" /></div><div><label>Year founded</label><input value={form.yearFounded} onChange={update('yearFounded')} /></div><div><label>Is this business a sole proprietorship?</label><select value={form.isSoleProprietorship} onChange={update('isSoleProprietorship')}><option value="">Select yes or no</option><option value="yes">Yes</option><option value="no">No</option></select></div><div></div><div><label>Full-time employees</label><input type="number" min="0" value={form.fullTimeEmployees} onChange={update('fullTimeEmployees')} placeholder="0" /></div><div><label>Part-time employees</label><input type="number" min="0" value={form.partTimeEmployees} onChange={update('partTimeEmployees')} placeholder="0" /></div></div></div>}

        {step === 4 && <div className="content-block"><div className="intro-copy"><h3>Business ownership</h3><p>List every owner of the business.</p></div><div className="hint"><strong>Why we ask for DOB and SSN:</strong> The LDC application requires this information for each business owner in order to apply. COR collects it only so we can prepare and submit the required application information on your behalf.</div><div className="field-grid"><div><label>Is the primary owner the 100% owner?</label><select value={primaryIs100 ? 'yes' : 'no'} onChange={(e) => setPrimaryOwnershipMode(e.target.value)}><option value="yes">Yes</option><option value="no">No</option></select></div></div>{!primaryIs100 && <div className="ownership-summary"><span>Ownership accounted for</span><strong className={Math.abs(ownershipTotal - 100) < 0.001 ? 'ownership-ok' : ''}>{ownershipTotal}% / 100%</strong></div>}{form.owners.map((owner, index) => <div className="owner-card" key={index}><div className="owner-card-head"><strong>{index === 0 ? 'Primary owner' : `Additional owner ${index + 1}`}</strong>{index > 0 && <button className="owner-remove" type="button" onClick={() => removeOwner(index)}>Remove</button>}</div><div className="field-grid"><div><label>First name</label><input value={owner.firstName} onChange={updateOwner(index, 'firstName')} /></div><div><label>Last name</label><input value={owner.lastName} onChange={updateOwner(index, 'lastName')} /></div><div><label>Email</label><input type="email" value={owner.email} onChange={updateOwner(index, 'email')} /></div><div><label>Best phone</label><input value={owner.phone} onChange={updateOwner(index, 'phone')} /></div><div><label>Date of birth</label><input type="date" value={owner.dob} onChange={updateOwner(index, 'dob')} /></div><div><label>SSN</label><input value={owner.ssn} onChange={updateOwner(index, 'ssn')} placeholder="•••-••-••••" /></div>{!primaryIs100 && <div><label>Ownership percentage</label><input type="number" min="0.01" max="100" step="0.01" value={owner.ownershipPercent} onChange={updateOwner(index, 'ownershipPercent')} placeholder="50" /></div>}</div></div>)}{!primaryIs100 && ownershipTotal < 100 && <button className="secondary add-owner" type="button" onClick={addOwner}>+ Add another owner</button>}{ownerError && <div className="validation-error">{ownerError}</div>}</div>}

        {step === 5 && <div className="content-block centered"><div className="status-icon">✓</div><h3>BRC lookup</h3><p>We now have the information needed to check for the New Jersey Business Registration Certificate.</p></div>}
        {step === 6 && <div className="content-block centered"><div className="status-icon">✓</div><h3>Your intake is complete.</h3><p>{TEST_MODE ? 'Testing mode: nothing was saved.' : 'Your COR account will show each next step and application update.'}</p></div>}

        {message && <div className="form-message">{message}</div>}
        <div className="wizard-footer"><button className="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>Back</button>{step === 0 && <button className="primary compact" onClick={continueFromAddress} disabled={busy}>Continue</button>}{step === 1 && <button className="primary compact" onClick={continueFromOffer}>Continue</button>}{step === 2 && <button className="primary compact" onClick={TEST_MODE ? createAccountAndCase : (signInMode ? signInAndResume : createAccountAndCase)} disabled={busy}>Continue</button>}{step === 3 && <button className="primary compact" onClick={saveBusinessStep} disabled={busy}>Continue</button>}{step === 4 && <button className="primary compact" onClick={saveOwnerStep} disabled={busy}>Continue</button>}{step === 5 && <button className="primary compact" onClick={() => setStep(6)}>Continue</button>}</div>
      </div>
      <div className="trust-row"><span>Secure application</span><span>•</span><span>Private document storage</span><span>•</span><span>Progress saved to your account</span></div>
    </main>
  </div>;
}

export default function Root() {
  return window.location.pathname === '/brc-test' ? <BrcTestPage /> : <App />;
}
