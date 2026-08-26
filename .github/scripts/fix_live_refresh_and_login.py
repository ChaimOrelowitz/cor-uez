from pathlib import Path

# ----- Applicant app -----
p = Path('src/App.jsx')
s = p.read_text()

# auth resolved state
s = s.replace("  const [session, setSession] = useState(null);\n", "  const [session, setSession] = useState(null);\n  const [authResolved, setAuthResolved] = useState(false);\n", 1)

# session bootstrap: always resolve
old = """  useEffect(() => {
    getApplicantSession().then((current) => {
      setSession(current || null);
      if (current) loadLatestApplication().catch(() => {});
    }).catch(() => {});
  }, []);
"""
new = """  useEffect(() => {
    let active = true;
    getApplicantSession().then(async (current) => {
      if (!active) return;
      setSession(current || null);
      if (current) await loadLatestApplication().catch(() => {});
    }).catch(() => {}).finally(() => { if (active) setAuthResolved(true); });
    return () => { active = false; };
  }, []);
"""
if old not in s: raise SystemExit('app session bootstrap anchor missing')
s = s.replace(old, new, 1)

# portal polling: update parent bundle every 4s + on focus
anchor = """  useEffect(() => {
    let active = true;
    getMyNjCredentials(app.id).then((result) => {
      if (active) setMyNjCredentials(result.exists ? result.credentials : null);
    }).catch(() => {});
    return () => { active = false; };
  }, [app.id]);
"""
insert = anchor + """

  useEffect(() => {
    let active = true;
    const refresh = () => { if (active && document.visibilityState === 'visible') onRefresh().catch(() => {}); };
    const timer = window.setInterval(refresh, 4000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [app.id, onRefresh]);
"""
if anchor not in s: raise SystemExit('portal credential effect anchor missing')
s = s.replace(anchor, insert, 1)

# login open should not force step 2
old = """  function openSignIn() {
    setSignInMode(true);
    setMessage('');
    setStep(2);
  }
"""
new = """  function openSignIn() {
    setSignInMode(true);
    setMessage('');
  }
"""
if old not in s: raise SystemExit('openSignIn anchor missing')
s = s.replace(old, new, 1)

# standalone loading + login before portal/wizard
anchor = """  if (portalBundle) {
    return <ApplicantPortal bundle={portalBundle} onRefresh={refreshPortal} onSignOut={handleSignOut} />;
  }

  return <div className=\"app-shell\">"""
replacement = """  if (!authResolved) {
    return <div className=\"app-shell auth-loading-shell\"><div className=\"auth-loading-card\">Loading…</div></div>;
  }

  if (!session && signInMode) {
    return <div className=\"app-shell\">
      <header className=\"topbar\">
        <div className=\"brand-mark\">COR</div>
        <div><div className=\"brand-name\">COR Solutions</div><div className=\"brand-subtitle\">UEZ Enrollment & Grant Support</div></div>
        <button className=\"signin-link\" onClick={() => { setSignInMode(false); setMessage(''); }}>Back to signup</button>
      </header>
      <main className=\"login-page-wrap\">
        <section className=\"wizard-card login-card\">
          <div className=\"content-block\">
            <div className=\"intro-copy\"><h3>Log in</h3><p>Access your UEZ application, documents, payment status, and updates.</p></div>
            <form onSubmit={(e) => { e.preventDefault(); signInAndResume(); }}>
              <label>Email</label><input type=\"email\" value={form.email} onChange={update('email')} autoComplete=\"email\" required />
              <label>Password</label><input type=\"password\" value={form.password} onChange={update('password')} autoComplete=\"current-password\" required />
              <button type=\"submit\" className=\"primary login-submit\" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
            </form>
            {message && <div className=\"form-message\">{message}</div>}
          </div>
        </section>
      </main>
    </div>;
  }

  if (portalBundle) {
    return <ApplicantPortal bundle={portalBundle} onRefresh={refreshPortal} onSignOut={handleSignOut} />;
  }

  return <div className=\"app-shell\">"""
if anchor not in s: raise SystemExit('portal return anchor missing')
s = s.replace(anchor, replacement, 1)

# header labels: normal log in/out
s = s.replace("Already registered? Sign in", "Log in")
s = s.replace(">Sign out</button>", ">Log out</button>")

# Account step is signup only now. Remove sign-in toggle and make handler always account creation.
s = s.replace("{step === 2 && <form className=\"content-block\" onSubmit={(e) => { e.preventDefault(); (signInMode ? signInAndResume : createAccountAndCase)(); }}>", "{step === 2 && <form className=\"content-block\" onSubmit={(e) => { e.preventDefault(); createAccountAndCase(); }}>", 1)
s = s.replace("<h3>{signInMode ? 'Sign in to your COR account' : 'Create your COR account'}</h3>\n            <p>{signInMode ? 'Use your email and password to continue your application.' : 'Your account keeps your application, documents, and status in one place.'}</p>", "<h3>Create your COR account</h3>\n            <p>Your account keeps your application, documents, and status in one place.</p>", 1)
s = s.replace("          <button type=\"button\" className=\"text-button\" onClick={() => { setSignInMode((old) => !old); setMessage(''); }}>{signInMode ? 'Need to create an account?' : 'Already have an account?'}</button>\n", "", 1)
s = s.replace("{busy ? 'Please wait…' : signInMode ? 'Sign in' : 'Create account'}", "{busy ? 'Please wait…' : 'Create account'}", 1)

p.write_text(s)

# ----- Admin -----
p = Path('src/AdminPage.jsx')
s = p.read_text()
s = s.replace("  const [session, setSession] = useState(null);\n", "  const [session, setSession] = useState(null);\n  const [authResolved, setAuthResolved] = useState(false);\n", 1)

old = """  useEffect(() => {
    getApplicantSession().then(async (current) => {
      if (!current) return;
      setSession(current);
      await bootstrap();
    }).catch(() => {});
  }, []);
"""
new = """  useEffect(() => {
    let active = true;
    getApplicantSession().then(async (current) => {
      if (!active) return;
      if (current) {
        setSession(current);
        await bootstrap();
      }
    }).catch(() => {}).finally(() => { if (active) setAuthResolved(true); });
    return () => { active = false; };
  }, []);
"""
if old not in s: raise SystemExit('admin bootstrap anchor missing')
s = s.replace(old, new, 1)

# Auto-refresh admin list/detail every 4 sec while not editing/busy, plus focus.
anchor = """  async function bootstrap() {
    setBusy(true);
"""
effect = """  useEffect(() => {
    if (!session || profile?.role !== 'admin') return undefined;
    let active = true;
    const refresh = async () => {
      if (!active || document.visibilityState !== 'visible' || busy || editMode || myNjEditMode || previewDoc) return;
      try {
        const rows = await getAdminApplications();
        if (!active) return;
        setApplications(rows || []);
        if (selectedId) {
          const data = await getAdminApplication(selectedId);
          if (active) setDetail(data);
        }
      } catch (_) {}
    };
    const timer = window.setInterval(refresh, 4000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [session, profile?.role, selectedId, busy, editMode, myNjEditMode, previewDoc]);

""" + anchor
if anchor not in s: raise SystemExit('admin bootstrap function anchor missing')
s = s.replace(anchor, effect, 1)

# loading state before login render
anchor = """  if (!session || profile?.role !== 'admin') {
    return <div className=\"app-shell admin-login-shell\">"""
replacement = """  if (!authResolved || (session && !profile)) {
    return <div className=\"app-shell auth-loading-shell\"><div className=\"auth-loading-card\">Loading admin…</div></div>;
  }

  if (!session || profile?.role !== 'admin') {
    return <div className=\"app-shell admin-login-shell\">"""
if anchor not in s: raise SystemExit('admin login render anchor missing')
s = s.replace(anchor, replacement, 1)
s = s.replace(">Sign out</button>", ">Log out</button>")

p.write_text(s)

# ----- CSS -----
p = Path('src/intakePolish.css')
s = p.read_text()
s += """
.auth-loading-shell{min-height:100vh;display:grid;place-items:center;background:#f7f8fb}.auth-loading-card{font:600 14px/1.4 system-ui;color:#687184}.login-page-wrap{width:min(460px,calc(100% - 28px));margin:54px auto}.login-card{overflow:hidden}.login-card .content-block{padding:30px}.login-card form{display:grid;gap:8px}.login-card input{margin-bottom:10px}.login-submit{width:100%;margin-top:8px}
@media(max-width:760px){.login-page-wrap{margin:28px auto}.login-card .content-block{padding:22px}}
"""
p.write_text(s)
