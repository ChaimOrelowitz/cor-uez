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

async function apiCall(method, path, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

export default function AccountsPage() {
  const [token, setToken] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState({});
  const [flash, setFlash] = useState({});

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const tok = data?.session?.access_token;
      if (!tok) { setError('Not logged in — go back to /admin and sign in first.'); setLoading(false); return; }
      setToken(tok);
      fetch(`${API_BASE}/admin/accounts`, { headers: { Authorization: `Bearer ${tok}` } })
        .then((r) => r.json())
        .then((d) => {
          if (d.error) throw new Error(d.error);
          setUsers(d);
          setLoading(false);
        })
        .catch((e) => { setError(e.message); setLoading(false); });
    });
  }, []);

  function showFlash(userId, msg, isErr) {
    setFlash((f) => ({ ...f, [userId]: { msg, isErr } }));
    setTimeout(() => setFlash((f) => { const n = { ...f }; delete n[userId]; return n; }), 3000);
  }

  async function act(userId, action) {
    setBusy((b) => ({ ...b, [userId]: action }));
    try {
      const result = await apiCall('POST', `/admin/accounts/${userId}/${action}`, token);
      if (action === 'reset-password') {
        showFlash(userId, `Reset email sent to ${result.email}`, false);
      } else {
        showFlash(userId, action === 'lock' ? 'Account locked' : 'Account unlocked', false);
        setUsers((u) => u.map((usr) => usr.id === userId ? { ...usr, banned: action === 'lock' } : usr));
      }
    } catch (e) {
      showFlash(userId, e.message, true);
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[userId]; return n; });
    }
  }

  async function deleteUser(userId, email) {
    if (!window.confirm(`Permanently delete account for ${email}? This cannot be undone.`)) return;
    setBusy((b) => ({ ...b, [userId]: 'delete' }));
    try {
      await apiCall('DELETE', `/admin/accounts/${userId}`, token);
      setUsers((u) => u.filter((usr) => usr.id !== userId));
    } catch (e) {
      showFlash(userId, e.message, true);
      setBusy((b) => { const n = { ...b }; delete n[userId]; return n; });
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = users.filter((u) => !q || [u.email, u.application?.business_name_input].some((v) => (v || '').toLowerCase().includes(q)));

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#f4f6fb' }}>
      {/* Header */}
      <div style={{ background: '#1e2235', color: '#fff', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 20 }}>
        <a href="/admin" style={{ color: '#9ca3c8', fontSize: 13, textDecoration: 'none' }}>← Admin</a>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-.01em' }}>Manage Accounts</h1>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7490' }}>{users.length} accounts</span>
      </div>

      <div style={{ maxWidth: 900, margin: '24px auto', padding: '0 16px' }}>
        {/* Search */}
        <input
          type="search"
          placeholder="Search by email or business name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #d0d4df', fontSize: 14, background: '#fff', boxSizing: 'border-box', marginBottom: 16, outline: 'none' }}
        />

        {loading && <div style={{ textAlign: 'center', color: '#6b7490', padding: 40 }}>Loading…</div>}
        {error && <div style={{ background: '#fff1f0', border: '1px solid #fca5a5', borderRadius: 10, padding: '12px 16px', color: '#b91c1c', marginBottom: 16 }}>{error}</div>}

        {!loading && !error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.length === 0 && <div style={{ textAlign: 'center', color: '#6b7490', padding: 40 }}>No accounts found</div>}
            {filtered.map((u) => (
              <div key={u.id} style={{ background: '#fff', border: '1px solid #e2e6ec', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                {/* Info */}
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#1e2235', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                  {u.application && (
                    <div style={{ fontSize: 12, color: '#6b7490', marginTop: 2 }}>
                      <a href="/admin" style={{ color: '#6366f1', textDecoration: 'none' }}>{u.application.business_name_input}</a>
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#9ca3c8', marginTop: 3 }}>
                    Joined {timeAgo(u.created_at)} · Last sign-in {timeAgo(u.last_sign_in_at)}
                  </div>
                </div>

                {/* Status */}
                <div style={{ flex: '0 0 auto' }}>
                  {u.banned
                    ? <span style={{ fontSize: 11, fontWeight: 700, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '2px 8px' }}>LOCKED</span>
                    : !u.application
                    ? <span style={{ fontSize: 11, color: '#9ca3c8', background: '#f4f6fb', border: '1px solid #e2e6ec', borderRadius: 6, padding: '2px 8px' }}>No application</span>
                    : <span style={{ fontSize: 11, color: '#166534', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, padding: '2px 8px' }}>Active</span>}
                </div>

                {/* Flash */}
                {flash[u.id] && (
                  <div style={{ fontSize: 12, color: flash[u.id].isErr ? '#b91c1c' : '#166534', background: flash[u.id].isErr ? '#fef2f2' : '#f0fdf4', border: `1px solid ${flash[u.id].isErr ? '#fca5a5' : '#86efac'}`, borderRadius: 6, padding: '4px 10px' }}>
                    {flash[u.id].msg}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, flex: '0 0 auto', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => act(u.id, 'reset-password')}
                    disabled={!!busy[u.id]}
                    style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7, border: '1px solid #d0d4df', background: '#fff', cursor: 'pointer', color: '#374151' }}
                  >
                    {busy[u.id] === 'reset-password' ? 'Sending…' : '✉ Reset password'}
                  </button>
                  {u.banned
                    ? <button
                        onClick={() => act(u.id, 'unlock')}
                        disabled={!!busy[u.id]}
                        style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7, border: '1px solid #86efac', background: '#f0fdf4', cursor: 'pointer', color: '#166534' }}
                      >
                        {busy[u.id] === 'unlock' ? 'Unlocking…' : '🔓 Unlock'}
                      </button>
                    : <button
                        onClick={() => act(u.id, 'lock')}
                        disabled={!!busy[u.id]}
                        style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7, border: '1px solid #fca5a5', background: '#fef2f2', cursor: 'pointer', color: '#b91c1c' }}
                      >
                        {busy[u.id] === 'lock' ? 'Locking…' : '🔒 Lock'}
                      </button>
                  }
                  <button
                    onClick={() => deleteUser(u.id, u.email)}
                    disabled={!!busy[u.id]}
                    style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7, border: '1px solid #fca5a5', background: '#fff', cursor: 'pointer', color: '#b91c1c' }}
                  >
                    {busy[u.id] === 'delete' ? 'Deleting…' : '🗑 Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
