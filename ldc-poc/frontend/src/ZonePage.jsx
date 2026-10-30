import React, { useCallback, useEffect, useMemo, useState } from 'react';
import supabase from './supabaseClient';
import { zoneApi } from './zoneApi';
import './zone.css';

const TYPE_LABEL = { AR: 'Annual report', RCRT: 'Recertification' };
const BUCKET_LABEL = { late: 'Overdue', due_30: 'Due ≤30 days', due_60: 'Due 31–60', due_90: 'Due 61–90', ok: 'Up to date', inactive: 'Inactive' };
const OUTCOMES = [
  ['reached', 'Reached them'], ['left_message', 'Left voicemail'], ['no_answer', 'No answer'],
  ['helped_file', 'Helped them file'], ['already_filed', 'Says already filed'], ['wrong_contact', 'Wrong contact info'], ['other', 'Other']
];
const OUTCOME_LABEL = Object.fromEntries([...OUTCOMES, ['reminder_sent', 'Reminder emailed'], ['reminder_test', 'Reminder tested']]);
const EVENT_LABEL = { new_business: 'New to zone', annual_filed: 'Annual report filed', recertified: 'Recertified', inactivated: 'Inactivated', reactivated: 'Reactivated' };

function fmtDate(d) { if (!d) return '—'; const [y, m, day] = String(d).slice(0, 10).split('-'); return `${m}/${day}/${y}`; }
function fmtWhen(ts) { if (!ts) return '—'; return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function daysText(d) { if (d == null) return ''; if (d < 0) return `${Math.abs(d).toLocaleString()}d late`; if (d === 0) return 'today'; return `in ${d}d`; }
function title(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s\-/&(.,#])([a-z])/g, (_, p, c) => p + c.toUpperCase()).replace(/\bLlc\b/g, 'LLC').replace(/\bInc\b/g, 'Inc');
}
const Icon = ({ d, fill }) => <svg viewBox="0 0 24 24" fill={fill || 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">{d}</svg>;
const ICONS = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />,
  biz: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></>,
  state: <><path d="M4 19V5M4 19h16M8 15l4-5 3 3 4-6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1 2 2 0 0 1-4 0 1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15a2 2 0 0 1 0-4 1.6 1.6 0 0 0-1.1-2.7 2 2 0 0 1 2.8-2.8 1.6 1.6 0 0 0 2.7-1.1 2 2 0 0 1 4 0A1.6 1.6 0 0 0 18.4 5.4a2 2 0 0 1 2.8 2.8A1.6 1.6 0 0 0 20.4 11a2 2 0 0 1 0 4Z" /></>,
  admin: <><path d="M12 3l8 4v5c0 4.4-3.1 7.9-8 9-4.9-1.1-8-4.6-8-9V7z" /></>
};

// ---------------- Sign in ----------------
function SignIn() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  async function submit(e) { e.preventDefault(); setBusy(true); setMsg(''); const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (error) setMsg(error.message); setBusy(false); }
  async function reset() { if (!email.trim()) return setMsg('Enter your email first.'); const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/` }); setMsg(error ? error.message : 'Check your email for a link to set your password.'); }
  return (
    <div className="z-center">
      <form className="z-card z-signin" onSubmit={submit}>
        <div className="brand-mark lg">EZ</div>
        <h1>EZMinder</h1>
        <p className="z-muted">Sign in to keep your zone's businesses enrolled.</p>
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <button className="btn z-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="z-link" onClick={reset}>Forgot or set your password</button>
        {msg && <div className="hint">{msg}</div>}
      </form>
    </div>
  );
}

// ---------------- Portal login setup ----------------
function PortalSetup({ org, status, onSaved, embedded }) {
  const [f, setF] = useState({ mynjUsername: '', mynjPassword: '', username: status?.login?.portal_user || '', password: '' });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const canEdit = org.role === 'admin';
  async function submit(e) {
    e.preventDefault(); setBusy(true); setMsg('');
    try { const r = await zoneApi.savePortalLogin(org.id, f); setMsg(`Connected: ${r.zoneName} (as ${r.portalUser}). Pulling your businesses now…`); setF({ ...f, password: '', mynjPassword: '' }); onSaved(); }
    catch (err) { setMsg(err.message); }
    setBusy(false);
  }
  const failed = status?.login?.status === 'failed';
  return (
    <div className={embedded ? '' : 'z-card z-setup'}>
      <h2 style={{ marginTop: 0 }}>{failed ? 'Reconnect your UEZ portal login' : 'Connect your UEZ portal login'}</h2>
      {failed && status.login.last_error && <div className="z-alert bad">{status.login.last_error}</div>}
      <p className="z-muted">Your two state logins — myNJ first, then the UEZ application. Stored encrypted, never shown again, used only to pull your zone's data.</p>
      {canEdit ? (
        <form onSubmit={submit}>
          <div className="field-grid">
            <div><label>myNJ login ID</label><input value={f.mynjUsername} onChange={(e) => setF({ ...f, mynjUsername: e.target.value })} autoComplete="off" /></div>
            <div><label>myNJ password</label><input type="password" value={f.mynjPassword} onChange={(e) => setF({ ...f, mynjPassword: e.target.value })} autoComplete="new-password" /></div>
          </div>
          <div className="field-grid">
            <div><label>UEZ username</label><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" /></div>
            <div><label>UEZ password</label><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></div>
          </div>
          <button className="btn" disabled={busy || !f.username || !f.password || !f.mynjUsername || !f.mynjPassword}>{busy ? 'Logging in…' : 'Test & connect'}</button>
        </form>
      ) : <div className="hint">Ask your organization's admin to connect the portal login.</div>}
      {msg && <div className="hint">{msg}</div>}
    </div>
  );
}

// ---------------- Business drawer ----------------
function BusinessDrawer({ org, fileNo, onClose, onChanged }) {
  const [data, setData] = useState(null); const [err, setErr] = useState('');
  const [form, setForm] = useState({ channel: 'call', outcome: 'reached', note: '', follow_up_on: '' });
  const [saving, setSaving] = useState(false); const [sending, setSending] = useState(false);
  const load = useCallback(() => { zoneApi.business(org.id, fileNo).then(setData).catch((e) => setErr(e.message)); }, [org.id, fileNo]);
  useEffect(() => { setData(null); setErr(''); load(); }, [load]);

  async function save(e) {
    e.preventDefault(); setSaving(true);
    try { await zoneApi.addOutreach(org.id, fileNo, { ...form, follow_up_on: form.follow_up_on || null }); setForm({ channel: 'call', outcome: 'reached', note: '', follow_up_on: '' }); load(); onChanged?.(); }
    catch (e2) { setErr(e2.message); }
    setSaving(false);
  }
  async function sendReminder() {
    setSending(true); setErr('');
    try { const r = await zoneApi.sendReminder(org.id, fileNo); setErr(r.status === 'sent' ? `✓ Reminder emailed to ${r.to}` : `✓ Test sent to ${r.to} (live sending is off)`); load(); onChanged?.(); }
    catch (e2) { setErr(e2.message); }
    setSending(false);
  }

  const b = data?.business;
  const jobs = (b?.employment || []).filter((r) => r.program_year && r.program_year !== 'OS');
  const recertCount = (b?.employment || []).filter((r) => r.app_status === 'A').length;
  return (
    <div className="z-drawer-backdrop" onClick={onClose}>
      <aside className="z-drawer" onClick={(e) => e.stopPropagation()}>
        <button className="z-close" onClick={onClose} aria-label="Close">×</button>
        {err && <div className="z-alert info">{err}</div>}
        {!b ? <div className="z-muted">Loading…</div> : (
          <>
            <div className="z-drawer-head">
              <span className={`z-pill ${b.bucket}`}>{BUCKET_LABEL[b.bucket]}</span>
              <h2>{title(b.trade_name || b.name)}</h2>
              {b.trade_name && b.name && b.trade_name !== b.name && <div className="z-muted">{title(b.name)}</div>}
              <div className="z-muted small">File #{b.file_no} · {title(b.zone_name)}</div>
            </div>

            {b.status !== 'I' && (
              <div className="z-deadline">
                <div>
                  <div className="z-label">Next deadline</div>
                  <div className="z-big">{TYPE_LABEL[b.deadline_type] || '—'}</div>
                  <div>{fmtDate(b.deadline)} <span className={`z-days ${b.bucket}`}>{daysText(b.days)}</span></div>
                  {b.deadline_source === 'estimate' && <div className="z-muted small">Estimated from cert date — detail not synced yet.</div>}
                </div>
                <div className="z-deadline-side">
                  <div><span className="z-label">Certified</span> {fmtDate(b.cert_date)}</div>
                  <div><span className="z-label">Last annual</span> {fmtDate(b.last_annual_date)}</div>
                  <div><span className="z-label">Last recert</span> {fmtDate(b.last_recert_date)}</div>
                  {b.next_recert_due && <div><span className="z-label">Next recert</span> {fmtDate(b.next_recert_due)}</div>}
                </div>
              </div>
            )}

            {recertCount >= 2 && <div className="z-loyal">✓ On the record {recertCount} years — a reliable filer. Remind them it only takes a few minutes.</div>}

            <section>
              <h3>Contact</h3>
              <div className="z-kv">
                <span>Name</span><strong>{title(b.contact_name) || '—'}</strong>
                <span>Phone</span><strong>{b.contact_phone ? <a href={`tel:${b.contact_phone.replace(/[^\d]/g, '').slice(0, 10)}`}>{b.contact_phone}</a> : '—'}</strong>
                <span>Email</span><strong>{b.contact_email ? <a href={`mailto:${b.contact_email}`}>{b.contact_email}</a> : '—'}</strong>
                <span>Address</span><strong>{b.street ? `${title(b.street)}, ${title(b.city)} ${b.zip || ''}` : '—'}</strong>
                <span>Industry</span><strong>{title(b.naics_desc || b.sic_desc) || b.naics_code || '—'}</strong>
              </div>
              {b.can_contact && b.status !== 'I' && b.contact_email && (
                <button className="btn ghost z-btn" onClick={sendReminder} disabled={sending}>{sending ? 'Sending…' : '✉ Send reminder now'}</button>
              )}
            </section>

            {jobs.length > 0 && (
              <section>
                <h3>Jobs reported</h3>
                <table className="z-mini">
                  <thead><tr><th>Year</th><th>FT proj</th><th>FT actual</th><th>New hires</th></tr></thead>
                  <tbody>{jobs.map((r, i) => <tr key={i}><td>{r.program_year}</td><td>{r.ft_projected ?? '—'}</td><td>{r.ft_actual ?? '—'}</td><td>{r.new_hires ?? '—'}</td></tr>)}</tbody>
                </table>
              </section>
            )}

            {b.can_contact ? (
              <section>
                <h3>Log outreach</h3>
                <form className="z-outreach-form" onSubmit={save}>
                  <div className="z-row">
                    <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                      <option value="call">📞 Call</option><option value="email">✉️ Email</option><option value="text">💬 Text</option><option value="visit">🚶 Visit</option><option value="note">📝 Note</option>
                    </select>
                    <select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>{OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  </div>
                  <textarea placeholder="What happened? (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                  <div className="z-row">
                    <label className="z-inline">Follow up <input type="date" value={form.follow_up_on} onChange={(e) => setForm({ ...form, follow_up_on: e.target.value })} /></label>
                    <button className="btn compact" disabled={saving}>{saving ? 'Saving…' : 'Log it'}</button>
                  </div>
                </form>
                <ul className="z-timeline">
                  {data.outreach.map((o) => (
                    <li key={o.id}><div><strong>{title(o.channel)}</strong> · {OUTCOME_LABEL[o.outcome] || o.outcome || ''} <span className="z-muted">· {fmtWhen(o.created_at)} · {o.user_email}</span></div>{o.note && <div>{o.note}</div>}{o.follow_up_on && <div className="z-muted">Follow up {fmtDate(o.follow_up_on)}</div>}</li>
                  ))}
                  {!data.outreach.length && <li className="z-muted">No outreach logged yet.</li>}
                </ul>
              </section>
            ) : <div className="hint">This business is in {title(b.zone_name)}. Outreach is handled by that zone.</div>}

            {(data.events.length > 0 || (b.state_notes || []).length > 0) && (
              <section>
                <h3>History</h3>
                <ul className="z-timeline">
                  {data.events.map((e) => <li key={`e${e.id}`}><strong>{EVENT_LABEL[e.kind] || e.kind}</strong> <span className="z-muted">· {fmtWhen(e.detected_at)}</span></li>)}
                  {(b.state_notes || []).map((n, i) => <li key={`n${i}`}><span className="z-muted">State note · {fmtDate(n.date)} · {n.by}</span><div>{n.text}</div></li>)}
                </ul>
              </section>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

// ---------------- Home (Concept A) ----------------
function Home({ org, refreshKey, onOpen, onGoBusinesses }) {
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { setD(null); zoneApi.home(org.id).then(setD).catch((e) => setErr(e.message)); }, [org.id, refreshKey]);
  if (err) return <div className="z-alert bad">{err}</div>;
  if (!d) return <div className="z-card z-muted" style={{ padding: 20 }}>Loading…</div>;
  const c = d.counts || {};
  return (
    <>
      <div className="z-stats">
        <button className="z-stat red" onClick={() => onGoBusinesses('late')}>
          <div className="k"><span className="pip red" />Overdue</div><div className="v">{c.late || 0}</div><div className="m">Reminders done — need a call</div>
        </button>
        <button className="z-stat amber" onClick={() => onGoBusinesses('due_30')}>
          <div className="k"><span className="pip amber" />Due in 30 days</div><div className="v">{c.due_30 || 0}</div><div className="m">Reminders sending automatically</div>
        </button>
        <div className="z-stat green">
          <div className="k"><span className="pip green" />Recertified this month</div><div className="v">{d.recertified_this_month || 0}</div><div className="m">Thank-you emails sent</div>
        </div>
        <button className="z-stat" onClick={() => onGoBusinesses('all')}>
          <div className="k"><span className="pip blue" />Active businesses</div><div className="v">{(d.active_count || 0).toLocaleString()}</div><div className="m">{d.new_this_month ? `+${d.new_this_month} new this month` : 'In your zone'}</div>
        </button>
      </div>

      <div className="z-grid">
        <section className="z-panel">
          <div className="z-panel-h"><h2>Needs your call</h2><span className="z-count">{d.needs_call.length} overdue</span></div>
          {d.needs_call.length === 0 && <div className="z-empty">🎉 Nobody's overdue. EZMinder is emailing the {c.due_30 || 0} due soon — nothing for you to chase today.</div>}
          {d.needs_call.slice(0, 40).map((b) => (
            <div className="z-crow" key={b.file_no} onClick={() => onOpen(b.file_no)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(b.file_no)}>
              <span className="z-type RCRT">{b.deadline_type === 'RCRT' ? 'Recert' : 'Annual'}</span>
              <div className="z-cbiz">
                <div className="n">{title(b.name)}</div>
                <div className="d">{title(b.contact_name) || '—'}{b.contact_phone ? ` · ${b.contact_phone}` : ''}{b.last_outreach ? ` · last: ${OUTCOME_LABEL[b.last_outreach.outcome] || b.last_outreach.channel}` : ''}</div>
              </div>
              <span className="z-late">{daysText(b.days)}</span>
              <button className="btn compact" onClick={(e) => { e.stopPropagation(); onOpen(b.file_no); }}>Log call</button>
            </div>
          ))}
        </section>

        <aside className="z-rail">
          <div className="z-win">
            <div className="big">{d.recertified_this_month || 0}</div>
            <div className="lbl">recertified this month 🎉</div>
            {d.recert_names.length > 0 && (
              <div className="win-list">
                {d.recert_names.slice(0, 4).map((n, i) => <div className="win-item" key={i}><span className="check">✓</span>{title(n)}</div>)}
                {d.recertified_this_month > 4 && <div className="z-muted small" style={{ color: '#2B6B48', fontWeight: 600 }}>+{d.recertified_this_month - 4} more</div>}
              </div>
            )}
            {d.recertified_this_month === 0 && <div className="win-none">No recerts yet this month — the first one will show up here.</div>}
          </div>
          <div className="z-panel">
            <div className="z-panel-h"><h2>Recent changes</h2></div>
            <div style={{ padding: '4px 18px 12px' }}>
              {(d.recent_activity || []).slice(0, 7).map((e, i) => (
                <div className="z-mini-act" key={i} onClick={() => onOpen(e.file_no)}>
                  <span className={`pip ${e.kind === 'recertified' || e.kind === 'annual_filed' ? 'green' : e.kind === 'inactivated' ? 'red' : 'blue'}`} />
                  <div><strong>{EVENT_LABEL[e.kind] || e.kind}</strong> · {title(e.uez_zone_businesses?.trade_name || e.uez_zone_businesses?.name)}<div className="z-muted small">{fmtWhen(e.detected_at)}</div></div>
                </div>
              ))}
              {!(d.recent_activity || []).length && <div className="z-muted small">No changes yet.</div>}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

// ---------------- Business list ----------------
function BusinessList({ org, zone, initialBucket, refreshKey, onOpen }) {
  const [data, setData] = useState(null); const [err, setErr] = useState('');
  const [bucket, setBucket] = useState(initialBucket || 'action');
  const [type, setType] = useState('all'); const [q, setQ] = useState(''); const [sort, setSort] = useState('deadline');
  useEffect(() => { setBucket(initialBucket || 'action'); }, [initialBucket, zone]);
  useEffect(() => { setData(null); setErr(''); zoneApi.businesses(org.id, zone).then(setData).catch((e) => setErr(e.message)); }, [org.id, zone, refreshKey]);

  const all = data?.businesses || [];
  const active = all.filter((b) => b.status !== 'I');
  const today = new Date().toISOString().slice(0, 10);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let r = all.filter((b) => {
      if (bucket === 'action' && !['late', 'due_30', 'due_60'].includes(b.bucket)) return false;
      if (bucket === 'followup' && !(b.last_outreach?.follow_up_on && b.last_outreach.follow_up_on <= today)) return false;
      if (!['action', 'all', 'followup'].includes(bucket) && b.bucket !== bucket) return false;
      if (bucket === 'all' && b.bucket === 'inactive') return false;
      if (type !== 'all' && b.deadline_type !== type) return false;
      if (needle && !`${b.name} ${b.trade_name} ${b.file_no} ${b.contact_name} ${b.contact_email}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const key = { deadline: (b) => (b.days ?? 99999), name: (b) => (b.trade_name || b.name || '').toLowerCase(), touched: (b) => b.last_outreach?.created_at || '' }[sort];
    r = [...r].sort((a, b2) => (key(a) < key(b2) ? -1 : key(a) > key(b2) ? 1 : 0));
    if (sort === 'touched') r.reverse();
    return r;
  }, [all, bucket, type, q, sort, today]);

  if (err) return <div className="z-alert bad">{err}</div>;
  if (!data) return <div className="z-card z-muted" style={{ padding: 20 }}>Loading businesses…</div>;
  if (!all.length) return <div className="z-card z-muted" style={{ padding: 20 }}>No businesses synced for {title(zone || 'this zone')} yet.</div>;
  const ownZone = data.own_zone;

  return (
    <>
      {!data.has_full_roster && <div className="hint">This zone isn't connected, so only businesses on the statewide due/late reports show.</div>}
      <div className="z-toolbar">
        <div className="z-seg">{[['action', 'Needs action'], ['all', 'All active'], ['inactive', 'Inactive']].map(([k, l]) => <button key={k} className={bucket === k ? 'on' : ''} onClick={() => setBucket(k)}>{l}</button>)}</div>
        <div className="z-seg">{[['all', 'All types'], ['AR', 'Annual'], ['RCRT', 'Recert']].map(([k, l]) => <button key={k} className={type === k ? 'on' : ''} onClick={() => setType(k)}>{l}</button>)}</div>
        <input className="z-search" placeholder="Search name, file #, contact…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="z-sort" value={sort} onChange={(e) => setSort(e.target.value)}><option value="deadline">Sort: deadline</option><option value="name">Sort: name</option>{ownZone && <option value="touched">Sort: last contacted</option>}</select>
      </div>
      <div className="z-card z-table-wrap">
        <table className="z-table">
          <thead><tr><th>Business</th><th>Type</th><th>Deadline</th><th className="z-hide-sm">Contact</th>{ownZone && <th className="z-hide-sm">Last outreach</th>}</tr></thead>
          <tbody>
            {rows.slice(0, 500).map((b) => (
              <tr key={b.file_no} onClick={() => onOpen(b.file_no)}>
                <td><strong>{title(b.trade_name || b.name)}</strong><div className="z-muted small">#{b.file_no}</div></td>
                <td>{b.bucket === 'inactive' ? <span className="z-pill inactive">Inactive</span> : <span className={`z-type ${b.deadline_type}`}>{b.deadline_type === 'RCRT' ? 'Recert' : 'Annual'}</span>}</td>
                <td>{b.deadline ? <>{fmtDate(b.deadline)} <span className={`z-days ${b.bucket}`}>{daysText(b.days)}</span></> : '—'}</td>
                <td className="z-hide-sm">{title(b.contact_name) || '—'}<div className="z-muted small">{b.contact_phone || b.contact_email || ''}</div></td>
                {ownZone && <td className="z-hide-sm">{b.last_outreach ? <>{OUTCOME_LABEL[b.last_outreach.outcome] || b.last_outreach.channel}<div className="z-muted small">{fmtWhen(b.last_outreach.created_at)}</div></> : <span className="z-muted">—</span>}</td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="z-muted" style={{ padding: 16 }}>Nothing here.</td></tr>}
          </tbody>
        </table>
        {rows.length > 500 && <div className="z-muted small z-pad">Showing first 500 of {rows.length}. Search to narrow.</div>}
      </div>
    </>
  );
}

// ---------------- Statewide ----------------
function Statewide({ org, onPickZone }) {
  const [data, setData] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { zoneApi.statewide(org.id).then(setData).catch((e) => setErr(e.message)); }, [org.id]);
  if (err) return <div className="z-alert bad">{err}</div>;
  if (!data) return <div className="z-card z-muted" style={{ padding: 20 }}>Loading…</div>;
  const max = Math.max(1, ...data.zones.map((z) => z.due_60 + z.late));
  return (
    <div className="z-card z-table-wrap">
      <div className="z-pad"><h2 className="z-h2">All zones</h2><div className="z-muted small">From the statewide Companies Due &amp; Late reports{data.as_of ? `, as of ${fmtWhen(data.as_of)}` : ''}. Click a zone to view it.</div></div>
      <table className="z-table">
        <thead><tr><th>Zone</th><th>Due next 60d</th><th>Annual / Recert</th><th>Late</th><th className="z-hide-sm">Jobs (due)</th><th className="z-hide-sm">Outreach 30d</th></tr></thead>
        <tbody>
          {data.zones.map((z) => (
            <tr key={z.zone} className={z.zone === org.zone_name ? 'z-mine' : ''} onClick={() => onPickZone(z.zone)}>
              <td><strong>{title(z.zone)}</strong>{z.zone === org.zone_name && <span className="z-pill ok">You</span>}</td>
              <td><div className="z-bar"><i style={{ width: `${(z.due_60 / max) * 100}%` }} /><b style={{ width: `${(z.late / max) * 100}%` }} /></div><span>{z.due_60}</span></td>
              <td>{z.due_ar} / {z.due_rcrt}</td>
              <td className={z.late ? 'z-bad-text' : ''}>{z.late}</td>
              <td className="z-hide-sm">{z.due_jobs}</td>
              <td className="z-hide-sm">{z.outreach_30d || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- Settings ----------------
function Settings({ org, status, onReconnect, me }) {
  const [s, setS] = useState(null); const [prof, setProf] = useState(null);
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false); const [testTo, setTestTo] = useState('');
  const canEdit = org.role === 'admin';
  useEffect(() => { zoneApi.settings(org.id).then((r) => setS(r)).catch((e) => setMsg(e.message)); }, [org.id]);
  useEffect(() => { zoneApi.myProfile().then((r) => { const m = r.memberships.find((x) => x.org_id === org.id) || r.memberships[0] || {}; setProf({ first_name: m.first_name || '', last_name: m.last_name || '', phone: m.phone || '' }); setTestTo(r.email || ''); }).catch(() => {}); }, [org.id]);

  async function saveSettings(patch) { setBusy(true); setMsg(''); try { const r = await zoneApi.saveSettings(org.id, patch); setS((cur) => ({ ...cur, settings: r.settings })); setMsg('Saved.'); } catch (e) { setMsg(e.message); } setBusy(false); }
  async function saveProfile() { setBusy(true); setMsg(''); try { await zoneApi.saveProfile(prof); setMsg('Profile saved.'); } catch (e) { setMsg(e.message); } setBusy(false); }
  async function sendTest() { setBusy(true); setMsg(''); try { const r = await zoneApi.testEmail(org.id, testTo); setMsg(`Test sent to ${r.to}.`); } catch (e) { setMsg(e.message); } setBusy(false); }

  if (!s) return <div className="z-card z-muted" style={{ padding: 20 }}>Loading settings…</div>;
  const v = s.settings;
  const set = (k) => (e) => setS((cur) => ({ ...cur, settings: { ...cur.settings, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } }));

  return (
    <div className="z-settings">
      {msg && <div className="z-alert info">{msg}</div>}

      <div className="z-card z-pad">
        <h2 className="z-h2">Your profile</h2>
        <p className="z-muted small">Used to sign your personal emails, like the thank-you note.</p>
        {prof && <>
          <div className="field-grid">
            <div><label>First name</label><input value={prof.first_name} onChange={(e) => setProf({ ...prof, first_name: e.target.value })} /></div>
            <div><label>Last name</label><input value={prof.last_name} onChange={(e) => setProf({ ...prof, last_name: e.target.value })} /></div>
          </div>
          <div className="field-grid">
            <div><label>Phone</label><input value={prof.phone} onChange={(e) => setProf({ ...prof, phone: e.target.value })} /></div>
            <div><label>Email</label><input value={testTo} disabled /></div>
          </div>
          <button className="btn" onClick={saveProfile} disabled={busy}>Save profile</button>
        </>}
      </div>

      <div className="z-card z-pad">
        <h2 className="z-h2">Email identity</h2>
        <p className="z-muted small">Businesses see your zone's name; replies go to your inbox. Sends from a verified COR Solutions address.</p>
        <div className="field-grid">
          <div><label>From name (what businesses see)</label><input value={v.from_name || ''} onChange={set('from_name')} disabled={!canEdit} placeholder="Lakewood UEZ" /></div>
          <div><label>Reply-to email</label><input value={v.reply_to || ''} onChange={set('reply_to')} disabled={!canEdit} placeholder="uez@lakewoodnj.gov" /></div>
        </div>
        <label>Email signature</label>
        <textarea value={v.signature || ''} onChange={set('signature')} disabled={!canEdit} placeholder="Moshe&#10;Lakewood UEZ Office" />
        <div className="field-grid">
          <div><label>Recert how-to video URL</label><input value={v.recert_video_url || ''} onChange={set('recert_video_url')} disabled={!canEdit} placeholder="https://…" /></div>
          <div><label>PBS login URL (in emails)</label><input value={v.pbs_login_url || ''} onChange={set('pbs_login_url')} disabled={!canEdit} /></div>
        </div>
        {canEdit && <button className="btn" onClick={() => saveSettings({ from_name: v.from_name, reply_to: v.reply_to, signature: v.signature, recert_video_url: v.recert_video_url, pbs_login_url: v.pbs_login_url })} disabled={busy}>Save email identity</button>}
      </div>

      <div className="z-card z-pad">
        <h2 className="z-h2">Sending</h2>
        {!s.resend_configured && <div className="z-alert bad">Email isn't configured on the server yet (RESEND_API_KEY missing).</div>}
        <label className="z-check"><input type="checkbox" checked={!!v.send_thankyou} onChange={set('send_thankyou')} disabled={!canEdit} /> Automatically send a thank-you when a business recertifies</label>
        <label className="z-check z-live"><input type="checkbox" checked={!!v.email_live} onChange={set('email_live')} disabled={!canEdit} /> <strong>Live sending</strong> — emails go to real businesses. {!v.email_live && <span className="z-muted">(Off: everything is redirected to your test address below.)</span>}</label>
        <div className="field-grid">
          <div><label>Test recipient (while not live)</label><input value={v.test_recipient || ''} onChange={set('test_recipient')} disabled={!canEdit} placeholder="you@corsolutions.io" /></div>
        </div>
        {canEdit && <button className="btn" onClick={() => saveSettings({ send_thankyou: v.send_thankyou, email_live: v.email_live, test_recipient: v.test_recipient })} disabled={busy}>Save sending</button>}
        <div className="z-divider" />
        <div className="z-row">
          <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Send a test email to…" />
          <button className="btn ghost" onClick={sendTest} disabled={busy || !testTo}>Send test</button>
        </div>
      </div>

      <div className="z-card z-pad">
        <h2 className="z-h2">State portal connection</h2>
        <PortalSetup org={org} status={status} onSaved={onReconnect} embedded />
      </div>
    </div>
  );
}

// ---------------- Platform admin ----------------
function AdminPanel({ onChanged }) {
  const [orgs, setOrgs] = useState([]); const [name, setName] = useState('');
  const [member, setMember] = useState({ orgId: '', email: '', role: 'admin' }); const [msg, setMsg] = useState('');
  const load = () => zoneApi.adminOrgs().then((d) => setOrgs(d.orgs)).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  return (
    <div className="z-card z-pad">
      <h2 className="z-h2">COR admin</h2>
      <table className="z-mini"><thead><tr><th>Organization</th><th>Zone</th><th>Members</th><th>Portal</th></tr></thead>
        <tbody>{orgs.map((o) => <tr key={o.id}><td>{o.name}</td><td>{o.zone_name || '—'}</td><td>{o.uez_zone_members?.length || 0}</td><td>{o.uez_zone_portal_logins?.status || 'not connected'}</td></tr>)}</tbody></table>
      <form className="z-row" onSubmit={async (e) => { e.preventDefault(); try { await zoneApi.adminCreateOrg(name); setName(''); load(); onChanged(); } catch (x) { setMsg(x.message); } }}>
        <input placeholder="New org (e.g. Newark UEZ)" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn ghost" disabled={!name}>Add org</button>
      </form>
      <form className="z-row" onSubmit={async (e) => { e.preventDefault(); try { const r = await zoneApi.adminAddMember(member.orgId, member.email, member.role); setMsg(r.invited ? `Invite sent to ${member.email}.` : `${member.email} added.`); setMember({ ...member, email: '' }); load(); } catch (x) { setMsg(x.message); } }}>
        <select value={member.orgId} onChange={(e) => setMember({ ...member, orgId: e.target.value })}><option value="">Choose org…</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <input type="email" placeholder="Member email" value={member.email} onChange={(e) => setMember({ ...member, email: e.target.value })} />
        <select value={member.role} onChange={(e) => setMember({ ...member, role: e.target.value })}><option value="admin">Admin</option><option value="staff">Staff</option></select>
        <button className="btn ghost" disabled={!member.orgId || !member.email}>Add member</button>
      </form>
      {msg && <div className="hint">{msg}</div>}
    </div>
  );
}

// ---------------- Shell ----------------
export default function ZonePage() {
  const [session, setSession] = useState(undefined);
  const [me, setMe] = useState(null);
  const [orgId, setOrgId] = useState(() => { try { return localStorage.getItem('uez_zone_org') || ''; } catch { return ''; } });
  const [status, setStatus] = useState(null);
  const [view, setView] = useState('home');
  const [viewZone, setViewZone] = useState(null);
  const [listBucket, setListBucket] = useState('action');
  const [open, setOpen] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  const loadMe = useCallback(() => { zoneApi.me().then((m) => { setMe(m); setOrgId((cur) => (m.orgs.find((o) => o.id === cur) ? cur : m.orgs[0]?.id || '')); }).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { if (session) loadMe(); }, [session, loadMe]);

  const org = me?.orgs.find((o) => o.id === orgId);
  const loadStatus = useCallback(() => { if (org) zoneApi.status(org.id).then(setStatus).catch((e) => setErr(e.message)); }, [org?.id]);
  useEffect(() => { setStatus(null); loadStatus(); try { if (orgId) localStorage.setItem('uez_zone_org', orgId); } catch {} }, [orgId, loadStatus]);

  useEffect(() => {
    if (!status?.syncing) return undefined;
    const t = setInterval(() => { zoneApi.status(org.id).then((s) => { setStatus(s); if (!s.syncing) { setRefreshKey((k) => k + 1); } }).catch(() => {}); }, 8000);
    return () => clearInterval(t);
  }, [status?.syncing, org?.id]);

  if (session === undefined) return null;
  if (!session) return <SignIn />;

  const lastRun = status?.runs?.[0];
  const lastOk = status?.runs?.find((r) => r.status === 'ok');
  const needsSetup = status && (!status.login || status.login.status === 'failed');
  const goBusinesses = (bucket) => { setListBucket(bucket); setViewZone(null); setView('businesses'); };

  const NAV = [['home', 'Home', ICONS.home], ['businesses', 'Businesses', ICONS.biz], ['state', 'All zones', ICONS.state], ['settings', 'Settings', ICONS.settings]];
  if (me?.isPlatformAdmin) NAV.push(['admin', 'Admin', ICONS.admin]);

  return (
    <div className="z-app">
      <aside className="z-side">
        <div className="z-brand"><div className="brand-mark">EZ</div><div><div className="z-bname">EZMinder</div><div className="z-bsub">{org?.zone_name ? title(org.zone_name) : 'UEZ'}</div></div></div>
        {NAV.map(([k, l, ic]) => <button key={k} className={`z-nav ${view === k && !viewZone ? 'on' : ''}`} onClick={() => { setView(k); setViewZone(null); }}><Icon d={ic} />{l}</button>)}
        {me?.orgs.length > 1 && <select className="z-orgpick" value={orgId} onChange={(e) => { setOrgId(e.target.value); setViewZone(null); setView('home'); }}>{me.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
        <div className="z-side-foot">
          <div className="avatar">{(me?.email || '?').slice(0, 2).toUpperCase()}</div>
          <div style={{ minWidth: 0 }}><div className="z-fname">{me?.email}</div><button className="z-link" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
        </div>
      </aside>

      <main className="z-main">
        {err && <div className="z-alert bad">{err}</div>}
        {me && !me.orgs.length && <div className="z-card z-pad">Your account isn't linked to a zone yet. Contact COR Solutions.</div>}

        {org && status && (
          <>
            <div className="z-top">
              <div>
                <h1 className="z-h1">{viewZone ? title(viewZone) : view === 'home' ? 'Good morning, Moshe' : view === 'businesses' ? 'Businesses' : view === 'state' ? 'All zones' : view === 'settings' ? 'Settings' : 'Admin'}</h1>
                {view === 'home' && !viewZone && <p className="z-sub">{status.syncing ? 'Syncing with the state portal…' : `${(status.runs?.find((r) => r.status === 'ok')?.stats?.details_remaining) ? 'Loading business details…' : "Here's your zone today."}`}</p>}
              </div>
              <div className="z-synced">
                <span className={`z-dot ${status.syncing ? 'syncing' : lastRun?.status === 'failed' ? 'failed' : 'ok'}`} />
                {status.syncing ? 'Syncing…' : lastRun?.status === 'failed' ? 'Last sync failed' : lastOk ? `Synced ${fmtWhen(lastOk.finished_at)}` : 'Not synced'}
                <button className="z-link" disabled={status.syncing} onClick={() => zoneApi.sync(org.id).then(loadStatus).catch((e) => setErr(e.message))}>Sync now</button>
              </div>
            </div>

            {needsSetup && view !== 'settings' && <PortalSetup org={org} status={status} onSaved={() => { loadStatus(); loadMe(); }} />}

            {!needsSetup && !viewZone && view === 'home' && <Home org={org} refreshKey={refreshKey} onOpen={setOpen} onGoBusinesses={goBusinesses} />}
            {!needsSetup && !viewZone && view === 'businesses' && <BusinessList org={org} zone={org.zone_name} initialBucket={listBucket} refreshKey={refreshKey} onOpen={setOpen} />}
            {!needsSetup && view === 'state' && !viewZone && <Statewide org={org} onPickZone={(z) => (z === org.zone_name ? setView('businesses') : setViewZone(z))} />}
            {viewZone && <><button className="z-link" style={{ marginBottom: 12 }} onClick={() => setViewZone(null)}>← All zones</button><BusinessList org={org} zone={viewZone} refreshKey={refreshKey} onOpen={setOpen} /></>}
            {view === 'settings' && !viewZone && <Settings org={org} status={status} me={me} onReconnect={() => { loadStatus(); loadMe(); }} />}
            {view === 'admin' && !viewZone && me.isPlatformAdmin && <AdminPanel onChanged={loadMe} />}
          </>
        )}
      </main>

      {open && org && <BusinessDrawer org={org} fileNo={open} onClose={() => setOpen(null)} onChanged={() => setRefreshKey((k) => k + 1)} />}
    </div>
  );
}
