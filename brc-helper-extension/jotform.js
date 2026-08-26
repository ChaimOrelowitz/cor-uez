(() => {
  if (globalThis.__corUezJotformHelperLoaded) return;
  globalThis.__corUezJotformHelperLoaded = true;

  const FORM_ID = '241936732268060';
  let running = false;
  let finished = false;
  let applicationData = null;
  let lastAdvancedPage = '';
  let lastStatus = '';

  const send = (message) => chrome.runtime.sendMessage(message).catch(() => null);

  const notifyStatus = async (status) => {
    if (lastStatus === status) return;
    lastStatus = status;
    await send({ type: 'COR_NJ_STATUS', status });
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
        maxWidth: '420px', boxShadow: '0 8px 25px rgba(0,0,0,.3)', border: '1px solid #3b4261'
      });
      (document.body || document.documentElement).appendChild(element);
    }
    element.textContent = message;
  };

  const bytesToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  };

  const dispatch = (element) => {
    ['input', 'change', 'blur'].forEach((type) => element.dispatchEvent(new Event(type, { bubbles: true })));
  };

  function setField(name, value) {
    if (value == null) return false;
    const elements = [...document.getElementsByName(name)];
    if (!elements.length) return false;
    const textValue = String(value);
    const first = elements[0];

    if (first.type === 'radio') {
      const target = elements.find((element) => String(element.value).toLowerCase() === textValue.toLowerCase());
      if (!target) return false;
      if (!target.checked) {
        target.checked = true;
        target.click();
        dispatch(target);
      }
      return true;
    }

    if (first.type === 'checkbox') {
      const shouldCheck = ['true', 'yes', '1', String(first.value).toLowerCase()].includes(textValue.toLowerCase());
      if (first.checked !== shouldCheck) {
        first.checked = shouldCheck;
        first.click();
        dispatch(first);
      }
      return true;
    }

    if (first.tagName === 'SELECT') {
      const option = [...first.options].find((item) => item.value === textValue || (item.textContent || '').trim() === textValue);
      if (!option) return false;
      if (first.value !== option.value) {
        first.value = option.value;
        dispatch(first);
      }
      return true;
    }

    if (first.value !== textValue) {
      first.value = textValue;
      dispatch(first);
    }
    return true;
  }

  function setNativeValue(element, value) {
    if (!element) return false;
    const next = String(value ?? '');
    const prototype = element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : null;
    const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value') : null;
    if (descriptor?.set) descriptor.set.call(element, next);
    else element.value = next;
    dispatch(element);
    return true;
  }

  function formatPhone(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) return String(value || '');
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  function formatSsn(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 9);
    if (digits.length !== 9) return String(value || '');
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  }

  function dateParts(value) {
    const text = String(value || '').trim();
    if (!text) return { year: '', month: '', day: '', formatted: '' };

    let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
    if (match) {
      const month = match[2].padStart(2, '0');
      const day = match[3].padStart(2, '0');
      const year = match[1];
      return { year, month, day, formatted: `${month}/${day}/${year}` };
    }

    match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[T\s].*)?$/);
    if (match) {
      const month = match[1].padStart(2, '0');
      const day = match[2].padStart(2, '0');
      const year = match[3];
      return { year, month, day, formatted: `${month}/${day}/${year}` };
    }

    const digits = text.replace(/\D/g, '');
    if (digits.length === 8) {
      const month = digits.slice(0, 2);
      const day = digits.slice(2, 4);
      const year = digits.slice(4);
      return { year, month, day, formatted: `${month}/${day}/${year}` };
    }

    return { year: '', month: '', day: '', formatted: '' };
  }

  function todayParts() {
    const today = new Date();
    return {
      month: String(today.getMonth() + 1).padStart(2, '0'),
      day: String(today.getDate()).padStart(2, '0'),
      year: String(today.getFullYear())
    };
  }

  function normalizeState(value) {
    const text = String(value || '').trim();
    const normalized = text.toLowerCase().replace(/\./g, '');
    if (normalized === 'new jersey' || normalized === 'nj') return 'NJ';
    return text.length === 2 ? text.toUpperCase() : text;
  }

  function parseBusinessAddress(application) {
    let line1 = String(application.address_line1 || '').trim();
    let line2 = String(application.address_line2 || '').trim();
    let city = String(application.city || '').trim();
    let state = normalizeState(application.state || '') || 'NJ';
    let postal = String(application.zip || '').trim();

    const parts = line1.split(',').map((part) => part.trim()).filter(Boolean);
    if ((!city || !postal) && parts.length >= 4 && /^\d{5}(?:-\d{4})?$/.test(parts[parts.length - 1])) {
      postal = postal || parts[parts.length - 1];
      state = normalizeState(parts[parts.length - 2]) || state || 'NJ';
      city = city || parts[parts.length - 3];
      line1 = parts.slice(0, -3).join(', ');
    } else if ((!city || !postal) && parts.length >= 3) {
      const last = parts[parts.length - 1].match(/^(.+?)\s+(\d{5}(?:-\d{4})?)$/);
      if (last) {
        postal = postal || last[2];
        state = normalizeState(last[1]) || state || 'NJ';
        city = city || parts[parts.length - 2];
        line1 = parts.slice(0, -2).join(', ');
      }
    }

    return { line1, line2, city, state: normalizeState(state) || 'NJ', postal };
  }

  function setAddress(prefix, address) {
    setField(`${prefix}[addr_line1]`, address?.addressLine1 || address?.line1 || '');
    setField(`${prefix}[addr_line2]`, address?.addressLine2 || address?.line2 || '');
    setField(`${prefix}[city]`, address?.city || '');
    setField(`${prefix}[state]`, address?.state || 'NJ');
    setField(`${prefix}[postal]`, address?.zip || address?.postal || '');
  }

  function setDate(prefix, parts) {
    setField(`${prefix}[month]`, parts.month || '');
    setField(`${prefix}[day]`, parts.day || '');
    setField(`${prefix}[year]`, parts.year || '');
  }

  function setJotformDate(questionId, prefix, value) {
    const parts = dateParts(value);
    if (!parts.formatted) return false;

    setField(`${prefix}[month]`, parts.month);
    setField(`${prefix}[day]`, parts.day);
    setField(`${prefix}[year]`, parts.year);

    const combinedCandidates = [
      document.getElementsByName(prefix)[0],
      document.getElementById(`input_${questionId}`),
      document.getElementById(`lite_mode_${questionId}`)
    ].filter(Boolean);
    combinedCandidates.forEach((element) => setNativeValue(element, parts.formatted));

    setNativeValue(document.getElementById(`month_${questionId}`), parts.month);
    setNativeValue(document.getElementById(`day_${questionId}`), parts.day);
    setNativeValue(document.getElementById(`year_${questionId}`), parts.year);

    return true;
  }

  function fillApplication(detail) {
    const application = detail.application || {};
    const owners = detail.owners || [];
    const primary = owners[0] || {};
    const secondary = owners[1] || null;
    const legalName = application.registered_business_name || application.brc_registered_name || application.business_name_input || '';
    const businessPhone = formatPhone(primary.phone || application.contact_phone || '');
    const businessAddress = parseBusinessAddress(application);
    const ownerCount = owners.length;
    const primaryTitle = primary.positionTitle || (ownerCount > 1 ? 'Partner' : 'Owner');

    setField('q3_companyName', legalName);
    setField('q82_doesThe', application.has_dba ? 'Yes' : 'No');
    if (application.has_dba) setField('q4_doingBusiness', application.dba_name || '');
    setAddress('q83_businessAddress83', businessAddress);
    setField('q6_ein', String(application.ein || '').replace(/\D/g, '').slice(0, 9));
    setField('q8_businessPhone[full]', businessPhone);
    setField('q74_email', application.contact_email || primary.email || '');

    if (application.program_code === 'lakewood_technology_grant') setField('q12_incentiveProgram12', '1');
    setField('q81_totalGrant81', application.grant_amount_requested ?? 5000);

    setField('q90_applicantName90[first]', primary.firstName || '');
    setField('q90_applicantName90[last]', primary.lastName || '');
    setField('q23_applicantPositiontitle', primaryTitle);
    setAddress('q68_applicantHome', primary);
    setField('q29_applicantPhone[full]', formatPhone(primary.phone));
    setField('q71_cell71[full]', formatPhone(primary.phone));
    setField('q35_applicantSsn', formatSsn(primary.ssn));
    setJotformDate(84, 'q84_applicantDob', primary.dob);
    setField('q72_applicantPercentage', primary.ownershipPercent ?? '');

    if (secondary) {
      const secondaryTitle = secondary.positionTitle || 'Partner';
      setField('q91_coapplicantName[first]', secondary.firstName || '');
      setField('q91_coapplicantName[last]', secondary.lastName || '');
      setField('q24_positionTitle24', secondaryTitle);
      setAddress('q69_address80', secondary);
      setField('q32_phone32[full]', formatPhone(secondary.phone));
      setField('q70_cell70[full]', formatPhone(secondary.phone));
      setField('q37_dob37', formatSsn(secondary.ssn));
      setJotformDate(85, 'q85_coapplicantDob', secondary.dob);
      setField('q73_coapplicantPercentage', secondary.ownershipPercent ?? '');
    }

    const ownershipTotal = owners.reduce((sum, owner) => sum + Number(owner.ownershipPercent || 0), 0);
    setField('q86_totalPercentage', ownershipTotal || 100);
  }

  function visiblePage() {
    const pages = [...document.querySelectorAll('.form-section.page-section, .form-section')];
    return pages.find((page) => page.offsetParent !== null) || null;
  }

  function signaturePageVisible() {
    const page = visiblePage();
    if (!page) return /SIGNATURES/i.test(document.body?.innerText || '');
    return /SIGNATURES/i.test(page.innerText || '');
  }

  function fillSignatureDates(detail) {
    const owners = detail.owners || [];
    const today = todayParts();
    setDate('q58_applicantSignature58', today);
    if (owners.length > 1) setDate('q60_date60', today);
  }

  function signaturePresent(name) {
    const element = document.getElementsByName(name)[0];
    return Boolean(element && String(element.value || '').startsWith('data:image/'));
  }

  function visibleNextButton() {
    const page = visiblePage();
    const candidates = page
      ? [...page.querySelectorAll('.form-pagebreak-next, button.form-pagebreak-next, input.form-pagebreak-next')]
      : [...document.querySelectorAll('.form-pagebreak-next, button.form-pagebreak-next, input.form-pagebreak-next')];
    return candidates.find((button) => button.offsetParent !== null && !button.disabled) || null;
  }

  function visibleControlByText(labels) {
    const wanted = labels.map((label) => label.toLowerCase());
    const candidates = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]')];
    return candidates.find((element) => {
      if (element.disabled || element.offsetParent === null) return false;
      const text = String(element.value || element.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return wanted.some((label) => text === label || text.includes(label));
    }) || null;
  }

  async function clickStartFillingIfPresent(job) {
    const button = visibleControlByText(['Start Filling']);
    if (!button) return false;
    const key = `corLdcStartFilling:${job.id}:${location.href}`;
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      notice('COR filled the application data. Opening the JotForm Sign fields…');
      await notifyStatus('starting_ldc_sign');
      setTimeout(() => button.click(), 150);
    }
    return true;
  }

  async function getApplicationData(job) {
    const response = await send({ type: 'COR_JOTFORM_GET_DATA', jobId: job.id });
    if (!response?.ok || !response.detail) throw new Error(response?.error || 'COR could not load this UEZ application.');
    return response.detail;
  }

  function extractThankYouValues() {
    const html = document.documentElement?.innerHTML || '';
    const sid = html.match(/\bpdfSID\s*=\s*['"](\d+)['"]/i)?.[1]
      || html.match(/submissionID\s*[:=]\s*['"](\d+)['"]/i)?.[1];
    const formId = html.match(/\bformID\s*=\s*['"](\d+)['"]/i)?.[1] || FORM_ID;
    const token = html.match(/\bdownloadToken\s*=\s*['"]([^'"]+)['"]/i)?.[1];
    return { sid, formId, token };
  }

  function filenameFromDisposition(value) {
    const match = String(value || '').match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i);
    const raw = match?.[1] || match?.[2] || match?.[3] || '';
    try { return decodeURIComponent(raw.trim()); } catch (_) { return raw.trim(); }
  }

  async function captureCompletedPdf(job) {
    if (finished) return;
    const values = extractThankYouValues();
    if (!values.sid || !values.token || !values.formId) {
      notice('COR is waiting for JotForm to finish creating the signed submission.');
      return;
    }

    finished = true;
    await notifyStatus('downloading_ldc_pdf');
    notice('JotForm submitted successfully. COR is downloading the signed application PDF…');

    const url = `${location.origin}/API/pdf-converter/${encodeURIComponent(values.formId)}/fill-pdf?type=PDFv2&submissionID=${encodeURIComponent(values.sid)}&downloadToken=${encodeURIComponent(values.token)}`;
    try {
      const response = await fetch(url, { credentials: 'include' });
      const buffer = await response.arrayBuffer();
      const type = response.headers.get('content-type') || '';
      if (!response.ok || !type.toLowerCase().includes('application/pdf') || buffer.byteLength < 100) {
        throw new Error('JotForm did not return the completed PDF.');
      }
      const filename = filenameFromDisposition(response.headers.get('content-disposition'))
        || `Lakewood-LDC-Incentive-Application-${values.sid}.pdf`;
      await send({
        type: 'COR_LDC_PDF',
        jobId: job.id,
        submissionId: values.sid,
        base64: bytesToBase64(buffer),
        filename
      });
      notice('Signed LDC application saved to COR. This window will close automatically.');
    } catch (error) {
      finished = false;
      await send({ type: 'COR_NJ_ERROR', error: error.message || 'Could not save the completed JotForm PDF.' });
    }
  }

  async function runOnce() {
    const response = await send({ type: 'COR_NJ_GET_JOB' });
    const job = response?.job;
    if (!job || job.workflow !== 'ldc_jotform') return;

    const host = location.hostname.toLowerCase();

    if (await clickStartFillingIfPresent(job)) return;

    if (host === 'submit.jotform.com') {
      await captureCompletedPdf(job);
      return;
    }

    if (host !== 'form.jotform.com') return;
    if (!applicationData) applicationData = await getApplicationData(job);

    fillApplication(applicationData);
    await notifyStatus('filling_ldc_form');

    if (signaturePageVisible()) {
      fillSignatureDates(applicationData);
      const applicantSigned = signaturePresent('q56_applicantSignature');
      const coApplicantNeeded = (applicationData.owners || []).length > 1;
      const coApplicantSigned = !coApplicantNeeded || signaturePresent('q57_coapplicantSignature');

      if (applicantSigned && coApplicantSigned) {
        const previewKey = `corLdcPreview:${job.id}`;
        const page = visiblePage();
        const previewButton = [...(page || document).querySelectorAll('button[type="submit"], input[type="submit"], .form-submit-button')].find((button) => button.offsetParent !== null && !button.disabled);
        if (previewButton && !sessionStorage.getItem(previewKey)) {
          sessionStorage.setItem(previewKey, '1');
          notice('Signatures complete. COR is generating the JotForm PDF preview…');
          await notifyStatus('generating_ldc_preview');
          setTimeout(() => previewButton.click(), 250);
          return;
        }
        notice('Review the generated application PDF and click the final Submit button when ready.');
        await notifyStatus('waiting_for_final_submit');
      } else {
        notice(coApplicantNeeded
          ? 'COR filled the application. Please review it and add the Applicant and Co-Applicant signatures.'
          : 'COR filled the application. Please review it and add the Applicant signature.');
        await notifyStatus('waiting_for_signature');
      }
      return;
    }

    const page = visiblePage();
    const nextButton = visibleNextButton();
    if (nextButton) {
      const pageKey = page?.id || page?.dataset?.page || String(nextButton.id || nextButton.name || 'page');
      if (pageKey !== lastAdvancedPage) {
        lastAdvancedPage = pageKey;
        notice('COR is filling the Lakewood LDC application…');
        setTimeout(() => nextButton.click(), 250);
      }
      return;
    }

    notice('COR is filling the Lakewood LDC application. If JotForm shows a validation message, review the highlighted field.');
  }

  async function run() {
    if (running) return;
    running = true;
    try { await runOnce(); } finally { running = false; }
  }

  const interval = setInterval(() => {
    if (finished) { clearInterval(interval); return; }
    run().catch((error) => send({ type: 'COR_NJ_ERROR', error: error.message }));
  }, 500);

  run().catch((error) => send({ type: 'COR_NJ_ERROR', error: error.message }));
  new MutationObserver(() => run().catch(() => {})).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', () => run().catch(() => {}));
})();