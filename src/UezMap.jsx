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

    const point = [latitude, longitude];
    const map = L.map(mapNode.current, {
      zoomControl: true,
      attributionControl: false,
      scrollWheelZoom: false
    }).setView(point, 18);
    mapRef.current = map;

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 20
    }).addTo(map);

    if (zoneGeometry) {
      L.geoJSON(zoneGeometry, {
        style: {
          color: '#6f63d9',
          weight: 2,
          opacity: 0.75,
          fillColor: '#8d84ea',
          fillOpacity: 0.1
        },
        interactive: false
      }).addTo(map);
    }

    const marker = L.circleMarker(point, {
      radius: 10,
      color: '#ffffff',
      weight: 4,
      fillColor: '#5f67d6',
      fillOpacity: 1
    }).addTo(map);
    marker.bindTooltip(address || 'Selected business address', {
      permanent: false,
      direction: 'top',
      offset: [0, -10]
    });

    setTimeout(() => {
      map.invalidateSize();
      map.setView(point, 18, { animate: false });
    }, 0);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [latitude, longitude, zoneGeometry, address]);

  return <div ref={mapNode} className="uez-map" aria-label="UEZ eligibility map" />;
}
