// Workflow: uez_enrollment — the NJ UEZ Certification Application, a 5-6
// page Oracle APEX wizard at portal03.nj.gov (app id 405). Unlike every
// other workflow in this extension, this one never auto-clicks Next/Save/
// Submit: several fields on this form (NAICS/SIC code, minority/women-owned,
// business type, established date, mailing address, the final legal
// certifications) aren't collected anywhere in COR's own data today, so an
// admin has to fill those in by hand on every page regardless. This script
// only pre-fills the fields it *does* have real data for, on whichever page
// is currently showing, and leaves clicking Next/Save entirely to the admin.
// A floating "Capture" button — shown on every page — lets the admin decide
// exactly when the on-screen page is the finished/pending certificate worth
// saving to the case file; there's no attempt to auto-detect that page.
(() => {
  if (globalThis.__corUezApplicationHelperLoaded) return;
  globalThis.__corUezApplicationHelperLoaded = true;
  let running = false;
  let announced = false;
  let uezData = null;

  const send = (message) => chrome.runtime.sendMessage(message).catch(() => null);

  const setValue = (input, value) => {
    if (!input || value === '' || value == null) return false;
    if (String(input.value || '').trim() === String(value).trim()) return false;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  };

  // Best-effort: only fills an EMPTY field (never overwrites something the
  // portal or the admin already put there), and tries text input, select,
  // then radio/checkbox group, in that order, since the real element type
  // for each P<n>_* item isn't known ahead of a live trial run.
  const fillField = (name, value) => {
    if (value === '' || value == null) return false;
    const textEl = document.querySelector(`input[name="${name}"]:not([type="radio"]):not([type="checkbox"]), textarea[name="${name}"]`);
    if (textEl) return setValue(textEl, value);
    const selectEl = document.querySelector(`select[name="${name}"]`);
    if (selectEl && !selectEl.value) {
      const option = [...selectEl.options].find((o) => o.value === String(value) || o.textContent.trim().toUpperCase() === String(value).toUpperCase());
      if (option) { selectEl.value = option.value; selectEl.dispatchEvent(new Event('change', { bubbles: true })); return true; }
      return false;
    }
    const radio = document.querySelector(`input[type="radio"][name="${name}"][value="${value}"]`);
    if (radio && !radio.checked) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); return true; }
    return false;
  };

  const pageText = () => String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();

  const notice = (message, filledCount) => {
    let panel = document.getElementById('cor-uez-app-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'cor-uez-app-panel';
      Object.assign(panel.style, {
        position: 'fixed', bottom: '10px', left: '10px', zIndex: '2147483647',
        background: '#17203a', color: 'white', padding: '10px 12px',
        borderRadius: '10px', font: '12px system-ui, -apple-system, sans-serif',
        maxWidth: '320px', boxShadow: '0 5px 16px rgba(0,0,0,.25)', border: '1px solid #3b4261',
        display: 'flex', flexDirection: 'column', gap: '8px'
      });
      const text = document.createElement('div');
      text.id = 'cor-uez-app-panel-text';
      panel.appendChild(text);
      const button = document.createElement('button');
      button.id = 'cor-uez-app-capture-btn';
      button.textContent = '📸 Capture this page as the pending certificate';
      Object.assign(button.style, {
        background: '#4f9d69', color: 'white', border: '0', borderRadius: '7px',
        padding: '8px 10px', font: '12px system-ui, -apple-system, sans-serif',
        fontWeight: '700', cursor: 'pointer'
      });
      button.addEventListener('click', onCapture);
      panel.appendChild(button);
      (document.body || document.documentElement).appendChild(panel);
    }
    const text = document.getElementById('cor-uez-app-panel-text');
    if (text) text.textContent = filledCount ? `${message} (pre-filled ${filledCount} field${filledCount === 1 ? '' : 's'} — review before continuing.)` : message;
  };

  async function onCapture() {
    const button = document.getElementById('cor-uez-app-capture-btn');
    if (button) { button.disabled = true; button.textContent = 'Capturing…'; }
    try {
      const submittedMatch = pageText().match(/(?:Submitted\s*ID|Confirmation)\s*:?\s*([A-Za-z0-9-]+)/i);
      const panel = document.getElementById('cor-uez-app-panel');
      if (panel) panel.style.display = 'none';
      await new Promise((resolve) => setTimeout(resolve, 150));
      const result = await send({ type: 'COR_UEZ_APP_CAPTURE_REQUEST', submittedId: submittedMatch ? submittedMatch[1] : '' });
      if (panel) panel.style.display = '';
      if (!result?.ok) throw new Error(result?.error || 'COR could not capture this page.');
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = '📸 Capture this page as the pending certificate'; }
      notice(`Capture failed: ${error.message}. You can try again.`, 0);
    }
  }

  // ---- Page recorder -------------------------------------------------------
  // Saves each page's form structure (names, types, labels, choices - never
  // what was typed) to the case once per page, so the prefill can be mapped
  // to the real NJ field names instead of guessed ones.
  const labelFor = (el) => {
    const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (byFor) return byFor.innerText.trim();
    const wrapped = el.closest('label');
    if (wrapped) return wrapped.innerText.trim();
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ').trim();
      if (text) return text;
    }
    // APEX often puts the label in the previous table cell / sibling container
    const container = el.closest('.t-Form-fieldContainer, .t-Form-inputContainer, td, tr, div');
    const label = container?.querySelector('label, .t-Form-label');
    return label ? label.innerText.trim() : '';
  };

  function recordPage() {
    const pageMatch = location.href.match(/[?&]p=\d+:(\d+)/) || location.href.match(/:(\d+):/);
    const page = pageMatch ? pageMatch[1] : (document.querySelector('input[name="p_flow_step_id"]')?.value || 'unknown');
    const seen = new Set();
    const fields = [];
    document.querySelectorAll('input, select, textarea').forEach((el) => {
      const type = (el.getAttribute('type') || el.tagName).toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'reset', 'password'].includes(type)) return;
      const name = el.name || el.id || '';
      if (!name) return;
      const key = `${name}|${type === 'radio' || type === 'checkbox' ? el.value : ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      const entry = { name, id: el.id || '', tag: el.tagName.toLowerCase(), type, label: labelFor(el).slice(0, 200), required: el.required || el.getAttribute('aria-required') === 'true', prefilled: type === 'radio' || type === 'checkbox' ? el.checked : Boolean(String(el.value || '').trim()) };
      if (type === 'radio' || type === 'checkbox') entry.value = el.value;
      if (el.tagName === 'SELECT') entry.options = [...el.options].slice(0, 80).map((o) => ({ value: o.value, text: o.textContent.trim().slice(0, 120) }));
      fields.push(entry);
    });
    if (!fields.length) return;
    const marker = `cor-uez-recorded-${page}-${fields.length}`;
    try { if (sessionStorage.getItem(marker)) return; sessionStorage.setItem(marker, '1'); } catch { /* ignore */ }
    const headings = [...document.querySelectorAll('h1, h2, h3, .t-Region-title')].map((h) => h.innerText.trim()).filter(Boolean).slice(0, 20);
    send({ type: 'COR_UEZ_APP_RECORD', recording: { page, url: location.href, title: document.title, headings, fields } });
  }

  // Answers a yes/no question found by its label text (radio group or select),
  // only if it hasn't been answered yet. Used for "minority-owned".
  function answerYesByLabel(pattern) {
    const radios = [...document.querySelectorAll('input[type="radio"]')];
    const groups = new Map();
    radios.forEach((r) => { if (!groups.has(r.name)) groups.set(r.name, []); groups.get(r.name).push(r); });
    for (const group of groups.values()) {
      const question = group[0].closest('fieldset, .t-Form-fieldContainer, tr, div')?.innerText || '';
      if (!pattern.test(question) || /women/i.test(labelFor(group[0]) || '')) continue;
      if (group.some((r) => r.checked)) return false;
      const yes = group.find((r) => /^(y|yes)$/i.test(r.value) || /^yes$/i.test(labelFor(r)));
      if (yes) { yes.checked = true; yes.dispatchEvent(new Event('change', { bubbles: true })); yes.dispatchEvent(new Event('click', { bubbles: true })); return true; }
    }
    for (const select of document.querySelectorAll('select')) {
      if (!pattern.test(labelFor(select)) || select.value) continue;
      const yes = [...select.options].find((o) => /^(y|yes)$/i.test(o.value) || /^yes$/i.test(o.textContent.trim()));
      if (yes) { select.value = yes.value; select.dispatchEvent(new Event('change', { bubbles: true })); return true; }
    }
    return false;
  }

  // Shows what the client said the business does, with lookups, so the NAICS
  // and SIC codes can be picked (or the SIC found from an existing NAICS).
  function industryHelper(description) {
    let box = document.getElementById('cor-uez-industry');
    if (!box) {
      const panel = document.getElementById('cor-uez-app-panel');
      if (!panel) return;
      box = document.createElement('div');
      box.id = 'cor-uez-industry';
      Object.assign(box.style, { background: '#24304f', borderRadius: '8px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' });
      panel.insertBefore(box, panel.lastChild);
    }
    const naicsInput = [...document.querySelectorAll('input, select')].find((el) => /naics/i.test(el.name || '') || /naics/i.test(labelFor(el)));
    const naics = String(naicsInput?.value || '').trim();
    const link = (href, text) => `<a href="${href}" target="_blank" rel="noreferrer" style="color:#9cc3ff">${text}</a>`;
    const desc = description ? description.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch])) : '<i>No description on file.</i>';
    const query = encodeURIComponent(description || '');
    // The page loop runs every 800ms - only redraw when something changed,
    // so a link isn't replaced under your click.
    const stateKey = `${naics}|${description}`;
    if (box.dataset.state === stateKey) return;
    box.dataset.state = stateKey;
    box.innerHTML = `
      <div style="font-weight:700">What the business does</div>
      <div style="max-height:90px;overflow:auto;line-height:1.35">${desc}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${naics
          ? link(`https://www.google.com/search?q=${encodeURIComponent(`NAICS ${naics} equivalent SIC code`)}`, `SIC for NAICS ${naics} ↗`)
          : `${link(`https://www.census.gov/naics/?input=${query}&year=2022`, 'Find NAICS ↗')} ${link(`https://www.google.com/search?q=${encodeURIComponent(`SIC code for ${description || ''}`)}`, 'Find SIC ↗')}`}
      </div>`;
  }

  async function ensureData(jobId) {
    if (uezData) return uezData;
    const response = await send({ type: 'COR_UEZ_APP_GET_DATA', jobId });
    if (!response?.ok) throw new Error(response?.error || 'COR could not load this application\'s data.');
    uezData = response.data;
    return uezData;
  }

  async function runOnce() {
    const response = await send({ type: 'COR_NJ_GET_JOB' });
    const job = response?.job;
    if (!job || job.workflow !== 'uez_enrollment') return;

    if (!announced) {
      announced = true;
      await send({ type: 'COR_NJ_STATUS', status: 'nj_page_open' });
    }

    // Record this page's fields once (for mapping the real NJ form).
    try { recordPage(); } catch { /* recording is best-effort */ }

    let data;
    try {
      data = await ensureData(job.id);
    } catch (error) {
      notice(`COR could not load this case's data: ${error.message}`, 0);
      return;
    }
    const { business: b, contact: c } = data;

    // Page 100 — terms agreement. Left unchecked deliberately: agreeing to
    // NJ's terms is the admin's call, not something to tick automatically.
    if (document.querySelector('input[name="P100_AGREE"]')) {
      notice('NJ UEZ Certification Application — review the agreement and check the box yourself, then click Next.', 0);
      return;
    }

    // Page 10 — Tax ID + ZIP lookup (checks whether a business record already exists).
    if (document.querySelector('input[name="P10_TAXID_SINGLE"]')) {
      let filled = 0;
      if (fillField('P10_TAXID_SINGLE', b.taxIdFull)) filled++;
      if (fillField('P10_ZIP', b.zip)) filled++;
      notice('NJ UEZ Certification Application — Tax ID lookup.', filled);
      return;
    }

    // Page 11 — address/parcel confirmation. Block/Lot/PAMS PIN/coordinates
    // come from NJ's own map widget as you confirm the pin location, not
    // from COR's data, so those are deliberately left alone here.
    if (document.querySelector('input[name="P11_ADDRESS_LINE_TEXT"]')) {
      let filled = 0;
      if (fillField('P11_CORP_NAME', b.corpName)) filled++;
      if (fillField('P11_ADDRESS_LINE_TEXT', b.addressLine1)) filled++;
      if (fillField('P11_CITY_NAME', b.city)) filled++;
      if (fillField('P11_ZIP_CODE', b.zip)) filled++;
      notice('NJ UEZ Certification Application — confirm the address on the map, then click Next.', filled);
      return;
    }

    // Page 2 — the big business/contact/owner page. Everything not filled
    // here (NAICS/SIC, minority/women-owned, business type, established
    // date, business start date, mailing address if different) isn't
    // collected in COR's data yet and needs the admin's own input.
    if (document.querySelector('input[name="P2_BUS_ADRS"]')) {
      let filled = 0;
      const fields = {
        P2_NJ_TAX_ID: b.taxIdFormatted, P2_CORP_NAME: b.corpName, P2_BUS_NAME: b.busName,
        P2_BUS_ADRS: b.addressLine1, P2_UNIT_NUM: b.addressLine2, P2_BUS_CITY: b.city,
        P2_BUS_STATE: b.state, P2_BUS_ZIP: b.zip,
        P2_CNTCT_SLTTN_TEXT: c.salutation, P2_CNTCT_FRST_NAME: c.firstName, P2_CNTCT_LAST_NAME: c.lastName,
        P2_PHONE: c.phone, P2_EMAIL: c.email, P2_VERIFY_EMAIL: c.email,
      };
      for (const [name, value] of Object.entries(fields)) { if (fillField(name, value)) filled++; }
      // COR's applicants are minority-owned; women-owned stays manual.
      if (answerYesByLabel(/minority/i)) filled++;
      notice('NJ UEZ Certification Application — business & contact details. Pick NAICS/SIC (description below) and women-owned yourself, then Save.', filled);
      industryHelper(b.description);
      return;
    }

    // Page 3 — employees & revenue. Actual counts come from COR's data;
    // projected counts, projected revenue, and the three yes/no questions
    // aren't something COR can answer, so they're left blank.
    if (document.querySelector('input[name="P3_FULL_TIME_ACTL_NUM"]')) {
      let filled = 0;
      if (fillField('P3_FULL_TIME_ACTL_NUM', b.fullTimeEmployees)) filled++;
      if (fillField('P3_PART_TIME_ACTL_NUM', b.partTimeEmployees)) filled++;
      notice('NJ UEZ Certification Application — employees & revenue. Fill in the projected figures and the three questions yourself, then Save.', filled);
      return;
    }

    // Page 4 — final consent/certification checkboxes. These are the
    // applicant's own legal certifications and are deliberately left
    // unchecked — only the PBS contact email is pre-filled.
    if (document.querySelector('input[name="P4_CERTIFY_TRUE_FLG"]')) {
      let filled = 0;
      if (fillField('P4_PBS_EMAIL', c.email || b.email)) filled++;
      notice('NJ UEZ Certification Application — review and check the certification boxes yourself, then Save to submit.', filled);
      return;
    }

    // Any other page (including whatever the final confirmation/pending
    // certificate page turns out to be) — just keep the capture button
    // available; the admin decides when it's the right page to save.
    notice('COR is standing by. When this page shows your finished/pending certificate, click Capture below.', 0);
  }

  async function run() {
    if (running) return;
    running = true;
    try { await runOnce(); } finally { running = false; }
  }

  const pollInterval = setInterval(() => run().catch(() => {}), 800);
  run().catch((error) => send({ type: 'COR_NJ_ERROR', error: error.message }));
  window.addEventListener('beforeunload', () => clearInterval(pollInterval));
  window.addEventListener('load', () => run().catch(() => {}));
})();
