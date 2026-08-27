from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

admin_path = Path('src/AdminPage.jsx')
admin = admin_path.read_text()

admin = replace_once(
    admin,
    "  const [pbsModalOpen, setPbsModalOpen] = useState(false);\n  const [dragStatusKey, setDragStatusKey] = useState(null);",
    "  const [pbsModalOpen, setPbsModalOpen] = useState(false);\n  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);\n  const [dragStatusKey, setDragStatusKey] = useState(null);",
    'mobile detail state'
)

admin = replace_once(
    admin,
    "    <header className=\"admin-topbar\">\n      <div className=\"admin-brand\"><div className=\"brand-mark\">COR</div><div><strong>COR UEZ</strong><span>Admin</span></div></div>\n      <div className=\"admin-top-actions\"><a href=\"/admin/email-settings\" className=\"email-settings-primary\">EMAIL SETTINGS</a><a href=\"/admin/signup-layout\">SIGNUP LAYOUT</a><a href=\"/admin/demo-client\" target=\"_blank\" rel=\"noreferrer\">DEMO CLIENT</a><a href=\"/\" target=\"_blank\" rel=\"noreferrer\">Open applicant site</a><button onClick={handleSignOut}>Log out</button></div>\n    </header>\n\n    <main className=\"admin-layout\">",
    "    <header className=\"admin-topbar\">\n      <div className=\"admin-brand\"><div className=\"brand-mark\">COR</div><div><strong>COR UEZ</strong><span>Admin</span></div></div>\n      <div className=\"admin-top-actions admin-desktop-actions\"><a href=\"/admin/email-settings\" className=\"email-settings-primary\">EMAIL SETTINGS</a><a href=\"/admin/signup-layout\">SIGNUP LAYOUT</a><a href=\"/admin/demo-client\" target=\"_blank\" rel=\"noreferrer\">DEMO CLIENT</a><a href=\"/\" target=\"_blank\" rel=\"noreferrer\">Open applicant site</a><button onClick={handleSignOut}>Log out</button></div>\n      <details className=\"admin-mobile-menu\">\n        <summary aria-label=\"Open admin menu\">•••</summary>\n        <div className=\"admin-mobile-menu-popover\">\n          <a href=\"/admin/email-settings\">Email settings</a>\n          <a href=\"/admin/signup-layout\">Signup layout</a>\n          <a href=\"/admin/demo-client\" target=\"_blank\" rel=\"noreferrer\">Demo client</a>\n          <a href=\"/\" target=\"_blank\" rel=\"noreferrer\">Applicant site</a>\n          <button onClick={handleSignOut}>Log out</button>\n        </div>\n      </details>\n    </header>\n\n    <main className={`admin-layout ${mobileDetailOpen ? 'mobile-detail-open' : 'mobile-list-open'}`}>",
    'mobile topbar and layout class'
)

admin = replace_once(
    admin,
    "onClick={() => openApplication(app.id)}",
    "onClick={() => { setMobileDetailOpen(true); openApplication(app.id); window.scrollTo({ top: 0, behavior: 'instant' }); }}",
    'mobile list open behavior'
)

admin = replace_once(
    admin,
    "      <section className=\"admin-detail\">\n        {message && <div className=\"admin-message\">{message}</div>}",
    "      <section className=\"admin-detail\">\n        {detail && <div className=\"mobile-detail-nav\">\n          <button type=\"button\" onClick={() => { setMobileDetailOpen(false); window.scrollTo({ top: 0, behavior: 'instant' }); }}>‹ Applicants</button>\n          <div><strong>{detail.application.business_name_input || 'Application'}</strong><small>{readyDocumentCount(detail)}/5 docs · {paymentStatusLabel(detail.payments?.[detail.payments.length - 1]?.status)}</small></div>\n        </div>}\n        {message && <div className=\"admin-message\">{message}</div>}",
    'mobile detail nav'
)

admin = replace_once(
    admin,
    "      setSelectedId(null);\n      setDetail(null);\n      setEditMode(false);",
    "      setSelectedId(null);\n      setDetail(null);\n      setMobileDetailOpen(false);\n      setEditMode(false);",
    'mobile reset after delete'
)

# Add a mobile-only warning to the extension-driven action panel without altering desktop behavior.
admin = replace_once(
    admin,
    "              <div className=\"ops-panel actions-panel\">\n                <div className=\"ops-action-grid clean-action-grid\">",
    "              <div className=\"ops-panel actions-panel\">\n                <div className=\"mobile-desktop-workflow-note\">Desktop automation · These workflow buttons use the COR Chrome extension.</div>\n                <div className=\"ops-action-grid clean-action-grid\">",
    'mobile desktop workflow note'
)

admin_path.write_text(admin)

css_path = Path('src/workflow.css')
css = css_path.read_text()
marker = '/* COR UEZ admin mobile layer */'
if marker in css:
    raise SystemExit('mobile admin CSS marker already exists')

css += r'''

/* COR UEZ admin mobile layer */
.admin-mobile-menu,
.mobile-detail-nav,
.mobile-desktop-workflow-note { display: none; }

@media (max-width: 767px) {
  /* Mobile is a reflow of the same admin. Desktop at 768px+ remains untouched. */
  body { overflow-x: hidden; }
  .admin-shell { min-height: 100dvh; background: #f6f7fb; }
  .admin-topbar {
    height: 60px;
    min-height: 60px;
    padding: 0 12px;
    gap: 10px;
    z-index: 80;
  }
  .admin-brand { gap: 8px; }
  .admin-brand .brand-mark { width: 36px; height: 36px; border-radius: 11px; font-size: 12px; }
  .admin-brand strong { font-size: 14px; }
  .admin-brand span { font-size: 10px; }
  .admin-desktop-actions { display: none !important; }

  .admin-mobile-menu { display: block; margin-left: auto; position: relative; }
  .admin-mobile-menu summary {
    list-style: none;
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border-radius: 12px;
    background: #f1f3f7;
    color: #49516a;
    font-size: 18px;
    font-weight: 900;
    letter-spacing: .08em;
    cursor: pointer;
  }
  .admin-mobile-menu summary::-webkit-details-marker { display: none; }
  .admin-mobile-menu-popover {
    position: absolute;
    top: 48px;
    right: 0;
    width: 210px;
    padding: 7px;
    border: 1px solid #e1e5ed;
    border-radius: 15px;
    background: #fff;
    box-shadow: 0 18px 44px rgba(27,34,65,.18);
    display: grid;
    z-index: 100;
  }
  .admin-mobile-menu-popover a,
  .admin-mobile-menu-popover button {
    width: 100%;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: #39425b;
    padding: 11px 12px;
    text-align: left;
    text-decoration: none;
    font-size: 13px;
    font-weight: 750;
  }
  .admin-mobile-menu-popover a:active,
  .admin-mobile-menu-popover button:active { background: #f2f3fa; }
  .admin-mobile-menu-popover button { color: #a04444; }

  .admin-layout {
    display: block;
    min-height: calc(100dvh - 60px);
  }

  /* App-style list/detail navigation: one surface at a time. */
  .mobile-list-open .admin-sidebar { display: block; }
  .mobile-list-open .admin-detail { display: none; }
  .mobile-detail-open .admin-sidebar { display: none; }
  .mobile-detail-open .admin-detail { display: block; }

  .admin-sidebar {
    min-height: calc(100dvh - 60px);
    border: 0;
    background: #f6f7fb;
    overflow: visible;
  }
  .admin-sidebar-head {
    position: sticky;
    top: 60px;
    z-index: 35;
    padding: 14px 12px 9px;
    background: rgba(246,247,251,.96);
    backdrop-filter: blur(14px);
  }
  .admin-sidebar-head > div { margin-bottom: 9px; }
  .admin-sidebar-head > div strong { font-size: 20px; }
  .admin-sidebar-head input {
    min-height: 44px;
    border-radius: 13px;
    background: #fff;
    box-shadow: 0 1px 0 rgba(39,45,72,.04);
  }
  .admin-filter-row {
    position: sticky;
    top: 131px;
    z-index: 34;
    grid-template-columns: repeat(3, minmax(0,1fr));
    gap: 6px;
    padding: 0 12px 10px;
    border: 0;
    background: rgba(246,247,251,.96);
    backdrop-filter: blur(14px);
  }
  .admin-filter-row button {
    min-height: 45px;
    padding: 7px 4px;
    border: 1px solid #e4e7ee;
    background: #fff;
    border-radius: 12px;
    font-size: 10px;
  }
  .admin-filter-row button.active { border-color: #676fe0; background: #676fe0; }
  .application-list {
    max-height: none;
    overflow: visible;
    padding: 3px 10px calc(28px + env(safe-area-inset-bottom));
  }
  .application-list-item {
    min-height: 82px;
    margin: 7px 0;
    padding: 14px 13px;
    border: 1px solid #e3e6ee;
    border-radius: 15px;
    box-shadow: 0 5px 18px rgba(32,39,77,.045);
    grid-template-columns: minmax(0,1fr) auto;
    align-items: center;
  }
  .application-list-item.active { box-shadow: 0 5px 18px rgba(32,39,77,.045); background: #fff; }
  .ops-list-main strong { font-size: 14px; line-height: 1.25; }
  .ops-list-main small { margin-top: 6px; font-size: 11px; }
  .list-item-meta { min-width: 84px; }
  .mini-status { font-size: 8px; padding: 5px 7px; }
  .list-item-meta small { font-size: 10px; }

  .admin-detail {
    padding: 0 10px calc(32px + env(safe-area-inset-bottom));
    overflow: visible;
  }
  .mobile-detail-nav {
    display: flex;
    align-items: center;
    gap: 10px;
    position: sticky;
    top: 60px;
    z-index: 36;
    min-height: 58px;
    margin: 0 -10px 12px;
    padding: 8px 10px;
    border-bottom: 1px solid #e4e7ee;
    background: rgba(255,255,255,.97);
    backdrop-filter: blur(14px);
  }
  .mobile-detail-nav > button {
    flex: 0 0 auto;
    border: 0;
    border-radius: 11px;
    background: #f1f2f7;
    color: #525bd0;
    padding: 9px 10px;
    font-size: 12px;
    font-weight: 850;
  }
  .mobile-detail-nav > div { min-width: 0; }
  .mobile-detail-nav strong,
  .mobile-detail-nav small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mobile-detail-nav strong { font-size: 12px; color: #293149; }
  .mobile-detail-nav small { margin-top: 2px; color: #8a91a2; font-size: 9px; }

  .admin-message {
    position: sticky;
    top: 126px;
    z-index: 30;
    margin: 0 0 10px;
    box-shadow: 0 8px 22px rgba(65,72,140,.08);
  }
  .cockpit-header {
    display: block;
    margin: 0 2px 10px;
    padding: 4px 2px 0;
  }
  .cockpit-header .eyebrow { margin-bottom: 5px; font-size: 9px; }
  .admin-detail-header h1 { font-size: 25px; line-height: 1.08; margin: 2px 0 7px; }
  .admin-detail-header p { font-size: 12px; line-height: 1.5; }
  .cockpit-header-chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .cockpit-chip { min-height: 31px; display: inline-flex; align-items: center; }

  .admin-edit-actions {
    display: grid;
    grid-template-columns: minmax(0,1fr) auto;
    gap: 8px;
    margin: 0 0 10px;
  }
  .admin-edit-actions button { width: 100%; min-width: 0; min-height: 43px; }
  .admin-edit-actions .admin-delete-button { width: auto; font-size: 0; min-width: 43px; padding: 8px; }
  .admin-edit-actions .admin-delete-button::after { content: 'Delete'; font-size: 10px; }

  .ops-cockpit { margin: 0; }
  .ops-attention-strip {
    margin: 0 0 10px;
    border-radius: 15px;
    padding: 13px;
  }
  .ops-attention-strip > strong { font-size: 12px; }
  .ops-attention-strip div { gap: 6px; }
  .ops-attention-strip span { font-size: 11px; }

  .ops-cockpit-grid {
    display: flex !important;
    flex-direction: column;
    gap: 10px !important;
  }
  .ops-panel {
    width: 100%;
    border-radius: 16px !important;
    box-shadow: none !important;
  }
  /* On a phone, things that can actually be handled on the phone come first. */
  .status-panel { order: 1; }
  .documents-panel { order: 2; }
  .actions-panel { order: 3; }
  .ops-panel-head { padding: 14px 14px 9px; }
  .ops-panel-head h3 { font-size: 15px; }
  .compact-status-grid { padding: 0 10px 11px; }
  .compact-status-item {
    min-height: 48px;
    padding: 8px 5px;
  }
  .compact-status-item > span { font-size: 11px; }
  .sortable-status-row { grid-template-columns: 18px minmax(82px,1fr) auto !important; }
  .drag-handle { display: none; }
  .tiny-toggle button,
  .tiny-confirm,
  .compact-status-item select { min-height: 34px; }

  .ops-doc-list { padding: 0 10px 11px; }
  .ops-doc-row {
    min-height: 52px;
    padding: 8px 9px !important;
    border-radius: 10px;
    margin-top: 5px;
  }
  .ops-doc-name { min-width: 0; }
  .ops-doc-name span { font-size: 12px; white-space: normal; text-align: left; }
  .ops-doc-row small { font-size: 10px; text-align: right; }

  .mobile-desktop-workflow-note {
    display: block;
    margin: 12px 12px 4px;
    padding: 9px 10px;
    border-radius: 10px;
    background: #f5f6fa;
    color: #7a8192;
    font-size: 10px;
    line-height: 1.4;
  }
  .ops-action-grid.clean-action-grid {
    grid-template-columns: repeat(2,minmax(0,1fr)) !important;
    gap: 8px !important;
    padding: 8px 10px 11px !important;
  }
  .actions-panel .ops-action {
    min-height: 72px;
    border-radius: 13px;
    padding: 11px 8px;
  }
  .actions-panel .ops-action span { font-size: 9px; }
  .actions-panel .ops-action strong { font-size: 12px; }

  .admin-details-heading {
    margin: 16px 2px 8px;
    padding: 0;
  }
  .admin-details-heading span { font-size: 10px; }
  .admin-details-heading small { display: none; }
  .admin-card-grid { display: block !important; }
  .admin-accordion {
    display: block;
    margin: 0 0 8px;
    border-radius: 14px;
    overflow: hidden;
  }
  .admin-accordion summary {
    min-height: 52px;
    padding: 12px 13px !important;
    gap: 10px;
  }
  .admin-accordion summary strong { font-size: 13px; }
  .admin-accordion summary span { font-size: 10px; }
  .admin-card.admin-secondary-card {
    border: 0;
    border-top: 1px solid #e8eaf0;
    border-radius: 0;
    padding: 14px;
    box-shadow: none;
  }
  .admin-card-head { align-items: flex-start; }
  .admin-card-head h3 { font-size: 15px; }
  .data-grid,
  .admin-edit-grid,
  .owner-edit-grid,
  .credential-grid { grid-template-columns: 1fr !important; }
  .data-grid > div { padding: 10px 0; }
  .admin-edit-grid { gap: 8px; }
  .admin-edit-grid input,
  .admin-edit-grid select,
  .admin-edit-grid textarea,
  .brc-result-form input,
  .credential-edit-grid input { min-height: 44px; font-size: 16px; }
  .admin-action-row { grid-template-columns: 1fr !important; }
  .admin-action-row button,
  .admin-full-button { min-height: 44px; }

  /* Document preview should feel like a phone sheet, not a squeezed desktop modal. */
  .document-modal-overlay { padding: 0 !important; align-items: stretch !important; }
  .document-modal {
    width: 100vw !important;
    max-width: none !important;
    height: 100dvh !important;
    max-height: none !important;
    border-radius: 0 !important;
  }
  .document-modal-body { min-height: 0; flex: 1; }
  .document-modal-body iframe,
  .document-modal-body embed,
  .document-modal-body object { height: 100% !important; min-height: 62dvh; }
  .document-modal-footer { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
}
'''
css_path.write_text(css)
