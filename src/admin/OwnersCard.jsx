import React from 'react';
import CopyValue from './CopyValue';
import { formatDob, formatDobInput, formatPhoneInput, formatSsn, formatSsnInput } from './caseLogic';

const OWNER_TITLES = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Rabbi'];

// Shares editMode with BusinessDetailsCard (one edit session, one Save/Cancel
// row, lives in the parent). This card handles real SSN/DOB - formatSsn/
// formatDob mask on display, formatSsnInput/formatDobInput format while
// typing - both already unit tested in caseLogic.test.js.
export default function OwnersCard({ owners, editMode, ownerDrafts, onChangeOwnerField, onAddOwner, onRemoveOwner, bare = false }) {
  const body = (
    <>
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
    </>
  );
  // bare (the header's Owner panel): one row group per owner, all on one
  // shared column grid so values line up down the list. Click a value to copy.
  if (bare && !editMode) {
    if (owners.length === 0) return <p className="cw-detail-empty">No owners on file.</p>;
    return (
      <div className="cw-detail cw-owners">
        {owners.map((owner) => {
          const name = [owner.title, owner.firstName, owner.lastName].filter(Boolean).join(' ');
          const home = [owner.addressLine1, owner.addressLine2, owner.city, owner.state, owner.zip].filter(Boolean).join(', ');
          const ssnDigits = String(owner.ssn || '').replace(/\D/g, '');
          const ssnFull = ssnDigits ? formatSsn(owner.ssn) : '';
          return (
            <section className="cw-owner" key={owner.id}>
              <header className="cw-owner-head">
                <strong>{name || '—'}</strong>
                <span className="cw-owner-role">{owner.positionTitle || (owners.length === 1 ? 'Owner' : 'Partner')}</span>
                {owner.ownershipPercent != null && owner.ownershipPercent !== '' && <span className="cw-fact-tag">{owner.ownershipPercent}%</span>}
              </header>
              <dl className="cw-owner-grid">
                <div className="cw-df cw-df-email"><dt>Email</dt><dd><CopyValue label="email" value={owner.email} /></dd></div>
                <div className="cw-df"><dt>Phone</dt><dd><CopyValue label="phone" value={owner.phone} /></dd></div>
                <div className="cw-df"><dt>DOB</dt><dd><CopyValue label="date of birth" value={owner.dob ? formatDob(owner.dob) : ''} /></dd></div>
                <div className="cw-df"><dt>SSN</dt><dd>
                  {/* Masked until hovered/focused; copying gives the full number. */}
                  <CopyValue label="SSN" value={ssnFull} className="cw-cv-secret">
                    <span className="cw-ssn-mask">{ssnDigits.length >= 4 ? `•••-••-${ssnDigits.slice(-4)}` : ssnFull}</span>
                    <span className="cw-ssn-full">{ssnFull}</span>
                  </CopyValue>
                </dd></div>
                <div className="cw-df cw-df-home"><dt>Home</dt><dd><CopyValue label="home address" value={home} /></dd></div>
              </dl>
            </section>
          );
        })}
      </div>
    );
  }
  if (bare) return <div className="cw-bare-card">{body}</div>;
  return (
    <details className="admin-accordion" open>
      <summary><strong>Owners</strong><span>{`${owners.length} owner${owners.length === 1 ? '' : 's'}`}</span></summary>
      <section className="admin-card admin-wide admin-owners-card admin-secondary-card">
        <div className="admin-card-head"><h3>Owners</h3><span className="status-pill">{editMode ? ownerDrafts.length : owners.length}</span></div>
        {body}
      </section>
    </details>
  );
}
