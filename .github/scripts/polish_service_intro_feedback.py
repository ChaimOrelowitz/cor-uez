from pathlib import Path

app_path = Path('src/App.jsx')
text = app_path.read_text()

repls = [
    (
        '''          <div className="service-intro-actions">\n            <button className="primary" onClick={() => { setShowServiceIntro(false); setMessage(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Check my business address</button>\n            <a className="secondary service-link-button" href="tel:+17329300739">Call 732-930-0739</a>\n          </div>''',
        '''          <div className="service-intro-actions">\n            <button className="primary" onClick={() => { setShowServiceIntro(false); setMessage(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Check my business address</button>\n          </div>'''
    ),
    (
        '''          <article><span>WHAT</span><h3>UEZ enrollment + grant application</h3><p>One intake for your New Jersey UEZ enrollment and the available Lakewood grant application.</p></article>\n          <article><span>WHO</span><h3>Eligible Lakewood businesses</h3><p>The first step checks whether your business location is inside the UEZ. If it is, you can continue directly into the application.</p></article>''',
        '''          <article><span>WHO</span><h3>Eligible Lakewood businesses</h3><p>The first step checks whether your business location is inside the UEZ. If it is, you can continue directly into the application.</p></article>\n          <article><span>WHAT</span><h3>UEZ enrollment + grant application</h3><p>One intake for your New Jersey UEZ enrollment and the available Lakewood grant application.</p></article>'''
    ),
    (
        '''            <details><summary>What will I need to provide?</summary><p>You will enter basic business and owner information. If the business is not a sole proprietorship, you will also upload its Certificate of Formation. If another item is needed later, it will appear clearly in your account.</p></details>''',
        '''            <details><summary>What will I need to provide?</summary><p>You will enter basic business and owner information, as well as the Certificate of Formation. If another item is needed later, it will appear clearly in your account.</p></details>'''
    ),
    (
        '''            <details><summary>Is a grant guaranteed?</summary><p>No. Eligibility and final approval are determined by the applicable government and grant agencies. COR Solutions provides the application service but cannot guarantee an approval or award.</p></details>\n''',
        ''''''
    ),
    (
        '''          <div><span className="eyebrow">QUESTIONS?</span><h2>Talk to Chaim before you apply.</h2><p>Call, text, or WhatsApp and ask anything you need to know about the service or the UEZ process.</p></div>''',
        '''          <div><span className="eyebrow">QUESTIONS?</span><h2>Talk to our team before you apply.</h2><p>Call, text, or WhatsApp and ask anything you need to know about the service or the UEZ process.</p></div>'''
    ),
    (
        '''            <a href="https://wa.me/17329300739" target="_blank" rel="noreferrer">WhatsApp</a>''',
        '''            <a href="https://wa.me/17329300739?text=Hi%2C%20I%20am%20interested%20in%20signing%20up%20for%20the%20tech%20grant." target="_blank" rel="noreferrer">WhatsApp</a>'''
    ),
    (
        '''    <main className={`page-wrap intake-page ${step === 0 ? 'intake-first-screen' : ''}`}>\n      <section className="hero">''',
        '''    <main className={`page-wrap intake-page ${step === 0 ? 'intake-first-screen' : ''}`}>\n      {!session && step === 0 && <button type="button" className="secondary intake-back-to-intro" onClick={() => { setShowServiceIntro(true); setMessage(''); setEligibility(null); setAddressSuggestions([]); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>← Back</button>}\n      <section className="hero">'''
    ),
]

for old, new in repls:
    if old not in text:
        raise SystemExit(f'Expected text not found:\n{old[:180]}')
    text = text.replace(old, new, 1)

app_path.write_text(text)

css_path = Path('src/intakePolish.css')
css = css_path.read_text()
addition = '''\n.intake-back-to-intro{margin:0 0 14px!important;width:auto!important}\n'''
if '.intake-back-to-intro' not in css:
    css += addition
css_path.write_text(css)
