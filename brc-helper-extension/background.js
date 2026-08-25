chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'cor-brc-capture') return;

  const { apiBase, captureId, token, payload } = message;
  if (!apiBase || !captureId || !token || !payload) {
    sendResponse({ ok: false, error: 'Missing capture data' });
    return;
  }

  const safeApiBase = String(apiBase).replace(/^http:\/\/cor-uez-api\.onrender\.com/i, 'https://cor-uez-api.onrender.com');

  fetch(`${safeApiBase}/api/uez/brc/browser-session/${encodeURIComponent(captureId)}/result`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-cor-capture-token': token
    },
    body: JSON.stringify(payload)
  })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Capture upload failed');
      sendResponse({ ok: true, data });
    })
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
