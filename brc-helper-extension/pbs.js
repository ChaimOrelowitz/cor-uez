(() => {
  if (globalThis.__corUezPbsHelperLoaded) return;
  globalThis.__corUezPbsHelperLoaded = true;

  let running = false;
  let cachedData = null;
  let lastStatus = '';

  const send = (message) => chrome.runtime.sendMessage(message).catch(() => null);

  const setValue = (input, value) => {
    if (!input) return;
    input.value = value == null ? '' : String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  };

  const pageText = () => String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();

  const notice = (message) => {
    let element = document.getElementById('cor-uez-pbs-notice');
    if (!element) {
      element = document.createElement('div');
      element.id = 'cor-uez-pbs-notice';
      Object.assign(element.style, {
        position: 'fixed', bottom: '12px', left: '12px', zIndex: '2147483647',
        background: '#17203a', color: '#fff', padding: '10px 12px', borderRadius: '9px',
        font: '600 12px/1.4 system-ui, -apple-system, sans-serif', maxWidth: '360px',
        boxShadow: '0 6px 20px rgba(0,0,0,.25)', border: '1px solid #3b4261',
        pointerEvents: 'none', opacity: '.94'
      });
      (document.body || document.documentElement).appendChild(element);
    }
    element.textContent = message;
  };

  const status = async (value) => {
    if (!value || value === lastStatus) return;
    lastStatus = value;
    await send({ type: 'COR_NJ_STATUS', status: value });
  };

  const submitForm = (form, action, actionToPerform) => {
    if (!form) return false;
    if (action) form.action = action;
    const hidden = form.querySelector('input[name="actionToPerform"]');
    if (hidden && actionToPerform != null) hidden.value = actionToPerform;
    HTMLFormElement.prototype.submit.call(form);
    return true;
  };

  async function getData(jobId) {
    if (cachedData) return cachedData;
    const response = await send({ type: 'COR_PBS_GET_DATA', jobId });
    if (!response?.ok || !response.data) throw new Error(response?.error || 'COR could not load the PBS applicant data.');
    cachedData = response.data;
    return cachedData;
  }

  function once(key) {
    const storageKey = `corPbs:${key}`;
    if (sessionStorage.getItem(storageKey)) return false;
    sessionStorage.setItem(storageKey, '1');
    return true;
  }

  function splitPhone(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(-10);
    return digits.length === 10 ? [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)] : ['', '', ''];
  }

  async function runOnce() {
    const jobResponse = await send({ type: 'COR_NJ_GET_JOB' });
    const job = jobResponse?.job;
    if (!job || job.workflow !== 'pbs_signup') return;

    const text = pageText();
    const data = await getData(job.id);

    if (/access denied|request unsuccessful|security verification|captcha/i.test(text) && !document.querySelector('input[name="repsTitle"], #newUid, #EINNo')) {
      notice('COR needs you: complete New Jersey’s security verification, then the helper will continue.');
      await status('waiting_for_pbs_verification');
      return;
    }

    // HAR Step 1: PBS landing page -> Get Started.
    const confirmLink = [...document.querySelectorAll('a')].find((link) => /confirmUser/i.test(link.getAttribute('href') || '') || /Get Started/i.test(link.textContent || '') && /confirmUser/i.test(String(link.href || '')));
    const welcomeForm = document.forms.taskDelegationForm;
    if (welcomeForm && confirmLink && !document.querySelector('input[name="repsTitle"]')) {
      notice('COR is starting the PBS account setup.');
      await status('pbs_opening_identification');
      if (once(`welcome:${job.id}`)) submitForm(welcomeForm, '/NJ_PREMIER_EBIZ/OEGController', 'confirmUser');
      return;
    }

    // HAR Step 2: "Let's Get Your Information".
    const titleInput = document.querySelector('input[name="repsTitle"]');
    const firstNameInput = document.querySelector('input[name="firstName"]');
    const email2Input = document.querySelector('input[name="email2"]');
    if (titleInput && firstNameInput && email2Input) {
      const owner = data.owner;
      const [phone1, phone2, phone3] = splitPhone(owner.phone);
      setValue(titleInput, owner.title);
      setValue(firstNameInput, owner.firstName);
      setValue(document.querySelector('input[name="lastName"]'), owner.lastName);
      setValue(document.querySelector('input[name="address1"]'), owner.addressLine1);
      setValue(document.querySelector('input[name="address2"]'), owner.addressLine2 || '');
      setValue(document.querySelector('input[name="city"]'), owner.city);
      setValue(document.querySelector('select[name="state"]'), owner.state);
      setValue(document.querySelector('input[name="zipCode"]'), owner.zip);
      setValue(document.querySelector('input[name="phone1"]'), phone1);
      setValue(document.querySelector('input[name="phone2"]'), phone2);
      setValue(document.querySelector('input[name="phone3"]'), phone3);
      setValue(document.querySelector('input[name="phoneExt"]'), '');
      setValue(document.querySelector('input[name="email1"]'), owner.email);
      setValue(email2Input, owner.email);
      setValue(document.querySelector('input[name="portalLogonID"]'), '');
      notice('COR filled the PBS contact information and is continuing to myNewJersey.');
      await status('pbs_filling_contact');
      if (once(`contact:${job.id}`)) submitForm(document.forms.InputCredentialForm, '', 'createAccount');
      return;
    }

    // HAR Step 3: Create/link myNewJersey account. COR always creates the stored login for this workflow.
    const haveIdNo = document.querySelector('#haveIDNo');
    const newUid = document.querySelector('#newUid');
    const signupForm = document.forms.signupForm;
    if (location.hostname === 'my.nj.gov' && haveIdNo && newUid && signupForm) {
      if (!haveIdNo.checked) haveIdNo.click();
      setValue(newUid, data.credentials.username);
      setValue(document.querySelector('#newPw'), data.credentials.password);
      setValue(document.querySelector('#confirmPw'), data.credentials.password);
      setValue(document.querySelector('#challengeQ'), data.credentials.challengeQuestion);
      setValue(document.querySelector('#challengeR'), data.credentials.challengeAnswer);
      setValue(signupForm.querySelector('input[name="givenName"]'), data.owner.firstName);
      setValue(signupForm.querySelector('input[name="sn"]'), data.owner.lastName);
      setValue(signupForm.querySelector('input[name="mail"]'), data.owner.email);
      setValue(signupForm.querySelector('input[name="confirmEmail"]'), data.owner.email);
      setValue(signupForm.querySelector('input[name="create"]'), 'true');
      notice('COR filled the stored myNewJersey login and is creating the account.');
      await status('pbs_creating_mynj');
      if (once(`mynj:${job.id}`)) HTMLFormElement.prototype.submit.call(signupForm);
      return;
    }

    // HAR Step 4: PBS account confirmation -> Add a Business.
    const confirmAccountForm = document.forms.confirmAccount;
    if (confirmAccountForm && /Your Account Has Been Opened/i.test(text)) {
      notice('PBS account opened. COR is moving to Add a Business.');
      await status('pbs_account_opened');
      if (once(`account-opened:${job.id}`)) submitForm(confirmAccountForm, 'OEGAdminBizClients', 'addBusinessHome');
      return;
    }

    // HAR Step 5: Add-a-business welcome -> Business Information.
    const addBusinessHome = document.forms.addBusinessHome;
    if (addBusinessHome && /Add a Business to My Account/i.test(text) && !document.querySelector('#EINNo')) {
      notice('COR is opening the PBS Business Information step.');
      await status('pbs_opening_business_information');
      if (once(`business-home:${job.id}`)) submitForm(addBusinessHome, 'OEGRegisterBusiness', '');
      return;
    }

    // HAR Step 6: Fill every deterministic business field. Business Type is intentionally HITL.
    const einInput = document.querySelector('#EINNo, input[name="EINNo"]');
    const businessType = document.querySelector('#buzType, select[name="buzType"]');
    if (einInput && businessType) {
      setValue(einInput, data.business.einNo);
      setValue(document.querySelector('#businessName, input[name="businessName"]'), data.business.businessName);
      setValue(document.querySelector('#PINNo, input[name="PINNo"]'), '');
      setValue(document.querySelector('#regiYear, input[name="regiYear"]'), data.business.yearFounded);
      setValue(document.querySelector('#zipCode, input[name="zipCode"]'), data.business.taxZip);
      setValue(document.querySelector('input[name="clientEmailAddress"]'), data.owner.email);
      setValue(document.querySelector('input[name="clientPhoneNumber"]'), data.owner.phone);
      setValue(document.querySelector('input[name="REPSFULLNAME"]'), `${data.owner.firstName} ${data.owner.lastName}`.trim());

      const syncBusinessTypeText = () => {
        const hidden = document.querySelector('input[name="busTypeHidden"]');
        if (hidden) setValue(hidden, businessType.options?.[businessType.selectedIndex]?.text || '');
      };
      businessType.addEventListener('change', syncBusinessTypeText, { once: false });
      syncBusinessTypeText();
      businessType.style.outline = '3px solid #f0a202';
      businessType.style.outlineOffset = '2px';
      businessType.scrollIntoView({ block: 'center', behavior: 'smooth' });
      notice('COR needs you: select the correct Business Type, then click Continue. Everything else is filled.');
      await status('waiting_for_pbs_business_type');
      return;
    }

    // The captured HAR ended here with an already-associated-business warning.
    if (/This business has previously been added to another Premier Business Services account/i.test(text)) {
      notice('COR needs you: NJ says this business is already attached to another PBS account.');
      await send({ type: 'COR_PBS_NEEDS_ATTENTION', jobId: job.id, reason: 'Business is already attached to another PBS account.' });
      return;
    }

    // Only declare success if NJ explicitly says the business was successfully added.
    if (!/previously been added/i.test(text) && /business/i.test(text) && /(successfully added|has been added to (your|this).*account|business.*added.*success)/i.test(text)) {
      notice('PBS business connection completed. COR is updating the applicant file.');
      await send({ type: 'COR_PBS_COMPLETE', jobId: job.id });
      return;
    }

    // Agreement / Your Information / Confirmation were not completed in the HAR. Keep them human-in-the-loop.
    if (/Agreement|Your Information|Confirmation/i.test(text) && /Business Information/i.test(text)) {
      notice('COR needs you: this PBS step was not captured in the HAR. Review and continue manually; COR will not guess.');
      await status('waiting_for_pbs_human_step');
      return;
    }

    notice('COR is waiting for the next PBS page. If New Jersey asks for a decision or verification, complete it in this window.');
    await status('waiting_for_pbs_page');
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      await runOnce();
    } catch (error) {
      notice(`COR PBS helper stopped: ${error.message}`);
      await send({ type: 'COR_NJ_ERROR', error: error.message || 'PBS helper failed.' });
    } finally {
      running = false;
    }
  }

  tick();
  const timer = setInterval(tick, 700);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
})();
