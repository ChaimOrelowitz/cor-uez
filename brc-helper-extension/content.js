(() => {
  const SESSION_KEY = 'corBrcCapturePayload';
  let sentOutcome = null;

  function decodePayload(value) {
    try {
      const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
      return JSON.parse(decodeURIComponent(escape(atob(padded))));
    } catch (_) {
      return null;
    }
  }

  function getPayload() {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const fromHash = hash.get('corBrc');
    if (fromHash) {
      const payload = decodePayload(fromHash);
      if (payload) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
        history.replaceState(null, '', `${location.pathname}${location.search}`);
        return payload;
      }
    }
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    } catch (_) {
      return null;
    }
  }

  const payload = getPayload();
  if (!payload?.captureId || !payload?.token || !payload?.apiBase) return;

  function normalizedText() {
    return String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  }

  function between(text, startLabel, endLabel) {
    const start = text.indexOf(startLabel);
    if (start < 0) return null;
    const from = start + startLabel.length;
    const end = endLabel ? text.indexOf(endLabel, from) : text.length;
    return text.slice(from, end < 0 ? text.length : end).trim() || null;
  }

  function relay(outcome, extra = {}) {
    if (sentOutcome === outcome && outcome !== 'challenge') return;
    if (outcome !== 'challenge') sentOutcome = outcome;
    chrome.runtime.sendMessage({
      type: 'cor-brc-capture',
      apiBase: payload.apiBase,
      captureId: payload.captureId,
      token: payload.token,
      payload: { outcome, ...extra }
    });
  }

  function fillLookupForm() {
    const nameInput = document.querySelector('input[name="pinnctl"]');
    const taxInput = document.querySelector('input[name="pinidnum"]');
    if (!nameInput || !taxInput || !payload.lookup) return false;

    if (!nameInput.value) {
      nameInput.value = String(payload.lookup.nameControl || '').toLowerCase();
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (!taxInput.value) {
      taxInput.value = String(payload.lookup.njTaxId || '');
      taxInput.dispatchEvent(new Event('input', { bubbles: true }));
      taxInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    let notice = document.getElementById('cor-brc-helper-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'cor-brc-helper-notice';
      notice.textContent = 'COR filled the BRC lookup. Complete any NJ verification and submit the form.';
      Object.assign(notice.style, {
        position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
        background: '#17203a', color: 'white', padding: '10px 14px', borderRadius: '10px',
        font: '13px system-ui, sans-serif', boxShadow: '0 8px 25px rgba(0,0,0,.2)'
      });
      document.documentElement.appendChild(notice);
    }
    return true;
  }

  function inspectPage() {
    const text = normalizedText();
    if (!text) return;

    if (/BUSINESS REGISTRATION CERTIFICATE/i.test(text) && /Certificate Number:/i.test(text)) {
      relay('found', {
        result: {
          taxpayerName: between(text, 'Taxpayer Name:', 'Trade Name:'),
          tradeName: between(text, 'Trade Name:', 'Address:'),
          address: between(text, 'Address:', 'Certificate Number:'),
          certificateNumber: between(text, 'Certificate Number:', 'Effective Date:'),
          effectiveDate: between(text, 'Effective Date:', 'Date of Issuance:'),
          issuanceDate: between(text, 'Date of Issuance:', 'For Office Use Only:')
        },
        html: document.documentElement.outerHTML
      });
      return;
    }

    if (/There was no match on the fields entered\./i.test(text)) {
      relay('not_found');
      return;
    }

    if (/hcaptcha|verify you are human|request unsuccessful|incapsula/i.test(`${text} ${document.documentElement.innerHTML}`)) {
      relay('challenge');
      return;
    }

    fillLookupForm();
  }

  fillLookupForm();
  inspectPage();

  const observer = new MutationObserver(() => inspectPage());
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('load', inspectPage);
})();
