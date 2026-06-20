'use client';

import { useEffect, useRef } from 'react';

/**
 * Compact route map for a packet: numbered pins in walk order joined by a
 * dashed line. Lazy-loads Leaflet 1.9 from a CDN (same approach as
 * PropertiesMap) so there's no runtime npm dep. Skips render when no stop has
 * coordinates.
 */
type Stop = { label: string; lat: number; lng: number; order: number };

export function PacketRouteMap({ stops }: { stops: Stop[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inst = useRef<any>(null);

  useEffect(() => {
    const valid = stops
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
      .sort((a, b) => a.order - b.order);
    if (!mapRef.current || inst.current || valid.length === 0) return;

    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    const init = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).L;
      if (!L || !mapRef.current) return;
      const map = L.map(mapRef.current, {
        scrollWheelZoom: false,
        zoomControl: false,
        attributionControl: false,
      });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 18 }).addTo(map);

      const latlngs = valid.map((p) => [p.lat, p.lng] as [number, number]);
      valid.forEach((p, i) => {
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:26px;height:26px;border-radius:50%;background:#c85a3a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.35)">${i + 1}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        L.marker([p.lat, p.lng], { icon }).addTo(map).bindTooltip(p.label, { direction: 'top', offset: [0, -12] });
      });
      if (latlngs.length > 1) {
        L.polyline(latlngs, { color: '#c85a3a', weight: 2, opacity: 0.7, dashArray: '5 5' }).addTo(map);
      }
      map.fitBounds(L.latLngBounds(latlngs), { padding: [28, 28], maxZoom: 15 });
      inst.current = map;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).L) {
      init();
    } else {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = init;
      document.head.appendChild(script);
    }

    return () => {
      if (inst.current) {
        inst.current.remove();
        inst.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasCoords = stops.some((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  if (!hasCoords) return null;
  return (
    <div
      ref={mapRef}
      style={{ width: '100%', height: 220, border: '1px solid var(--rule)', marginBottom: 22, background: 'var(--paper-2, #fff)' }}
    />
  );
}
