import { useEffect, useState } from 'react';
import supabase from './supabaseClient';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:4000') + '/api/uez';

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function AccountsPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState({});
  const [flash, setFlash] = useState({});
  const [tok, setTok] = useState(null);

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data, error: sessErr }) => {
        if (sessErr) { setError('Session error: ' + sessErr.message); setLoading(false); return; }
        const token = data?.session?.access_token;
        if (!token) { setError('Not logged in — open /admin first and sign in.'); setLoading(false); return; }
        setTok(token);
        return fetch(`${API_BASE}/admin/accounts`, { headers: { Authorization: `Bearer ${token}` } });
      })
      .then((res) => {
        if (!res) return; // already handled above
        if (!res.ok) return res.text().then((t) => { throw new Error(`${res.status}: ${t.slice(0, 200)}`); });
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        if (!Array.isArray(data)) throw new Error(data.error || 'Unexpected response');
        setUsers(data);
        setLoading(false);
      })
      .catch((e) => { setError(String(e?.message || e)); setLoading(false); });
  }, []);

  function showFlash(userId, msg, isErr) {
    setFlash((f) => ({ ...f, [userId]: { msg, isErr } }));
    setTimeout(() => setFlash((f) => { const n = { ...f }; delete n[userId]; return n; }), 4000);
  }

  async function apiAction(method, path) {
    const res = await fetch(`${API_BASE}${path}`, { method, headers: { Authorization: `Bearer ${tok}` } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || res.statusText);
    return json;
  }

  async function act(userId, action) {
    setBusy((b) => ({ ...b, [userId]: action }));
    try {
      const result = await apiAction('POST', `/admin/accounts/${userId}/${action}`);
      if (action === 'reset-password') {
        showFlash(userId, `Reset email sent to ${result.email}`, false);
      } else {
        showFlash(userId, action === 'lock' ? 'Account locked' : 'Account unlocked', false);
        setUsers((u) => u.map((usr) => usr.id === userId ? { ...usr, banned: action === 'lock' } : usr));
      }
    } catch (e) {
      showFlash(userId, String(e?.message || e), true);
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[userId]; return n; });
    }
  }

  async function deleteUser(userId, email) {
    if (!window.confirm(`Permanently delete ${email} and ALL their data? This cannot be undone.`)) return;
    setBusy((b) => ({ ...b, [userId]: 'delete' }));
    try {
      await apiAction('DELETE', `/admin/accounts/${userId}`);
      setUsers((u) => u.filter((usr) => usr.id !== userId));
    } catch (e) {
      showFlash(userId, String(e?.message || e), true);
      setBusy((b) => { const n = { ...b }; delete n[userId]; return n; });
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = (users || []).filter((u) =>
    !q || [u.email, u.application?.business_name_input].some((v) => (v || '').toLowerCase().includes(q))
  );

  return (
    <div style={{ fontFamily: 'system-ui,sans-serif', minHeight: '100vh', background: '#f4f6fb' }}>
      <div style={{ background: '#1e2235', color: '#fff', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 20 }}>
        <a href="/admin" style={{ color: '#9ca3c8', fontSize: 13, textDecoration: 'none' }}>← Admin</a>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Manage Accounts</h1>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7490' }}>{users.length} accounts</span>
      </div>

      <div style={{ maxWidth: 900, margin: '24px auto', padding: '0 16px' }}>
        <input
          type="search"
          placeholder="Search by email or business name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #d0d4df', fontSize: 14, background: '#fff', boxSizing: 'border-box', marginBottom: 16, outline: 'none' }}
        />

        {loading && <div style={{ textAlign: 'center', color: '#6b7490', padding: 48, fontSize: 15 }}>Loading accounts…</div>}

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: '14px 18px', color: '#b91c1c', fontSize: 14 }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: '#6b7490', padding: 48 }}>No accounts found</div>
        )}

        {!loading && !error && filtered.map((u) => (
          <div key={u.id} style={{ background: '#fff', border: '1px solid #e2e6ec', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#1e2235', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
              {u.application && (
                <div style={{ fontSize: 12, color: '#6366f1', marginTop: 2 }}>{u.application.business_name_input}</div>
              )}
              <div style={{ fontSize: 11, color: '#9ca3c8', marginTop: 3 }}>
                Joined {timeAgo(u.created_at)} · Last login {timeAgo(u.last_sign_in_at)}
              </div>
            </div>

            <div>
              {u.banned
                ? <span style={{ fontSize: 11, fontWeight: 700, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '2px 8px' }}>LOCKED</span>
                : u.application
                ? <span style={{ fontSize: 11, color: '#166534', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, padding: '2px 8px' }}>Active</span>
                : <span style={{ fontSize: 11, color: '#9ca3c8', background: '#f4f6fb', border: '1px solid #e2e6ec', borderRadius: 6, padding: '2px 8px' }}>No application</span>}
            </div>

            {flash[u.id] && (
              <div style={{ fontSize: 12, color: flash[u.id].isErr ? '#b91c1c' : '#166534', background: flash[u.id].isErr ? '#fef2f2' : '#f0fdf4', border: `1px solid ${flash[u.id].isErr ? '#fca5a5' : '#86efac'}`, borderRadius: 6, padding: '4px 10px' }}>
                {flash[u.id].msg}
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={() => act(u.id, 'reset-password')} disabled={!!busy[u.id]}
                style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7, border: '1px solid #d0d4df', background: '#fff', cursor: 'pointer', color: '#374151', opacity: busy[u.id] ? 0.5 : 1 }}>
                {busy[u.id] === 'reset-password' ? 'Sending…' : '✉ Reset password'}
              </button>
              {u.banned
                ? <button onClick={() => act(u.id, 'unlock')} disabled={!!busy[u.id]}
                    style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7, border: '1px solid #86efac', background: '#f0fdf4', cursor: 'pointer', color: '#166534', opacity: busy[u.id] ? 0.5 : 1 }}>
                    {busy[u.id] === 'unlock' ? 'Unlocking…' : '🔓 Unlock'}
                  </button>
                : <button onClick={() => act(u.id, 'lock')} disabled={!!busy[u.id]}
                    style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7, border: '1px solid #fca5a5', background: '#fef2f2', cursor: 'pointer', color: '#b91c1c', opacity: busy[u.id] ? 0.5 : 1 }}>
                    {busy[u.id] === 'lock' ? 'Locking…' : '🔒 Lock'}
                  </button>}
              <button onClick={() => deleteUser(u.id, u.email)} disabled={!!busy[u.id]}
                style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7, border: '1px solid #d0d4df', background: '#fff', cursor: 'pointer', color: '#b91c1c', opacity: busy[u.id] ? 0.5 : 1 }}>
                {busy[u.id] === 'delete' ? 'Deleting…' : '🗑 Delete all'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
