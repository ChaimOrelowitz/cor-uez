// One place that decides a case's business name + business address.
//
// Rule (Chaim, Nov 22): when the BRC is found, its taxpayer name and address
// become THE business name and address everywhere. A manual edit in the BRC
// card or the case drawer overrides everything the same way. Newest wins.
//
// "Everywhere" = every name column (business_name_input, registered_business_name,
// brc_registered_name) and every address column (address_line1/2, city, state,
// zip), plus brc_data.address so the BRC card shows the same thing. Everything
// that reads a name/address (sidebar, header, emails, PBS/UEZ/JotForm fills,
// LDC matching, client portal) reads one of those columns.
//
// Each change is logged as an internal activity event with the old value, so
// what the client originally typed is never lost.

const supabase = require('../db/supabase');

const ARCGIS_GEOCODER = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer';
const UEZ_LAYER = 'https://services.arcgis.com/Aur8tCo478N3VovT/arcgis/rest/services/Govt_admin_UEZ_bnd/FeatureServer/0/query';

const STREET_SUFFIXES = new Set([
  'ST', 'STREET', 'AVE', 'AV', 'AVENUE', 'RD', 'ROAD', 'DR', 'DRIVE', 'LN', 'LANE', 'WAY', 'CT', 'COURT',
  'PL', 'PLACE', 'BLVD', 'BOULEVARD', 'TER', 'TERR', 'TERRACE', 'CIR', 'CIRCLE', 'HWY', 'HIGHWAY', 'PKWY',
  'PARKWAY', 'SQ', 'SQUARE', 'TPKE', 'TURNPIKE', 'PIKE', 'ALY', 'ALLEY', 'LOOP', 'PATH', 'TRL', 'TRAIL',
  'ROW', 'RUN', 'CRES', 'CRESCENT', 'XING', 'PLZ', 'PLAZA', 'WALK', 'GRN', 'GREEN', 'LINE'
]);
const DIRECTIONS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'NORTH', 'SOUTH', 'EAST', 'WEST']);
const UNIT_WORDS = new Set(['SUITE', 'STE', 'UNIT', 'APT', 'FL', 'FLOOR', 'RM', 'ROOM', 'BLDG', '#']);

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// "202 CARLTON AVE SOUTH" -> "202 Carlton Ave South"; keeps "102A", "PO", "NJ".
function titleCaseWords(value) {
  return clean(value).split(' ').map((word) => {
    if (/\d/.test(word)) return word.toUpperCase();
    if (/^(PO|NJ|NY|LLC|INC)$/i.test(word)) return word.toUpperCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

// Splits "STREET[, UNIT] CITY" where the BRC prints no comma before the city.
// Returns the index of the first city token, or -1 if it can't tell.
function cityStartIndex(tokens) {
  let end = -1;
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i].replace(/[,.]/g, '').toUpperCase();
    if (i > 0 && STREET_SUFFIXES.has(t)) end = i;
    else if (end === i - 1 && end >= 0 && DIRECTIONS.has(t)) end = i;
    else if (UNIT_WORDS.has(t) && i + 1 < tokens.length) { end = i + 1; i += 1; }
    else if (/^#\w+/.test(t)) end = i;
    else if (t === 'BOX' && i + 1 < tokens.length && /^\d/.test(tokens[i + 1])) { end = i + 1; i += 1; }
  }
  return end >= 0 && end < tokens.length - 1 ? end + 1 : -1;
}

// BRC addresses look like "101 CHASE AVE, SUITE 102A LAKEWOOD, NJ 08701-4761".
// `geocodedCity` (from ArcGIS) is the most reliable way to find where the city
// starts; the street-suffix heuristic is the fallback.
function parseBrcAddress(raw, geocodedCity = null) {
  const text = clean(raw);
  if (!text) return null;
  const match = text.match(/^(.*?),?\s+([A-Za-z]{2})\.?\s+(\d{5})(?:-?\d{4})?$/);
  if (!match) return null;
  const head = match[1].replace(/,\s*$/, '').trim();
  const state = match[2].toUpperCase();
  const zip = match[3];

  let street = null;
  let city = null;
  const gc = clean(geocodedCity);
  if (gc && head.toUpperCase().endsWith(` ${gc.toUpperCase()}`)) {
    street = head.slice(0, head.length - gc.length).trim();
    city = gc;
  } else if (/,/.test(head) && !/\d|\b(SUITE|STE|UNIT|APT|FL|FLOOR|RM|ROOM|BLDG|BOX)\b|#/i.test(head.slice(head.lastIndexOf(',') + 1))) {
    // Already comma-separated ("12 Main St, Toms River") - e.g. typed in the BRC card.
    street = head.slice(0, head.lastIndexOf(',')).trim();
    city = head.slice(head.lastIndexOf(',') + 1).trim();
  } else {
    const tokens = head.split(' ');
    const start = cityStartIndex(tokens);
    if (start > 0) {
      street = tokens.slice(0, start).join(' ');
      city = tokens.slice(start).join(' ');
    } else if (tokens.length > 1) {
      street = tokens.slice(0, -1).join(' ');
      city = tokens[tokens.length - 1];
    } else {
      return null;
    }
  }

  street = street.replace(/,\s*$/, '');
  // "101 CHASE AVE, SUITE 102A" -> line1 "101 Chase Ave", line2 "Suite 102A"
  let line1 = street;
  let line2 = null;
  const unit = street.match(/^(.*?),?\s+((?:SUITE|STE|UNIT|APT|FL|FLOOR|RM|ROOM|BLDG)\b.*|#\s*\w.*)$/i);
  if (unit && unit[1].trim()) { line1 = unit[1].trim(); line2 = unit[2].trim(); }

  return {
    addressLine1: titleCaseWords(line1.replace(/,\s*$/, '')),
    addressLine2: line2 ? titleCaseWords(line2) : null,
    city: titleCaseWords(city),
    state,
    zip
  };
}

function formatAddress(a) {
  if (!a) return '';
  return [a.addressLine1, a.addressLine2, a.city, [a.state, a.zip].filter(Boolean).join(' ')]
    .map(clean).filter(Boolean).join(', ');
}

async function jsonFetch(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const response = await fetch(url, { signal: ctrl.signal });
    if (!response.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function geocode(address) {
  const params = new URLSearchParams({ SingleLine: address, outFields: '*', outSR: '4326', maxLocations: '1', countryCode: 'USA', f: 'json' });
  const data = await jsonFetch(`${ARCGIS_GEOCODER}/findAddressCandidates?${params}`);
  const candidate = data?.candidates?.[0];
  if (!candidate || Number(candidate.score) < 85) return null;
  return candidate;
}

// Same map the applicant signup uses (src/eligibility.js). Returns
// { status: in_uez | inactive_uez | not_in_uez | address_not_found | po_box | check_failed, ... }
async function checkZone(address, candidate) {
  const checkedAt = new Date().toISOString();
  if (/\bP\.?\s*O\.?\s*BOX\b/i.test(address)) return { status: 'po_box', inUez: false, address, checkedAt };
  try {
    const hit = candidate === undefined ? await geocode(address) : candidate;
    if (!hit) return { status: 'address_not_found', inUez: false, address, checkedAt };
    const params = new URLSearchParams({
      f: 'json', geometry: JSON.stringify({ x: hit.location.x, y: hit.location.y }), geometryType: 'esriGeometryPoint',
      inSR: '4326', spatialRel: 'esriSpatialRelIntersects', where: '1=1', outFields: 'MUNICIPAL,UEZ_NAME,ACTIVE', returnGeometry: 'false'
    });
    const data = await jsonFetch(`${UEZ_LAYER}?${params}`);
    if (!data) return { status: 'check_failed', inUez: null, address, checkedAt };
    const zone = data.features?.[0]?.attributes;
    if (!zone) return { status: 'not_in_uez', inUez: false, address, municipality: hit.attributes?.City || null, checkedAt };
    const active = !/^(N|NO|FALSE|0|INACTIVE)$/i.test(String(zone.ACTIVE ?? 'Y').trim());
    const raw = String(zone.UEZ_NAME || zone.MUNICIPAL || '').replace(/\bUEZ\b/gi, '').trim();
    const base = titleCaseWords(raw || 'New Jersey');
    return {
      status: active ? 'in_uez' : 'inactive_uez',
      inUez: active,
      address,
      zoneName: `${base} Urban Enterprise Zone (UEZ)`,
      zoneIdentifier: (raw || 'uez').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
      checkedAt
    };
  } catch (err) {
    return { status: 'check_failed', inUez: null, address, error: err.message, checkedAt };
  }
}

// Turns a raw BRC address string into structured fields, using the geocoder
// to split street/city when it can. Returns { address, zoneCheck } or null.
async function resolveBrcAddress(raw) {
  const text = clean(raw);
  if (!text) return null;
  let candidate = null;
  if (!/\bP\.?\s*O\.?\s*BOX\b/i.test(text)) candidate = await geocode(text).catch(() => null);
  const address = parseBrcAddress(text, candidate?.attributes?.City || null);
  if (!address) return null;
  const zoneCheck = await checkZone(text, candidate);
  return { address, zoneCheck };
}

function currentName(app) {
  return clean(app.registered_business_name || app.brc_registered_name || app.business_name_input);
}

function currentAddress(app) {
  return {
    addressLine1: clean(app.address_line1) || null,
    addressLine2: clean(app.address_line2) || null,
    city: clean(app.city) || null,
    state: clean(app.state) || null,
    zip: clean(app.zip) || null
  };
}

function sameAddress(a, b) {
  return formatAddress(a).toUpperCase() === formatAddress(b).toUpperCase();
}

// Builds the DB patch that makes `name` / `address` the business identity.
// Pass only what's changing; omitted (undefined) parts are left alone.
// `brcData` is the brc_data object to build on (already merged by the caller).
function identityPatch(application, { name, address, zoneCheck, brcData }) {
  const patch = {};
  const changes = [];
  const nextBrc = { ...(brcData !== undefined ? (brcData || {}) : (application.brc_data || {})) };
  let brcTouched = brcData !== undefined;

  const newName = clean(name);
  if (newName) {
    const before = currentName(application);
    const typedBefore = clean(application.business_name_input);
    if (newName !== clean(application.business_name_input) || newName !== clean(application.registered_business_name) || newName !== clean(application.brc_registered_name)) {
      patch.business_name_input = newName;
      patch.registered_business_name = newName;
      patch.brc_registered_name = newName;
      if (newName !== before || newName !== typedBefore) changes.push({ field: 'name', from: typedBefore !== before && typedBefore ? `${before} (typed: ${typedBefore})` : before, to: newName });
    }
    if (application.brc_data || brcData) { nextBrc.taxpayerName = newName; brcTouched = true; }
  }

  if (address && address.addressLine1) {
    const before = currentAddress(application);
    const next = {
      addressLine1: clean(address.addressLine1) || null,
      addressLine2: clean(address.addressLine2) || null,
      city: clean(address.city) || null,
      state: (clean(address.state) || 'NJ').toUpperCase().slice(0, 2),
      zip: clean(address.zip) || null
    };
    if (!sameAddress(before, next)) {
      patch.address_line1 = next.addressLine1;
      patch.address_line2 = next.addressLine2;
      patch.city = next.city;
      patch.state = next.state;
      patch.zip = next.zip;
      changes.push({ field: 'address', from: formatAddress(before) || '(blank)', to: formatAddress(next) });
    }
    if (application.brc_data || brcData || zoneCheck) {
      nextBrc.address = formatAddress(next);
      brcTouched = true;
    }
    if (zoneCheck) {
      nextBrc.zoneCheck = zoneCheck;
      brcTouched = true;
      // Keep the displayed zone in step with the address. zone_eligible is left
      // alone on purpose: the client portal uses it to decide where to resume.
      if (zoneCheck.inUez) {
        patch.zone_name = zoneCheck.zoneName;
        patch.zone_identifier = zoneCheck.zoneIdentifier;
      }
    }
  }

  if (brcTouched) patch.brc_data = nextBrc;
  return { patch, changes };
}

const SOURCE_LABEL = { brc: 'from the BRC', brc_card: 'edited in the BRC card', drawer: 'edited in the case drawer' };

async function logIdentityChanges(applicationId, changes, source, userId, zoneCheck) {
  const zoneWarn = zoneCheck && zoneCheck.inUez === false
    ? ` ⚠ ${zoneCheck.status === 'po_box' ? 'PO Box, not a physical UEZ address' : zoneCheck.status === 'address_not_found' ? 'address could not be found on the UEZ map' : 'address is NOT in the UEZ'}.`
    : '';
  for (const change of changes) {
    const label = change.field === 'name' ? 'Business name updated' : 'Business address updated';
    const message = `${change.from || '(blank)'} → ${change.to} (${SOURCE_LABEL[source] || source}).${change.field === 'address' ? zoneWarn : ''}`;
    const { error } = await supabase.from('uez_status_events').insert({
      application_id: applicationId,
      status: change.field === 'name' ? 'business_name_updated' : 'business_address_updated',
      label,
      message,
      visible_to_applicant: false,
      created_by: userId || null,
      metadata: { field: change.field, from: change.from, to: change.to, source, zoneCheck: change.field === 'address' ? (zoneCheck || null) : undefined }
    });
    if (error) console.error('Business identity event logging failed:', error.message);
  }
}

module.exports = {
  clean,
  parseBrcAddress,
  formatAddress,
  checkZone,
  resolveBrcAddress,
  identityPatch,
  logIdentityChanges,
  titleCaseWords
};
