import supabase from './supabaseClient';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Please sign in to continue.');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(await authHeaders()),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
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

export function requestBrcCheck(applicationId) {
  return request(`/api/uez/brc/${applicationId}/request-check`, { method: 'POST' });
}

export function markBrcRegistered(applicationId) {
  return request(`/api/uez/brc/${applicationId}/i-registered`, { method: 'POST' });
}

export function getMyApplications() {
  return request('/api/uez/me');
}

export function getApplication(applicationId) {
  return request(`/api/uez/applications/${applicationId}`);
}
