from pathlib import Path

# ---------------- extension manifest ----------------
p = Path('brc-helper-extension/manifest.json')
s = p.read_text()
s = s.replace('"version": "1.3.4"', '"version": "1.3.5"')
if '"<all_urls>"' not in s:
    s = s.replace('  "host_permissions": [\n', '  "host_permissions": [\n    "<all_urls>",\n', 1)
p.write_text(s)

# ---------------- logged-in client dashboard ----------------
p = Path('src/App.jsx')
s = p.read_text()
start = s.index('  return <div className="app-shell">', s.index('function ApplicantPortal'))
end = s.index('\n}\n\nexport default function App()', start)

new_return = r'''  return <div className="app-shell client-shell">
    <header className="topbar client-topbar">
      <div className="brand-mark">COR</div>
      <div><div className="brand-name">COR Solutions</div><div className="brand-subtitle">UEZ Application Portal</div></div>
      <button className="signin-link" onClick={onSignOut}>Sign out</button>
    </header>

    <main className="page-wrap portal-wrap client-dashboard">
      <section className="client-dashboard-head">
        <div>
          <div className="eyebrow">YOUR COR UEZ APPLICATION</div>
          <h1>{app.business_name_input || 'Your application'}</h1>
          <p>COR is handling your UEZ enrollment and grant application. If we need something from you, it will show up right here.</p>
        </div>
        <span className={`status-pill ${brcConfirmed ? 'good' : needsBrc ? 'warn' : ''}`}>{statusLabel(app.status)}</span>
      </section>

      <section className="client-summary-strip">
        <div><span>Status</span><strong>{statusLabel(app.status)}</strong></div>
        <div><span>Documents</span><strong>{bundle.documents.length}</strong></div>
        <div><span>Payment</span><strong>{latestPayment?.status === 'paid' ? 'Paid' : latestPayment?.status === 'client_reported' ? 'Verifying' : 'Not recorded'}</strong></div>
      </section>

      {(needsBrc || (needsApprovalEmail && !approvalUploaded)) ? <section className="client-action-card">
        <div className="client-section-kicker">ACTION NEEDED</div>
        {needsBrc && <div className="client-task">
          <div>
            <h2>We need your New Jersey BRC</h2>
            <p>COR could not locate a current Business Registration Certificate. Complete New Jersey registration if needed, then upload the BRC here.</p>
          </div>
          <div className="action-row client-task-actions">
            <a className="secondary inline-button" href={NJ_REGISTRATION_URL} target="_blank" rel="noreferrer">NJ registration</a>
            <label className="primary compact inline-button file-button">
              {uploading ? 'Uploading…' : 'Upload BRC'}
              <input type="file" accept=".pdf,image/*" disabled={uploading} onChange={(e) => uploadBrc(e.target.files?.[0])} />
            </label>
          </div>
        </div>}

        {needsApprovalEmail && !approvalUploaded && <div className="client-task">
          <div>
            <h2>Upload your UEZ approval email</h2>
            <p>Upload the “Notice of Certification Application Approved” email from UEZdonotreply@dca.nj.gov.</p>
          </div>
          <label className="primary compact inline-button file-button">
            {uploading ? 'Uploading…' : 'Upload approval email'}
            <input type="file" accept=".pdf,.eml,image/*" disabled={uploading} onChange={(e) => uploadApprovalEmail(e.target.files?.[0])} />
          </label>
        </div>}
      </section> : <section className="client-action-card client-action-done">
        <span className="client-done-icon">✓</span>
        <div><strong>COR is handling the next steps.</strong><p>There is nothing you need to do right now. We’ll update this page if we need anything from you.</p></div>
      </section>}

      <div className="client-progress-mini">
        <span className={brcConfirmed ? 'done' : brcUploaded ? 'received' : ''}>BRC · {brcConfirmed ? 'Confirmed' : brcUploaded ? 'Received' : 'Pending'}</span>
        <span className={approvalUploaded ? 'done' : ''}>UEZ approval · {approvalUploaded ? 'Received' : 'Pending'}</span>
        <span className={latestPayment?.status === 'paid' ? 'done' : latestPayment?.status === 'client_reported' ? 'received' : ''}>Payment · {latestPayment?.status === 'paid' ? 'Paid' : latestPayment?.status === 'client_reported' ? 'Verifying' : 'Pending'}</span>
      </div>

      {message && <div className="form-message client-message">{message}</div>}

      <div className="client-main-grid">
        <section className="client-card">
          <div className="client-card-head"><h2>Documents</h2><span>{bundle.documents.length}</span></div>
          <div className="document-list client-document-list">
            {bundle.documents.length === 0 && <p className="muted">No documents uploaded yet.</p>}
            {bundle.documents.map((doc) => <button className="document-row" key={doc.id} onClick={() => openDocument(doc)}>
              <span><strong>{documentLabel(doc.document_type)}</strong><small>{doc.filename}</small></span>
              <b>Open</b>
            </button>)}
          </div>
        </section>

        <section className="client-card">
          <div className="client-card-head"><h2>Payment</h2><span>$500</span></div>
          {latestPayment?.status === 'paid' ? <div className="client-payment-state good"><strong>✓ Payment received</strong><p>COR confirmed your payment.</p></div>
            : latestPayment?.status === 'client_reported' ? <div className="client-payment-state"><strong>Payment reported</strong><p>You told COR the payment was sent. We’re verifying it.</p></div>
            : <div className="client-payment-state"><p>After you send the $500 payment, tell COR so we know to check for it.</p><button className="primary client-payment-button" onClick={reportPaymentSent} disabled={paymentBusy}>{paymentBusy ? 'Saving…' : 'I sent my payment'}</button></div>}
        </section>
      </div>

      {myNjCredentials && <details className="client-accordion">
        <summary><strong>MyNJ / PBS account information</strong><span>Login ready</span></summary>
        <div className="client-accordion-body">
          <div className="credential-grid applicant-credential-grid">
            <div><span>MyNJ username</span><strong>{myNjCredentials.username}</strong></div>
            <div><span>MyNJ password</span><strong>{showMyNjSecrets ? myNjCredentials.password : '••••••••••••'}</strong></div>
            <div><span>Challenge question</span><strong>{myNjCredentials.challengeQuestion}</strong></div>
            <div><span>Challenge answer</span><strong>{showMyNjSecrets ? myNjCredentials.challengeAnswer : '••••••••'}</strong></div>
          </div>
          <button className="secondary portal-secret-button" onClick={() => setShowMyNjSecrets((shown) => !shown)}>{showMyNjSecrets ? 'Hide password and answer' : 'Reveal password and answer'}</button>
          <p className="muted credential-note">Keep this information private.</p>
        </div>
      </details>}

      <details className="client-accordion">
        <summary><strong>Application updates</strong><span>{bundle.statusEvents.length}</span></summary>
        <div className="client-accordion-body">
          <div className="timeline">
            {[...bundle.statusEvents].reverse().map((event) => <div className="timeline-item" key={event.id}>
              <span className="timeline-dot"></span>
              <div><strong>{event.label || statusLabel(event.status)}</strong><p>{event.message}</p><small>{new Date(event.created_at).toLocaleString()}</small></div>
            </div>)}
          </div>
        </div>
      </details>
    </main>
  </div>;'''

s = s[:start] + new_return + s[end:]
p.write_text(s)

# ---------------- dashboard CSS ----------------
p = Path('src/styles.css')
s = p.read_text()
s += r'''

/* Logged-in client dashboard */
.client-shell{background:#f7f8fb}.client-topbar{min-height:64px}.client-dashboard{width:min(980px,calc(100% - 28px));padding:26px 0 42px}.client-dashboard-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:14px}.client-dashboard-head .eyebrow{margin-bottom:6px}.client-dashboard-head h1{margin:0;font-size:30px;line-height:1.08;letter-spacing:-.025em}.client-dashboard-head p{margin:8px 0 0;color:#727b8e;font-size:14px;line-height:1.5;max-width:650px}.client-dashboard-head .status-pill{flex:0 0 auto;margin-top:3px}.client-summary-strip{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #e2e6ec;border-radius:14px;background:#fff;margin-bottom:12px;overflow:hidden}.client-summary-strip>div{padding:12px 14px;border-right:1px solid #edf0f3;display:grid;gap:2px}.client-summary-strip>div:last-child{border-right:0}.client-summary-strip span{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8a93a0;font-weight:800}.client-summary-strip strong{font-size:14px}.client-action-card{border:1px solid #e4d18f;background:#fffaf0;border-radius:14px;padding:15px 16px;margin-bottom:10px}.client-action-card.client-action-done{border-color:#cfe1d3;background:#f6fbf7;display:flex;align-items:center;gap:12px}.client-action-done strong{font-size:14px}.client-action-done p{margin:3px 0 0;color:#6f7a72;font-size:12px}.client-done-icon{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#e1f3e5;color:#247443;font-weight:900;flex:0 0 30px}.client-section-kicker{font-size:10px;letter-spacing:.1em;font-weight:900;color:#a16d00;margin-bottom:8px}.client-task{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:10px 0}.client-task+.client-task{border-top:1px solid #eee2bd;margin-top:4px;padding-top:14px}.client-task h2{margin:0 0 4px;font-size:16px}.client-task p{margin:0;color:#6f7480;font-size:12px;line-height:1.45;max-width:620px}.client-task .inline-button{margin:0;white-space:nowrap}.client-task-actions{flex-wrap:nowrap}.client-progress-mini{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 12px}.client-progress-mini span{font-size:10px;font-weight:800;border:1px solid #e0e4e9;background:#fff;color:#7b8490;border-radius:999px;padding:5px 8px}.client-progress-mini span.received{background:#fff8e9;border-color:#ead39b;color:#8a6710}.client-progress-mini span.done{background:#f0f8f2;border-color:#c7ddcc;color:#317148}.client-message{margin:0 0 12px}.client-main-grid{display:grid;grid-template-columns:1.35fr .85fr;gap:12px;margin-bottom:12px}.client-card{background:#fff;border:1px solid #e2e6ec;border-radius:14px;overflow:hidden}.client-card-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #edf0f3}.client-card-head h2{margin:0;font-size:14px}.client-card-head span{font-size:11px;color:#8a93a0;font-weight:800}.client-document-list .document-row{border-radius:0;border-left:0;border-right:0}.client-document-list .document-row:first-child{border-top:0}.client-document-list .document-row:last-child{border-bottom:0}.client-payment-state{padding:15px}.client-payment-state strong{font-size:14px}.client-payment-state p{margin:4px 0 0;color:#70798a;font-size:12px;line-height:1.45}.client-payment-state.good{background:#f7fbf8}.client-payment-button{width:100%;margin-top:12px}.client-accordion{border:1px solid #e2e6ec;border-radius:14px;background:#fff;overflow:hidden;margin-top:10px}.client-accordion>summary{display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;list-style:none}.client-accordion>summary::-webkit-details-marker{display:none}.client-accordion>summary strong{font-size:13px}.client-accordion>summary span{margin-left:auto;font-size:11px;color:#89919d;font-weight:700}.client-accordion>summary:after{content:'›';font-size:18px;color:#9aa2ad;transform:rotate(90deg)}.client-accordion[open]>summary:after{transform:rotate(-90deg)}.client-accordion-body{border-top:1px solid #edf0f3;padding:14px}.client-accordion .credential-grid{margin:0}.client-accordion .timeline{margin:0}.client-accordion .portal-secret-button{margin-top:12px}
@media(max-width:760px){.client-topbar{min-height:58px}.client-dashboard{width:min(100% - 18px,980px);padding:16px 0 30px}.client-dashboard-head{gap:10px}.client-dashboard-head h1{font-size:24px}.client-dashboard-head p{font-size:12px}.client-dashboard-head .status-pill{font-size:10px}.client-summary-strip{grid-template-columns:1fr 1fr 1fr}.client-summary-strip>div{padding:10px}.client-summary-strip strong{font-size:12px}.client-task{align-items:stretch;flex-direction:column;gap:10px}.client-task-actions{width:100%;flex-wrap:wrap}.client-task .inline-button{flex:1;text-align:center}.client-main-grid{grid-template-columns:1fr}.client-progress-mini{gap:5px}.client-progress-mini span{font-size:9px}.client-accordion-body{padding:12px}}
'''
p.write_text(s)
