const NJ_GEOCODER = 'https://geo.nj.gov/arcgis/rest/services/Tasks/NJ_Geocode/GeocodeServer';
const UEZ_LAYER = 'https://services.arcgis.com/Aur8tCo478N3VovT/arcgis/rest/services/Govt_admin_UEZ_bnd/FeatureServer/0/query';
const UEZ_LAYER_ITEM_ID = '7cf1dfdc498a4ce499ddd9cb85bc8785';
const ARCGIS_MAP_VIEWER = 'https://www.arcgis.com/apps/mapviewer/index.html';

function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export async function suggestNjAddresses(text) {
  const value = String(text || '').trim();
  if (value.length < 3) return [];

  const params = new URLSearchParams({
    text: value,
    maxSuggestions: '7',
    f: 'json'
  });

  const response = await fetch(`${NJ_GEOCODER}/suggest?${params}`);
  if (!response.ok) return [];
  const data = await response.json();
  return (data?.suggestions || [])
    .filter((suggestion) => suggestion?.text)
    .map((suggestion) => ({ text: suggestion.text, magicKey: suggestion.magicKey || null }));
}

async function geocodeAddress(address, magicKey = null) {
  const params = new URLSearchParams({
    SingleLine: address,
    outFields: '*',
    outSR: '4326',
    maxLocations: '5',
    f: 'json'
  });
  if (magicKey) params.set('magicKey', magicKey);

  const response = await fetch(`${NJ_GEOCODER}/findAddressCandidates?${params}`);
  if (!response.ok) throw new Error('Could not verify that address.');
  const data = await response.json();
  const candidate = data?.candidates?.[0];
  if (!candidate || candidate.score < 90) return null;
  return candidate;
}

async function findUezZone(location) {
  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: location.x, y: location.y }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
    outFields: 'MUNICIPAL,DATE_DESIG,UEZ_NAME,ACTIVE,DATE_MODIFIED,OBJECTID',
    returnGeometry: 'false'
  });
  const response = await fetch(`${UEZ_LAYER}?${params}`);
  if (!response.ok) throw new Error('Could not check the UEZ map.');
  const data = await response.json();
  return data?.features?.[0]?.attributes || null;
}

function mapUrl(location, address) {
  if (!location) return null;

  const markerTitle = 'Selected business address';
  const markerText = address || 'Business address';
  const marker = `${location.x};${location.y};4326;${markerTitle};;${markerText}`;

  const params = new URLSearchParams({
    layers: UEZ_LAYER_ITEM_ID,
    center: `${location.x},${location.y}`,
    level: '17',
    marker
  });

  return `${ARCGIS_MAP_VIEWER}?${params}`;
}

export async function checkUezEligibility(address, magicKey = null) {
  const candidate = await geocodeAddress(address, magicKey);
  if (!candidate) return { status: 'address_not_found', address, matchedAddress: null, latitude: null, longitude: null, mapUrl: null, zoneIdentifier: null, zoneName: null, municipality: null, eligible: false, programs: [] };

  const location = candidate.location;
  const zone = await findUezZone(location);
  const matchedAddress = candidate.address;

  if (!zone) return {
    status: 'not_in_uez',
    address,
    matchedAddress,
    latitude: location.y,
    longitude: location.x,
    mapUrl: mapUrl(location, matchedAddress),
    zoneIdentifier: null,
    zoneName: null,
    municipality: titleCase(candidate.attributes?.City || ''),
    eligible: false,
    programs: []
  };

  const municipality = titleCase(zone.MUNICIPAL || candidate.attributes?.City || '');
  const rawZoneName = String(zone.UEZ_NAME || municipality || 'New Jersey').replace(/\bUEZ\b/gi, '').trim();
  const zoneBaseName = titleCase(rawZoneName || municipality || 'New Jersey');
  const zoneName = `${zoneBaseName} Urban Enterprise Zone (UEZ)`;
  const zoneIdentifier = (rawZoneName || municipality || 'uez').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const isLakewood = zoneIdentifier === 'lakewood' || /lakewood/i.test(rawZoneName) || /lakewood/i.test(municipality);

  return {
    status: 'in_uez',
    address,
    matchedAddress,
    latitude: location.y,
    longitude: location.x,
    mapUrl: mapUrl(location, matchedAddress),
    zoneIdentifier,
    zoneName,
    municipality,
    eligible: zone.ACTIVE == null ? true : Boolean(zone.ACTIVE),
    programs: isLakewood ? [{ code: 'lakewood_technology_grant', name: 'Lakewood LDC Technology Grant' }] : []
  };
}
