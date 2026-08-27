from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

# -----------------------------------------------------------------------------
# Backend: keep field order guardrails, add per-field 1/2-column span metadata.
# Legacy saved layouts without widths remain valid and receive safe defaults.
# -----------------------------------------------------------------------------
backend_path = Path('backend/routes/uez.js')
backend = backend_path.read_text()

old_default = """const DEFAULT_SIGNUP_LAYOUT = {
  account: ['email', 'password'],
  business: ['businessName', 'businessDescription', 'ein', 'yearFounded', 'hasDba', 'dbaName', 'fullTimeEmployees', 'partTimeEmployees'],
  ownerCore: ['title', 'firstName', 'lastName', 'email', 'phone', 'dob', 'ssn', 'ownershipPercent'],
  ownerAddress: ['addressLine1', 'addressLine2', 'city', 'state', 'zip'],
  documents: ['formation', 'soleProp', 'supporting']
};

function validateSignupLayout(layout) {
  const clean = {};
  for (const [group, defaults] of Object.entries(DEFAULT_SIGNUP_LAYOUT)) {
    const received = Array.isArray(layout?.[group]) ? layout[group] : defaults;
    if (received.length !== defaults.length || new Set(received).size !== defaults.length || received.some((key) => !defaults.includes(key))) {
      throw new Error(`Invalid signup layout for ${group}. Fields can only be reordered within their existing page.`);
    }
    clean[group] = received;
  }
  return clean;
}
"""

new_default = """const DEFAULT_SIGNUP_LAYOUT = {
  account: ['email', 'password'],
  business: ['businessName', 'businessDescription', 'ein', 'yearFounded', 'hasDba', 'dbaName', 'fullTimeEmployees', 'partTimeEmployees'],
  ownerCore: ['title', 'firstName', 'lastName', 'email', 'phone', 'dob', 'ssn', 'ownershipPercent'],
  ownerAddress: ['addressLine1', 'addressLine2', 'city', 'state', 'zip'],
  documents: ['formation', 'soleProp', 'supporting'],
  widths: {
    account: { email: 1, password: 1 },
    business: { businessName: 2, businessDescription: 2, ein: 1, yearFounded: 1, hasDba: 1, dbaName: 1, fullTimeEmployees: 1, partTimeEmployees: 1 },
    ownerCore: { title: 1, firstName: 1, lastName: 1, email: 1, phone: 1, dob: 1, ssn: 1, ownershipPercent: 1 },
    ownerAddress: { addressLine1: 1, addressLine2: 1, city: 1, state: 1, zip: 1 },
    documents: { formation: 2, soleProp: 2, supporting: 2 }
  }
};

function validateSignupLayout(layout) {
  const clean = { widths: {} };
  for (const [group, defaults] of Object.entries(DEFAULT_SIGNUP_LAYOUT)) {
    if (group === 'widths') continue;
    const received = Array.isArray(layout?.[group]) ? layout[group] : defaults;
    if (received.length !== defaults.length || new Set(received).size !== defaults.length || received.some((key) => !defaults.includes(key))) {
      throw new Error(`Invalid signup layout for ${group}. Fields can only be reordered within their existing page.`);
    }
    clean[group] = received;
    clean.widths[group] = {};
    for (const key of defaults) {
      const requested = Number(layout?.widths?.[group]?.[key]);
      clean.widths[group][key] = requested === 2 ? 2 : requested === 1 ? 1 : (DEFAULT_SIGNUP_LAYOUT.widths[group][key] || 1);
    }
  }
  return clean;
}
"""
backend = replace_once(backend, old_default, new_default, 'backend layout defaults')
backend_path.write_text(backend)

# -----------------------------------------------------------------------------
# Client intake: consume saved spans on the actual real fields.
# -----------------------------------------------------------------------------
app_path = Path('src/App.jsx')
app = app_path.read_text()

old_app_default = """const DEFAULT_SIGNUP_LAYOUT = {
  account: ['email', 'password'],
  business: ['businessName', 'businessDescription', 'ein', 'yearFounded', 'hasDba', 'dbaName', 'fullTimeEmployees', 'partTimeEmployees'],
  ownerCore: ['title', 'firstName', 'lastName', 'email', 'phone', 'dob', 'ssn', 'ownershipPercent'],
  ownerAddress: ['addressLine1', 'addressLine2', 'city', 'state', 'zip'],
  documents: ['formation', 'soleProp', 'supporting']
};
"""
new_app_default = """const DEFAULT_SIGNUP_LAYOUT = {
  account: ['email', 'password'],
  business: ['businessName', 'businessDescription', 'ein', 'yearFounded', 'hasDba', 'dbaName', 'fullTimeEmployees', 'partTimeEmployees'],
  ownerCore: ['title', 'firstName', 'lastName', 'email', 'phone', 'dob', 'ssn', 'ownershipPercent'],
  ownerAddress: ['addressLine1', 'addressLine2', 'city', 'state', 'zip'],
  documents: ['formation', 'soleProp', 'supporting'],
  widths: {
    account: { email: 1, password: 1 },
    business: { businessName: 2, businessDescription: 2, ein: 1, yearFounded: 1, hasDba: 1, dbaName: 1, fullTimeEmployees: 1, partTimeEmployees: 1 },
    ownerCore: { title: 1, firstName: 1, lastName: 1, email: 1, phone: 1, dob: 1, ssn: 1, ownershipPercent: 1 },
    ownerAddress: { addressLine1: 1, addressLine2: 1, city: 1, state: 1, zip: 1 },
    documents: { formation: 2, soleProp: 2, supporting: 2 }
  }
};

function signupFieldClass(layout, group, key) {
  return Number(layout?.widths?.[group]?.[key]) === 2 ? 'field-span-2' : '';
}
"""
app = replace_once(app, old_app_default, new_app_default, 'app layout defaults')

# Account fields.
app = replace_once(
    app,
    """{signupLayout.account.map((key) => key === 'email'
              ? <div key={key}><label>Email <span className=\"required-star\">*</span></label><input type=\"email\" value={form.email} onChange={update('email')} required /></div>
              : <div key={key}><label>Password <span className=\"required-star\">*</span></label><input type=\"password\" value={form.password} onChange={update('password')} required minLength=\"6\" /></div>)}""",
    """{signupLayout.account.map((key) => key === 'email'
              ? <div className={signupFieldClass(signupLayout, 'account', key)} key={key}><label>Email <span className=\"required-star\">*</span></label><input type=\"email\" value={form.email} onChange={update('email')} required /></div>
              : <div className={signupFieldClass(signupLayout, 'account', key)} key={key}><label>Password <span className=\"required-star\">*</span></label><input type=\"password\" value={form.password} onChange={update('password')} required minLength=\"6\" /></div>)}""",
    'account span classes'
)

# Business field roots.
replacements = [
("if (key === 'businessName') return <div className=\"field-span-2\" key={key}>", "if (key === 'businessName') return <div className={signupFieldClass(signupLayout, 'business', key)} key={key}>"),
("if (key === 'businessDescription') return <div className=\"field-span-2\" key={key}>", "if (key === 'businessDescription') return <div className={signupFieldClass(signupLayout, 'business', key)} key={key}>"),
("if (key === 'ein') return <div key={key}>", "if (key === 'ein') return <div className={signupFieldClass(signupLayout, 'business', key)} key={key}>"),
("if (key === 'yearFounded') return <div key={key}>", "if (key === 'yearFounded') return <div className={signupFieldClass(signupLayout, 'business', key)} key={key}>"),
("if (key === 'hasDba') return <div key={key}>", "if (key === 'hasDba') return <div className={signupFieldClass(signupLayout, 'business', key)} key={key}>"),
("if (key === 'dbaName') return form.hasDba === 'yes' ? <div key={key}>", "if (key === 'dbaName') return form.hasDba === 'yes' ? <div className={signupFieldClass(signupLayout, 'business', key)} key={key}>"),
("if (key === 'fullTimeEmployees') return <div key={key}>", "if (key === 'fullTimeEmployees') return <div className={signupFieldClass(signupLayout, 'business', key)} key={key}>"),
("if (key === 'partTimeEmployees') return <div key={key}>", "if (key === 'partTimeEmployees') return <div className={signupFieldClass(signupLayout, 'business', key)} key={key}>"),
]
for old, new in replacements:
    app = replace_once(app, old, new, f'business class {old[:35]}')

# Owner main and address roots.
owner_replacements = [
("if (key === 'title') return <React.Fragment key={key}><div>", "if (key === 'title') return <React.Fragment key={key}><div className={signupFieldClass(signupLayout, 'ownerCore', key)}>"),
("if (key === 'firstName') return <div key={key}>", "if (key === 'firstName') return <div className={signupFieldClass(signupLayout, 'ownerCore', key)} key={key}>"),
("if (key === 'lastName') return <div key={key}>", "if (key === 'lastName') return <div className={signupFieldClass(signupLayout, 'ownerCore', key)} key={key}>"),
("if (key === 'email') return <div key={key}>", "if (key === 'email') return <div className={signupFieldClass(signupLayout, 'ownerCore', key)} key={key}>"),
("if (key === 'phone') return <div key={key}>", "if (key === 'phone') return <div className={signupFieldClass(signupLayout, 'ownerCore', key)} key={key}>"),
("if (key === 'dob') return <div key={key}>", "if (key === 'dob') return <div className={signupFieldClass(signupLayout, 'ownerCore', key)} key={key}>"),
("if (key === 'ssn') return <div key={key}>", "if (key === 'ssn') return <div className={signupFieldClass(signupLayout, 'ownerCore', key)} key={key}>"),
("if (key === 'ownershipPercent') return !primaryIs100 ? <div key={key}>", "if (key === 'ownershipPercent') return !primaryIs100 ? <div className={signupFieldClass(signupLayout, 'ownerCore', key)} key={key}>"),
("if (key === 'addressLine1') return <div key={key}>", "if (key === 'addressLine1') return <div className={signupFieldClass(signupLayout, 'ownerAddress', key)} key={key}>"),
("if (key === 'addressLine2') return <div key={key}>", "if (key === 'addressLine2') return <div className={signupFieldClass(signupLayout, 'ownerAddress', key)} key={key}>"),
("if (key === 'city') return <div key={key}>", "if (key === 'city') return <div className={signupFieldClass(signupLayout, 'ownerAddress', key)} key={key}>"),
("if (key === 'state') return <div key={key}>", "if (key === 'state') return <div className={signupFieldClass(signupLayout, 'ownerAddress', key)} key={key}>"),
("if (key === 'zip') return <div key={key}>", "if (key === 'zip') return <div className={signupFieldClass(signupLayout, 'ownerAddress', key)} key={key}>"),
]
for old, new in owner_replacements:
    app = replace_once(app, old, new, f'owner class {old[:35]}')

# Documents become a two-column visual grid with saved spans.
app = replace_once(
    app,
    "if (key === 'formation') return <div className=\"upload-card formation-choice-card\" key={key}>",
    "if (key === 'formation') return <div className={`upload-card formation-choice-card ${signupFieldClass(signupLayout, 'documents', key)}`} key={key}>",
    'formation document span'
)
app = replace_once(
    app,
    "if (key === 'soleProp') return !hasFormation ? <div className={`sole-prop-choice ${solePropConfirmedHere ? 'selected' : ''}`} key={key}>",
    "if (key === 'soleProp') return !hasFormation ? <div className={`sole-prop-choice ${solePropConfirmedHere ? 'selected' : ''} ${signupFieldClass(signupLayout, 'documents', key)}`} key={key}>",
    'sole prop document span'
)
app = replace_once(
    app,
    "if (key === 'supporting') return <div className=\"upload-card\" key={key}>",
    "if (key === 'supporting') return <div className={`upload-card ${signupFieldClass(signupLayout, 'documents', key)}`} key={key}>",
    'supporting document span'
)
app_path.write_text(app)

# -----------------------------------------------------------------------------
# Admin visual layout editor: real two-column canvas + full-row/half-row controls.
# -----------------------------------------------------------------------------
layout_path = Path('src/SignupLayoutPage.jsx')
layout_page = layout_path.read_text()

layout_page = replace_once(
    layout_page,
    """  function move(group, from, to) {
    if (to < 0 || to >= layout[group].length || from === to) return;
    setLayout((old) => {
      const next = [...old[group]];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return { ...old, [group]: next };
    });
  }
""",
    """  function move(group, from, to) {
    if (to < 0 || to >= layout[group].length || from === to) return;
    setLayout((old) => {
      const next = [...old[group]];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return { ...old, [group]: next };
    });
  }

  function setSpan(group, key, span) {
    setLayout((old) => ({
      ...old,
      widths: {
        ...(old.widths || {}),
        [group]: { ...(old.widths?.[group] || {}), [key]: span }
      }
    }));
  }

  function spanFor(group, key) {
    return Number(layout.widths?.[group]?.[key]) === 2 ? 2 : 1;
  }
""",
    'layout span functions'
)

layout_page = replace_once(
    layout_page,
    "setMessage('Signup field order saved. New applicants will see this order.');",
    "setMessage('Signup layout saved. Field order and row widths are live for new applicants.');",
    'layout save message'
)

layout_page = replace_once(
    layout_page,
    "<div className=\"signup-layout-heading\"><div><span className=\"eyebrow\">CLIENT SIGNUP</span><h1>Arrange signup fields</h1><p>Drag fields to reorder them. Guardrails keep every field on its current page so validation and saving continue to work correctly.</p></div><div className=\"layout-actions\">",
    "<div className=\"signup-layout-heading\"><div><span className=\"eyebrow\">CLIENT SIGNUP</span><h1>Arrange the actual form grid</h1><p>Drag fields into order, then choose whether each field takes half a row or the full row by itself. Guardrails keep every field on its current signup page.</p></div><div className=\"layout-actions\">",
    'layout heading'
)

old_group_markup = """          <div className=\"layout-list\">
            {layout[group].map((key, index) => <div
              key={key}
              className={`layout-row ${drag?.group === group && drag?.index === index ? 'dragging' : ''}`}
              draggable
              onDragStart={() => setDrag({ group, index })}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (drag?.group === group) move(group, drag.index, index); setDrag(null); }}
            >
              <span className=\"drag-handle\" aria-hidden=\"true\">⋮⋮</span><strong>{info.fields[key] || key}</strong>
              <div className=\"layout-row-actions\"><button title=\"Move up\" onClick={() => move(group, index, index - 1)} disabled={index === 0}>↑</button><button title=\"Move down\" onClick={() => move(group, index, index + 1)} disabled={index === layout[group].length - 1}>↓</button></div>
            </div>)}
          </div>"""
new_group_markup = """          <div className=\"layout-visual-grid\">
            {layout[group].map((key, index) => <div
              key={key}
              className={`layout-field-tile ${spanFor(group, key) === 2 ? 'span-full' : 'span-half'} ${drag?.group === group && drag?.index === index ? 'dragging' : ''}`}
              draggable
              onDragStart={() => setDrag({ group, index })}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (drag?.group === group) move(group, drag.index, index); setDrag(null); }}
            >
              <div className=\"layout-field-main\"><span className=\"drag-handle\" aria-hidden=\"true\">⋮⋮</span><strong>{info.fields[key] || key}</strong></div>
              <div className=\"layout-field-controls\">
                <div className=\"layout-span-toggle\" aria-label={`Width for ${info.fields[key] || key}`}>
                  <button type=\"button\" className={spanFor(group, key) === 1 ? 'active' : ''} onClick={() => setSpan(group, key, 1)}>Half row</button>
                  <button type=\"button\" className={spanFor(group, key) === 2 ? 'active' : ''} onClick={() => setSpan(group, key, 2)}>Full row</button>
                </div>
                <div className=\"layout-row-actions\"><button title=\"Move up\" onClick={() => move(group, index, index - 1)} disabled={index === 0}>↑</button><button title=\"Move down\" onClick={() => move(group, index, index + 1)} disabled={index === layout[group].length - 1}>↓</button></div>
              </div>
            </div>)}
          </div>"""
layout_page = replace_once(layout_page, old_group_markup, new_group_markup, 'visual grid markup')
layout_path.write_text(layout_page)

# -----------------------------------------------------------------------------
# Visit counter: data already exists; move it to a visible place and show 30-day.
# -----------------------------------------------------------------------------
counter_path = Path('src/AdminVisitCounter.jsx')
counter = counter_path.read_text()
counter = replace_once(
    counter,
    "const locateHost = () => setHost(document.querySelector('.admin-top-actions'));",
    "const locateHost = () => setHost(document.querySelector('.admin-sidebar-head'));",
    'visit counter host'
)
counter = replace_once(
    counter,
    """      <div><span>7 days</span><strong>{stats.last7Days}</strong></div>
      <div><span>Total</span><strong>{stats.total}</strong></div>""",
    """      <div><span>7 days</span><strong>{stats.last7Days}</strong></div>
      <div><span>30 days</span><strong>{stats.last30Days}</strong></div>
      <div><span>Total</span><strong>{stats.total}</strong></div>""",
    'visit counter 30 days'
)
counter_path.write_text(counter)

analytics_css_path = Path('src/analytics.css')
analytics_css = analytics_css_path.read_text()
analytics_css = """.admin-visit-counter{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin-top:10px;overflow:hidden;border:1px solid #e2e5ee;border-radius:12px;background:#f7f8fc;color:#273047}.admin-visit-counter>div{min-width:0;padding:8px 5px;text-align:center}.admin-visit-counter>div+div{border-left:1px solid #e2e5ee}.admin-visit-counter span{display:block;font-size:8px;font-weight:850;line-height:1.15;text-transform:uppercase;letter-spacing:.05em;color:#8b92a4}.admin-visit-counter strong{display:block;margin-top:3px;font-size:17px;line-height:1.05;color:#303952}@media(max-width:767px){.admin-visit-counter{margin-top:9px;background:#fff}.admin-visit-counter>div{padding:7px 4px}.admin-visit-counter strong{font-size:16px}}
"""
analytics_css_path.write_text(analytics_css)

# -----------------------------------------------------------------------------
# Styling for the real client grid + visual admin form builder.
# -----------------------------------------------------------------------------
styles_path = Path('src/styles.css')
styles = styles_path.read_text()

styles = replace_once(
    styles,
    ".ordered-field-grid{align-items:start}.field-span-2{grid-column:1/-1}.ordered-documents{display:grid;gap:14px}",
    ".ordered-field-grid{align-items:start}.field-span-2{grid-column:1/-1}.ordered-documents{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}",
    'ordered documents grid'
)

old_layout_css = ".layout-list{display:grid;gap:8px;padding:16px}.layout-row{display:grid;grid-template-columns:28px 1fr auto;align-items:center;gap:10px;padding:12px 14px;border:1px solid #e3e6ef;border-radius:12px;background:#fff;cursor:grab}.layout-row.dragging{opacity:.45}.drag-handle{font-size:20px;color:#9aa0b2;letter-spacing:-4px}.layout-row-actions{display:flex;gap:6px}.layout-row-actions button{width:32px;height:32px;border:1px solid #e0e3ec;background:#f7f8fb;border-radius:9px;color:#596176;font-weight:800}.layout-row-actions button:disabled{opacity:.28}"
new_layout_css = ".layout-visual-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:16px;background:linear-gradient(90deg,transparent calc(50% - .5px),#edf0f5 calc(50% - .5px),#edf0f5 calc(50% + .5px),transparent calc(50% + .5px))}.layout-field-tile{min-width:0;padding:12px;border:1px solid #dfe3ec;border-radius:13px;background:#fff;box-shadow:0 3px 12px rgba(35,43,80,.04);cursor:grab}.layout-field-tile.span-full{grid-column:1/-1}.layout-field-tile.dragging{opacity:.45}.layout-field-main{display:flex;align-items:center;gap:9px;min-height:28px}.layout-field-main strong{font-size:13px;line-height:1.3}.drag-handle{font-size:20px;color:#9aa0b2;letter-spacing:-4px}.layout-field-controls{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}.layout-span-toggle{display:flex;gap:3px;padding:3px;border-radius:9px;background:#f2f3f7}.layout-span-toggle button{border:0;border-radius:7px;background:transparent;color:#7a8192;padding:6px 8px;font-size:9px;font-weight:850}.layout-span-toggle button.active{background:#fff;color:#555fd1;box-shadow:0 1px 4px rgba(31,38,73,.11)}.layout-row-actions{display:flex;gap:5px}.layout-row-actions button{width:30px;height:30px;border:1px solid #e0e3ec;background:#f7f8fb;border-radius:8px;color:#596176;font-weight:800}.layout-row-actions button:disabled{opacity:.28}"
styles = replace_once(styles, old_layout_css, new_layout_css, 'visual layout css')

styles = replace_once(
    styles,
    "@media(max-width:760px){.signup-layout-heading{align-items:stretch;flex-direction:column}.layout-actions{width:100%}.layout-actions button{flex:1}.field-span-2{grid-column:auto}.layout-row{grid-template-columns:24px 1fr auto;padding:11px 10px}.signup-layout-wrap{width:min(100% - 20px,980px);padding-top:24px}}",
    "@media(max-width:760px){.signup-layout-heading{align-items:stretch;flex-direction:column}.layout-actions{width:100%}.layout-actions button{flex:1}.field-span-2{grid-column:auto}.ordered-documents{grid-template-columns:1fr}.layout-visual-grid{grid-template-columns:1fr;background:none}.layout-field-tile.span-full{grid-column:auto}.layout-field-controls{align-items:flex-start;flex-direction:column}.layout-span-toggle{width:100%}.layout-span-toggle button{flex:1}.layout-row-actions{align-self:flex-end}.signup-layout-wrap{width:min(100% - 20px,980px);padding-top:24px}}",
    'layout mobile css'
)
styles_path.write_text(styles)

# Mobile admin: visit counter increases sticky header height, so do not overlap filters.
workflow_css_path = Path('src/workflow.css')
workflow_css = workflow_css_path.read_text()
workflow_css = replace_once(
    workflow_css,
    "  .admin-filter-row {\n    position: sticky;\n    top: 131px;",
    "  .admin-filter-row {\n    position: static;\n    top: auto;",
    'mobile filters after visit counter'
)
workflow_css_path.write_text(workflow_css)
