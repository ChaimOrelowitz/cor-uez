from pathlib import Path


def rep(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'missing {label} in {path}')
    p.write_text(s.replace(old, new, 1))

rep('src/App.jsx',
"const blankOwner = () => ({ firstName: '', lastName: '', email: '', phone: '', dob: '', ssn: '', ownershipPercent: '' });",
"const blankOwner = () => ({ firstName: '', lastName: '', email: '', phone: '', dob: '', ssn: '', ownershipPercent: '', addressLine1: '', addressLine2: '', city: '', state: 'NJ', zip: '' });",
'blank owner address fields')

rep('src/App.jsx',
"""    const incomplete = ownersForSave.some((owner) =>
      !owner.firstName || !owner.lastName || !owner.email || !owner.phone || !owner.dob ||
      String(owner.ssn || '').replace(/\D/g, '').length !== 9 || !owner.ownershipPercent
    );
    if (incomplete) {
      setOwnerError('Complete each owner’s name, email, phone, date of birth, 9-digit SSN, and ownership before continuing.');
      return;
    }""",
"""    const incomplete = ownersForSave.some((owner) =>
      !owner.firstName || !owner.lastName || !owner.email || !owner.phone || !owner.dob ||
      String(owner.ssn || '').replace(/\D/g, '').length !== 9 || !owner.ownershipPercent ||
      !owner.addressLine1?.trim() || !owner.city?.trim() || !owner.state?.trim() || !owner.zip?.trim()
    );
    if (incomplete) {
      setOwnerError('Complete each owner’s name, email, phone, date of birth, 9-digit SSN, ownership, and home address before continuing.');
      return;
    }""",
'owner step validation')

rep('src/App.jsx',
"""              <div><label>SSN <span className=\"required-star\">*</span></label><input required inputMode=\"numeric\" value={owner.ssn} onChange={updateOwner(index, 'ssn')} placeholder=\"•••-••-••••\" /></div>
              {!primaryIs100 && <div><label>Ownership percentage <span className=\"required-star\">*</span></label><input required type=\"number\" min=\"0.01\" max=\"100\" step=\"0.01\" value={owner.ownershipPercent} onChange={updateOwner(index, 'ownershipPercent')} /></div>}""",
"""              <div><label>SSN <span className=\"required-star\">*</span></label><input required inputMode=\"numeric\" value={owner.ssn} onChange={updateOwner(index, 'ssn')} placeholder=\"•••-••-••••\" /></div>
              {!primaryIs100 && <div><label>Ownership percentage <span className=\"required-star\">*</span></label><input required type=\"number\" min=\"0.01\" max=\"100\" step=\"0.01\" value={owner.ownershipPercent} onChange={updateOwner(index, 'ownershipPercent')} /></div>}
              <div className=\"owner-address-heading\"><strong>Home address</strong></div>
              <div><label>Street address <span className=\"required-star\">*</span></label><input required autoComplete=\"street-address\" value={owner.addressLine1 || ''} onChange={updateOwner(index, 'addressLine1')} /></div>
              <div><label>Address line 2</label><input value={owner.addressLine2 || ''} onChange={updateOwner(index, 'addressLine2')} /></div>
              <div><label>City <span className=\"required-star\">*</span></label><input required value={owner.city || ''} onChange={updateOwner(index, 'city')} /></div>
              <div><label>State <span className=\"required-star\">*</span></label><input required maxLength=\"2\" value={owner.state || ''} onChange={(e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0,2); updateOwner(index, 'state')(e); }} /></div>
              <div><label>ZIP <span className=\"required-star\">*</span></label><input required inputMode=\"numeric\" maxLength=\"5\" value={owner.zip || ''} onChange={(e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0,5); updateOwner(index, 'zip')(e); }} /></div>""",
'owner address inputs')

rep('backend/routes/uez.js',
"""    if (owners.some((owner) => !owner.email || !owner.phone || !owner.dob || !String(owner.ssn || '').replace(/\D/g, ''))) {
      throw new Error('Each owner requires email, phone, date of birth, and SSN');
    }""",
"""    if (owners.some((owner) => !owner.email || !owner.phone || !owner.dob || !String(owner.ssn || '').replace(/\D/g, ''))) {
      throw new Error('Each owner requires email, phone, date of birth, and SSN');
    }
    if (owners.some((owner) => !String(owner.addressLine1 || '').trim() || !String(owner.city || '').trim() || !String(owner.state || '').trim() || !String(owner.zip || '').trim())) {
      throw new Error('Each owner requires a complete home address: street, city, state, and ZIP');
    }""",
'backend owner address validation')

p = Path('src/workflow.css')
s = p.read_text()
s += """
.owner-address-heading { grid-column: 1 / -1; margin-top: 8px; padding-top: 12px; border-top: 1px solid #eceef4; }
.owner-address-heading strong { font-size: 12px; color: #555d72; }
"""
p.write_text(s)
