import supabase from './supabaseClient';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4100';

async function request(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Please sign in to continue.');
  const res = await fetch(`${API_BASE}/api/uez/zone${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

export const zoneApi = {
  me: () => request('/me'),
  status: (orgId) => request(`/orgs/${orgId}/status`),
  savePortalLogin: (orgId, creds) => request(`/orgs/${orgId}/portal-login`, { method: 'PUT', body: creds }),
  sync: (orgId) => request(`/orgs/${orgId}/sync`, { method: 'POST', body: {} }),
  businesses: (orgId, zone) => request(`/orgs/${orgId}/businesses${zone ? `?zone=${encodeURIComponent(zone)}` : ''}`),
  business: (orgId, fileNo) => request(`/orgs/${orgId}/businesses/${encodeURIComponent(fileNo)}`),
  addOutreach: (orgId, fileNo, body) => request(`/orgs/${orgId}/businesses/${encodeURIComponent(fileNo)}/outreach`, { method: 'POST', body }),
  activity: (orgId) => request(`/orgs/${orgId}/activity`),
  statewide: (orgId) => request(`/orgs/${orgId}/statewide`),
  home: (orgId) => request(`/orgs/${orgId}/home`),
  settings: (orgId) => request(`/orgs/${orgId}/settings`),
  saveSettings: (orgId, body) => request(`/orgs/${orgId}/settings`, { method: 'PUT', body }),
  myProfile: () => request('/me/profile'),
  saveProfile: (body) => request('/me/profile', { method: 'PUT', body }),
  sendReminder: (orgId, fileNo) => request(`/orgs/${orgId}/businesses/${encodeURIComponent(fileNo)}/send-reminder`, { method: 'POST', body: {} }),
  templates: (orgId) => request(`/orgs/${orgId}/templates`),
  saveTemplate: (orgId, kind, subject, body) => request(`/orgs/${orgId}/templates/${kind}`, { method: 'PUT', body: { subject, body } }),
  resetTemplate: (orgId, kind) => request(`/orgs/${orgId}/templates/${kind}`, { method: 'DELETE' }),
  startBackfill: (orgId) => request(`/orgs/${orgId}/backfill-inactive`, { method: 'POST', body: {} }),
  backfillStatus: (orgId) => request(`/orgs/${orgId}/backfill-inactive/status`),
  testEmail: (orgId, to) => request(`/orgs/${orgId}/test-email`, { method: 'POST', body: { to } }),
  adminOrgs: () => request('/admin/orgs'),
  adminCreateOrg: (name) => request('/admin/orgs', { method: 'POST', body: { name } }),
  adminAddMember: (orgId, email, role) => request(`/admin/orgs/${orgId}/members`, { method: 'POST', body: { email, role } })
};
