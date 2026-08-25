(() => {
  if (globalThis.__corUezDocumentHelperLoaded) return;
  globalThis.__corUezDocumentHelperLoaded = true;
  let sent = false;
  let running = false;
  let announced = false;

  const send = (message) => chrome.runtime.sendMessage(message).catch(() => null);

  const setValue = (input, value) => {
    if (!input) return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  };

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
      element = document.createElement('div');
      element.id = 'cor-uez-helper-notice';
      Object.assign(element.style, {
        position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
        background: '#17203a', color: 'white', padding: '12px 16px',
        borderRadius: '10px', font: '13px system-ui, -apple-system, sans-serif',
        maxWidth: '380px', boxShadow: '0 8px 25px rgba(0,0,0,.3)', border: '1px solid #3b4261'
      });
      (document.body || document.documentElement).appendChild(element);
    }
    element.textContent = message;
  };

  const bytesToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(binary);
  };

  async function runOnce() {
    const response = await send({ type: 'COR_NJ_GET_JOB' });
    const job = response?.job;
    if (!job || sent) return;
    const text = pageText();

    if (!announced) {
      announced = true;
      await send({ type: 'COR_NJ_STATUS', status: 'nj_page_open' });
    }

    if (job.workflow === 'brc') {
      const nameInput = document.querySelector('input[name="pinnctl"]');
      const taxInput = document.querySelector('input[name="pinidnum"]');

      // 1. If we are on the lookup form page, fill and submit!
      if (nameInput && taxInput) {
        const control = job.businessName.replace(/[^a-z0-9]/gi, '').slice(0, 4);
        const digits = job.ein.replace(/\D/g, '').slice(0, 9);
        const fullTaxId = digits.length === 9 ? `${digits}000` : digits;

        let filledAny = false;
        if (!nameInput.value || nameInput.value.toLowerCase() !== control.toLowerCase()) {
          setValue(nameInput, control);
          filledAny = true;
        }
        if (!taxInput.value || taxInput.value !== fullTaxId) {
          setValue(taxInput, fullTaxId);
          filledAny = true;
        }

        const submissionKey = `corBrcSubmitted:${job.id}`;
        const submitBtn = document.querySelector('input[name="submit"], input[type="submit"], button[type="submit"]');

        if (submitBtn && (!sessionStorage.getItem(submissionKey) || filledAny)) {
          sessionStorage.setItem(submissionKey, '1');
          notice(`COR filled BRC form (${control.toUpperCase()} / ${fullTaxId}). Submitting…`);
          await send({ type: 'COR_NJ_STATUS', status: 'waiting_for_verification' });
          submitBtn.click();
        } else {
          notice(`COR filled BRC form (${control.toUpperCase()} / ${fullTaxId}). Complete any CAPTCHA if shown.`);
          await send({ type: 'COR_NJ_STATUS', status: 'waiting_for_verification' });
        }
        return;
      }

      // 2. If we are on the certificate result page (no search inputs present)
      if (/BUSINESS REGISTRATION CERTIFICATE/i.test(text) && /Effective Date:/i.test(text) && /Date of Issuance:/i.test(text)) {
        sent = true;
        notice('COR found the official BRC certificate! Saving PDF to file…');
        await send({
          type: 'COR_BRC_FOUND',
          result: {
            taxpayerName: between(text, 'Taxpayer Name:', 'Trade Name:') || between(text, 'Taxpayer Name:', 'Address:'),
            tradeName: between(text, 'Trade Name:', 'Address:') || '',
            address: between(text, 'Address:', 'Certificate Number:'),
            certificateNumber: between(text, 'Certificate Number:', 'Effective Date:'),
            effectiveDate: between(text, 'Effective Date:', 'Date of Issuance:'),
            issuanceDate: between(text, 'Date of Issuance:', 'For Office Use Only:') || between(text, 'Date of Issuance:', 'State of New Jersey')
          },
          html: document.documentElement.outerHTML
        });
        return;
      }

      // 3. No match found on NJ database
      if (/There was no match on the fields entered/i.test(text)) {
        sent = true;
        notice('NJ reported no matching BRC found.');
        await send({ type: 'COR_BRC_NOT_FOUND' });
        return;
      }

      notice('COR is waiting for New Jersey page to load. Complete any security verification if shown.');
      await send({ type: 'COR_NJ_STATUS', status: 'waiting_for_verification' });
      return;
    }

    if (job.workflow === 'tax_clearance') {
      const usernameInput = document.querySelector('input[name="IDToken1"]');
      const passwordInput = document.querySelector('input[name="IDToken2"]');

      if (usernameInput && passwordInput && job.credentials) {
        setValue(usernameInput, job.credentials.username || '');
        setValue(passwordInput, job.credentials.password || '');
        notice('COR filled the stored MyNJ login and is signing in.');
        await send({ type: 'COR_NJ_STATUS', status: 'signing_in_to_pbs' });
        document.querySelector('input[name="Login.Submit"], input[type="submit"], button[type="submit"]')?.click();
        return;
      }

      if (usernameInput && !passwordInput && job.credentials?.challengeAnswer) {
        if (/challenge|security question|secret question/i.test(text)) {
          setValue(usernameInput, job.credentials.challengeAnswer);
          notice('COR filled the MyNJ challenge question answer and is continuing.');
          await send({ type: 'COR_NJ_STATUS', status: 'signing_in_to_pbs' });
          document.querySelector('input[type="submit"], button[type="submit"]')?.click();
          return;
        }
      }

      const taxLink = [...document.querySelectorAll('a')].find((link) =>
        /Tax & Revenue Center/i.test(link.textContent || '') ||
        /TYTR_ACE_App\/servlet\/common\/portalRequest/i.test(link.href || '')
      );
      if (taxLink) {
        notice('COR is opening Tax & Revenue Center.');
        await send({ type: 'COR_NJ_STATUS', status: 'opening_tax_revenue_center' });
        taxLink.click();
        return;
      }

      const loginLink = document.querySelector('a[href*="my.nj.gov/aui/Login"]');
      if (loginLink) {
        notice('COR is opening the MyNJ login.');
        await send({ type: 'COR_NJ_STATUS', status: 'opening_mynj_login' });
        loginLink.click();
        return;
      }

      const incentiveBtn = document.querySelector('input[name="Submit"][value="Business Incentive Tax Clearance"]');
      if (incentiveBtn) {
        notice('COR selected Business Incentive Tax Clearance. Complete New Jersey verification if it appears.');
        await send({ type: 'COR_NJ_STATUS', status: 'waiting_for_human_verification' });
        incentiveBtn.click();
        return;
      }

      const departmentSelect = document.querySelector('select[name="ClearanceDept"]');
      const downloadBtn = document.querySelector('input[name="Submit"][value="Download Clearance Letter"]');
      if (departmentSelect && downloadBtn?.form) {
        const option = [...departmentSelect.options].find((item) => /New Jersey Department of Community Affairs/i.test(item.textContent || ''));
        if (option) setValue(departmentSelect, option.value);
        notice('COR is retrieving the tax-clearance PDF and adding it to the applicant file.');
        await send({ type: 'COR_NJ_STATUS', status: 'requesting_tax_clearance_pdf' });
        sent = true;

        try {
          const form = downloadBtn.form;
          const formData = new FormData(form);
          formData.set(downloadBtn.name, downloadBtn.value);
          const result = await fetch(form.action || location.href, {
            method: (form.method || 'POST').toUpperCase(),
            body: new URLSearchParams([...formData.entries()].map(([k, v]) => [k, String(v)])),
            credentials: 'include'
          });
          const buffer = await result.arrayBuffer();
          const type = result.headers.get('content-type') || '';
          if (!result.ok || !type.toLowerCase().includes('application/pdf') || buffer.byteLength < 100) {
            throw new Error('New Jersey did not return a tax-clearance PDF.');
          }
          await send({ type: 'COR_TAX_PDF', base64: bytesToBase64(buffer), filename: 'NJ-Tax-Clearance.pdf' });
        } catch (error) {
          await send({ type: 'COR_NJ_ERROR', error: error.message });
        }
      }
    }
  }

  async function run() {
    if (running) return;
    running = true;
    try { await runOnce(); } finally { running = false; }
  }

  const pollInterval = setInterval(() => {
    if (sent) { clearInterval(pollInterval); return; }
    run().catch(() => {});
  }, 500);

  run().catch((error) => send({ type: 'COR_NJ_ERROR', error: error.message }));
  new MutationObserver(() => run().catch(() => {})).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', () => run().catch(() => {}));
})();
