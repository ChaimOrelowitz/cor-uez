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

  async function ensureData() {
    if (uezData) return uezData;
    const response = await send({ type: 'COR_UEZ_APP_GET_DATA' });
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

    let data;
    try {
      data = await ensureData();
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
      notice('NJ UEZ Certification Application — business & contact details. Fill in NAICS/SIC, minority/women-owned, business type, and start date yourself, then Save.', filled);
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
