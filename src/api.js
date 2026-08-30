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
  const response = await fetch(`${API_BASE}/api/uez/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Could not create your account.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
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

export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(String(email || '').trim(), {
    redirectTo: `${window.location.origin}/reset-password`
  });
  if (error) throw error;
}

export async function updateApplicantPassword(password) {
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  return data;
}


export async function getSignupLayout() {
  const response = await fetch(`${API_BASE}/api/uez/signup-layout`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Could not load signup layout.');
  return payload.layout;
}

export function saveAdminSignupLayout(layout) {
  return request('/api/uez/admin/signup-layout', {
    method: 'PUT',
    body: JSON.stringify({ layout })
  });
}

export function resetAdminSignupLayout() {
  return request('/api/uez/admin/signup-layout/reset', { method: 'POST' });
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

export function savePbsAccountInfo(applicationId, payload) {
  return request(`/api/uez/applications/${applicationId}/pbs-account-info`, {
    method: 'PUT',
    body: JSON.stringify(payload)
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

export function reportApplicantPayment(applicationId) {
  return request(`/api/uez/applications/${applicationId}/payment-reported`, { method: 'POST' });
}

export function reportBrcCreated(applicationId) {
  return request(`/api/uez/brc/${applicationId}/client-created`, { method: 'POST' });
}

export function reportTaxClearanceResolved(applicationId) {
  return request(`/api/uez/applications/${applicationId}/tax-clearance-resolved`, { method: 'POST' });
}

export function saveAdminPayment(applicationId, payload) {
  return request(`/api/uez/admin/applications/${applicationId}/payment`, {
    method: 'PUT', body: JSON.stringify(payload)
  });
}

export function requestAdminPayment(applicationId) {
  return request(`/api/uez/admin/applications/${applicationId}/request-payment`, { method: 'POST' });
}

export function reviewAdminDocument(applicationId, documentId, decision) {
  return request(`/api/uez/admin/applications/${applicationId}/documents/${documentId}/review`, {
    method: 'POST',
    body: JSON.stringify({ decision })
  });
}

export function getAdminEmailTemplates() {
  return request('/api/uez/email/admin/templates');
}

export function updateAdminEmailTemplate(templateKey, payload) {
  return request(`/api/uez/email/admin/templates/${encodeURIComponent(templateKey)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function sendAdminApplicationEmail(applicationId, templateKey, options = {}) {
  const { extra = {}, subject, body } = options;
  return request(`/api/uez/email/admin/applications/${applicationId}/send/${encodeURIComponent(templateKey)}`, {
    method: 'POST',
    body: JSON.stringify({ extra, subject, body })
  });
}

export function getAdminEmailPreview(applicationId, templateKey) {
  return request(`/api/uez/email/admin/applications/${applicationId}/preview/${encodeURIComponent(templateKey)}`);
}

export function getAdminCaseNotes(applicationId) {
  return request(`/api/uez/admin/applications/${applicationId}/notes`);
}

export function addAdminCaseNote(applicationId, body) {
  return request(`/api/uez/admin/applications/${applicationId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body })
  });
}

export function updateAdminCaseNote(applicationId, noteId, body) {
  return request(`/api/uez/admin/applications/${applicationId}/notes/${noteId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body })
  });
}

export function deleteAdminCaseNote(applicationId, noteId) {
  return request(`/api/uez/admin/applications/${applicationId}/notes/${noteId}`, {
    method: 'DELETE'
  });
}

export function updateAdminProcessStep(applicationId, stepKey, payload) {
  return request(`/api/uez/admin/applications/${applicationId}/process-steps/${encodeURIComponent(stepKey)}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function resetAdminProcessStep(applicationId, stepKey) {
  return request(`/api/uez/admin/applications/${applicationId}/process-steps/${encodeURIComponent(stepKey)}`, {
    method: 'DELETE'
  });
}
