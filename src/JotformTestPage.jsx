import React, { useEffect, useRef, useState } from 'react';
import { getApplicantSession, getAdminApplication, startJotformTest, whoAmI } from './api';

// Admin-only harness for testing the JotForm signup wiring end to end,
// without touching the live client wizard at all. "Start new test" creates
// a throwaway application, embeds the real JotForm with that application's
// id prefilled into its hidden field, and polls until the webhook
// (backend/routes/uezJotform.js) marks it submitted — at which point it's
// just a normal application, viewable in the usual admin Case Workspace.
const JOTFORM_URL = 'https://form.jotform.com/262516524276055';
const JOTFORM_ID_PARAM = 'q47_applicationId'; // must match the field's Name in the JotForm builder

export default function JotformTestPage() {
  const [authorized, setAuthorized] = useState(false);
  const [applicationId, setApplicationId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | waiting | received
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    (async () => {
      const session = await getApplicantSession();
      if (!session) return window.location.replace('/admin');
      const me = await whoAmI();
      if (me.role !== 'admin') return window.location.replace('/admin');
      setAuthorized(true);
    })().catch((err) => setMessage(err.message));
  }, []);

  useEffect(() => {
    if (status !== 'waiting' || !applicationId) return undefined;
    pollRef.current = window.setInterval(async () => {
      try {
        const bundle = await getAdminApplication(applicationId);
        if (bundle?.application?.submitted_at) {
          window.clearInterval(pollRef.current);
          setStatus('received');
        }
      } catch (_) { /* keep polling — a transient failure shouldn't stop the check */ }
    }, 4000);
    return () => window.clearInterval(pollRef.current);
  }, [status, applicationId]);

  async function startTest() {
    setBusy(true); setMessage('');
    try {
      const result = await startJotformTest();
      setApplicationId(result.applicationId);
      setStatus('waiting');
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  function startAnother() {
    window.clearInterval(pollRef.current);
    setApplicationId(null);
    setStatus('idle');
    setMessage('');
  }

  if (!authorized) return <div className="app-shell auth-loading-shell admin-loading"><div className="auth-loading-card">Loading…</div></div>;

  return <div className="admin-shell signup-layout-shell">
    <header className="admin-topbar">
      <div className="admin-brand"><div className="brand-mark">COR</div><div><strong>JotForm Test</strong><span>Admin</span></div></div>
      <div className="admin-top-actions"><a href="/admin">BACK TO ADMIN</a></div>
    </header>
    <main className="signup-layout-wrap">
      <div className="signup-layout-heading">
        <div><span className="eyebrow">JOTFORM SIGNUP — TEST HARNESS</span><h1>Test the JotForm wiring</h1><p>This creates a throwaway test application, embeds the real JotForm, and waits for its webhook to land the submission — exactly like a real signup would, without touching the live site. Fill it out and submit to confirm everything lands correctly.</p></div>
        {status === 'idle' && <div className="layout-actions"><button className="primary compact" onClick={startTest} disabled={busy}>{busy ? 'Starting…' : 'Start new test'}</button></div>}
        {status !== 'idle' && <div className="layout-actions"><button className="secondary compact" onClick={startAnother}>Start another test</button></div>}
      </div>
      {message && <div className="form-message layout-message">{message}</div>}

      {status === 'waiting' && <>
        <div className="admin-message" style={{ marginBottom: 12 }}>Waiting for submission… fill out the form below. This page checks every few seconds for the webhook to land — no need to refresh.</div>
        <iframe
          src={`${JOTFORM_URL}?${JOTFORM_ID_PARAM}=${encodeURIComponent(applicationId)}`}
          title="Test client JotForm"
          style={{ width: '100%', height: '80vh', border: '1px solid var(--admin-border, #e3e6f2)', borderRadius: 12, background: '#fff' }}
        />
      </>}

      {status === 'received' && <div className="wizard-card layout-group" style={{ padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>✅ Submission received</h2>
        <p>The webhook landed the data. Open it in the normal Case Workspace to check every field, owner, and document came through correctly.</p>
        <a className="primary compact inline-button" href={`/admin/businesses/${applicationId}`} target="_blank" rel="noreferrer">View in admin pipeline ↗</a>
      </div>}
    </main>
  </div>;
}
