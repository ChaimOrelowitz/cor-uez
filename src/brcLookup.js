// Pure helpers for New Jersey's official BRC lookup tool
// (https://www1.state.nj.us/TYTR_BRC/servlet/common/BRCLogin) — shared by the
// client-facing signup wizard (App.jsx, showing a client what to paste into
// NJ's own "Name Control"/"Tax ID" boxes) and the admin side (caseLogic.js/
// AdminPage.jsx, which auto-fills the same boxes via a hidden form post).
// Extracted here instead of living only in src/admin/caseLogic.js so the
// client wizard doesn't have to reach into admin-only code for it.

export function nameControl(name) {
  return String(name || '').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase();
}

export function njTaxId(ein) {
  const digits = String(ein || '').replace(/\D/g, '').slice(0, 9);
  return digits.length === 9 ? `${digits}000` : '';
}
