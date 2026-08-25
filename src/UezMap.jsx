import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export default function UezMap({ latitude, longitude, zoneGeometry, address }) {
  const mapNode = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!mapNode.current || latitude == null || longitude == null) return undefined;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = L.map(mapNode.current, {
      zoomControl: true,
      attributionControl: false,
      scrollWheelZoom: false
    });
    mapRef.current = map;

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 20
    }).addTo(map);

    const point = [latitude, longitude];
    const marker = L.circleMarker(point, {
      radius: 9,
      weight: 4,
      fillOpacity: 1
    }).addTo(map);
    marker.bindTooltip(address || 'Selected business address', { direction: 'top', offset: [0, -8] });

    let zoneLayer = null;
    if (zoneGeometry) {
      zoneLayer = L.geoJSON(zoneGeometry, {
        style: {
          weight: 3,
          fillOpacity: 0.18
        }
      }).addTo(map);
    }

    if (zoneLayer && zoneLayer.getBounds().isValid()) {
      const bounds = zoneLayer.getBounds();
      bounds.extend(point);
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 17 });
    } else {
      map.setView(point, 17);
    }

    setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [latitude, longitude, zoneGeometry, address]);

  return <div ref={mapNode} className="uez-map" aria-label="UEZ eligibility map" />;
}
