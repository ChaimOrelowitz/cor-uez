(() => {
  if (globalThis.__corUezLakewoodGrantJotformLoaded) return;
  globalThis.__corUezLakewoodGrantJotformLoaded = true;

  const FORM_ID = '222748639284165';
  const REQUIRED_UPLOADS = [
    { field: 'q2_application', inputId: 'input_2', documentType: 'ldc_application', label: 'signed LDC application' },
    { field: 'q47_certificateOf', inputId: 'input_47', documentType: 'formation', label: 'Certificate of Formation' },
    { field: 'q52_ueztaxClearance', inputId: 'input_52', documentType: 'tax_clearance', label: 'tax clearance' },
    { field: 'q54_noticeOf', inputId: 'input_54', documentType: 'uez_approval_email', label: 'UEZ approval email' },
    { field: 'q58_businessRegistration', inputId: 'input_58', documentType: 'brc', label: 'BRC' }
  ];

  let running = false;
  let finished = false;
  let detail = null;
  let currentJob = null;
  let lastStatus = '';
  const attachedFields = new Set();

  const send = (message) => chrome.runtime.sendMessage(message).catch(() => null);

  async function notifyStatus(status) {
    if (lastStatus === status) return;
    lastStatus = status;
    await send({ type: 'COR_NJ_STATUS', status });
  }

  function notice(message) {
    let node = document.getElementById('cor-uez-grant-notice');
    if (!node) {
      node = document.createElement('div');
      node.id = 'cor-uez-grant-notice';
      Object.assign(node.style, {
        position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
        background: '#17203a', color: '#fff', padding: '12px 16px',
        borderRadius: '10px', font: '13px system-ui, -apple-system, sans-serif',
        maxWidth: '440px', boxShadow: '0 8px 25px rgba(0,0,0,.3)', border: '1px solid #3b4261'
      });
      (document.body || document.documentElement).appendChild(node);
    }
    node.textContent = message;
  }

  function dispatch(element) {
    ['input', 'change', 'blur'].forEach((type) => element.dispatchEvent(new Event(type, { bubbles: true })));
  }

  function setField(name, value) {
    if (value == null) return false;
    const elements = [...document.getElementsByName(name)];
    if (!elements.length) return false;
    const text = String(value);
    const first = elements[0];

    if (first.type === 'radio') {
      const target = elements.find((element) => String(element.value).toLowerCase() === text.toLowerCase());
      if (!target) return false;
      if (!target.checked) {
        target.click();
        dispatch(target);
      }
      return true;
    }

    if (first.tagName === 'SELECT') {
      const option = [...first.options].find((item) => item.value === text || String(item.textContent || '').trim() === text);
      if (!option) return false;
      first.value = option.value;
      dispatch(first);
      return true;
    }

    const prototype = first instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : first instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : null;
    const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value') : null;
    if (descriptor?.set) descriptor.set.call(first, text);
    else first.value = text;
    dispatch(first);
    return true;
  }

  function formatPhone(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) return String(value || '');
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  function normalizeState(value) {
    const text = String(value || '').trim();
    if (/^(new jersey|nj)$/i.test(text)) return 'NJ';
    return text.length === 2 ? text.toUpperCase() : text;
  }

  function parseBusinessAddress(application) {
    let line1 = String(application.addressLine1 || '').trim();
    let line2 = String(application.addressLine2 || '').trim();
    let city = String(application.city || '').trim();
    let state = normalizeState(application.state || '') || 'NJ';
    let postal = String(application.zip || '').trim();

    const parts = line1.split(',').map((part) => part.trim()).filter(Boolean);
    if ((!city || !postal) && parts.length >= 4 && /^\d{5}(?:-\d{4})?$/.test(parts[parts.length - 1])) {
      postal = postal || parts[parts.length - 1];
      state = normalizeState(parts[parts.length - 2]) || state;
      city = city || parts[parts.length - 3];
      line1 = parts.slice(0, -3).join(', ');
    } else if ((!city || !postal) && parts.length >= 3) {
      const match = parts[parts.length - 1].match(/^(.+?)\s+(\d{5}(?:-\d{4})?)$/);
      if (match) {
        postal = postal || match[2];
        state = normalizeState(match[1]) || state;
        city = city || parts[parts.length - 2];
        line1 = parts.slice(0, -2).join(', ');
      }
    }

    return { line1, line2, city, state, postal };
  }

  function setAddress(prefix, address) {
    setField(`${prefix}[addr_line1]`, address.line1 || '');
    setField(`${prefix}[addr_line2]`, address.line2 || '');
    setField(`${prefix}[city]`, address.city || '');
    setField(`${prefix}[state]`, address.state || 'NJ');
    setField(`${prefix}[postal]`, address.postal || '');
  }

  function visible(element) {
    return Boolean(element && element.offsetParent !== null && !element.disabled);
  }

  function pageOneVisible() {
    const yes = document.getElementById('input_25_0');
    const secondPageBusiness = document.getElementById('input_17');
    return visible(yes) && !visible(secondPageBusiness);
  }

  function fillPageOne(job) {
    const yes = document.getElementById('input_25_0');
    if (!yes) return false;
    if (!yes.checked) {
      yes.click();
      dispatch(yes);
    }

    const next = document.getElementById('form-pagebreak-next_71') || document.querySelector('.form-pagebreak-next');
    if (visible(next)) {
      const key = `corGrantNext:${job.id}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        notice('COR confirmed UEZ certification and is opening the grant application.');
        setTimeout(() => next.click(), 250);
      }
    }
    return true;
  }

  function fillPageTwo(data) {
    const application = data.application || {};
    const contact = data.contact || {};
    const address = parseBusinessAddress(application);

    setField('q17_businessName', application.businessName || '');
    setField('q14_phoneNumber14[full]', formatPhone(application.businessPhone || contact.phone));
    setField('q4_email4', application.businessEmail || contact.email || '');
    setAddress('q64_businessUez', address);
    setField('q3_contactName[first]', contact.firstName || '');
    setField('q3_contactName[last]', contact.lastName || '');
    setField('q21_contactPhone[full]', formatPhone(contact.phone || application.businessPhone));
    setField('q20_contactEmail', contact.email || application.businessEmail || '');
  }

  function extensionAllowed(filename, input) {
    const allowed = String(input?.dataset?.fileAccept || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    if (!allowed.length) return true;
    const ext = String(filename || '').split('.').pop().toLowerCase();
    return allowed.includes(ext);
  }

  function dataUrlToFile(base64, filename, mimeType) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], filename, { type: mimeType || 'application/octet-stream' });
  }

  function newestDocument(documents, documentType, input) {
    const candidates = (documents || [])
      .filter((doc) => doc.documentType === documentType)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return candidates.find((doc) => extensionAllowed(doc.filename, input)) || candidates[0] || null;
  }

  async function attachOne(job, data, spec) {
    if (attachedFields.has(spec.field)) return true;
    const input = document.getElementById(spec.inputId);
    if (!input) return false;

    const doc = newestDocument(data.documents, spec.documentType, input);
    if (!doc) throw new Error(`COR is missing the required ${spec.label}.`);
    if (!extensionAllowed(doc.filename, input)) {
      throw new Error(`${spec.label} is saved as ${doc.filename}, but this Lakewood form does not accept that file type.`);
    }

    const response = await send({ type: 'COR_LAKEWOOD_GET_DOCUMENT', jobId: job.id, documentId: doc.id });
    if (!response?.ok || !response.base64) throw new Error(response?.error || `COR could not load the ${spec.label}.`);

    const transfer = new DataTransfer();
    transfer.items.add(dataUrlToFile(response.base64, response.filename || doc.filename, response.mimeType));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    attachedFields.add(spec.field);
    return true;
  }

  async function attachSupporting(job, data) {
    const input = document.getElementById('input_18');
    if (!input || attachedFields.has('q18_anyAdditional')) return;
    const docs = (data.documents || [])
      .filter((doc) => doc.documentType === 'supporting')
      .filter((doc) => extensionAllowed(doc.filename, input));
    if (!docs.length) {
      attachedFields.add('q18_anyAdditional');
      return;
    }

    const transfer = new DataTransfer();
    for (const doc of docs) {
      const response = await send({ type: 'COR_LAKEWOOD_GET_DOCUMENT', jobId: job.id, documentId: doc.id });
      if (!response?.ok || !response.base64) continue;
      transfer.items.add(dataUrlToFile(response.base64, response.filename || doc.filename, response.mimeType));
    }
    if (transfer.files.length) {
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    attachedFields.add('q18_anyAdditional');
  }

  function uploadComplete(spec) {
    const tempName = `temp_upload[${spec.field}][]`;
    const hidden = [...document.getElementsByName(tempName)].find((element) => String(element.value || '').trim());
    if (hidden) return true;

    const qid = spec.inputId.replace('input_', '');
    const row = document.getElementById(`id_${qid}`);
    return Boolean(row?.querySelector('.qq-upload-success, .qq-upload-complete, .qq-upload-file-selector'));
  }

  function finalSubmitVisible() {
    const submit = document.getElementById('input_1') || document.querySelector('.form-submit-button');
    return visible(submit) ? submit : null;
  }

  function successDetected() {
    const text = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    return /Thank You!\s*Your submission has been received\.?/i.test(text)
      || /your submission has been received/i.test(text);
  }

  async function markSubmitted(job) {
    if (finished) return;
    finished = true;
    notice('Lakewood received the grant application. COR is updating the applicant file…');
    const response = await send({ type: 'COR_LAKEWOOD_SUBMITTED', jobId: job.id, url: location.href });
    if (!response?.ok) {
      finished = false;
      throw new Error(response?.error || 'Lakewood submitted, but COR could not update the applicant status.');
    }
  }

  async function getData(job) {
    const response = await send({ type: 'COR_LAKEWOOD_GET_DATA', jobId: job.id });
    if (!response?.ok || !response.detail) throw new Error(response?.error || 'COR could not load the Lakewood grant application data.');
    return response.detail;
  }

  async function runOnce() {
    const response = await send({ type: 'COR_NJ_GET_JOB' });
    const job = response?.job;
    if (!job || job.workflow !== 'lakewood_portal') return;
    currentJob = job;

    if (successDetected()) {
      await markSubmitted(job);
      return;
    }

    if (!location.href.includes(FORM_ID) && location.hostname !== 'form.jotform.com') return;

    if (pageOneVisible()) {
      await notifyStatus('filling_lakewood_portal');
      fillPageOne(job);
      return;
    }

    if (!detail) detail = await getData(job);
    if (!document.getElementById('input_17')) return;

    await notifyStatus('filling_lakewood_portal');
    fillPageTwo(detail);

    await notifyStatus('attaching_lakewood_documents');
    for (const spec of REQUIRED_UPLOADS) await attachOne(job, detail, spec);
    await attachSupporting(job, detail);

    const completeCount = REQUIRED_UPLOADS.filter(uploadComplete).length;
    const submit = finalSubmitVisible();
    if (submit && completeCount === REQUIRED_UPLOADS.length) {
      await notifyStatus('waiting_for_lakewood_submit');
      notice('COR filled the Lakewood grant form and attached all 5 required documents. Review everything, then click the final Submit Form button.');
    } else {
      notice(`COR is uploading the Lakewood grant packet (${completeCount}/${REQUIRED_UPLOADS.length} required documents finished).`);
    }
  }

  async function run() {
    if (running || finished) return;
    running = true;
    try { await runOnce(); } finally { running = false; }
  }

  const timer = setInterval(() => {
    if (finished) { clearInterval(timer); return; }
    run().catch((error) => send({ type: 'COR_NJ_ERROR', error: error.message || 'The Lakewood grant form helper failed.' }));
  }, 700);

  run().catch((error) => send({ type: 'COR_NJ_ERROR', error: error.message || 'The Lakewood grant form helper failed.' }));
  new MutationObserver(() => run().catch(() => {})).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', () => run().catch(() => {}));
})();
