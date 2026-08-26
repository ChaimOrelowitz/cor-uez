from pathlib import Path


def rep(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'missing {label} in {path}')
    p.write_text(s.replace(old, new, 1))

rep('src/App.jsx',
"const blankOwner = () => ({ firstName: '', lastName: '', email: '', phone: '', dob: '', ssn: '', ownershipPercent: '', addressLine1: '', addressLine2: '', city: '', state: '', zip: '' });",
"const blankOwner = () => ({ title: '', titleOther: '', firstName: '', lastName: '', email: '', phone: '', dob: '', ssn: '', ownershipPercent: '', addressLine1: '', addressLine2: '', city: '', state: '', zip: '' });",
'blank owner title')

rep('src/App.jsx',
"""            firstName: owner.first_name || '',
            lastName: owner.last_name || '',""",
"""            title: ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Rabbi'].includes(owner.honorific_title) ? owner.honorific_title : (owner.honorific_title ? 'Other' : ''),
            titleOther: ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Rabbi'].includes(owner.honorific_title) ? '' : (owner.honorific_title || ''),
            firstName: owner.first_name || '',
            lastName: owner.last_name || '',""",
'load owner title')

rep('src/App.jsx',
"""    const incomplete = ownersForSave.some((owner) =>
      !owner.firstName || !owner.lastName || !owner.email || !owner.phone || !owner.dob ||""",
"""    const incomplete = ownersForSave.some((owner) =>
      !owner.title || (owner.title === 'Other' && !owner.titleOther?.trim()) || !owner.firstName || !owner.lastName || !owner.email || !owner.phone || !owner.dob ||""",
'validate owner title')

rep('src/App.jsx',
"""      await saveOwners(applicationId, ownersForSave);""",
"""      const ownersPayload = ownersForSave.map((owner) => ({
        ...owner,
        title: owner.title === 'Other' ? owner.titleOther.trim() : owner.title
      }));
      await saveOwners(applicationId, ownersPayload);""",
'persist owner title')

rep('src/App.jsx',
"""            <div className=\"field-grid\">
              <div><label>First name <span className=\"required-star\">*</span></label><input required value={owner.firstName} onChange={updateOwner(index, 'firstName')} /></div>""",
"""            <div className=\"field-grid\">
              <div><label>Title <span className=\"required-star\">*</span></label><select required value={owner.title || ''} onChange={updateOwner(index, 'title')}><option value=\"\" disabled>Select title</option><option value=\"Mr.\">Mr.</option><option value=\"Mrs.\">Mrs.</option><option value=\"Ms.\">Ms.</option><option value=\"Dr.\">Dr.</option><option value=\"Rabbi\">Rabbi</option><option value=\"Other\">Other</option></select></div>
              {owner.title === 'Other' && <div><label>Other title <span className=\"required-star\">*</span></label><input required value={owner.titleOther || ''} onChange={updateOwner(index, 'titleOther')} /></div>}
              <div><label>First name <span className=\"required-star\">*</span></label><input required value={owner.firstName} onChange={updateOwner(index, 'firstName')} /></div>""",
'title UI')

rep('backend/routes/uez.js',
"""      first_name: String(owner.firstName || '').trim(),
      last_name: String(owner.lastName || '').trim(),""",
"""      honorific_title: String(owner.title || '').trim(),
      first_name: String(owner.firstName || '').trim(),
      last_name: String(owner.lastName || '').trim(),""",
'owner title row')

rep('backend/routes/uez.js',
"""    if (rows.some((row) => !row.first_name || !row.last_name)) throw new Error('Each owner requires a first and last name.');""",
"""    if (req.user.role !== 'admin' && rows.some((row) => !row.honorific_title)) throw new Error('Each owner requires a title.');
    if (rows.some((row) => !row.first_name || !row.last_name)) throw new Error('Each owner requires a first and last name.');""",
'backend title validation')

rep('backend/routes/uez.js',
"""      .select('id, owner_order, first_name, last_name, email, phone, ownership_percent, position_title, created_at, updated_at')""",
"""      .select('id, owner_order, honorific_title, first_name, last_name, email, phone, ownership_percent, position_title, address_line1, address_line2, city, state, zip, created_at, updated_at')""",
'owner response fields')

rep('backend/routes/uez.js',
"""      .select('id, owner_order, first_name, last_name, email, phone, ownership_percent, position_title')""",
"""      .select('id, owner_order, honorific_title, first_name, last_name, email, phone, ownership_percent, position_title, address_line1, address_line2, city, state, zip')""",
'bundle owner fields')

rep('backend/routes/uez.js',
"""    if (submittedOwners.some((owner) => !String(owner.first_name || '').trim() || !String(owner.last_name || '').trim() || !String(owner.email || '').trim()""",
"""    if (submittedOwners.some((owner) => !String(owner.honorific_title || '').trim() || !String(owner.first_name || '').trim() || !String(owner.last_name || '').trim() || !String(owner.email || '').trim()""",
'final submit title validation')
