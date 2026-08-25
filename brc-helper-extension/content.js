(() => {
  if (window !== window.top) return;
  let sent = false;
  let running = false;
  const send = (message) => chrome.runtime.sendMessage(message).catch(() => null);
  const setValue = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };
  const pageText = () => String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  const between = (value, startLabel, endLabel) => {
    const start = value.indexOf(startLabel);
    if (start < 0) return null;
    const from = start + startLabel.length;
    const end = endLabel ? value.indexOf(endLabel, from) : value.length;
    return value.slice(from, end < 0 ? value.length : end).trim() || null;
  };
  const notice = (message) => {
    let element = document.getElementById('cor-uez-helper-notice');
    if (!element) {
      element = document.createElement('div'); element.id = 'cor-uez-helper-notice';
      Object.assign(element.style, { position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647', background: '#17203a', color: 'white', padding: '10px 14px', borderRadius: '10px', font: '13px system-ui,sans-serif', maxWidth: '380px', boxShadow: '0 8px 25px rgba(0,0,0,.25)' });
      document.documentElement.appendChild(element);
    }
    element.textContent = message;
  };
  const bytesToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer); let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(binary);
  };

  async function runOnce() {
    const response = await send({ type: 'COR_NJ_GET_JOB' });
    const job = response?.job;
    if (!job || sent) return;
    const text = pageText();

    if (job.workflow === 'brc') {
      if (/BUSINESS REGISTRATION CERTIFICATE/i.test(text) && /Certificate Number:/i.test(text)) {
        sent = true;
        await send({ type: 'COR_BRC_FOUND', result: {
          taxpayerName: between(text, 'Taxpayer Name:', 'Trade Name:'), tradeName: between(text, 'Trade Name:', 'Address:'),
          address: between(text, 'Address:', 'Certificate Number:'), certificateNumber: between(text, 'Certificate Number:', 'Effective Date:'),
          effectiveDate: between(text, 'Effective Date:', 'Date of Issuance:'), issuanceDate: between(text, 'Date of Issuance:', 'For Office Use Only:')
        }, html: document.documentElement.outerHTML });
        return;
      }
      if (/There was no match on the fields entered\./i.test(text)) { sent = true; await send({ type: 'COR_BRC_NOT_FOUND' }); return; }
      const name = document.querySelector('input[name="pinnctl"]');
      const taxId = document.querySelector('input[name="pinidnum"]');
      if (name && taxId) {
        const control = job.businessName.replace(/[^a-z0-9]/gi, '').slice(0, 4).toLowerCase();
        const digits = job.ein.replace(/\D/g, '').slice(0, 9);
        if (!name.value) setValue(name, control);
        if (!taxId.value) setValue(taxId, digits.length === 9 ? `${digits}000` : '');
        notice('COR filled the BRC lookup. Complete New Jersey verification and submit. The certificate will be saved to the applicant automatically.');
        await send({ type: 'COR_NJ_STATUS', status: 'waiting_for_verification' });
      }
      return;
    }

    const username = document.querySelector('input[name="IDToken1"]');
    const password = document.querySelector('input[name="IDToken2"]');
    if (username && password && job.credentials) {
      setValue(username, job.credentials.username || ''); setValue(password, job.credentials.password || '');
      notice('COR filled the stored MyNJ login and is signing in.');
      await send({ type: 'COR_NJ_STATUS', status: 'signing_in_to_pbs' });
      document.querySelector('input[name="Login.Submit"], input[type="submit"], button[type="submit"]')?.click();
      return;
    }

    const taxLink = [...document.querySelectorAll('a')].find((link) => /Tax & Revenue Center/i.test(link.textContent || '') || /TYTR_ACE_App\/servlet\/common\/portalRequest/i.test(link.href || ''));
    if (taxLink) { notice('COR is opening Tax & Revenue Center.'); await send({ type: 'COR_NJ_STATUS', status: 'opening_tax_revenue_center' }); taxLink.click(); return; }
    const loginLink = document.querySelector('a[href*="my.nj.gov/aui/Login"]');
    if (loginLink) { notice('COR is opening the MyNJ login.'); await send({ type: 'COR_NJ_STATUS', status: 'opening_mynj_login' }); loginLink.click(); return; }
    const incentive = document.querySelector('input[name="Submit"][value="Business Incentive Tax Clearance"]');
    if (incentive) { notice('COR selected Business Incentive Tax Clearance. Complete New Jersey verification if it appears.'); await send({ type: 'COR_NJ_STATUS', status: 'waiting_for_human_verification' }); incentive.click(); return; }

    const department = document.querySelector('select[name="ClearanceDept"]');
    const download = document.querySelector('input[name="Submit"][value="Download Clearance Letter"]');
    if (department && download?.form) {
      const option = [...department.options].find((item) => /New Jersey Department of Community Affairs/i.test(item.textContent || ''));
      if (option) setValue(department, option.value);
      notice('COR is retrieving the tax-clearance PDF and adding it to the applicant.');
      await send({ type: 'COR_NJ_STATUS', status: 'requesting_tax_clearance_pdf' });
      sent = true;
      try {
        const form = download.form; const formData = new FormData(form); formData.set(download.name, download.value);
        const result = await fetch(form.action || location.href, { method: (form.method || 'POST').toUpperCase(), body: new URLSearchParams([...formData.entries()].map(([key, value]) => [key, String(value)])), credentials: 'include' });
        const buffer = await result.arrayBuffer(); const type = result.headers.get('content-type') || '';
        if (!result.ok || !type.toLowerCase().includes('application/pdf') || buffer.byteLength < 100) throw new Error('New Jersey did not return a tax-clearance PDF.');
        await send({ type: 'COR_TAX_PDF', base64: bytesToBase64(buffer), filename: 'NJ-Tax-Clearance.pdf' });
      } catch (error) { await send({ type: 'COR_NJ_ERROR', error: error.message }); }
    }
  }

  async function run() {
    if (running) return;
    running = true;
    try { await runOnce(); } finally { running = false; }
  }

  run().catch((error) => send({ type: 'COR_NJ_ERROR', error: error.message }));
  new MutationObserver(() => run().catch(() => {})).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', () => run().catch(() => {}));
})();
