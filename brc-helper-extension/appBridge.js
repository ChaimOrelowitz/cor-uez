(() => {
  const ALLOWED_ORIGINS = new Set(['https://cor-uez.vercel.app', 'https://uez.corsolutions.io']);
  if (!ALLOWED_ORIGINS.has(location.origin)) return;

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.source !== 'cor-uez-app' || !['COR_UEZ_PING', 'COR_UEZ_START'].includes(message.type)) return;
    chrome.runtime.sendMessage(message).then((response) => {
      window.postMessage({ source: 'cor-uez-extension', type: message.type === 'COR_UEZ_PING' ? 'COR_UEZ_PONG' : 'COR_UEZ_START_RESULT', requestId: message.requestId, ...(response || {}) }, location.origin);
    }).catch((error) => {
      window.postMessage({ source: 'cor-uez-extension', type: 'COR_UEZ_START_RESULT', requestId: message.requestId, ok: false, error: error.message || 'The COR extension could not start.' }, location.origin);
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.source === 'cor-uez-background') window.postMessage({ ...message, source: 'cor-uez-extension' }, location.origin);
  });
})();
