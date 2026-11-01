import React, { useEffect, useState } from 'react';
import './zone.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4100';

export default function EnrollPage({ token }) {
  const [info, setInfo] = useState(undefined); // undefined=loading, null=invalid
  const [f, setF] = useState({ username: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/uez/enroll/${encodeURIComponent(token)}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => setInfo(ok ? d : null))
      .catch(() => setInfo(null));
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/uez/enroll/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f)
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
      if (d.ok) setDone(true);
      else setErr(d.error || "That didn't work. Please try again.");
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  if (info === undefined) return <div className="z-center"><div className="z-card z-signin z-muted">Loading…</div></div>;

  if (info === null || info.expired) {
    return (
      <div className="z-center">
        <div className="z-card z-signin">
          <div className="brand-mark lg">EZ</div>
          <h1>Link not available</h1>
          <p className="z-muted">{info?.expired ? 'This link has expired.' : "This link isn't valid."} Please ask your UEZ office to send a new one.</p>
        </div>
      </div>
    );
  }

  if (done || info.status === 'ok') {
    return (
      <div className="z-center">
        <div className="z-card z-signin z-enroll-done">
          <div className="z-enroll-check">✓</div>
          <h1>You're all set</h1>
          <p className="z-muted">Thank you! Your login is saved securely with {info.zone}. When it's time to recertify {info.business}, we'll reach out and help you get it done — it only takes a couple of minutes.</p>
          <p className="z-muted small">You can close this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="z-center">
      <form className="z-card z-signin z-enroll" onSubmit={submit}>
        <div className="brand-mark lg">EZ</div>
        <h1>Assisted recertification</h1>
        <p className="z-muted">{info.zone} can handle UEZ recertification for <strong>{info.business}</strong>. Enter your myNJ login below and we'll take it from here when it's time to re-up.</p>

        <label>myNJ login ID</label>
        <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" autoCapitalize="none" />
        <label>myNJ password</label>
        <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="off" />

        <button className="btn z-full" disabled={busy || !f.username || !f.password}>{busy ? 'Checking your login…' : 'Save securely'}</button>
        {err && <div className="z-alert bad" style={{ marginTop: 12 }}>{err}</div>}

        <div className="z-enroll-note">
          🔒 Your login is encrypted and stored securely. {info.zone} never sees your password — it's used only to help you file your recertification.
        </div>
      </form>
    </div>
  );
}
