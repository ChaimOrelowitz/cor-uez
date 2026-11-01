import React from 'react';
import './summary.css';

// Faithful reproduction of the NJ UEZ portal "Summary Sheet" (page 3), so the zone can
// print/save it exactly like the state's own — without logging into the portal.

function titleCase(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s\-/&(.,#])([a-z])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/\bLlc\b/g, 'LLC').replace(/\bInc\b/g, 'Inc');
}
function usDate(iso) {
  if (!iso) return 'N/A';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return m ? `${m}/${d}/${y}` : 'N/A';
}
function money(n) {
  if (n == null) return '';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function numCell(n) { return n == null ? '' : String(n); }
function yn(v) { return v === true ? 'YES' : v === false ? 'NO' : (v || ''); }
function up(s) { return s == null ? '' : String(s).toUpperCase(); }

function Field({ label, children, wide }) {
  return (
    <div className={`ss-field${wide ? ' wide' : ''}`}>
      <span className="ss-lbl">{label}:</span>
      <span className="ss-val">{children}</span>
    </div>
  );
}

export default function SummarySheet({ b, onClose }) {
  const emp = Array.isArray(b.employment) ? b.employment : [];
  const notes = Array.isArray(b.state_notes) ? b.state_notes : [];
  const owner = [up(b.salutation), titleCase(b.owner_name)].filter(Boolean).join(' ');

  return (
    <div className="ss-backdrop" onClick={onClose}>
      <div className="ss-wrap" onClick={(e) => e.stopPropagation()}>
        <div className="ss-toolbar">
          <button className="btn ghost compact" onClick={() => window.print()}>🖨 Print / Save PDF</button>
          <button className="btn ghost compact" onClick={onClose}>Close</button>
        </div>

        <div className="ss-sheet" id="ss-print">
          <div className="ss-header">
            <div className="ss-state">New Jersey</div>
            <div className="ss-titlebar"><h1>Urban Enterprise Zones</h1></div>
          </div>

          <div className="ss-band">Summary Information</div>
          <div className="ss-summary">
            <Field label="File #">{b.file_no}</Field>
            <Field label="Status">{b.status === 'I' ? 'Inactive' : 'Active'}</Field>
            <Field label="Zone">{up(b.zone_name)}</Field>
            <Field label="Business Size">{up(b.business_size)}</Field>
            <Field label="25% Req">{up(b.req_25)}</Field>
            <Field label="25% Met">{up(b.met_25)}</Field>
            <Field label="25% DL">{b.dl_25 ? usDate(b.dl_25) : ''}</Field>
            <Field label="Notes">{notes.length ? 'Y' : 'N'}</Field>
          </div>

          <div className="ss-band">Business Information</div>
          <div className="ss-grid">
            <Field label="Legal Company Name">{titleCase(b.name)}</Field>
            <Field label="Permit #">{b.permit_no}</Field>
            <Field label="Fed #">{b.fed_id}</Field>

            <Field label="Trade Name">{titleCase(b.trade_name || b.name)}</Field>
            <Field label="GFW">{b.gfw}</Field>
            <Field label="NJ Tax #">{b.nj_tax}</Field>

            <Field label="Business Street Address" wide>{titleCase(b.street)}</Field>
            <div className="ss-field" />

            <Field label="City">{titleCase(b.city)}</Field>
            <Field label="State">{up(b.state)}</Field>
            <Field label="Zip">{b.zip}</Field>

            <Field label="Unit Number">{b.unit_num}</Field>
            <Field label="Block">{b.block}</Field>
            <Field label="Lot">{b.lot}</Field>

            <Field label="Business Owner / Officer / Partner" wide>{owner}</Field>
            <Field label="Title">{titleCase(b.owner_title)}</Field>

            <Field label="Phone">{b.phone || b.contact_phone}</Field>
            <Field label="Email" wide>{b.email || b.contact_email}</Field>

            <Field label="Mailing Address" wide>{titleCase(b.mailing_address)}</Field>
            <div className="ss-field" />

            <div className="ss-rule" />

            <Field label="Nature">{up(b.nature)}</Field>
            <Field label="NAICS">{b.naics_code}</Field>
            <Field label="NAICS Desc">{up(b.naics_desc)}</Field>

            <Field label="Began Date">{usDate(b.began_date)}</Field>
            <Field label="SIC">{b.sic_code}</Field>
            <Field label="SIC Desc">{up(b.sic_desc)}</Field>

            <Field label="Cert Date">{usDate(b.cert_date)}</Field>
            <Field label="Last Annual">{usDate(b.last_annual_date)}</Field>
            <Field label="Next Annual Due">{usDate(b.next_annual_due)}</Field>

            <Field label="Extension Date">{usDate(b.extension_date)}</Field>
            <Field label="Last Recert">{usDate(b.last_recert_date)}</Field>
            <Field label="Next Recert Due">{usDate(b.next_recert_due)}</Field>

            <div className="ss-rule" />

            <Field label="Minority">{yn(b.minority_owned)}</Field>
            <Field label="Women">{yn(b.women_owned)}</Field>
            <Field label="Type">{up(b.entity_type)}</Field>

            <Field label="New Business">{yn(b.new_business)}</Field>
            <Field label="Re-Entry">{b.re_entry}</Field>
            <Field label="Move In">{b.move_in}</Field>
          </div>

          <div className="ss-band">Employment / Investment Information</div>
          <table className="ss-emp">
            <thead>
              <tr>
                <th>Date</th><th>App Stat</th><th>Stat Dtl</th><th>Prog Year</th>
                <th>FT Proj</th><th>FT Act</th><th>FT Inc</th><th>New Hires</th><th># of Chks</th><th>%</th>
                <th>PT Proj</th><th>PT Act</th><th>PT Inc</th>
                <th>Actual Capital</th><th>Projected Capital</th><th>UZ-1 Qlfd</th>
                <th>UZ4 Tax Savings</th><th>UZ5 Tax Savings</th><th>Origin</th>
              </tr>
            </thead>
            <tbody>
              {emp.length === 0 && <tr><td colSpan={19} className="ss-empty">No employment records.</td></tr>}
              {emp.map((r, i) => (
                <tr key={i}>
                  <td>{r.date ? usDate(r.date) : ''}</td>
                  <td>{r.app_status || ''}</td>
                  <td>{r.status_detail || ''}</td>
                  <td>{r.program_year || ''}</td>
                  <td>{numCell(r.ft_projected)}</td>
                  <td>{numCell(r.ft_actual)}</td>
                  <td>{numCell(r.ft_change)}</td>
                  <td>{numCell(r.new_hires)}</td>
                  <td>{numCell(r.chks)}</td>
                  <td>{r.pct_25 || ''}</td>
                  <td>{numCell(r.pt_projected)}</td>
                  <td>{numCell(r.pt_actual)}</td>
                  <td>{numCell(r.pt_change)}</td>
                  <td className="num">{money(r.capital_actual)}</td>
                  <td className="num">{money(r.capital_projected)}</td>
                  <td>{r.uz1_qlfd || ''}</td>
                  <td className="num">{money(r.uz4_savings)}</td>
                  <td className="num">{money(r.uz5_savings)}</td>
                  <td>{r.origin || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ss-legend">
            <div><strong>Appstatus:</strong> A=Ap; B=Den Emp &amp; %; C=Emp NM; D=Den; E=Emp NM &amp; %Rem; I=Inact; L=In-Lieu; N=%Rem; P=Den%; R=Ret</div>
            <div><strong>Status Dtl:</strong> T=Part Time; S=Special Retention; X=Cond Appr; G=Good Standing; Z=Inactivated</div>
          </div>

          <div className="ss-band">Administration Notes</div>
          {notes.length === 0 ? (
            <div className="ss-notes-empty">There are no Notes for this Business.</div>
          ) : (
            <table className="ss-notes">
              <thead><tr><th>Notes</th><th>Important?</th><th>Created By</th><th>Date</th></tr></thead>
              <tbody>
                {notes.map((n, i) => (
                  <tr key={i}><td>{n.text}</td><td>{n.important ? 'Y' : 'N'}</td><td>{n.by || ''}</td><td>{usDate(n.date)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
