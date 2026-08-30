import React, { useEffect, useMemo, useState } from 'react';
import {
  getAdminApplications,
  getAdminEmailTemplates,
  getApplicantSession,
  sendAdminApplicationEmail,
  signOutApplicant,
  updateAdminEmailTemplate,
  whoAmI
} from './api';

const VARIABLE_HELP = '{{first_name}}, {{last_name}}, {{business_name}}, {{phone}}, {{last_three_ein}}, {{account_url}}. PBS email also supports {{pbs_username}}, {{pbs_password}}, {{challenge_question}}, {{challenge_answer}}.';

export default function EmailSettingsPage() {
  const [ready, setReady] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [applications, setApplications] = useState([]);
  const [applicationId, setApplicationId] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const session = await getApplicantSession();
        if (!session) return;
        const me = await whoAmI();
        if (me.role !== 'admin') return;
        const [templateRows, applicationRows] = await Promise.all([
          getAdminEmailTemplates(),
          getAdminApplications()
        ]);
        if (!active) return;
        setAuthorized(true);
        setTemplates(templateRows || []);
        setApplications(applicationRows || []);
        setApplicationId(applicationRows?.[0]?.id || '');
        setDrafts(Object.fromEntries((templateRows || []).map((row) => [row.template_key, {
          subject: row.subject,
          body: row.body,
          enabled: row.enabled
        }])));
      } catch (err) {
        if (active) setMessage(err.message);
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => { active = false; };
  }, []);

  const selectedApplication = useMemo(
    () => applications.find((row) => row.id === applicationId) || null,
    [applications, applicationId]
  );

  function patchDraft(key, patch) {
    setDrafts((old) => ({ ...old, [key]: { ...old[key], ...patch } }));
  }

  async function saveTemplate(key) {
    setBusyKey(`save:${key}`); setMessage('');
    try {
      const saved = await updateAdminEmailTemplate(key, drafts[key]);
      setTemplates((old) => old.map((row) => row.template_key === key ? saved : row));
      setDrafts((old) => ({ ...old, [key]: { subject: saved.subject, body: saved.body, enabled: saved.enabled } }));
      setMessage(`${saved.display_name} saved.`);
    } catch (err) { setMessage(err.message); }
    finally { setBusyKey(''); }
  }

  async function sendNow(key) {
    if (!applicationId) return setMessage('Choose an applicant first.');
    const business = selectedApplication?.business_name_input || 'this applicant';
    if (!window.confirm(`Send “${templates.find((row) => row.template_key === key)?.display_name || key}” to ${business}?`)) return;
    setBusyKey(`send:${key}`); setMessage('');
    try {
      const result = await sendAdminApplicationEmail(applicationId, key);
      if (result?.skipped && result?.reason === 'resend_not_configured') {
        setMessage('Resend is not configured on the backend yet. Add RESEND_API_KEY in Render first.');
      } else {
        setMessage(`Email sent to ${selectedApplication?.contact_email || 'the applicant'}.`);
      }
    } catch (err) { setMessage(err.message); }
    finally { setBusyKey(''); }
  }

  async function signOut() {
    await signOutApplicant();
    window.location.href = '/admin';
  }

  if (!ready) return <div className="app-shell auth-loading-shell admin-loading"><div className="auth-loading-card">Loading email settings…</div></div>;
  if (!authorized) return <div className="app-shell admin-login-shell"><main className="admin-login-wrap"><div className="wizard-card admin-login-card"><div className="content-block"><h3>Admin sign-in required</h3><p>Sign in through the UEZ admin portal first.</p><a className="primary inline-button" href="/admin">Go to admin login</a>{message && <div className="validation-error">{message}</div>}</div></div></main></div>;

  return <div className="admin-shell email-settings-shell">
    <header className="admin-topbar">
      <div className="admin-brand"><div className="brand-mark">COR</div><div><strong>COR UEZ</strong><span>Email Settings</span></div></div>
      <div className="admin-top-actions"><a href="/admin">← Admin dashboard</a><button onClick={signOut}>Log out</button></div>
    </header>
    <main className="email-settings-wrap">
      <section className="email-settings-intro">
        <div><span className="eyebrow">EMAIL CONTROL CENTER</span><h1>Applicant emails</h1><p>Edit the messages COR sends automatically. Turning a template off stops automatic sends but still lets you send it manually.</p></div>
        <div className="manual-recipient-card"><label>Manual-send applicant</label><select value={applicationId} onChange={(e) => setApplicationId(e.target.value)}><option value="">Choose applicant</option>{applications.map((app) => <option key={app.id} value={app.id}>{app.business_name_input || app.contact_email} — {app.contact_email}</option>)}</select></div>
      </section>
      {message && <div className="admin-message">{message}</div>}
      <div className="email-template-list">
        {templates.map((template) => {
          const draft = drafts[template.template_key] || template;
          return <section className="email-template-card" key={template.template_key}>
            <div className="email-template-head">
              <div><h2>{template.display_name}</h2><p>{template.description}</p></div>
              <label className="email-enabled-toggle"><input type="checkbox" checked={Boolean(draft.enabled)} onChange={(e) => patchDraft(template.template_key, { enabled: e.target.checked })} /><span>{draft.enabled ? 'Automatic ON' : 'Automatic OFF'}</span></label>
            </div>
            <label>Subject<input value={draft.subject || ''} onChange={(e) => patchDraft(template.template_key, { subject: e.target.value })} /></label>
            <label>Body<textarea rows="12" value={draft.body || ''} onChange={(e) => patchDraft(template.template_key, { body: e.target.value })} /></label>
            <p className="email-variable-help">Available variables: {VARIABLE_HELP}</p>
            <div className="email-template-actions">
              <button className="primary compact" onClick={() => saveTemplate(template.template_key)} disabled={Boolean(busyKey)}>{busyKey === `save:${template.template_key}` ? 'Saving…' : 'Save changes'}</button>
              <button className="secondary compact" onClick={() => sendNow(template.template_key)} disabled={Boolean(busyKey) || !applicationId}>{busyKey === `send:${template.template_key}` ? 'Sending…' : 'Send to selected applicant now'}</button>
            </div>
          </section>;
        })}
      </div>
    </main>
  </div>;
}
