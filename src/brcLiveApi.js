const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function jsonFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'BRC browser request failed.');
  return data;
}

export function startLiveBrcSession(businessName, ein) {
  return jsonFetch('/api/uez/brc/live/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName, ein })
  });
}

export function getLiveBrcSession(id, token) {
  return jsonFetch(`/api/uez/brc/live/session/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`);
}

export function sendLiveBrcInput(id, token, payload) {
  return jsonFetch(`/api/uez/brc/live/session/${encodeURIComponent(id)}/input?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function liveBrcScreenshotUrl(id, token, tick = Date.now()) {
  return `${API_BASE}/api/uez/brc/live/session/${encodeURIComponent(id)}/screenshot?token=${encodeURIComponent(token)}&t=${tick}`;
}

export function liveBrcDocumentUrl(id, token) {
  return `${API_BASE}/api/uez/brc/live/session/${encodeURIComponent(id)}/document?token=${encodeURIComponent(token)}`;
}
