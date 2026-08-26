function setNativeSelectValue(select, value) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (descriptor?.set) descriptor.set.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function fieldByLabel(prefix) {
  const labels = [...document.querySelectorAll('label')];
  const label = labels.find((item) => item.textContent.trim().startsWith(prefix));
  if (!label) return null;
  const container = label.parentElement;
  return container?.querySelector('input, select, textarea') || label.nextElementSibling;
}

function limitDigits(input, maxDigits, formatter = null) {
  if (!input || input.dataset.corLimited === String(maxDigits)) return;
  input.dataset.corLimited = String(maxDigits);
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.addEventListener('input', () => {
    const digits = String(input.value || '').replace(/\D/g, '').slice(0, maxDigits);
    input.value = formatter ? formatter(digits) : digits;
  }, true);
}

function makeInlineRadios(questionPrefix) {
  const select = fieldByLabel(questionPrefix);
  if (!(select instanceof HTMLSelectElement)) return;
  const parent = select.parentElement;
  if (!parent || parent.querySelector('.cor-inline-radios')) return;

  select.classList.add('cor-hidden-select');
  const group = document.createElement('div');
  group.className = 'cor-inline-radios';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', questionPrefix);

  for (const [value, text] of [['yes', 'Yes'], ['no', 'No']]) {
    const label = document.createElement('label');
    label.className = 'cor-radio-option';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `cor-${questionPrefix.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    radio.value = value;
    radio.checked = select.value === value;
    radio.addEventListener('change', () => {
      if (radio.checked) setNativeSelectValue(select, value);
    });
    const span = document.createElement('span');
    span.textContent = text;
    label.append(radio, span);
    group.appendChild(label);
  }

  select.addEventListener('change', () => {
    group.querySelectorAll('input[type="radio"]').forEach((radio) => {
      radio.checked = radio.value === select.value;
    });
  });

  select.insertAdjacentElement('afterend', group);
}

function ensureUtilityLinks() {
  const adminActions = document.querySelector('.admin-top-actions');
  if (adminActions && !adminActions.querySelector('a[href="/admin/email-settings"]')) {
    const link = document.createElement('a');
    link.href = '/admin/email-settings';
    link.className = 'cor-email-settings-link';
    link.textContent = 'Email settings';
    adminActions.prepend(link);
  }

  const loginCard = document.querySelector('.login-card');
  if (loginCard && window.location.pathname === '/' && !loginCard.querySelector('a[href="/forgot-password"]')) {
    const submit = loginCard.querySelector('.login-submit');
    if (submit) {
      const link = document.createElement('a');
      link.href = '/forgot-password';
      link.className = 'forgot-password-link';
      link.textContent = 'Forgot password?';
      submit.insertAdjacentElement('afterend', link);
    }
  }
}

function applyIntakePolish() {
  const ein = fieldByLabel('EIN');
  if (ein instanceof HTMLInputElement) {
    ein.maxLength = 10;
    limitDigits(ein, 9, (digits) => digits.length > 2 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits);
  }

  const year = fieldByLabel('Year founded');
  if (year instanceof HTMLInputElement) {
    year.maxLength = 4;
    limitDigits(year, 4);
  }

  for (const label of ['Full-time employees', 'Part-time employees']) {
    const input = fieldByLabel(label);
    if (input instanceof HTMLInputElement) {
      input.type = 'text';
      input.placeholder = '';
      input.maxLength = 3;
      limitDigits(input, 3);
    }
  }

  makeInlineRadios('Is this business a sole proprietorship?');
  makeInlineRadios('Does the business have a DBA?');
  ensureUtilityLinks();
}

let queued = false;
function queuePolish() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    applyIntakePolish();
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', queuePolish);
else queuePolish();

new MutationObserver(queuePolish).observe(document.documentElement, { childList: true, subtree: true });
