(() => {
  function isAllowedOrigin(origin) {
    if (!origin) return false;
    if (origin === 'https://cor-uez.vercel.app' || origin === 'https://uez.corsolutions.io') return true;
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
    if (/^https:\/\/cor-uez-[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true;
    return false;
  }

  if (!isAllowedOrigin(location.origin)) return;

  window.addEventListener('message', (event) => {
    if (event.source !== window || !isAllowedOrigin(event.origin)) return;
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
