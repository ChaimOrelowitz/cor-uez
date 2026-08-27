const ARCGIS_GEOCODER = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer';
const NJ_GEOCODER = 'https://geo.nj.gov/arcgis/rest/services/Tasks/NJ_Geocode/GeocodeServer';
const UEZ_LAYER = 'https://services.arcgis.com/Aur8tCo478N3VovT/arcgis/rest/services/Govt_admin_UEZ_bnd/FeatureServer/0/query';

function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizedStreetAddress(candidate) {
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

function parseActive(value) {
  if (value == null || value === '') return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toUpperCase();
  if (['N', 'NO', 'FALSE', '0', 'INACTIVE'].includes(normalized)) return false;
  if (['Y', 'YES', 'TRUE', '1', 'ACTIVE'].includes(normalized)) return true;
  return false;
}

async function jsonFetch(url) {
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json();
}

export async function suggestNjAddresses(text) {
  const value = String(text || '').trim();
  if (value.length < 3) return [];

  const worldSuggestParams = new URLSearchParams({
    text: value,
    maxSuggestions: '8',
    countryCode: 'USA',
    f: 'json'
  });

  const worldCandidateParams = new URLSearchParams({
    SingleLine: value,
    outFields: 'Match_addr,Addr_type,City,Region,Postal',
    outSR: '4326',
    maxLocations: '8',
    countryCode: 'USA',
    f: 'json'
  });

  const njCandidateParams = new URLSearchParams({
    SingleLine: value,
    outFields: 'Match_addr,Addr_type,City,Region,Postal',
    outSR: '4326',
    maxLocations: '8',
    f: 'json'
  });

  const [worldSuggestResult, worldCandidateResult, njCandidateResult] = await Promise.allSettled([
    jsonFetch(`${ARCGIS_GEOCODER}/suggest?${worldSuggestParams}`),
    jsonFetch(`${ARCGIS_GEOCODER}/findAddressCandidates?${worldCandidateParams}`),
    jsonFetch(`${NJ_GEOCODER}/findAddressCandidates?${njCandidateParams}`)
  ]);

  const worldSuggestions = worldSuggestResult.status === 'fulfilled'
    ? (worldSuggestResult.value?.suggestions || [])
        .filter((item) => item?.text && /\bNJ\b|New Jersey/i.test(item.text))
        .map((item) => ({ text: item.text, magicKey: item.magicKey || null }))
    : [];

  const candidateRows = [];
  for (const result of [worldCandidateResult, njCandidateResult]) {
    if (result.status !== 'fulfilled') continue;
    for (const candidate of result.value?.candidates || []) {
      const region = candidate.attributes?.Region || candidate.attributes?.RegionAbbr || '';
      if (!candidate?.address || Number(candidate.score) < 70) continue;
      if (region && !/^NJ$|New Jersey/i.test(region)) continue;
      candidateRows.push({ text: candidate.address, magicKey: null });
    }
  }

  const seen = new Set();
  return [...worldSuggestions, ...candidateRows].filter((item) => {
    const key = item.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

async function geocodeWith(service, address, magicKey = null) {
  const params = new URLSearchParams({
    SingleLine: address,
    outFields: '*',
    outSR: '4326',
    maxLocations: '5',
    f: 'json'
  });
  if (service === ARCGIS_GEOCODER) params.set('countryCode', 'USA');
  if (magicKey && service === ARCGIS_GEOCODER) params.set('magicKey', magicKey);

  const data = await jsonFetch(`${service}/findAddressCandidates?${params}`);
  const candidate = data?.candidates?.[0];
  if (!candidate || Number(candidate.score) < 85) return null;
  return candidate;
}

async function geocodeAddress(address, magicKey = null) {
  const world = await geocodeWith(ARCGIS_GEOCODER, address, magicKey);
  if (world) return world;
  return geocodeWith(NJ_GEOCODER, address, null);
}

async function findUezZone(location) {
  const params = new URLSearchParams({
    f: 'geojson',
    geometry: JSON.stringify({ x: location.x, y: location.y }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
    outFields: 'MUNICIPAL,DATE_DESIG,UEZ_NAME,ACTIVE,DATE_MODIFIED,OBJECTID',
    returnGeometry: 'true'
  });
  const response = await fetch(`${UEZ_LAYER}?${params}`);
  if (!response.ok) throw new Error('Could not check the UEZ map.');
  const data = await response.json();
  const feature = data?.features?.[0] || null;
  if (!feature) return null;
  return { attributes: feature.properties || {}, geometry: feature.geometry || null };
}

export async function checkUezEligibility(address, magicKey = null) {
  const candidate = await geocodeAddress(address, magicKey);
  if (!candidate) return {
    status: 'address_not_found', address, matchedAddress: null, latitude: null, longitude: null,
    zoneGeometry: null, zoneIdentifier: null, zoneName: null, municipality: null, eligible: false, programs: []
  };

  const location = candidate.location;
  const zoneResult = await findUezZone(location);
  const normalizedAddress = normalizedStreetAddress(candidate);
  const matchedAddress = normalizedAddress.matchedAddress;

  if (!zoneResult) return {
    status: 'not_in_uez', address, matchedAddress,
    addressLine1: normalizedAddress.addressLine1, city: normalizedAddress.city, state: normalizedAddress.state, zip: normalizedAddress.zip,
    latitude: location.y, longitude: location.x,
    zoneGeometry: null,
    zoneIdentifier: null, zoneName: null,
    municipality: titleCase(candidate.attributes?.City || ''),
    eligible: false, programs: []
  };

  const zone = zoneResult.attributes;
  const municipality = titleCase(zone.MUNICIPAL || candidate.attributes?.City || '');
  const rawZoneName = String(zone.UEZ_NAME || municipality || 'New Jersey').replace(/\bUEZ\b/gi, '').trim();
  const zoneBaseName = titleCase(rawZoneName || municipality || 'New Jersey');
  const zoneName = `${zoneBaseName} Urban Enterprise Zone (UEZ)`;
  const zoneIdentifier = (rawZoneName || municipality || 'uez').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const isLakewood = zoneIdentifier === 'lakewood' || /lakewood/i.test(rawZoneName) || /lakewood/i.test(municipality);
  const active = parseActive(zone.ACTIVE);

  return {
    status: active ? 'in_uez' : 'inactive_uez',
    address,
    matchedAddress,
    addressLine1: normalizedAddress.addressLine1,
    city: normalizedAddress.city,
    state: normalizedAddress.state,
    zip: normalizedAddress.zip,
    latitude: location.y,
    longitude: location.x,
    zoneGeometry: zoneResult.geometry,
    zoneIdentifier,
    zoneName,
    municipality,
    eligible: active,
    programs: active && isLakewood ? [{ code: 'lakewood_technology_grant', name: 'Lakewood LDC Technology Grant' }] : []
  };
}
