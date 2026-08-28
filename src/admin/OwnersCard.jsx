import React from 'react';
import { formatDob, formatDobInput, formatPhoneInput, formatSsn, formatSsnInput } from './caseLogic';

const OWNER_TITLES = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Rabbi'];

// Shares editMode with BusinessDetailsCard (one edit session, one Save/Cancel
// row, lives in the parent). This card handles real SSN/DOB - formatSsn/
// formatDob mask on display, formatSsnInput/formatDobInput format while
// typing - both already unit tested in caseLogic.test.js.
export default function OwnersCard({ owners, editMode, ownerDrafts, onChangeOwnerField, onAddOwner, onRemoveOwner }) {
  return (
    <details className="admin-accordion">
      <summary><strong>Owners</strong><span>{`${owners.length} owner${owners.length === 1 ? '' : 's'}`}</span></summary>
      <section className="admin-card admin-wide admin-owners-card admin-secondary-card">
        <div className="admin-card-head"><h3>Owners</h3><span>{editMode ? ownerDrafts.length : owners.length}</span></div>
        {editMode ? <>
          <div className="owner-admin-list owner-edit-list">
            {ownerDrafts.map((owner, index) => (
              <div className="owner-admin-card" key={`owner-edit-${index}`}>
                <div className="owner-admin-title">
                  <strong>Owner {index + 1}</strong>
                  <button className="owner-remove-button" type="button" onClick={() => onRemoveOwner(index)}>Remove owner</button>
                </div>
                <div className="admin-edit-grid owner-edit-grid">
                  <div>
                    <label>Title (Mr., Mrs., etc.) <span className="required-star">*</span></label>
                    <select value={owner.title || ''} onChange={(e) => onChangeOwnerField(index, 'title', e.target.value)}>
                      <option value="">Select title</option>
                      {OWNER_TITLES.map((title) => <option key={title} value={title}>{title}</option>)}
                      {owner.title && !OWNER_TITLES.includes(owner.title) && <option value={owner.title}>{owner.title}</option>}
                    </select>
                  </div>
                  <div><label>First name <span className="required-star">*</span></label><input value={owner.firstName} onChange={(e) => onChangeOwnerField(index, 'firstName', e.target.value)} /></div>
                  <div><label>Last name <span className="required-star">*</span></label><input value={owner.lastName} onChange={(e) => onChangeOwnerField(index, 'lastName', e.target.value)} /></div>
                  <div><label>Email <span className="required-star">*</span></label><input type="email" value={owner.email} onChange={(e) => onChangeOwnerField(index, 'email', e.target.value)} /></div>
                  <div><label>Phone <span className="required-star">*</span></label><input inputMode="tel" value={owner.phone} onChange={(e) => onChangeOwnerField(index, 'phone', formatPhoneInput(e.target.value))} /></div>
                  <div><label>Date of birth (MM/DD/YYYY) <span className="required-star">*</span></label><input inputMode="numeric" placeholder="MM/DD/YYYY" value={owner.dob} onChange={(e) => onChangeOwnerField(index, 'dob', formatDobInput(e.target.value))} /></div>
                  <div><label>SSN <span className="required-star">*</span></label><input inputMode="numeric" placeholder="###-##-####" value={owner.ssn} onChange={(e) => onChangeOwnerField(index, 'ssn', formatSsnInput(e.target.value))} /></div>
                  <div><label>Ownership percentage <span className="required-star">*</span></label><input type="number" min="0.01" max="100" step="0.01" value={owner.ownershipPercent} onChange={(e) => onChangeOwnerField(index, 'ownershipPercent', e.target.value)} /></div>
                  <div><label>Position / title</label><input value={owner.positionTitle} onChange={(e) => onChangeOwnerField(index, 'positionTitle', e.target.value)} placeholder={ownerDrafts.length === 1 ? 'Owner' : 'Partner'} /></div>
                  <div><label>Address <span className="required-star">*</span></label><input value={owner.addressLine1} onChange={(e) => onChangeOwnerField(index, 'addressLine1', e.target.value)} /></div>
                  <div><label>Address line 2</label><input value={owner.addressLine2} onChange={(e) => onChangeOwnerField(index, 'addressLine2', e.target.value)} /></div>
                  <div><label>City <span className="required-star">*</span></label><input value={owner.city} onChange={(e) => onChangeOwnerField(index, 'city', e.target.value)} /></div>
                  <div><label>State <span className="required-star">*</span></label><input maxLength="2" value={owner.state} onChange={(e) => onChangeOwnerField(index, 'state', e.target.value.toUpperCase())} /></div>
                  <div><label>ZIP <span className="required-star">*</span></label><input value={owner.zip} onChange={(e) => onChangeOwnerField(index, 'zip', e.target.value)} /></div>
                </div>
              </div>
            ))}
          </div>
          <button className="secondary admin-add-owner" type="button" onClick={onAddOwner}>+ Add owner</button>
        </> : <div className="owner-admin-list">
          {owners.map((owner) => (
            <div className="owner-admin-card" key={owner.id}>
              <div className="owner-admin-title"><strong>{owner.firstName} {owner.lastName}</strong><span>{owner.ownershipPercent}%</span></div>
              <dl className="data-grid compact-data">
                <div><dt>Title</dt><dd>{owner.title || '—'}</dd></div>
                <div><dt>Email</dt><dd>{owner.email || '—'}</dd></div>
                <div><dt>Phone</dt><dd>{owner.phone || '—'}</dd></div>
                <div><dt>Position / title</dt><dd>{owner.positionTitle || (owners.length === 1 ? 'Owner' : 'Partner')}</dd></div>
                <div><dt>DOB</dt><dd>{formatDob(owner.dob) || '—'}</dd></div>
                <div><dt>SSN</dt><dd>{formatSsn(owner.ssn)}</dd></div>
                <div className="data-wide"><dt>Address</dt><dd>{[owner.addressLine1, owner.addressLine2, owner.city, owner.state, owner.zip].filter(Boolean).join(', ') || '—'}</dd></div>
              </dl>
            </div>
          ))}
        </div>}
      </section>
    </details>
  );
}
