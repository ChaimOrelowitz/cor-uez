import React, { useEffect, useState } from 'react';
import { getApplicantSession, requestPasswordReset, signOutApplicant, updateApplicantPassword } from './api';

export default function AccountRecoveryPage({ mode }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [recoveryReady, setRecoveryReady] = useState(mode !== 'reset');

  useEffect(() => {
    if (mode !== 'reset') return;
    let active = true;
    const check = async () => {
      try {
        const session = await getApplicantSession();
        if (active) setRecoveryReady(Boolean(session));
      } catch (_) { if (active) setRecoveryReady(false); }
    };
    check();
    const timer = window.setTimeout(check, 800);
    return () => { active = false; window.clearTimeout(timer); };
  }, [mode]);

  async function sendReset(e) {
    e.preventDefault();
    setBusy(true); setMessage('');
    try {
      await requestPasswordReset(email);
      setMessage('If an account exists for that email, a password reset link has been sent.');
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  async function savePassword(e) {
    e.preventDefault();
    if (password.length < 6) return setMessage('Password must be at least 6 characters.');
    if (password !== confirm) return setMessage('The two passwords do not match.');
    setBusy(true); setMessage('');
    try {
      await updateApplicantPassword(password);
      await signOutApplicant().catch(() => {});
      window.location.href = '/?login=1&passwordReset=1';
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark">COR</div>
      <div><div className="brand-name">COR Solutions</div><div className="brand-subtitle">UEZ Enrollment & Grant Support</div></div>
      <a className="signin-link" href="/?login=1">Log in</a>
    </header>
    <main className="login-page-wrap">
      <section className="wizard-card login-card">
        <div className="content-block">
          {mode === 'forgot' ? <>
            <div className="intro-copy"><h3>Reset your password</h3><p>Enter the email address connected to your COR UEZ account.</p></div>
            <form onSubmit={sendReset}>
              <label>Email</label><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <button className="primary login-submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
            </form>
          </> : <>
            <div className="intro-copy"><h3>Choose a new password</h3><p>{recoveryReady ? 'Enter your new password below.' : 'Open this page from the password reset link in your email.'}</p></div>
            {recoveryReady && <form onSubmit={savePassword}>
              <label>New password</label><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength="6" required />
              <label>Confirm new password</label><input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength="6" required />
              <button className="primary login-submit" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
            </form>}
          </>}
          {message && <div className="form-message">{message}</div>}
        </div>
      </section>
    </main>
  </div>;
}
