from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Missing {label} in {path}')
    p.write_text(text.replace(old, new, 1))

# 1) Keep the exact same UEZ map/geometry check, but normalize a POI/business geocoder
# result down to its actual street address fields before saving/displaying it.
replace_once(
    'src/eligibility.js',
    """function parseActive(value) {""",
    """function normalizedStreetAddress(candidate) {
  const attrs = candidate?.attributes || {};
  const addressLine1 = String(attrs.Address || attrs.StAddr || attrs.Street || '').trim();
  const city = String(attrs.City || attrs.Municipality || '').trim();
  const rawState = String(attrs.RegionAbbr || attrs.Region || 'NJ').trim();
  const state = /^new jersey$/i.test(rawState) ? 'NJ' : rawState;
  const zip = String(attrs.Postal || attrs.Zip || '').trim().slice(0, 10);

  // ArcGIS POI matches can put the business name in candidate.address even though
  // the candidate has a perfectly good street address in its attributes. Prefer
  // those physical-address fields; fall back only when the geocoder did not return them.
  const matchedAddress = addressLine1
    ? [addressLine1, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    : String(candidate?.address || '').trim();

  return { matchedAddress, addressLine1: addressLine1 || matchedAddress, city, state, zip };
}

function parseActive(value) {""",
    'normalized street address helper'
)

replace_once(
    'src/eligibility.js',
    """  const zoneResult = await findUezZone(location);
  const matchedAddress = candidate.address;
""",
    """  const zoneResult = await findUezZone(location);
  const normalizedAddress = normalizedStreetAddress(candidate);
  const matchedAddress = normalizedAddress.matchedAddress;
""",
    'normalized matched address'
)

replace_once(
    'src/eligibility.js',
    """    status: 'not_in_uez', address, matchedAddress,
    latitude: location.y, longitude: location.x,""",
    """    status: 'not_in_uez', address, matchedAddress,
    addressLine1: normalizedAddress.addressLine1, city: normalizedAddress.city, state: normalizedAddress.state, zip: normalizedAddress.zip,
    latitude: location.y, longitude: location.x,""",
    'not in zone address fields'
)

replace_once(
    'src/eligibility.js',
    """    address,
    matchedAddress,
    latitude: location.y,""",
    """    address,
    matchedAddress,
    addressLine1: normalizedAddress.addressLine1,
    city: normalizedAddress.city,
    state: normalizedAddress.state,
    zip: normalizedAddress.zip,
    latitude: location.y,""",
    'eligible address fields'
)

# Persist the normalized physical address as structured fields. Eligibility itself is untouched.
replace_once(
    'src/App.jsx',
    """        address: eligibility?.matchedAddress || form.address,
        zoneIdentifier: eligibility?.zoneIdentifier,""",
    """        address: eligibility?.matchedAddress || form.address,
        addressLine1: eligibility?.addressLine1 || eligibility?.matchedAddress || form.address,
        city: eligibility?.city || null,
        state: eligibility?.state || 'NJ',
        zip: eligibility?.zip || null,
        zoneIdentifier: eligibility?.zoneIdentifier,""",
    'first application address payload'
)

replace_once(
    'src/App.jsx',
    """            address: pendingAddress,
            zoneIdentifier: pendingEligibility?.zoneIdentifier,""",
    """            address: pendingAddress,
            addressLine1: pendingEligibility?.addressLine1 || pendingAddress,
            city: pendingEligibility?.city || null,
            state: pendingEligibility?.state || 'NJ',
            zip: pendingEligibility?.zip || null,
            zoneIdentifier: pendingEligibility?.zoneIdentifier,""",
    'pending application address payload'
)

# 2) Documents cockpit: grey empty, yellow review, green good, red bad.
replace_once(
    'src/AdminPage.jsx',
    """return <div className={`ops-doc-row reviewable-doc ${formationSatisfied(detail) ? 'ready' : review === 'rejected' ? 'bad' : ''}`}><button className=\"ops-doc-name\" onClick={() => formation && previewDocument(formation)} disabled={!formation}><b>{formationSatisfied(detail) ? '✓' : '○'}</b><span>Certificate of Formation</span></button>""",
    """return <div className={`ops-doc-row reviewable-doc ${formationSatisfied(detail) ? 'ready' : review === 'rejected' ? 'bad' : formation ? 'review-pending' : ''}`}><button className=\"ops-doc-name\" onClick={() => formation && previewDocument(formation)} disabled={!formation}><b>{formationSatisfied(detail) ? '✓' : formation ? '!' : '○'}</b><span>Certificate of Formation</span></button>""",
    'formation review color state'
)

replace_once(
    'src/styles.css',
    ".ops-doc-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;min-height:34px;padding:5px 7px;border-radius:8px;background:#f8fafb}.ops-doc-row.ready{background:#f1f9f3}.ops-doc-row.bad{background:#fff2f0}",
    ".ops-doc-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;min-height:34px;padding:5px 7px;border-radius:8px;background:#f1f3f5}.ops-doc-row.ready{background:#eaf7ee}.ops-doc-row.bad{background:#fdeceb}",
    'document base good bad colors'
)

replace_once(
    'src/styles.css',
    ".ops-doc-row.review-pending{background:#fff9eb}",
    ".ops-doc-row.review-pending{background:#fff3cd}",
    'document review yellow'
)
