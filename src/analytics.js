import supabase from './supabaseClient';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const VISIT_KEY = 'cor_uez_site_visit_v1';
const VISIT_TTL_MS = 30 * 60 * 1000;

function fallbackUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : ((random & 0x3) | 0x8);
    return value.toString(16);
  });
}

function visitSession() {
  const now = Date.now();
  try {
    const saved = JSON.parse(localStorage.getItem(VISIT_KEY) || 'null');
    if (saved?.id && Number.isFinite(Number(saved.startedAt)) && now - Number(saved.startedAt) < VISIT_TTL_MS) {
      return { ...saved, shouldTrack: false };
    }
  } catch (_) {}

  const next = {
    id: globalThis.crypto?.randomUUID?.() || fallbackUuid(),
    startedAt: now
  };

  try {
    localStorage.setItem(VISIT_KEY, JSON.stringify(next));
  } catch (_) {}

  return { ...next, shouldTrack: true };
}

export async function trackPublicVisit() {
  const visit = visitSession();
  if (!visit.shouldTrack) return;

  try {
    const response = await fetch(`${API_BASE}/api/uez/analytics/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: visit.id,
        path: window.location.pathname || '/',
        referrer: document.referrer || null
      }),
      keepalive: true
    });
    if (!response.ok) throw new Error('Visit tracking failed.');
  } catch (_) {
    try { localStorage.removeItem(VISIT_KEY); } catch (_) {}
  }
}

export async function getAdminVisitStats() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session?.access_token) return null;

  const response = await fetch(`${API_BASE}/api/uez/analytics/admin/visits`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Could not load site visits.');
  return payload;
}
