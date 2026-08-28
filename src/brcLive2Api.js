import { request } from './api';

// Standalone client for the admin-authenticated "live BRC" browser
// (backend/routes/uezBrcLive2.js). Mirrors brcLiveApi.js's shapes, but the
// JSON calls go through api.js's authenticated request() helper, and
// sessions are started from an applicationId rather than raw business info.
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function startLiveBrc2Session(applicationId) {
  return request('/api/uez/brc-live2/session', {
    method: 'POST',
    body: JSON.stringify({ applicationId })
  });
}

export function getLiveBrc2Session(id, token) {
  return request(`/api/uez/brc-live2/session/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`);
}

export function sendLiveBrc2Input(id, token, payload) {
  return request(`/api/uez/brc-live2/session/${encodeURIComponent(id)}/input?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function saveLiveBrc2Session(id, token) {
  return request(`/api/uez/brc-live2/session/${encodeURIComponent(id)}/save?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export function liveBrc2ScreenshotUrl(id, token, tick = Date.now()) {
  return `${API_BASE}/api/uez/brc-live2/session/${encodeURIComponent(id)}/screenshot?token=${encodeURIComponent(token)}&t=${tick}`;
}

export function liveBrc2DocumentUrl(id, token) {
  return `${API_BASE}/api/uez/brc-live2/session/${encodeURIComponent(id)}/document?token=${encodeURIComponent(token)}`;
}
