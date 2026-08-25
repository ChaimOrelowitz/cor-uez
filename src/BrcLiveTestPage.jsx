import React, { useEffect, useRef, useState } from 'react';
import {
  getLiveBrcSession,
  liveBrcDocumentUrl,
  liveBrcScreenshotUrl,
  sendLiveBrcInput,
  startLiveBrcSession
} from './brcLiveApi';

export default function BrcLiveTestPage() {
  const [businessName, setBusinessName] = useState('');
  const [ein, setEin] = useState('');
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [screenTick, setScreenTick] = useState(Date.now());
  const imageRef = useRef(null);

  const terminal = ['found', 'not_found', 'error'].includes(status);

  useEffect(() => {
    if (!session?.id || !session?.token) return undefined;
    let cancelled = false;

    async function refresh() {
      try {
        const data = await getLiveBrcSession(session.id, session.token);
        if (cancelled) return;
        setStatus(data.status);
        setResult(data);
        if (!['found', 'not_found', 'error'].includes(data.status)) setScreenTick(Date.now());
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }

    refresh();
    const timer = setInterval(refresh, 700);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session?.id, session?.token]);

  async function startCheck() {
    setStarting(true);
    setError('');
    setResult(null);
    setStatus('opening');
    try {
      const next = await startLiveBrcSession(businessName.trim(), ein.trim());
      setSession(next);
      setStatus(next.status);
      setScreenTick(Date.now());
    } catch (err) {
      setError(err.message);
      setStatus(null);
    } finally {
      setStarting(false);
    }
  }

  async function clickBrowser(event) {
    if (!session || terminal || !imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    const viewport = session.viewport || { width: 1100, height: 850 };
    const x = ((event.clientX - rect.left) / rect.width) * viewport.width;
    const y = ((event.clientY - rect.top) / rect.height) * viewport.height;
    try {
      await sendLiveBrcInput(session.id, session.token, { type: 'click', x, y });
      setScreenTick(Date.now());
    } catch (err) {
      setError(err.message);
    }
  }

  async function scrollBrowser(deltaY) {
    if (!session || terminal) return;
    try {
      await sendLiveBrcInput(session.id, session.token, { type: 'wheel', deltaY });
      setScreenTick(Date.now());
    } catch (err) {
      setError(err.message);
    }
  }

  const screenshot = session
    ? liveBrcScreenshotUrl(session.id, session.token, screenTick)
    : null;
  const documentUrl = result?.hasDocument && session
    ? liveBrcDocumentUrl(session.id, session.token)
    : null;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark">COR</div>
      <div><div className="brand-name">COR Solutions</div><div className="brand-subtitle">BRC Lookup Test</div></div>
    </header>

    <main className="page-wrap brc-live-wrap">
      <div className="wizard-card">
        <div className="wizard-head"><div><span className="step-count">LIVE TEST</span><h2>New Jersey BRC Lookup</h2></div></div>
        <div className="content-block">
          <div className="intro-copy">
            <h3>Check a business registration certificate</h3>
            <p>COR runs the NJ lookup in its own browser. If New Jersey asks for human verification, complete it right here. When the BRC appears, COR captures it automatically.</p>
          </div>

          {!session && <>
            <label>Business name</label>
            <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Business name" />
            <label>EIN</label>
            <input value={ein} onChange={(e) => setEin(e.target.value)} placeholder="12-3456789" />
            <button type="button" className="primary" onClick={startCheck} disabled={starting || !businessName.trim() || !ein.trim()}>
              {starting ? 'Starting NJ browser…' : 'Check my BRC'}
            </button>
          </>}

          {session && !terminal && <div className="live-browser-shell">
            <div className="live-browser-head">
              <div>
                <strong>{status === 'challenge' ? 'New Jersey needs human verification' : 'Checking with New Jersey…'}</strong>
                <p>{status === 'challenge' ? 'Use the live NJ browser below. Your clicks control the same browser COR is monitoring.' : 'COR filled and submitted the lookup. If NJ asks for verification, it will appear below.'}</p>
              </div>
              <span className="live-dot">LIVE</span>
            </div>
            <div className="live-browser-stage">
              {screenshot && <img
                ref={imageRef}
                src={screenshot}
                alt="Live New Jersey BRC browser"
                className="live-browser-image"
                onClick={clickBrowser}
                draggable="false"
              />}
            </div>
            <div className="live-browser-controls">
              <button type="button" className="secondary" onClick={() => scrollBrowser(-500)}>Scroll up</button>
              <button type="button" className="secondary" onClick={() => scrollBrowser(500)}>Scroll down</button>
            </div>
          </div>}

          {status === 'found' && result?.result && <div className="brc-test-result found">
            <strong>BRC confirmed</strong>
            {result.result.taxpayerName && <p><b>Official business name:</b> {result.result.taxpayerName}</p>}
            {result.result.tradeName && <p><b>Trade name:</b> {result.result.tradeName}</p>}
            {result.result.address && <p><b>Address:</b> {result.result.address}</p>}
            {result.result.certificateNumber && <p><b>Certificate #:</b> {result.result.certificateNumber}</p>}
            {result.result.effectiveDate && <p><b>Effective date:</b> {result.result.effectiveDate}</p>}
            {result.result.issuanceDate && <p><b>Issued:</b> {result.result.issuanceDate}</p>}
            {documentUrl && <a className="secondary brc-document-link" href={documentUrl} target="_blank" rel="noreferrer">Open captured BRC</a>}
          </div>}

          {status === 'not_found' && <div className="brc-test-result not_found"><strong>No BRC match found</strong><p>NJ did not return a Business Registration Certificate for these lookup values.</p></div>}
          {status === 'error' && <div className="validation-error">{result?.error || 'The NJ browser session failed.'}</div>}
          {error && <div className="validation-error">{error}</div>}

          {session && terminal && <button type="button" className="secondary live-restart" onClick={() => { setSession(null); setStatus(null); setResult(null); setError(''); }}>Try another business</button>}
        </div>
      </div>
    </main>
  </div>;
}
