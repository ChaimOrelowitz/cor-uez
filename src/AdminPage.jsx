import React, { useEffect, useMemo, useState } from 'react';
import {
  getAdminApplication,
  getAdminApplications,
  getApplicantSession,
  getDocumentUrl,
  markAdminBrcFound,
  markAdminBrcNotFound,
  signInApplicant,
  signOutApplicant,
  updateAdminApplicationStatus,
  whoAmI
} from './api';

const NJ_BRC_LOOKUP_URL = 'https://www1.state.nj.us/TYTR_BRC/servlet/common/BRCLogin';
const NJ_REGISTRATION_URL = 'https://www.njportal.com/dor/businessregistration';
const UEZ_API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const LOCAL_BRC_CHECKER = 'http://127.0.0.1:4318';

function statusLabel(status) {
  const labels = {
    intake_in_progress: 'In progress',
    submitted_for_review: 'Submitted',
    waiting_for_brc: 'Waiting for BRC',
    brc_uploaded: 'BRC uploaded',
    brc_confirmed: 'BRC confirmed',
    ldc_submitted: 'LDC submitted',
    approved: 'Approved'
  };
  return labels[status] || String(status || '').replace(/_/g, ' ');
}

function programLabel(code) {
  return code === 'lakewood_technology_grant' ? 'Lakewood LDC Technology Grant' : (code || 'UEZ enrollment');
}

function documentLabel(type) {
  if (type === 'formation') return 'Formation document';
  if (type === 'brc') return 'BRC';
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
  const [profile, setProfile] = useState(null);
  const [login, setLogin] = useState({ email: '', password: '' });
  const [applications, setApplications] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [filter, setFilter] = useState('submitted');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [brcForm, setBrcForm] = useState({
    registeredBusinessName: '',
    tradeName: '',
    address: '',
    certificateNumber: '',
    effectiveDate: '',
    issuanceDate: ''
  });

  useEffect(() => {
    getApplicantSession().then(async (current) => {
      if (!current) return;
      setSession(current);
      await bootstrap();
    }).catch(() => {});
  }, []);

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
      const app = data.application;
      const brc = app.brc_data || {};
      setBrcForm({
        registeredBusinessName: app.brc_registered_name || app.registered_business_name || app.business_name_input || '',
        tradeName: brc.tradeName || '',
        address: brc.address || '',
        certificateNumber: brc.certificateNumber || '',
        effectiveDate: brc.effectiveDate || '',
        issuanceDate: brc.issuanceDate || ''
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

  async function openDoc(doc) {
    try {
      const result = await getDocumentUrl(detail.application.id, doc.id);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function waitForLocalBrc(jobId) {
    const statusMessages = {
      opening: 'Opening the NJ BRC checker on this computer…',
      waiting_for_nj: 'NJ is loading in the checker window…',
      checking: 'NJ lookup submitted. Complete any verification shown in the checker window.',
      waiting_for_verification: 'Complete the NJ verification in the checker window. UEZ will import the result automatically.',
      saving_pdf: 'BRC found. Creating the applicant’s PDF…',
      uploading: 'Uploading the BRC PDF directly to the applicant’s UEZ file…',
      saving_not_found: 'Saving the NJ result…'
    };

    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const response = await fetch(`${LOCAL_BRC_CHECKER}/jobs/${jobId}`, { cache: 'no-store' });
      const job = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(job.error || 'The local BRC checker stopped responding.');
      if (statusMessages[job.status]) setMessage(statusMessages[job.status]);
      if (['complete', 'not_found', 'error'].includes(job.status)) return job;
    }
  }

  async function runBrcLookup() {
    setBusy(true);
    setMessage('Connecting to the BRC checker on this computer…');
    try {
      const currentSession = await getApplicantSession();
      if (!currentSession?.access_token) throw new Error('Please sign in again before running the BRC check.');

      const response = await fetch(`${LOCAL_BRC_CHECKER}/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicationId: detail.application.id,
          businessName: detail.application.business_name_input,
          ein: detail.application.ein,
          apiBase: UEZ_API_BASE,
          accessToken: currentSession.access_token
        })
      });
      const started = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(started.error || 'Could not start the local BRC checker.');

      const outcome = await waitForLocalBrc(started.id);
      await refreshList(detail.application.id);

      if (outcome.status === 'complete') {
        setMessage('BRC confirmed. The PDF and certificate details were added directly to this applicant’s UEZ file.');
      } else if (outcome.status === 'not_found') {
        setMessage('NJ did not find a matching BRC. The applicant was marked as waiting for a BRC.');
      } else {
        throw new Error(outcome.error || 'The BRC check did not finish.');
      }
    } catch (err) {
      const connectionProblem = /fetch|network|failed to connect|stopped responding/i.test(String(err.message || err));
      setMessage(connectionProblem
        ? 'The BRC checker is not running on this computer. Start npm run brc-checker in the repository backend folder, then click this button again.'
        : err.message);
    } finally {
      setBusy(false);
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
      setMessage('Marked as waiting for BRC. The applicant now sees the BRC instructions and upload button in their account.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return applications.filter((app) => {
      const matchesSearch = !q || [app.business_name_input, app.registered_business_name, app.contact_email, app.ein]
        .some((value) => String(value || '').toLowerCase().includes(q));
      if (!matchesSearch) return false;
      if (filter === 'all') return true;
      if (filter === 'submitted') return ['submitted_for_review', 'brc_uploaded'].includes(app.status);
      if (filter === 'brc') return app.status === 'waiting_for_brc';
      if (filter === 'confirmed') return app.brc_status === 'found' || app.status === 'brc_confirmed';
      return true;
    });
  }, [applications, filter, search]);

  const counts = useMemo(() => ({
    submitted: applications.filter((app) => ['submitted_for_review', 'brc_uploaded'].includes(app.status)).length,
    brc: applications.filter((app) => app.status === 'waiting_for_brc').length,
    confirmed: applications.filter((app) => app.brc_status === 'found' || app.status === 'brc_confirmed').length,
    all: applications.length
  }), [applications]);

  const emailApplicantHref = detail ? `mailto:${encodeURIComponent(detail.application.contact_email || '')}?subject=${encodeURIComponent('Your New Jersey Business Registration Certificate is needed')}&body=${encodeURIComponent(
    `Hi,\n\nWe reviewed your COR UEZ application and could not locate a current New Jersey Business Registration Certificate (BRC).\n\nPlease complete New Jersey business/tax registration here:\n${NJ_REGISTRATION_URL}\n\nOnce your BRC is available, sign back into your COR account and upload it. We will continue your application from there.\n\nCOR Solutions`
  )}` : '#';

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
      <div className="admin-top-actions"><a href="/" target="_blank" rel="noreferrer">Open applicant site</a><button onClick={handleSignOut}>Sign out</button></div>
    </header>

    <main className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-head">
          <div><span>APPLICATIONS</span><strong>{applications.length}</strong></div>
          <input placeholder="Search business, email, EIN" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="admin-filter-row">
          {[
            ['submitted', 'New', counts.submitted],
            ['brc', 'Needs BRC', counts.brc],
            ['confirmed', 'BRC ✓', counts.confirmed],
            ['all', 'All', counts.all]
          ].map(([key, label, count]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}<span>{count}</span></button>)}
        </div>

        <div className="application-list">
          {filtered.map((app) => <button key={app.id} className={`application-list-item ${selectedId === app.id ? 'active' : ''}`} onClick={() => openApplication(app.id)}>
            <div><strong>{app.business_name_input || 'Unnamed business'}</strong><small>{app.contact_email || 'No email'}</small></div>
            <div className="list-item-meta"><span className={`mini-status ${app.status === 'waiting_for_brc' ? 'warn' : app.brc_status === 'found' ? 'good' : ''}`}>{statusLabel(app.status)}</span><small>{new Date(app.created_at).toLocaleDateString()}</small></div>
          </button>)}
          {filtered.length === 0 && <div className="empty-list">No applications in this view.</div>}
        </div>
      </aside>

      <section className="admin-detail">
        {!detail && <div className="admin-empty"><h2>Select an application</h2><p>New submissions will appear on the left.</p></div>}

        {detail && <>
          <div className="admin-detail-header">
            <div><span className="eyebrow">UEZ APPLICATION</span><h1>{detail.application.business_name_input}</h1><p>{detail.application.contact_email} · {detail.application.contact_phone || 'No phone'}</p></div>
            <div className="admin-header-status"><span>{statusLabel(detail.application.status)}</span><small>Submitted {detail.application.submitted_at ? new Date(detail.application.submitted_at).toLocaleString() : 'not yet'}</small></div>
          </div>

          {message && <div className="admin-message">{message}</div>}

          <div className="admin-card-grid">
            <section className="admin-card">
              <div className="admin-card-head"><h3>Business</h3><span>{programLabel(detail.application.program_code)}</span></div>
              <dl className="data-grid">
                <div><dt>Business name</dt><dd>{detail.application.business_name_input}</dd></div>
                <div><dt>EIN</dt><dd>{detail.application.ein || '—'}</dd></div>
                <div><dt>Address</dt><dd>{detail.application.address_line1 || '—'}</dd></div>
                <div><dt>UEZ</dt><dd>{detail.application.zone_name || '—'}</dd></div>
                <div><dt>Founded</dt><dd>{detail.application.year_founded || '—'}</dd></div>
                <div><dt>Employees</dt><dd>{detail.application.full_time_employees ?? 0} FT · {detail.application.part_time_employees ?? 0} PT</dd></div>
                <div className="data-wide"><dt>Description</dt><dd>{detail.application.business_description || '—'}</dd></div>
              </dl>
            </section>

            <section className="admin-card brc-admin-card">
              <div className="admin-card-head"><h3>BRC verification</h3><span className={`status-pill ${detail.application.brc_status === 'found' ? 'good' : detail.application.status === 'waiting_for_brc' ? 'warn' : ''}`}>{detail.application.brc_status || 'pending'}</span></div>
              <div className="lookup-values"><span>Name control <strong>{nameControl(detail.application.business_name_input)}</strong></span><span>NJ Tax ID <strong>{njTaxId(detail.application.ein)}</strong></span></div>
              <button className="primary admin-primary" onClick={runBrcLookup} disabled={busy}>{busy ? 'BRC check running…' : 'Look up and import BRC from NJ'}</button>
              <p className="admin-help">Start the local BRC checker on this computer, then click above. Complete any NJ verification in its window; the certificate details and PDF will be added directly to this applicant’s UEZ file.</p>

              <div className="brc-result-form">
                <label>Official registered business name</label><input value={brcForm.registeredBusinessName} onChange={(e) => setBrcForm((old) => ({ ...old, registeredBusinessName: e.target.value }))} />
                <div className="admin-two-col">
                  <div><label>Certificate #</label><input value={brcForm.certificateNumber} onChange={(e) => setBrcForm((old) => ({ ...old, certificateNumber: e.target.value }))} /></div>
                  <div><label>Trade name</label><input value={brcForm.tradeName} onChange={(e) => setBrcForm((old) => ({ ...old, tradeName: e.target.value }))} /></div>
                  <div><label>Effective date</label><input value={brcForm.effectiveDate} onChange={(e) => setBrcForm((old) => ({ ...old, effectiveDate: e.target.value }))} /></div>
                  <div><label>Issue date</label><input value={brcForm.issuanceDate} onChange={(e) => setBrcForm((old) => ({ ...old, issuanceDate: e.target.value }))} /></div>
                </div>
                <label>BRC address</label><input value={brcForm.address} onChange={(e) => setBrcForm((old) => ({ ...old, address: e.target.value }))} />
              </div>

              <div className="admin-action-row">
                <button className="success-button" onClick={saveBrcFound} disabled={busy}>✓ BRC found</button>
                <button className="warning-button" onClick={saveBrcNotFound} disabled={busy}>No BRC found</button>
              </div>

              {detail.application.status === 'waiting_for_brc' && <a className="secondary admin-email-button" href={emailApplicantHref}>Email applicant BRC instructions</a>}
            </section>

            <section className="admin-card admin-wide">
              <div className="admin-card-head"><h3>Owners</h3><span>{detail.owners.length}</span></div>
              <div className="owner-admin-list">
                {detail.owners.map((owner) => <div className="owner-admin-card" key={owner.id}>
                  <div className="owner-admin-title"><strong>{owner.firstName} {owner.lastName}</strong><span>{owner.ownershipPercent}%</span></div>
                  <dl className="data-grid compact-data">
                    <div><dt>Email</dt><dd>{owner.email || '—'}</dd></div>
                    <div><dt>Phone</dt><dd>{owner.phone || '—'}</dd></div>
                    <div><dt>DOB</dt><dd>{owner.dob || '—'}</dd></div>
                    <div><dt>SSN</dt><dd>{formatSsn(owner.ssn)}</dd></div>
                  </dl>
                </div>)}
              </div>
            </section>

            <section className="admin-card">
              <div className="admin-card-head"><h3>Documents</h3><span>{detail.documents.length}</span></div>
              <div className="admin-document-list">
                {detail.documents.map((doc) => <button key={doc.id} onClick={() => openDoc(doc)}><span><strong>{documentLabel(doc.document_type)}</strong><small>{doc.filename}</small></span><b>Open</b></button>)}
                {detail.documents.length === 0 && <p className="muted">No documents uploaded.</p>}
              </div>
            </section>

            <section className="admin-card">
              <div className="admin-card-head"><h3>Workflow</h3></div>
              <button className="secondary admin-full-button" onClick={markReadyForLdc} disabled={busy || detail.application.brc_status !== 'found'}>Mark ready for grant processing</button>
              <p className="admin-help">This becomes available after the BRC is confirmed.</p>
              <div className="admin-timeline">
                {[...detail.statusEvents].reverse().slice(0, 6).map((event) => <div key={event.id}><strong>{event.label || statusLabel(event.status)}</strong><p>{event.message}</p><small>{new Date(event.created_at).toLocaleString()}</small></div>)}
              </div>
            </section>
          </div>
        </>}
      </section>
    </main>
  </div>;
}
