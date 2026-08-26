import supabase from './supabaseClient';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function sessionToken() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session?.access_token) throw new Error('Please sign in to continue.');
  return session.access_token;
}

async function request(path, options = {}) {
  const token = await sessionToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {})
  };

  if (!(options.body instanceof FormData) && options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => '');

  if (!response.ok) {
    const message = typeof data === 'string' ? data : data.error;
    throw new Error(message || 'Something went wrong.');
  }

  return data;
}

export async function getApplicantSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signUpApplicant(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${window.location.origin}/` }
  });
  if (error) throw error;
  return data;
}

export async function signInApplicant(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOutApplicant() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function whoAmI() {
  return request('/api/uez/whoami');
}

export function createApplication(payload) {
  return request('/api/uez/applications', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function saveBusiness(applicationId, payload) {
  return request(`/api/uez/applications/${applicationId}/business`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function saveOwners(applicationId, owners) {
  return request(`/api/uez/applications/${applicationId}/owners`, {
    method: 'PUT',
    body: JSON.stringify({ owners })
  });
}

export function uploadApplicationDocument(applicationId, documentType, file) {
  const body = new FormData();
  body.append('documentType', documentType);
  body.append('file', file);
  return request(`/api/uez/applications/${applicationId}/documents`, {
    method: 'POST',
    body
  });
}

export function getDocumentUrl(applicationId, documentId) {
  return request(`/api/uez/applications/${applicationId}/documents/${documentId}/url`);
}

export function deleteDocument(applicationId, documentId) {
  return request(`/api/uez/applications/${applicationId}/documents/${documentId}`, {
    method: 'DELETE'
  });
}

export function submitApplication(applicationId) {
  return request(`/api/uez/applications/${applicationId}/submit`, { method: 'POST' });
}

export function getMyApplications() {
  return request('/api/uez/me');
}

export function getApplication(applicationId) {
  return request(`/api/uez/applications/${applicationId}`);
}

export function getMyNjCredentials(applicationId) {
  return request(`/api/uez/applications/${applicationId}/credentials/mynj`);
}

export function getAdminApplications() {
  return request('/api/uez/admin/applications');
}

export function getAdminApplication(applicationId) {
  return request(`/api/uez/admin/applications/${applicationId}`);
}

export function updateAdminApplication(applicationId, payload) {
  return request(`/api/uez/admin/applications/${applicationId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function deleteAdminApplication(applicationId) {
  return request(`/api/uez/admin/applications/${applicationId}`, {
    method: 'DELETE'
  });
}

export function createAdminMyNjCredentials(applicationId) {
  return request(`/api/uez/admin/applications/${applicationId}/credentials/mynj`, {
    method: 'POST'
  });
}

export function updateAdminMyNjCredentials(applicationId, payload) {
  return request(`/api/uez/admin/applications/${applicationId}/credentials/mynj`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function markAdminPbsAccountCreated(applicationId) {
  return request(`/api/uez/admin/applications/${applicationId}/pbs-account-created`, {
    method: 'POST'
  });
}

export function updateAdminProcessFlags(applicationId, payload) {
  return request(`/api/uez/admin/applications/${applicationId}/process-flags`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function markAdminBrcFound(applicationId, payload) {
  return request(`/api/uez/admin/applications/${applicationId}/brc-found`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function markAdminBrcNotFound(applicationId) {
  return request(`/api/uez/admin/applications/${applicationId}/brc-not-found`, {
    method: 'POST'
  });
}

export function updateAdminApplicationStatus(applicationId, payload) {
  return request(`/api/uez/admin/applications/${applicationId}/status`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}
