from pathlib import Path


def rep(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'missing {label} in {path}')
    p.write_text(s.replace(old, new, 1))

# ---------- Client intake ----------
rep(
    'src/App.jsx',
    "const blankOwner = () => ({ firstName: '', lastName: '', email: '', phone: '', dob: '', ssn: '', ownershipPercent: '', addressLine1: '', addressLine2: '', city: '', state: 'NJ', zip: '' });",
    "const blankOwner = () => ({ firstName: '', lastName: '', email: '', phone: '', dob: '', ssn: '', ownershipPercent: '', addressLine1: '', addressLine2: '', city: '', state: '', zip: '' });",
    'blank owner state'
)

rep(
    'src/App.jsx',
    "    owners: [{ ...blankOwner(), ownershipPercent: '100' }]",
    "    owners: [blankOwner()]",
    'initial ownership answer'
)

rep(
    'src/App.jsx',
    "  const primaryIs100 = form.owners.length === 1 && form.owners[0].ownershipPercent === '100';",
    "  const primaryIs100 = form.owners.length === 1 && form.owners[0].ownershipPercent === '100';\n  const primaryOwnershipSelection = form.owners.length === 1 && !form.owners[0].ownershipPercent ? '' : (primaryIs100 ? 'yes' : 'no');",
    'primary ownership selection'
)

rep(
    'src/App.jsx',
    """    if (!form.businessName.trim() || !form.businessDescription.trim() || einDigits.length !== 9 || !form.isSoleProprietorship || !form.hasDba || (form.hasDba === 'yes' && !form.dbaName.trim())) {
      setMessage('Complete the business name, description, 9-digit EIN, business type, and DBA information before continuing.');
      return;
    }""",
    """    const foundedDigits = String(form.yearFounded || '').replace(/\\D/g, '');
    if (
      !form.businessName.trim() || !form.businessDescription.trim() || einDigits.length !== 9 ||
      foundedDigits.length !== 4 || form.fullTimeEmployees === '' || form.partTimeEmployees === '' ||
      !form.isSoleProprietorship || !form.hasDba || (form.hasDba === 'yes' && !form.dbaName.trim())
    ) {
      setMessage('Complete every business field before continuing. All fields are required.');
      return;
    }""",
    'business client validation'
)

rep(
    'src/App.jsx',
    """          <div className=\"field-grid\"><div><label>Is the primary owner the 100% owner? <span className=\"required-star\">*</span></label><select required value={primaryIs100 ? 'yes' : 'no'} onChange={(e) => setPrimaryOwnershipMode(e.target.value)}><option value=\"yes\">Yes</option><option value=\"no\">No</option></select></div></div>""",
    """          <div className=\"field-grid\"><div><label>Is the primary owner the 100% owner? <span className=\"required-star\">*</span></label><select required value={primaryOwnershipSelection} onChange={(e) => setPrimaryOwnershipMode(e.target.value)}><option value=\"\" disabled>Select yes or no</option><option value=\"yes\">Yes</option><option value=\"no\">No</option></select></div></div>""",
    'primary owner explicit answer'
)

# ---------- Backend: business-step enforcement ----------
rep(
    'backend/routes/uez.js',
    """    if (patch.full_time_employees != null && patch.full_time_employees < 0) throw new Error('Full-time employees cannot be negative');
    if (patch.part_time_employees != null && patch.part_time_employees < 0) throw new Error('Part-time employees cannot be negative');
    if (patch.has_dba === true && !patch.dba_name) throw new Error('DBA name is required when the business has a DBA.');""",
    """    if (!String(patch.business_name_input || '').trim()) throw new Error('Business name is required.');
    if (!String(patch.business_description || '').trim()) throw new Error('Business description is required.');
    if (normalizeEin(patch.ein).length !== 9) throw new Error('A 9-digit EIN is required.');
    if (!Number.isInteger(patch.year_founded) || String(patch.year_founded).length !== 4) throw new Error('A 4-digit year founded is required.');
    if (typeof patch.is_sole_proprietorship !== 'boolean') throw new Error('Please answer whether the business is a sole proprietorship.');
    if (!Number.isInteger(patch.full_time_employees) || patch.full_time_employees < 0) throw new Error('Full-time employees is required and cannot be negative.');
    if (!Number.isInteger(patch.part_time_employees) || patch.part_time_employees < 0) throw new Error('Part-time employees is required and cannot be negative.');
    if (typeof patch.has_dba !== 'boolean') throw new Error('Please answer whether the business has a DBA.');
    if (patch.has_dba === true && !patch.dba_name) throw new Error('DBA name is required when the business has a DBA.');""",
    'business backend validation'
)

# ---------- Backend: owner enforcement ----------
rep(
    'backend/routes/uez.js',
    """    if (rows.some((row) => !row.first_name || !row.last_name)) throw new Error('Each owner requires a first and last name');
    if (owners.some((owner) => !owner.email || !owner.phone || !owner.dob || !String(owner.ssn || '').replace(/\\D/g, ''))) {
      throw new Error('Each owner requires email, phone, date of birth, and SSN');
    }
    if (owners.some((owner) => !String(owner.addressLine1 || '').trim() || !String(owner.city || '').trim() || !String(owner.state || '').trim() || !String(owner.zip || '').trim())) {
      throw new Error('Each owner requires a complete home address: street, city, state, and ZIP');
    }""",
    """    if (rows.some((row) => !row.first_name || !row.last_name)) throw new Error('Each owner requires a first and last name.');
    if (owners.some((owner) => !/^\\S+@\\S+\\.\\S+$/.test(String(owner.email || '').trim()))) {
      throw new Error('Each owner requires a valid email address.');
    }
    if (owners.some((owner) => String(owner.phone || '').replace(/\\D/g, '').length !== 10)) {
      throw new Error('Each owner requires a 10-digit phone number.');
    }
    if (owners.some((owner) => !String(owner.dob || '').trim())) {
      throw new Error('Each owner requires a date of birth.');
    }
    if (owners.some((owner) => String(owner.ssn || '').replace(/\\D/g, '').length !== 9)) {
      throw new Error('Each owner requires a 9-digit SSN.');
    }
    if (owners.some((owner) => !(Number(owner.ownershipPercent) > 0))) {
      throw new Error('Each owner requires an ownership percentage greater than zero.');
    }
    if (owners.some((owner) => !String(owner.addressLine1 || '').trim() || !String(owner.city || '').trim() || !/^[A-Za-z]{2}$/.test(String(owner.state || '').trim()) || !/^\\d{5}$/.test(String(owner.zip || '').trim()))) {
      throw new Error('Each owner requires a complete home address: street, city, 2-letter state, and 5-digit ZIP. Address Line 2 is optional.');
    }""",
    'strict owner backend validation'
)

# ---------- Backend: final submission cannot bypass any required signup data ----------
rep(
    'backend/routes/uez.js',
    "supabase.from('uez_owners').select('id, ownership_percent').eq('application_id', application.id),",
    "supabase.from('uez_owners').select('*').eq('application_id', application.id),",
    'submit owner query'
)

rep(
    'backend/routes/uez.js',
    """    if (!application.business_name_input || !application.ein || !application.address_line1) {
      return res.status(400).json({ error: 'Business name, EIN, and business address are required before submission.' });
    }
    if (application.has_dba == null) return res.status(400).json({ error: 'Please answer whether the business has a DBA before submission.' });
    if (application.has_dba && !application.dba_name) return res.status(400).json({ error: 'Please enter the DBA name before submission.' });

    const ownershipTotal = (ownersResult.data || []).reduce((sum, owner) => sum + Number(owner.ownership_percent || 0), 0);
    if (!(ownersResult.data || []).length || Math.abs(ownershipTotal - 100) > 0.001) {
      return res.status(400).json({ error: 'Business ownership must be complete and total 100% before submission.' });
    }""",
    """    if (!String(application.contact_email || '').trim()) return res.status(400).json({ error: 'Contact email is required before submission.' });
    if (!String(application.address_line1 || '').trim()) return res.status(400).json({ error: 'Business address is required before submission.' });
    if (!String(application.business_name_input || '').trim()) return res.status(400).json({ error: 'Business name is required before submission.' });
    if (!String(application.business_description || '').trim()) return res.status(400).json({ error: 'Business description is required before submission.' });
    if (normalizeEin(application.ein).length !== 9) return res.status(400).json({ error: 'A 9-digit EIN is required before submission.' });
    if (!Number.isInteger(application.year_founded) || String(application.year_founded).length !== 4) return res.status(400).json({ error: 'Year founded is required before submission.' });
    if (typeof application.is_sole_proprietorship !== 'boolean') return res.status(400).json({ error: 'Sole proprietorship answer is required before submission.' });
    if (!Number.isInteger(application.full_time_employees) || application.full_time_employees < 0) return res.status(400).json({ error: 'Full-time employees is required before submission.' });
    if (!Number.isInteger(application.part_time_employees) || application.part_time_employees < 0) return res.status(400).json({ error: 'Part-time employees is required before submission.' });
    if (application.has_dba == null) return res.status(400).json({ error: 'Please answer whether the business has a DBA before submission.' });
    if (application.has_dba && !String(application.dba_name || '').trim()) return res.status(400).json({ error: 'Please enter the DBA name before submission.' });
    if (!String(application.contact_phone || '').trim()) return res.status(400).json({ error: 'Primary owner phone is required before submission.' });

    const submittedOwners = ownersResult.data || [];
    const ownershipTotal = submittedOwners.reduce((sum, owner) => sum + Number(owner.ownership_percent || 0), 0);
    if (!submittedOwners.length || Math.abs(ownershipTotal - 100) > 0.001) {
      return res.status(400).json({ error: 'Business ownership must be complete and total 100% before submission.' });
    }
    if (submittedOwners.some((owner) => !String(owner.first_name || '').trim() || !String(owner.last_name || '').trim() || !String(owner.email || '').trim() || !String(owner.phone || '').trim() || !owner.dob_enc || !owner.ssn_enc || !(Number(owner.ownership_percent) > 0) || !String(owner.address_line1 || '').trim() || !String(owner.city || '').trim() || !String(owner.state || '').trim() || !String(owner.zip || '').trim())) {
      return res.status(400).json({ error: 'Every owner field is required before submission except Address Line 2.' });
    }""",
    'strict final submission validation'
)
