import React from 'react';
import CopyValue from './CopyValue';
import { formatPhoneInput, programLabel, displayBusinessName, businessAddressLine, addressZoneWarning } from './caseLogic';

// editMode/draft/save-all live in the parent (shared with OwnersCard - they're
// one edit session under a single Edit/Save/Cancel row, not two independent
// forms). This card is purely: show the read view, or show the edit grid and
// report field changes upward via onChangeField.
export default function BusinessDetailsCard({ application, editMode, draft, onChangeField, bare = false }) {
  const body = (
    <>
        {editMode ? <div className="admin-edit-grid">
          <div><label>Business name <span className="required-star">*</span></label><input value={draft.businessName} onChange={(e) => onChangeField('businessName', e.target.value)} /></div>
          <div><label>Contact email <span className="required-star">*</span></label><input type="email" value={draft.contactEmail} onChange={(e) => onChangeField('contactEmail', e.target.value)} /></div>
          <div><label>Contact phone</label><input inputMode="tel" value={draft.contactPhone} onChange={(e) => onChangeField('contactPhone', formatPhoneInput(e.target.value))} /></div>
          <div><label>EIN <span className="required-star">*</span></label><input inputMode="numeric" value={draft.ein} onChange={(e) => onChangeField('ein', e.target.value.replace(/\D/g, '').slice(0, 9))} /></div>
          <div><label>Year founded</label><input type="number" value={draft.yearFounded} onChange={(e) => onChangeField('yearFounded', e.target.value)} /></div>
          <div><label>Full-time employees</label><input type="number" min="0" value={draft.fullTimeEmployees} onChange={(e) => onChangeField('fullTimeEmployees', e.target.value)} /></div>
          <div><label>Part-time employees</label><input type="number" min="0" value={draft.partTimeEmployees} onChange={(e) => onChangeField('partTimeEmployees', e.target.value)} /></div>
          <div><label>Does the business have a DBA? <span className="required-star">*</span></label><select value={draft.hasDba} onChange={(e) => onChangeField('hasDba', e.target.value)}><option value="">Select yes or no</option><option value="yes">Yes</option><option value="no">No</option></select></div>
          {draft.hasDba === 'yes' && <div><label>DBA name <span className="required-star">*</span></label><input value={draft.dbaName} onChange={(e) => onChangeField('dbaName', e.target.value)} /></div>}
          <div><label>Grant amount requested</label><input type="number" min="0" step="0.01" value={draft.grantAmountRequested} onChange={(e) => onChangeField('grantAmountRequested', e.target.value)} /></div>
          <div className="admin-edit-wide"><label>Address <span className="required-star">*</span></label><input value={draft.addressLine1} onChange={(e) => onChangeField('addressLine1', e.target.value)} /></div>
          <div className="admin-edit-wide"><label>Address line 2</label><input value={draft.addressLine2} onChange={(e) => onChangeField('addressLine2', e.target.value)} /></div>
          <div><label>City</label><input value={draft.city} onChange={(e) => onChangeField('city', e.target.value)} /></div>
          <div><label>State</label><input maxLength="2" value={draft.state} onChange={(e) => onChangeField('state', e.target.value.toUpperCase())} /></div>
          <div><label>ZIP</label><input value={draft.zip} onChange={(e) => onChangeField('zip', e.target.value)} /></div>
          <label className="admin-checkbox"><input type="checkbox" checked={draft.isSoleProprietorship} onChange={(e) => onChangeField('isSoleProprietorship', e.target.checked)} /> Sole proprietorship</label>
          <div className="admin-edit-wide"><label>Business description</label><textarea rows="4" value={draft.businessDescription} onChange={(e) => onChangeField('businessDescription', e.target.value)} /></div>
        </div> : <dl className="data-grid">
          {!bare && <div><dt>Business name</dt><dd>{displayBusinessName(application) || '—'}</dd></div>}
          {!bare && <div><dt>Contact email</dt><dd>{application.contact_email || '—'}</dd></div>}
          {!bare && <div><dt>Contact phone</dt><dd>{application.contact_phone || '—'}</dd></div>}
          {!bare && <div><dt>EIN</dt><dd>{application.ein || '—'}</dd></div>}
          <div><dt>Address</dt><dd>{businessAddressLine(application) || '—'}{addressZoneWarning(application) && <div className="cw-zone-warn">⚠ {addressZoneWarning(application)}</div>}</dd></div>
          <div><dt>UEZ</dt><dd>{application.zone_name || '—'}</dd></div>
          <div><dt>Founded</dt><dd>{application.year_founded || '—'}</dd></div>
          <div><dt>Employees</dt><dd>{application.full_time_employees ?? 0} FT · {application.part_time_employees ?? 0} PT</dd></div>
          <div><dt>Business type</dt><dd>{application.is_sole_proprietorship ? 'Sole proprietorship' : 'Entity'}</dd></div>
          <div><dt>DBA</dt><dd>{application.has_dba == null ? '—' : application.has_dba ? (application.dba_name || 'Yes') : 'No'}</dd></div>
          <div><dt>Grant amount</dt><dd>{application.grant_amount_requested == null ? '—' : `$${Number(application.grant_amount_requested).toLocaleString()}`}</dd></div>
          <div className="data-wide"><dt>Description</dt><dd>{application.business_description || '—'}</dd></div>
        </dl>}
    </>
  );
  // bare: just the fields, for the facts panel (no accordion / card chrome).
  // bare (the header's Business panel): a tight label/value sheet when
  // viewing, the normal edit grid when editing.
  if (bare && !editMode) {
    const zoneWarning = addressZoneWarning(application);
    const brc = application.brc_data || {};
    const address = businessAddressLine(application) || '';
    const fromBrc = application.brc_status === 'found' && brc.address
      && address.toUpperCase() === String(brc.address).toUpperCase();
    const grant = application.grant_amount_requested == null ? '—' : '$' + Number(application.grant_amount_requested).toLocaleString();
    // Labels always above values; three groups: address, facts strip, about.
    return (
      <div className="cw-detail cw-biz">
        <dl className="cw-biz-address">
          <div className="cw-df">
            <dt>Address</dt>
            <dd>
              <CopyValue label="address" value={address} />
              {zoneWarning ? <span className="cw-fact-tag warn">⚠ {zoneWarning}</span>
                : application.zone_name ? <span className="cw-fact-tag good">✓ {application.zone_name.replace(' Urban Enterprise Zone (UEZ)', ' UEZ')}</span> : null}
              {fromBrc && <span className="cw-fact-tag">from BRC</span>}
            </dd>
          </div>
        </dl>
        <dl className="cw-biz-facts">
          <div className="cw-df cw-df-wide"><dt>Program</dt><dd>{programLabel(application.program_code)}</dd></div>
          <div className="cw-df"><dt>Grant</dt><dd>{grant}</dd></div>
          <div className="cw-df"><dt>Type</dt><dd>{application.is_sole_proprietorship ? 'Sole proprietorship' : 'Entity'}</dd></div>
          <div className="cw-df"><dt>DBA</dt><dd>
            {application.has_dba == null ? '—'
              : !application.has_dba ? 'No'
              : application.dba_name ? <CopyValue label="DBA name" value={application.dba_name} /> : 'Yes'}
          </dd></div>
          <div className="cw-df"><dt>Founded</dt><dd>{application.year_founded || '—'}</dd></div>
          <div className="cw-df"><dt>Employees</dt><dd>{application.full_time_employees ?? 0} FT · {application.part_time_employees ?? 0} PT</dd></div>
          {brc.certificateNumber && <div className="cw-df"><dt>BRC cert</dt><dd><CopyValue label="BRC certificate number" value={brc.certificateNumber} /></dd></div>}
        </dl>
        <dl className="cw-biz-about">
          <div className="cw-df"><dt>About</dt><dd>{application.business_description || '—'}</dd></div>
        </dl>
      </div>
    );
  }
  if (bare) return <div className="cw-bare-card">{body}</div>;
  return (
    <details className="admin-accordion" open>
      <summary><strong>Business details</strong><span>{application.ein || 'No EIN'}</span></summary>
      <section className="admin-card admin-business-card admin-secondary-card">
        <div className="admin-card-head"><h3>Business</h3><span className="status-pill">{programLabel(application.program_code)}</span></div>
        {body}
      </section>
    </details>
  );
}
