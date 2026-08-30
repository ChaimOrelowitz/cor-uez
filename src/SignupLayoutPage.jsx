import React, { useEffect, useState } from 'react';
import { getApplicantSession, getSignupLayout, resetAdminSignupLayout, saveAdminSignupLayout, whoAmI } from './api';

const GROUPS = {
  account: { title: 'Account page', fields: { email: 'Email', password: 'Password' } },
  business: { title: 'Business page', fields: { businessName: 'Business name', businessDescription: 'Business description', ein: 'EIN', yearFounded: 'Year founded', hasDba: 'DBA question', dbaName: 'DBA name (conditional)', fullTimeEmployees: 'Full-time employees', partTimeEmployees: 'Part-time employees' } },
  ownerCore: { title: 'Owners · main fields', fields: { title: 'Title', firstName: 'First name', lastName: 'Last name', email: 'Email', phone: 'Best phone', dob: 'Date of birth', ssn: 'SSN', ownershipPercent: 'Ownership percentage (when applicable)' } },
  ownerAddress: { title: 'Owners · home address', fields: { addressLine1: 'Street address', addressLine2: 'Address line 2', city: 'City', state: 'State', zip: 'ZIP' } },
  documents: { title: 'Documents page', fields: { formation: 'Certificate of Formation upload', soleProp: 'Sole proprietorship alternative', pbsAccount: 'Existing PBS account question', supporting: 'Other supporting document' } }
};

export default function SignupLayoutPage() {
  const [layout, setLayout] = useState(null);
  const [drag, setDrag] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await getApplicantSession();
      if (!session) return window.location.replace('/admin');
      const me = await whoAmI();
      if (me.role !== 'admin') return window.location.replace('/admin');
      setLayout(await getSignupLayout());
    })().catch((err) => setMessage(err.message));
  }, []);

  function move(group, from, to) {
    if (to < 0 || to >= layout[group].length || from === to) return;
    setLayout((old) => {
      const next = [...old[group]];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return { ...old, [group]: next };
    });
  }

  function setSpan(group, key, span) {
    setLayout((old) => ({
      ...old,
      widths: {
        ...(old.widths || {}),
        [group]: { ...(old.widths?.[group] || {}), [key]: span }
      }
    }));
  }

  function spanFor(group, key) {
    return Number(layout.widths?.[group]?.[key]) === 2 ? 2 : 1;
  }

  async function save() {
    setBusy(true); setMessage('');
    try {
      const result = await saveAdminSignupLayout(layout);
      setLayout(result.layout);
      setMessage('Signup layout saved. Field order and row widths are live for new applicants.');
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  async function reset() {
    if (!window.confirm('Reset all signup fields to the original order?')) return;
    setBusy(true); setMessage('');
    try {
      const result = await resetAdminSignupLayout();
      setLayout(result.layout);
      setMessage('Signup layout reset to default.');
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  if (!layout) return <div className="app-shell auth-loading-shell admin-loading"><div className="auth-loading-card">Loading signup layout…</div></div>;

  return <div className="admin-shell signup-layout-shell">
    <header className="admin-topbar">
      <div className="admin-brand"><div className="brand-mark">COR</div><div><strong>Signup Layout</strong><span>Admin</span></div></div>
      <div className="admin-top-actions"><a href="/admin">BACK TO ADMIN</a><a href="/admin/demo-client" target="_blank" rel="noreferrer">PREVIEW CLIENT</a></div>
    </header>
    <main className="signup-layout-wrap">
      <div className="signup-layout-heading"><div><span className="eyebrow">CLIENT SIGNUP</span><h1>Arrange the actual form grid</h1><p>Drag fields into order, then choose whether each field takes half a row or the full row by itself. Guardrails keep every field on its current signup page.</p></div><div className="layout-actions"><button className="secondary" onClick={reset} disabled={busy}>Reset to default</button><button className="primary compact" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save layout'}</button></div></div>
      {message && <div className="form-message layout-message">{message}</div>}
      <div className="layout-groups">
        {Object.entries(GROUPS).map(([group, info]) => <section className="wizard-card layout-group" key={group}>
          <div className="layout-group-head"><h2>{info.title}</h2><span>{layout[group].length} fields</span></div>
          <div className="layout-visual-grid">
            {layout[group].map((key, index) => <div
              key={key}
              className={`layout-field-tile ${spanFor(group, key) === 2 ? 'span-full' : 'span-half'} ${drag?.group === group && drag?.index === index ? 'dragging' : ''}`}
              draggable
              onDragStart={() => setDrag({ group, index })}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (drag?.group === group) move(group, drag.index, index); setDrag(null); }}
            >
              <div className="layout-field-main"><span className="drag-handle" aria-hidden="true">⋮⋮</span><strong>{info.fields[key] || key}</strong></div>
              <div className="layout-field-controls">
                <div className="layout-span-toggle" aria-label={`Width for ${info.fields[key] || key}`}>
                  <button type="button" className={spanFor(group, key) === 1 ? 'active' : ''} onClick={() => setSpan(group, key, 1)}>Half row</button>
                  <button type="button" className={spanFor(group, key) === 2 ? 'active' : ''} onClick={() => setSpan(group, key, 2)}>Full row</button>
                </div>
                <div className="layout-row-actions"><button title="Move up" onClick={() => move(group, index, index - 1)} disabled={index === 0}>↑</button><button title="Move down" onClick={() => move(group, index, index + 1)} disabled={index === layout[group].length - 1}>↓</button></div>
              </div>
            </div>)}
          </div>
        </section>)}
      </div>
    </main>
  </div>;
}
