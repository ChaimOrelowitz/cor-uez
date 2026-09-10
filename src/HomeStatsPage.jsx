import React, { useEffect, useState } from 'react';
import { getApplicantSession, getHomeStats, saveAdminHomeStats, whoAmI } from './api';

// Two manually-set numbers shown on the client home/intro screen —
// "X Applications Submitted" / "Y Grants Left". No auto-calculation yet;
// an admin just types the current numbers in here. Same auth-check +
// load/save shape as SignupLayoutPage.
export default function HomeStatsPage() {
  const [stats, setStats] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await getApplicantSession();
      if (!session) return window.location.replace('/admin');
      const me = await whoAmI();
      if (me.role !== 'admin') return window.location.replace('/admin');
      const result = await getHomeStats();
      setStats({ applicationsSubmitted: String(result.applicationsSubmitted ?? 0), grantsLeft: String(result.grantsLeft ?? 0) });
    })().catch((err) => setMessage(err.message));
  }, []);

  async function save() {
    setBusy(true); setMessage('');
    try {
      const result = await saveAdminHomeStats({
        applicationsSubmitted: Number(stats.applicationsSubmitted),
        grantsLeft: Number(stats.grantsLeft)
      });
      setStats({ applicationsSubmitted: String(result.applicationsSubmitted), grantsLeft: String(result.grantsLeft) });
      setMessage('Saved. The home page numbers are live for every visitor.');
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  if (!stats) return <div className="app-shell auth-loading-shell admin-loading"><div className="auth-loading-card">{message || 'Loading home stats…'}</div></div>;

  return <div className="admin-shell signup-layout-shell">
    <header className="admin-topbar">
      <div className="admin-brand"><div className="brand-mark">COR</div><div><strong>Home Stats</strong><span>Admin</span></div></div>
      <div className="admin-top-actions"><a href="/admin">BACK TO ADMIN</a><a href="/" target="_blank" rel="noreferrer">PREVIEW HOME PAGE</a></div>
    </header>
    <main className="signup-layout-wrap">
      <div className="signup-layout-heading">
        <div><span className="eyebrow">CLIENT HOME PAGE</span><h1>Set the two homepage numbers</h1><p>These two numbers show on the home page every visitor sees before signing up. Set them by hand for now — nothing here is calculated automatically.</p></div>
        <div className="layout-actions"><button className="primary compact" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </div>
      {message && <div className="form-message layout-message">{message}</div>}
      <div className="layout-groups">
        <section className="wizard-card layout-group">
          <div className="layout-group-head"><h2>Applications submitted</h2></div>
          <div style={{ padding: '4px 2px 14px' }}>
            <input
              type="number"
              min="0"
              value={stats.applicationsSubmitted}
              onChange={(e) => setStats((old) => ({ ...old, applicationsSubmitted: e.target.value }))}
              style={{ fontSize: 22, fontWeight: 700, width: '100%', boxSizing: 'border-box' }}
            />
          </div>
        </section>
        <section className="wizard-card layout-group">
          <div className="layout-group-head"><h2>Grants left</h2></div>
          <div style={{ padding: '4px 2px 14px' }}>
            <input
              type="number"
              min="0"
              value={stats.grantsLeft}
              onChange={(e) => setStats((old) => ({ ...old, grantsLeft: e.target.value }))}
              style={{ fontSize: 22, fontWeight: 700, width: '100%', boxSizing: 'border-box' }}
            />
          </div>
        </section>
      </div>
    </main>
  </div>;
}
