import React, { useCallback, useEffect, useMemo, useState } from 'react';
import supabase from './supabaseClient';
import { zoneApi } from './zoneApi';
import './zone.css';

const BUCKETS = [
  { key: 'late', label: 'Late', tone: 'bad' },
  { key: 'due_30', label: 'Due ≤ 30 days', tone: 'warn' },
  { key: 'due_60', label: 'Due 31–60', tone: 'soon' },
  { key: 'due_90', label: 'Due 61–90', tone: 'calm' },
  { key: 'ok', label: 'Up to date', tone: 'good' }
];
const BUCKET_LABEL = Object.fromEntries(BUCKETS.map((b) => [b.key, b.label]));
const TYPE_LABEL = { AR: 'Annual report', RCRT: 'Recertification' };
const OUTCOMES = [
  ['reached', 'Reached them'],
  ['left_message', 'Left message'],
  ['no_answer', 'No answer'],
  ['helped_file', 'Helped them file'],
  ['already_filed', 'Says already filed'],
  ['wrong_contact', 'Wrong contact info'],
  ['other', 'Other']
];
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES);
const EVENT_LABEL = {
  new_business: 'New to zone',
  annual_filed: 'Annual report filed',
  recertified: 'Recertified',
  inactivated: 'Inactivated',
  reactivated: 'Reactivated'
};

function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${m}/${day}/${y}`;
}
function fmtWhen(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function daysText(b) {
  if (b.days === null || b.days === undefined) return '';
  if (b.days < 0) return `${Math.abs(b.days)}d late`;
  if (b.days === 0) return 'today';
  return `in ${b.days}d`;
}
function title(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s\-/&(.,#])([a-z])/g, (_, p, c) => p + c.toUpperCase()).replace(/\bLlc\b/g, 'LLC').replace(/\bInc\b/g, 'Inc');
}

function mailtoFor(b, orgName) {
  const name = title(b.trade_name || b.name);
  const what = b.deadline_type === 'RCRT' ? 'UEZ recertification' : 'UEZ annual report';
  const when = b.bucket === 'late' ? 'is past due' : `is due ${fmtDate(b.deadline)}`;
  const subject = `${name}: your ${what} ${b.bucket === 'late' ? 'is past due' : 'is coming up'}`;
  const body = [
    `Hi ${title(b.contact_name || '').split(' ')[0] || 'there'},`,
    '',
    `This is ${orgName}, your local Urban Enterprise Zone office. Our records show that the ${what} for ${name} (UEZ file #${b.file_no}) ${when}.`,
    '',
    'Staying current keeps your UEZ benefits active, including the reduced sales tax. If you would like help filling it out, reply to this email or give us a call. We are happy to walk you through it.',
    '',
    'Thank you,',
    orgName
  ].join('\n');
  return `mailto:${b.contact_email || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ---------------- Sign in ----------------
function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setMsg(error.message);
    setBusy(false);
  }
  async function reset() {
    if (!email.trim()) return setMsg('Enter your email first.');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/` });
    setMsg(error ? error.message : 'Check your email for a link to set your password.');
  }
  return (
    <div className="z-center">
      <form className="z-card z-signin" onSubmit={submit}>
        <div className="brand-mark">COR</div>
        <h1>UEZ Zone Dashboard</h1>
        <p className="z-muted">Sign in to track your zone's businesses and deadlines.</p>
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <button className="primary z-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="z-link" onClick={reset}>Forgot or need to set your password?</button>
        {msg && <div className="hint">{msg}</div>}
      </form>
    </div>
  );
}

// ---------------- Portal login setup ----------------
function PortalSetup({ org, status, onSaved }) {
  const [mynjUsername, setMynjUsername] = useState('');
  const [mynjPassword, setMynjPassword] = useState('');
  const [username, setUsername] = useState(status?.login?.portal_user || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const canEdit = org.role === 'admin';
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const r = await zoneApi.savePortalLogin(org.id, { mynjUsername, mynjPassword, username, password });
      setMsg(`Connected: ${r.zoneName} (logged in as ${r.portalUser}). Pulling your businesses now…`);
      setPassword(''); setMynjPassword('');
      onSaved();
    } catch (err) {
      setMsg(err.message);
    }
    setBusy(false);
  }
  const failed = status?.login?.status === 'failed';
  return (
    <div className="z-card z-setup">
      <h2>{failed ? 'Your UEZ portal login needs updating' : 'Connect your UEZ portal login'}</h2>
      {failed && <div className="z-alert bad">{status.login.last_error}</div>}
      <p className="z-muted">
        The same two logins you use to get into the state's UEZ system: first myNJ, then the UEZ application.
        We use them to pull your zone's business list and the state's due and late reports every night.
        They're stored encrypted and never shown again. Testing takes about 30 seconds.
      </p>
      {canEdit ? (
        <form onSubmit={submit}>
          <div className="field-grid">
            <div><label>myNJ login ID</label><input value={mynjUsername} onChange={(e) => setMynjUsername(e.target.value)} autoComplete="off" /></div>
            <div><label>myNJ password</label><input type="password" value={mynjPassword} onChange={(e) => setMynjPassword(e.target.value)} autoComplete="new-password" /></div>
          </div>
          <div className="field-grid">
            <div><label>UEZ username</label><input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" /></div>
            <div><label>UEZ password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></div>
          </div>
          <button className="primary" disabled={busy || !username || !password || !mynjUsername || !mynjPassword}>{busy ? 'Logging in to myNJ and UEZ…' : 'Test & connect'}</button>
        </form>
      ) : (
        <div className="hint">Ask your organization's admin to connect the UEZ portal login.</div>
      )}
      {msg && <div className="hint">{msg}</div>}
    </div>
  );
}

// ---------------- Business drawer ----------------
function BusinessDrawer({ org, fileNo, onClose, onLogged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ channel: 'call', outcome: 'reached', note: '', follow_up_on: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    zoneApi.business(org.id, fileNo).then(setData).catch((e) => setErr(e.message));
  }, [org.id, fileNo]);
  useEffect(() => { setData(null); load(); }, [load]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await zoneApi.addOutreach(org.id, fileNo, { ...form, follow_up_on: form.follow_up_on || null });
      setForm({ channel: 'call', outcome: 'reached', note: '', follow_up_on: '' });
      load(); onLogged();
    } catch (e2) { setErr(e2.message); }
    setSaving(false);
  }

  const b = data?.business;
  const jobs = (b?.employment || []).filter((r) => r.program_year && r.program_year !== 'OS');
  return (
    <div className="z-drawer-backdrop" onClick={onClose}>
      <aside className="z-drawer" onClick={(e) => e.stopPropagation()}>
        <button className="z-close" onClick={onClose} aria-label="Close">×</button>
        {err && <div className="z-alert bad">{err}</div>}
        {!b ? <div className="z-muted">Loading…</div> : (
          <>
            <div className="z-drawer-head">
              <span className={`z-pill ${b.bucket}`}>{BUCKET_LABEL[b.bucket] || 'Inactive'}</span>
              <h2>{title(b.trade_name || b.name)}</h2>
              {b.trade_name && b.name && b.trade_name !== b.name && <div className="z-muted">{title(b.name)}</div>}
              <div className="z-muted">File #{b.file_no} · {b.zone_name}</div>
            </div>

            {b.status !== 'I' && (
              <div className="z-deadline">
                <div>
                  <div className="z-label">Next deadline</div>
                  <div className="z-big">{TYPE_LABEL[b.deadline_type] || '—'}</div>
                  <div>{fmtDate(b.deadline)} <span className={`z-days ${b.bucket}`}>{daysText(b)}</span></div>
                  {b.deadline_source === 'estimate' && <div className="z-muted small">Estimated from certification date. Details not synced yet.</div>}
                </div>
                <div className="z-deadline-side">
                  <div><span className="z-label">Certified</span> {fmtDate(b.cert_date)}</div>
                  <div><span className="z-label">Last annual</span> {fmtDate(b.last_annual_date)}</div>
                  <div><span className="z-label">Last recert</span> {fmtDate(b.last_recert_date)}</div>
                  {b.next_recert_due && <div><span className="z-label">Next recert</span> {fmtDate(b.next_recert_due)}</div>}
                </div>
              </div>
            )}

            <section>
              <h3>Contact</h3>
              <div className="z-kv">
                <span>Name</span><strong>{title(b.contact_name) || '—'}</strong>
                <span>Phone</span><strong>{b.contact_phone ? <a href={`tel:${b.contact_phone.replace(/[^\d]/g, '').slice(0, 10)}`}>{b.contact_phone}</a> : '—'}</strong>
                <span>Email</span><strong>{b.contact_email ? <a href={`mailto:${b.contact_email}`}>{b.contact_email}</a> : '—'}</strong>
                <span>Address</span><strong>{b.street ? `${title(b.street)}, ${title(b.city)} ${b.zip || ''}` : '—'}</strong>
                <span>Industry</span><strong>{title(b.naics_desc || b.sic_desc) || b.naics_code || '—'}</strong>
              </div>
              {b.can_contact && b.contact_email && b.status !== 'I' && (
                <a className="secondary z-btn" href={mailtoFor(b, org.name)}>✉️ Email a reminder</a>
              )}
            </section>

            {jobs.length > 0 && (
              <section>
                <h3>Jobs reported</h3>
                <table className="z-mini">
                  <thead><tr><th>Year</th><th>FT projected</th><th>FT actual</th><th>New hires</th></tr></thead>
                  <tbody>{jobs.map((r, i) => <tr key={i}><td>{r.program_year}</td><td>{r.ft_projected ?? '—'}</td><td>{r.ft_actual ?? '—'}</td><td>{r.new_hires ?? '—'}</td></tr>)}</tbody>
                </table>
              </section>
            )}

            {b.can_contact ? (
              <section>
                <h3>Outreach</h3>
                <form className="z-outreach-form" onSubmit={save}>
                  <div className="z-row">
                    <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                      <option value="call">📞 Call</option><option value="email">✉️ Email</option><option value="text">💬 Text</option>
                      <option value="visit">🚶 Visit</option><option value="note">📝 Note</option>
                    </select>
                    <select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>
                      {OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <textarea placeholder="What happened? (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                  <div className="z-row">
                    <label className="z-inline">Follow up on <input type="date" value={form.follow_up_on} onChange={(e) => setForm({ ...form, follow_up_on: e.target.value })} /></label>
                    <button className="primary compact" disabled={saving}>{saving ? 'Saving…' : 'Log it'}</button>
                  </div>
                </form>
                <ul className="z-timeline">
                  {data.outreach.map((o) => (
                    <li key={o.id}>
                      <div><strong>{o.channel}</strong> · {OUTCOME_LABEL[o.outcome] || o.outcome || ''} <span className="z-muted">· {fmtWhen(o.created_at)} · {o.user_email}</span></div>
                      {o.note && <div>{o.note}</div>}
                      {o.follow_up_on && <div className="z-muted">Follow up {fmtDate(o.follow_up_on)}</div>}
                    </li>
                  ))}
                  {!data.outreach.length && <li className="z-muted">No outreach logged yet.</li>}
                </ul>
              </section>
            ) : (
              <div className="hint">This business is in {b.zone_name}. Outreach is handled by that zone's office.</div>
            )}

            {(data.events.length > 0 || (b.state_notes || []).length > 0) && (
              <section>
                <h3>History</h3>
                <ul className="z-timeline">
                  {data.events.map((e) => <li key={`e${e.id}`}><strong>{EVENT_LABEL[e.kind] || e.kind}</strong> <span className="z-muted">· detected {fmtWhen(e.detected_at)}</span></li>)}
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

// ---------------- Business list ----------------
function BusinessList({ org, zone, refreshKey, onOpen }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [bucket, setBucket] = useState('action');
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('deadline');

  useEffect(() => {
    setData(null); setErr('');
    zoneApi.businesses(org.id, zone).then(setData).catch((e) => setErr(e.message));
  }, [org.id, zone, refreshKey]);

  const all = data?.businesses || [];
  const active = all.filter((b) => b.status !== 'I');
  const counts = useMemo(() => {
    const c = { late: 0, due_30: 0, due_60: 0, due_90: 0, ok: 0, inactive: 0 };
    for (const b of all) c[b.bucket] = (c[b.bucket] || 0) + 1;
    return c;
  }, [all]);
  const followUps = active.filter((b) => b.last_outreach?.follow_up_on && b.last_outreach.follow_up_on <= new Date().toISOString().slice(0, 10)).length;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let r = all.filter((b) => {
      if (bucket === 'action' && !['late', 'due_30', 'due_60'].includes(b.bucket)) return false;
      if (bucket === 'followup' && !(b.last_outreach?.follow_up_on && b.last_outreach.follow_up_on <= new Date().toISOString().slice(0, 10))) return false;
      if (!['action', 'all', 'followup'].includes(bucket) && b.bucket !== bucket) return false;
      if (bucket === 'all' && b.bucket === 'inactive') return false;
      if (type !== 'all' && b.deadline_type !== type) return false;
      if (needle && !`${b.name} ${b.trade_name} ${b.file_no} ${b.contact_name} ${b.contact_email}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const key = {
      deadline: (b) => (b.days ?? 99999),
      name: (b) => (b.trade_name || b.name || '').toLowerCase(),
      touched: (b) => b.last_outreach?.created_at || ''
    }[sort];
    r = [...r].sort((a, b2) => (key(a) < key(b2) ? -1 : key(a) > key(b2) ? 1 : 0));
    if (sort === 'touched') r.reverse();
    return r;
  }, [all, bucket, type, q, sort]);

  if (err) return <div className="z-alert bad">{err}</div>;
  if (!data) return <div className="z-card z-muted">Loading businesses…</div>;
  if (!all.length) return <div className="z-card z-muted">No businesses synced for {zone || 'this zone'} yet. The first sync can take a few minutes.</div>;

  const ownZone = data.own_zone;
  return (
    <>
      <div className="z-tiles">
        <button className={`z-tile bad ${bucket === 'late' ? 'on' : ''}`} onClick={() => setBucket('late')}><span>{counts.late}</span>Late</button>
        <button className={`z-tile warn ${bucket === 'due_30' ? 'on' : ''}`} onClick={() => setBucket('due_30')}><span>{counts.due_30}</span>Due in 30 days</button>
        <button className={`z-tile soon ${bucket === 'due_60' ? 'on' : ''}`} onClick={() => setBucket('due_60')}><span>{counts.due_60}</span>Due in 31–60</button>
        {data.has_full_roster && <button className={`z-tile calm ${bucket === 'due_90' ? 'on' : ''}`} onClick={() => setBucket('due_90')}><span>{counts.due_90}</span>Due in 61–90</button>}
        {data.has_full_roster && <button className={`z-tile neutral ${bucket === 'all' ? 'on' : ''}`} onClick={() => setBucket('all')}><span>{active.length}</span>Active businesses</button>}
        {ownZone && followUps > 0 && <button className={`z-tile neutral ${bucket === 'followup' ? 'on' : ''}`} onClick={() => setBucket('followup')}><span>{followUps}</span>Follow-ups due</button>}
      </div>
      {!data.has_full_roster && <div className="hint">This zone isn't connected yet, so only businesses on the state's statewide due and late reports are shown.</div>}

      <div className="z-toolbar">
        <div className="z-seg">
          {[['action', 'Needs action'], ['all', 'All active'], ['inactive', 'Inactive']].map(([k, l]) => (
            <button key={k} className={bucket === k ? 'on' : ''} onClick={() => setBucket(k)}>{l}</button>
          ))}
        </div>
        <div className="z-seg">
          {[['all', 'All types'], ['AR', 'Annual reports'], ['RCRT', 'Recerts']].map(([k, l]) => (
            <button key={k} className={type === k ? 'on' : ''} onClick={() => setType(k)}>{l}</button>
          ))}
        </div>
        <input className="z-search" placeholder="Search name, file #, contact…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="z-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="deadline">Sort: deadline</option><option value="name">Sort: name</option>{ownZone && <option value="touched">Sort: last contacted</option>}
        </select>
      </div>

      <div className="z-card z-table-wrap">
        <table className="z-table">
          <thead><tr><th>Business</th><th>Type</th><th>Deadline</th><th className="z-hide-sm">Contact</th>{ownZone && <th className="z-hide-sm">Last outreach</th>}</tr></thead>
          <tbody>
            {rows.slice(0, 500).map((b) => (
              <tr key={b.file_no} onClick={() => onOpen(b.file_no)}>
                <td><strong>{title(b.trade_name || b.name)}</strong><div className="z-muted small">#{b.file_no}</div></td>
                <td>{b.bucket === 'inactive' ? <span className="z-pill inactive">Inactive</span> : <span className={`z-type ${b.deadline_type}`}>{b.deadline_type === 'RCRT' ? 'Recert' : 'Annual'}</span>}</td>
                <td>{b.deadline ? <>{fmtDate(b.deadline)} <span className={`z-days ${b.bucket}`}>{daysText(b)}</span></> : '—'}</td>
                <td className="z-hide-sm">{title(b.contact_name) || '—'}<div className="z-muted small">{b.contact_phone || b.contact_email || ''}</div></td>
                {ownZone && <td className="z-hide-sm">{b.last_outreach ? <>{OUTCOME_LABEL[b.last_outreach.outcome] || b.last_outreach.channel}<div className="z-muted small">{fmtWhen(b.last_outreach.created_at)}</div></> : <span className="z-muted">—</span>}</td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="z-muted">Nothing here.</td></tr>}
          </tbody>
        </table>
        {rows.length > 500 && <div className="z-muted small z-pad">Showing first 500 of {rows.length}. Search to narrow it down.</div>}
      </div>
    </>
  );
}

// ---------------- Statewide ----------------
function Statewide({ org, onPickZone }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { zoneApi.statewide(org.id).then(setData).catch((e) => setErr(e.message)); }, [org.id]);
  if (err) return <div className="z-alert bad">{err}</div>;
  if (!data) return <div className="z-card z-muted">Loading…</div>;
  const max = Math.max(1, ...data.zones.map((z) => z.due_60 + z.late));
  return (
    <div className="z-card z-table-wrap">
      <div className="z-pad">
        <h2 className="z-h2">All zones</h2>
        <div className="z-muted small">From the state's Companies Due (next 60 days) and Companies Late reports{data.as_of ? `, as of ${fmtWhen(data.as_of)}` : ''}. Click a zone to see its businesses.</div>
      </div>
      <table className="z-table">
        <thead><tr><th>Zone</th><th>Due next 60 days</th><th>Annual / Recert</th><th>Late</th><th className="z-hide-sm">Jobs (due businesses)</th><th className="z-hide-sm">Local outreach, 30d</th></tr></thead>
        <tbody>
          {data.zones.map((z) => (
            <tr key={z.zone} className={z.zone === org.zone_name ? 'z-mine' : ''} onClick={() => onPickZone(z.zone)}>
              <td><strong>{title(z.zone)}</strong>{z.zone === org.zone_name && <span className="z-pill ok">You</span>}</td>
              <td>
                <div className="z-bar"><i style={{ width: `${(z.due_60 / max) * 100}%` }} /><b style={{ width: `${(z.late / max) * 100}%` }} /></div>
                <span>{z.due_60}</span>
              </td>
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

// ---------------- Activity ----------------
function Activity({ org, refreshKey, onOpen }) {
  const [events, setEvents] = useState([]);
  useEffect(() => { zoneApi.activity(org.id).then((d) => setEvents(d.events)).catch(() => {}); }, [org.id, refreshKey]);
  if (!events.length) return null;
  return (
    <div className="z-card z-activity">
      <h3>Recent changes</h3>
      <ul>
        {events.slice(0, 12).map((e) => (
          <li key={e.id} onClick={() => onOpen(e.file_no)}>
            <span className={`z-dot ${e.kind}`} />
            <div><strong>{EVENT_LABEL[e.kind] || e.kind}</strong> · {title(e.uez_zone_businesses?.name)}<div className="z-muted small">{fmtWhen(e.detected_at)}</div></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------- Platform admin ----------------
function AdminPanel({ onChanged }) {
  const [orgs, setOrgs] = useState([]);
  const [name, setName] = useState('');
  const [member, setMember] = useState({ orgId: '', email: '', role: 'admin' });
  const [msg, setMsg] = useState('');
  const load = () => zoneApi.adminOrgs().then((d) => setOrgs(d.orgs)).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  return (
    <div className="z-card z-pad">
      <h2 className="z-h2">COR admin</h2>
      <table className="z-mini">
        <thead><tr><th>Organization</th><th>Zone</th><th>Members</th><th>Portal login</th></tr></thead>
        <tbody>{orgs.map((o) => <tr key={o.id}><td>{o.name}</td><td>{o.zone_name || '—'}</td><td>{o.uez_zone_members?.length || 0}</td><td>{o.uez_zone_portal_logins?.status || 'not connected'}</td></tr>)}</tbody>
      </table>
      <form className="z-row" onSubmit={async (e) => { e.preventDefault(); try { await zoneApi.adminCreateOrg(name); setName(''); load(); onChanged(); } catch (x) { setMsg(x.message); } }}>
        <input placeholder="New organization (e.g. Newark UEZ)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="secondary" disabled={!name}>Add org</button>
      </form>
      <form className="z-row" onSubmit={async (e) => {
        e.preventDefault();
        try { const r = await zoneApi.adminAddMember(member.orgId, member.email, member.role); setMsg(r.invited ? `Invite sent to ${member.email}.` : `${member.email} added.`); setMember({ ...member, email: '' }); load(); } catch (x) { setMsg(x.message); }
      }}>
        <select value={member.orgId} onChange={(e) => setMember({ ...member, orgId: e.target.value })}>
          <option value="">Choose org…</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <input type="email" placeholder="Member email" value={member.email} onChange={(e) => setMember({ ...member, email: e.target.value })} />
        <select value={member.role} onChange={(e) => setMember({ ...member, role: e.target.value })}><option value="admin">Admin</option><option value="staff">Staff</option></select>
        <button className="secondary" disabled={!member.orgId || !member.email}>Add member</button>
      </form>
      {msg && <div className="hint">{msg}</div>}
    </div>
  );
}

// ---------------- Page ----------------
export default function ZonePage() {
  const [session, setSession] = useState(undefined);
  const [me, setMe] = useState(null);
  const [orgId, setOrgId] = useState(() => { try { return localStorage.getItem('uez_zone_org') || ''; } catch { return ''; } });
  const [status, setStatus] = useState(null);
  const [tab, setTab] = useState('zone');
  const [viewZone, setViewZone] = useState(null);
  const [open, setOpen] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadMe = useCallback(() => {
    zoneApi.me().then((m) => {
      setMe(m);
      setOrgId((cur) => (m.orgs.find((o) => o.id === cur) ? cur : m.orgs[0]?.id || ''));
    }).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => { if (session) loadMe(); }, [session, loadMe]);

  const org = me?.orgs.find((o) => o.id === orgId);
  const loadStatus = useCallback(() => { if (org) zoneApi.status(org.id).then(setStatus).catch((e) => setErr(e.message)); }, [org?.id]);
  useEffect(() => { setStatus(null); loadStatus(); try { if (orgId) localStorage.setItem('uez_zone_org', orgId); } catch {} }, [orgId, loadStatus]);

  // Poll while a sync is running.
  useEffect(() => {
    if (!status?.syncing) return undefined;
    const t = setInterval(() => {
      zoneApi.status(org.id).then((s) => {
        setStatus(s);
        if (!s.syncing) { setRefreshKey((k) => k + 1); loadMe(); }
      }).catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [status?.syncing, org?.id, loadMe]);

  if (session === undefined) return null;
  if (!session) return <SignIn />;

  const lastRun = status?.runs?.[0];
  const lastOk = status?.runs?.find((r) => r.status === 'ok');
  const needsSetup = status && (!status.login || status.login.status === 'failed');

  return (
    <div className="app-shell z-shell">
      <header className="topbar">
        <div className="brand-mark">COR</div>
        <div>
          <div className="brand-name">{org ? org.name : 'UEZ Zone Dashboard'}</div>
          <div className="brand-subtitle">{org?.zone_name ? `${title(org.zone_name)} Urban Enterprise Zone` : 'Urban Enterprise Zone'}</div>
        </div>
        {me?.orgs.length > 1 && (
          <select className="z-orgpick" value={orgId} onChange={(e) => { setOrgId(e.target.value); setViewZone(null); }}>
            {me.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        <button className="signin-link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>

      <main className="z-main">
        {err && <div className="z-alert bad">{err}</div>}
        {me && !me.orgs.length && <div className="z-card z-pad">Your account isn't linked to a zone yet. Contact COR Solutions to get access.</div>}

        {org && status && (
          <>
            {needsSetup && <PortalSetup org={org} status={status} onSaved={() => { loadStatus(); loadMe(); }} />}

            {!needsSetup && (
              <div className="z-syncbar">
                <span className={`z-dot ${status.syncing ? 'syncing' : lastRun?.status === 'failed' ? 'failed' : 'ok'}`} />
                {status.syncing ? 'Syncing with the state portal…'
                  : lastRun?.status === 'failed' ? <>Last sync failed: {lastRun.error}</>
                  : lastOk ? <>Synced {fmtWhen(lastOk.finished_at)}{lastOk.stats?.details_remaining ? ` · ${lastOk.stats.details_remaining} business details still loading` : ''}</>
                  : 'Not synced yet'}
                <button className="z-link" disabled={status.syncing} onClick={() => zoneApi.sync(org.id).then(loadStatus).catch((e) => setErr(e.message))}>Sync now</button>
                {org.role === 'admin' && <button className="z-link" onClick={() => setStatus({ ...status, login: { ...(status.login || {}), status: 'failed', last_error: 'Enter the updated login below.' } })}>Update portal login</button>}
              </div>
            )}

            {org.zone_name && (
              <>
                <nav className="z-tabs">
                  <button className={tab === 'zone' && !viewZone ? 'on' : ''} onClick={() => { setTab('zone'); setViewZone(null); }}>My zone</button>
                  <button className={tab === 'state' ? 'on' : ''} onClick={() => { setTab('state'); setViewZone(null); }}>All zones</button>
                  {viewZone && <button className="on">{title(viewZone)}</button>}
                  {me.isPlatformAdmin && <button className={tab === 'admin' ? 'on' : ''} onClick={() => { setTab('admin'); setViewZone(null); }}>Admin</button>}
                </nav>

                {tab === 'zone' && !viewZone && (
                  <div className="z-grid">
                    <div><BusinessList org={org} zone={org.zone_name} refreshKey={refreshKey} onOpen={setOpen} /></div>
                    <Activity org={org} refreshKey={refreshKey} onOpen={setOpen} />
                  </div>
                )}
                {tab === 'state' && !viewZone && <Statewide org={org} onPickZone={(z) => (z === org.zone_name ? setTab('zone') : setViewZone(z))} />}
                {viewZone && <BusinessList org={org} zone={viewZone} refreshKey={refreshKey} onOpen={setOpen} />}
                {tab === 'admin' && !viewZone && <AdminPanel onChanged={loadMe} />}
              </>
            )}
            {!org.zone_name && me.isPlatformAdmin && <AdminPanel onChanged={loadMe} />}
          </>
        )}
      </main>

      {open && org && <BusinessDrawer org={org} fileNo={open} onClose={() => setOpen(null)} onLogged={() => setRefreshKey((k) => k + 1)} />}
    </div>
  );
}
