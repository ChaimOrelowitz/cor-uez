import supabase from './supabaseClient';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizeBrowserCheckerUrl(checkerUrl) {
  try {
    const url = new URL(checkerUrl);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const encodedPayload = hash.get('corBrc');
    if (!encodedPayload) return checkerUrl;

    const payload = JSON.parse(decodeBase64Url(encodedPayload));
    payload.apiBase = API_BASE;
    hash.set('corBrc', encodeBase64Url(JSON.stringify(payload)));
    url.hash = hash.toString();
    return url.toString();
  } catch (_) {
    return checkerUrl;
  }
}

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

export async function checkBrcTest(businessName, ein) {
  const response = await fetch(`${API_BASE}/api/uez/brc/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName, ein })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'BRC lookup failed.');
  return data;
}

export async function startBrowserBrcCapture(businessName, ein) {
  const response = await fetch(`${API_BASE}/api/uez/brc/browser-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName, ein })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not start the BRC browser check.');

  // Older Render builds generated the capture payload with http:// because Render
  // terminates TLS before Express. Always rewrite the helper payload to the same
  // public API URL this frontend is already using so the Chrome helper can relay
  // the NJ result back over HTTPS even while Render is temporarily on an older build.
  if (data.checkerUrl) data.checkerUrl = normalizeBrowserCheckerUrl(data.checkerUrl);
  return data;
}

export async function getBrowserBrcCapture(captureId, token) {
  const response = await fetch(`${API_BASE}/api/uez/brc/browser-session/${encodeURIComponent(captureId)}?token=${encodeURIComponent(token)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not read the BRC browser check.');
  return data;
}

export function browserBrcDocumentUrl(captureId, token) {
  return `${API_BASE}/api/uez/brc/browser-session/${encodeURIComponent(captureId)}/document?token=${encodeURIComponent(token)}`;
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
