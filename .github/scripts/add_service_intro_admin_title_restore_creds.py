from pathlib import Path

APP = Path('src/App.jsx')
ADMIN = Path('src/AdminPage.jsx')
CSS = Path('src/intakePolish.css')

app = APP.read_text()
admin = ADMIN.read_text()
css = CSS.read_text()


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Missing expected block: {label}')
    return text.replace(old, new, 1)

# --- Applicant portal: restore MyNJ/PBS credentials ---
app = replace_once(
    app,
    "  getApplication,\n  getMyApplications,",
    "  getApplication,\n  getMyApplications,\n  getMyNjCredentials,",
    'getMyNjCredentials import'
)

app = replace_once(
    app,
    "  const [message, setMessage] = useState('');\n  const [paymentBusy, setPaymentBusy] = useState(false);",
    "  const [message, setMessage] = useState('');\n  const [myNjCredentials, setMyNjCredentials] = useState(null);\n  const [showMyNjSecrets, setShowMyNjSecrets] = useState(false);\n  const [paymentBusy, setPaymentBusy] = useState(false);",
    'portal credential state'
)

app = replace_once(
    app,
    "\n\n  useEffect(() => {\n    let active = true;\n    const refresh = () => { if (active && document.visibilityState === 'visible') onRefresh().catch(() => {}); };",
    "\n\n  useEffect(() => {\n    let active = true;\n    getMyNjCredentials(app.id).then((result) => {\n      if (active) setMyNjCredentials(result.exists ? result.credentials : null);\n    }).catch(() => {});\n    return () => { active = false; };\n  }, [app.id]);\n\n  useEffect(() => {\n    let active = true;\n    const refresh = () => { if (active && document.visibilityState === 'visible') onRefresh().catch(() => {}); };",
    'portal credential fetch effect'
)

payment_block = '''        <section className="wizard-card portal-card">
          <div className="portal-section-head"><h3>Payment</h3><span>$500</span></div>
          {latestPayment?.status === 'paid' ? <div className="action-panel good-panel"><h3>✓ Payment received</h3></div>
            : latestPayment?.status === 'client_reported' ? <div className="action-panel"><h3>Payment reported</h3><p>You told COR the payment was sent. We are verifying it.</p></div>
            : <><p className="muted">After you send the $500 payment, click below.</p><button className="primary admin-full-button" onClick={reportPaymentSent} disabled={paymentBusy}>{paymentBusy ? 'Saving…' : 'I sent my payment'}</button></>}
        </section>

        <section className="wizard-card portal-card portal-wide">'''

payment_with_creds = '''        <section className="wizard-card portal-card">
          <div className="portal-section-head"><h3>Payment</h3><span>$500</span></div>
          {latestPayment?.status === 'paid' ? <div className="action-panel good-panel"><h3>✓ Payment received</h3></div>
            : latestPayment?.status === 'client_reported' ? <div className="action-panel"><h3>Payment reported</h3><p>You told COR the payment was sent. We are verifying it.</p></div>
            : <><p className="muted">After you send the $500 payment, click below.</p><button className="primary admin-full-button" onClick={reportPaymentSent} disabled={paymentBusy}>{paymentBusy ? 'Saving…' : 'I sent my payment'}</button></>}
        </section>

        {myNjCredentials && <section className="wizard-card portal-card portal-wide mynj-card">
          <div className="portal-section-head"><h3>MyNJ / PBS account information</h3><span>✓</span></div>
          <div className="credential-grid applicant-credential-grid">
            <div><span>MyNJ username</span><strong>{myNjCredentials.username}</strong></div>
            <div><span>MyNJ password</span><strong>{showMyNjSecrets ? myNjCredentials.password : '••••••••••••'}</strong></div>
            <div><span>Challenge question</span><strong>{myNjCredentials.challengeQuestion}</strong></div>
            <div><span>Challenge answer</span><strong>{showMyNjSecrets ? myNjCredentials.challengeAnswer : '••••••••'}</strong></div>
          </div>
          <button className="secondary portal-secret-button" onClick={() => setShowMyNjSecrets((shown) => !shown)}>{showMyNjSecrets ? 'Hide password and answer' : 'Reveal password and answer'}</button>
          <p className="muted credential-note">Keep this login information private. You may need it to access New Jersey services related to your application.</p>
        </section>}

        <section className="wizard-card portal-card portal-wide">'''

app = replace_once(app, payment_block, payment_with_creds, 'client MyNJ card')

# --- Public landing: service explanation page before map ---
app = replace_once(
    app,
    "  const [signInMode, setSignInMode] = useState(() => new URLSearchParams(window.location.search).get('login') === '1');\n  const [session, setSession] = useState(null);",
    "  const [signInMode, setSignInMode] = useState(() => new URLSearchParams(window.location.search).get('login') === '1');\n  const [showServiceIntro, setShowServiceIntro] = useState(true);\n  const [session, setSession] = useState(null);",
    'service intro state'
)

portal_return = '''  if (portalBundle) {
    return <ApplicantPortal bundle={portalBundle} onRefresh={refreshPortal} onSignOut={handleSignOut} />;
  }

  return <div className="app-shell">'''

intro_return = '''  if (portalBundle) {
    return <ApplicantPortal bundle={portalBundle} onRefresh={refreshPortal} onSignOut={handleSignOut} />;
  }

  if (!session && showServiceIntro) {
    return <div className="app-shell service-intro-shell">
      <header className="topbar">
        <div className="brand-mark">COR</div>
        <div><div className="brand-name">COR Solutions</div><div className="brand-subtitle">UEZ Enrollment & Grant Support</div></div>
        <button className="signin-link" onClick={openSignIn}>Log in</button>
      </header>
      <main className="service-intro-wrap">
        <section className="service-intro-hero">
          <div className="eyebrow">LAKEWOOD UEZ SIGNUP & GRANT SUPPORT</div>
          <h1>UEZ signup and grant applications, without figuring it all out yourself.</h1>
          <p>COR Solutions provides a start-to-finish application service for eligible Lakewood businesses. Start with a quick address check, complete one intake, and use your account to follow the application as it moves forward.</p>
          <div className="service-intro-actions">
            <button className="primary" onClick={() => { setShowServiceIntro(false); setMessage(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Check my business address</button>
            <a className="secondary service-link-button" href="tel:+17329300739">Call 732-930-0739</a>
          </div>
        </section>

        <section className="service-explainer-grid" aria-label="About the service">
          <article><span>WHAT</span><h3>UEZ enrollment + grant application</h3><p>One intake for your New Jersey UEZ enrollment and the available Lakewood grant application.</p></article>
          <article><span>WHO</span><h3>Eligible Lakewood businesses</h3><p>The first step checks whether your business location is inside the UEZ. If it is, you can continue directly into the application.</p></article>
          <article><span>HOW</span><h3>Complete one online intake</h3><p>Provide the requested business and ownership information, upload your Certificate of Formation when applicable, and respond to any action items that appear in your account.</p></article>
          <article><span>COST</span><h3>$500 service fee</h3><p>The $500 service fee covers UEZ signup and the grant application service. If the LDC rejects the application, the fee is refunded; after LDC approval it is non-refundable.</p></article>
        </section>

        <section className="service-faq-card">
          <div className="service-faq-head"><div><span className="eyebrow">FAQ</span><h2>Questions before you start?</h2></div><p>Open any question below, or reach out directly.</p></div>
          <div className="service-faq-list">
            <details><summary>What is the UEZ?</summary><p>New Jersey's Urban Enterprise Zone program provides benefits to qualifying businesses located within designated UEZ areas. This service starts by checking your business location against the UEZ map.</p></details>
            <details><summary>What does COR Solutions do?</summary><p>COR Solutions collects the information needed for the process, prepares the UEZ enrollment and applicable Lakewood grant application, and gives you an online account where you can see updates and anything that still needs your attention.</p></details>
            <details><summary>What will I need to provide?</summary><p>You will enter basic business and owner information. If the business is not a sole proprietorship, you will also upload its Certificate of Formation. If another item is needed later, it will appear clearly in your account.</p></details>
            <details><summary>How do I know if my business is eligible?</summary><p>Click “Check my business address.” The next page checks the location against the UEZ map before you create an account or complete the full intake.</p></details>
            <details><summary>Is a grant guaranteed?</summary><p>No. Eligibility and final approval are determined by the applicable government and grant agencies. COR Solutions provides the application service but cannot guarantee an approval or award.</p></details>
            <details><summary>What happens after I submit?</summary><p>You can log back into your COR account at any time. Your activity tracker shows the application moving forward, and any item you need to provide or replace will appear as an action in your account.</p></details>
          </div>
        </section>

        <section className="service-contact-card">
          <div><span className="eyebrow">QUESTIONS?</span><h2>Talk to Chaim before you apply.</h2><p>Call, text, or WhatsApp and ask anything you need to know about the service or the UEZ process.</p></div>
          <div className="service-contact-actions">
            <a href="tel:+17329300739">Call</a>
            <a href="sms:+17329300739">Text</a>
            <a href="https://wa.me/17329300739" target="_blank" rel="noreferrer">WhatsApp</a>
          </div>
          <strong className="service-phone">732-930-0739</strong>
        </section>
      </main>
    </div>;
  }

  return <div className="app-shell">'''

app = replace_once(app, portal_return, intro_return, 'service intro return')

# --- Admin: honorific title for legacy applicants ---
admin = replace_once(
    admin,
    "  return {\n    firstName: owner.firstName || '',",
    "  return {\n    title: owner.title || '',\n    firstName: owner.firstName || '',",
    'admin owner title draft'
)

admin = replace_once(
    admin,
    '''                    <div className="admin-edit-grid owner-edit-grid">
                      <div><label>First name <span className="required-star">*</span></label><input value={owner.firstName} onChange={(e) => updateOwnerDraft(index, 'firstName', e.target.value)} /></div>''',
    '''                    <div className="admin-edit-grid owner-edit-grid">
                      <div><label>Title (Mr., Mrs., etc.) <span className="required-star">*</span></label><select value={owner.title || ''} onChange={(e) => updateOwnerDraft(index, 'title', e.target.value)}><option value="">Select title</option><option value="Mr.">Mr.</option><option value="Mrs.">Mrs.</option><option value="Ms.">Ms.</option><option value="Dr.">Dr.</option><option value="Rabbi">Rabbi</option>{owner.title && !['Mr.','Mrs.','Ms.','Dr.','Rabbi'].includes(owner.title) && <option value={owner.title}>{owner.title}</option>}</select></div>
                      <div><label>First name <span className="required-star">*</span></label><input value={owner.firstName} onChange={(e) => updateOwnerDraft(index, 'firstName', e.target.value)} /></div>''',
    'admin title edit field'
)

admin = replace_once(
    admin,
    '''                  <dl className="data-grid compact-data">
                    <div><dt>Email</dt><dd>{owner.email || '—'}</dd></div>''',
    '''                  <dl className="data-grid compact-data">
                    <div><dt>Title</dt><dd>{owner.title || '—'}</dd></div>
                    <div><dt>Email</dt><dd>{owner.email || '—'}</dd></div>''',
    'admin title display'
)

# Make admin save catch missing titles so legacy applicants can be repaired before PBS.
admin = replace_once(
    admin,
    "    if (!applicationDraft.businessName.trim() || !applicationDraft.contactEmail.trim()) {\n      setMessage('Business name and contact email are required.');\n      return;\n    }",
    "    if (!applicationDraft.businessName.trim() || !applicationDraft.contactEmail.trim()) {\n      setMessage('Business name and contact email are required.');\n      return;\n    }\n    if (ownerDrafts.some((owner) => !String(owner.title || '').trim())) {\n      setMessage('Choose a title for each owner before saving.');\n      return;\n    }",
    'admin title validation'
)

# --- Intro styling ---
intro_css = r'''

/* Public service explainer shown before the UEZ map */
.service-intro-shell{min-height:100vh;background:radial-gradient(circle at 12% 0,#eef1ff 0,#f8f9ff 34%,#fbfbfe 72%)}
.service-intro-wrap{width:min(1000px,calc(100% - 32px));margin:0 auto;padding:50px 0 64px}
.service-intro-hero{max-width:820px;text-align:left;margin:0 auto 28px;padding:34px 36px;border:1px solid #e3e6f2;border-radius:28px;background:rgba(255,255,255,.96);box-shadow:0 24px 70px rgba(48,54,111,.10)}
.service-intro-hero h1{margin:0;font-size:clamp(36px,5vw,56px);line-height:1.04;letter-spacing:-.04em;color:#17203a}
.service-intro-hero p{margin:18px 0 0;max-width:760px;color:#687186;font-size:17px;line-height:1.65}
.service-intro-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:24px}.service-intro-actions .primary{margin:0}.service-link-button{display:inline-flex;text-decoration:none;align-items:center;justify-content:center}
.service-explainer-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 auto 22px;max-width:820px}.service-explainer-grid article{padding:20px;border:1px solid #e3e6ee;border-radius:17px;background:#fff}.service-explainer-grid article>span{font-size:10px;letter-spacing:.14em;font-weight:900;color:#6971d9}.service-explainer-grid h3{margin:7px 0 6px;font-size:17px;color:#202c43}.service-explainer-grid p{margin:0;color:#727c8e;font-size:13px;line-height:1.55}
.service-faq-card{max-width:820px;margin:0 auto 22px;padding:26px 28px;border:1px solid #e3e6ee;border-radius:22px;background:#fff}.service-faq-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:12px}.service-faq-head .eyebrow{margin-bottom:5px}.service-faq-head h2{margin:0;font-size:25px}.service-faq-head>p{margin:0;color:#7b8495;font-size:12px}.service-faq-list{border-top:1px solid #edf0f4}.service-faq-list details{border-bottom:1px solid #edf0f4}.service-faq-list summary{cursor:pointer;list-style:none;padding:15px 2px;font-weight:800;font-size:14px;color:#303a51;display:flex;align-items:center;justify-content:space-between;gap:12px}.service-faq-list summary::-webkit-details-marker{display:none}.service-faq-list summary:after{content:'+';font-size:20px;font-weight:500;color:#747de1}.service-faq-list details[open] summary:after{content:'−'}.service-faq-list details p{margin:-3px 34px 16px 2px;color:#697386;font-size:13px;line-height:1.6}
.service-contact-card{max-width:820px;margin:0 auto;padding:24px 28px;border-radius:22px;background:#17203a;color:#fff;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px 28px;align-items:center}.service-contact-card .eyebrow{color:#adb4ff;margin-bottom:5px}.service-contact-card h2{margin:0;font-size:24px}.service-contact-card p{margin:7px 0 0;color:#c7ccda;font-size:13px;line-height:1.5}.service-contact-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.service-contact-actions a{padding:10px 13px;border-radius:10px;background:#fff;color:#26304b;text-decoration:none;font-size:12px;font-weight:900}.service-phone{grid-column:1/-1;font-size:18px;letter-spacing:.03em}
@media(max-width:760px){.service-intro-wrap{width:min(100% - 18px,1000px);padding:20px 0 34px}.service-intro-hero{padding:24px 20px;border-radius:20px;margin-bottom:12px}.service-intro-hero h1{font-size:34px}.service-intro-hero p{font-size:14px}.service-intro-actions{align-items:stretch}.service-intro-actions>*{width:100%}.service-explainer-grid{grid-template-columns:1fr;gap:8px;margin-bottom:12px}.service-explainer-grid article{padding:16px}.service-faq-card{padding:20px 18px;border-radius:18px;margin-bottom:12px}.service-faq-head{display:block}.service-faq-head>p{margin-top:7px}.service-faq-list summary{font-size:13px}.service-contact-card{grid-template-columns:1fr;padding:20px;border-radius:18px}.service-contact-actions{justify-content:flex-start}.service-contact-actions a{flex:1;text-align:center}.service-phone{grid-column:auto}}
'''

if '/* Public service explainer shown before the UEZ map */' not in css:
    css += intro_css
else:
    raise SystemExit('Intro CSS already exists; patch should not be rerun.')

APP.write_text(app)
ADMIN.write_text(admin)
CSS.write_text(css)
