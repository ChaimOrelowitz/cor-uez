const NJ_GEOCODER = 'https://geo.nj.gov/arcgis/rest/services/Tasks/NJ_Geocode/GeocodeServer/findAddressCandidates';
const UEZ_LAYER = 'https://services.arcgis.com/Aur8tCo478N3VovT/arcgis/rest/services/Govt_admin_UEZ_bnd/FeatureServer/0/query';
const UEZ_EXPLORE = 'https://hub.arcgis.com/datasets/njdca::urban-enterprise-zones-in-new-jersey/explore';

async function geocodeAddress(address) {
  const params = new URLSearchParams({ SingleLine: address, outFields: '*', outSR: '4326', f: 'json' });
  const response = await fetch(`${NJ_GEOCODER}?${params}`);
  if (!response.ok) throw new Error('Could not verify that address.');
  const data = await response.json();
  const candidate = data?.candidates?.[0];
  if (!candidate || candidate.score < 90) return null;
  return candidate;
}

async function findUezZone(location) {
  const params = new URLSearchParams({
    f: 'json', geometry: JSON.stringify({ x: location.x, y: location.y }), geometryType: 'esriGeometryPoint',
    inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', where: '1=1',
    outFields: 'MUNICIPAL,DATE_DESIG,UEZ_NAME,DATE_MODIFIED,OBJECTID', returnGeometry: 'false'
  });
  const response = await fetch(`${UEZ_LAYER}?${params}`);
  if (!response.ok) throw new Error('Could not check the UEZ map.');
  const data = await response.json();
  return data?.features?.[0]?.attributes || null;
}

function mapUrl(location) {
  if (!location) return null;
  return `${UEZ_EXPLORE}?location=${encodeURIComponent(`${location.y},${location.x},15`)}`;
}

export async function checkUezEligibility(address) {
  const candidate = await geocodeAddress(address);
  if (!candidate) return { status: 'address_not_found', address, matchedAddress: null, latitude: null, longitude: null, mapUrl: null, zoneIdentifier: null, zoneName: null, municipality: null, eligible: false, programs: [] };

  const location = candidate.location;
  const zone = await findUezZone(location);
  if (!zone) return { status: 'not_in_uez', address, matchedAddress: candidate.address, latitude: location.y, longitude: location.x, mapUrl: mapUrl(location), zoneIdentifier: null, zoneName: null, municipality: candidate.attributes?.City || null, eligible: false, programs: [] };

  const municipality = zone.MUNICIPAL || candidate.attributes?.City || null;
  const zoneName = zone.UEZ_NAME || (municipality ? `${municipality} UEZ` : 'New Jersey UEZ');
  const zoneIdentifier = (zone.UEZ_NAME || municipality || 'uez').toLowerCase().replace(/\buez\b/g, '').trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const isLakewood = zoneIdentifier === 'lakewood' || /lakewood/i.test(zoneName);

  return { status: 'in_uez', address, matchedAddress: candidate.address, latitude: location.y, longitude: location.x, mapUrl: mapUrl(location), zoneIdentifier, zoneName, municipality, eligible: true, programs: isLakewood ? [{ code: 'lakewood_technology_grant', name: 'Lakewood LDC Technology Grant' }] : [] };
}
