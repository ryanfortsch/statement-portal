'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Compact live route map for a packet: numbered pins in walk order joined by a
 * route line. Lazy-loads Leaflet 1.9 from a CDN (same approach as PropertiesMap)
 * so there's no runtime npm dep. Skips render when no stop has coordinates.
 *
 * When a stop carries `state`, pins color by progress like a delivery app: done
 * stops go tide-blue with a check, the current stop is signal-orange with a
 * ring, upcoming stops are hollow navy, and the traveled leg of the line goes
 * solid while the rest stays dashed. `verified` adds a small tide check when the
 * Seam lock recorded their code at that door. With no `state` it renders the
 * original signal-orange numbered pins (browsing / pre-claim).
 */
type StopState = 'done' | 'current' | 'next';
/** `num` is the number shown on the pin. Pass the stop's LIST position so the
 *  map always agrees with the stop list — without it, a coordinate-less stop
 *  gets filtered out and every pin after it silently shifts down by one.
 *  `pin: false` joins the route line without drawing a marker — used for the
 *  return-to-supply-closet leg, which ends where pin 1 already sits. */
type Stop = { label: string; lat: number; lng: number; order: number; num?: number; state?: StopState; verified?: boolean; pin?: boolean };

const SIGNAL = '#c85a3a';
const TIDE = '#3a6b8a';
const NAVY = '#1e2e34';
const PAPER = '#faf7f1';

function pinHtml(n: number, s: Stop): string {
  const st = s.state;
  const bg = !st ? SIGNAL : st === 'done' ? TIDE : st === 'current' ? SIGNAL : PAPER;
  const fg = st === 'next' ? NAVY : '#fff';
  const border = st === 'next' ? NAVY : '#fff';
  const ring = st === 'current' ? '0 0 0 4px rgba(200,90,58,0.22),0 1px 3px rgba(0,0,0,0.35)' : '0 1px 3px rgba(0,0,0,0.35)';
  const inner = st === 'done' ? '✓' : String(n);
  const badge = s.verified
    ? `<div style="position:absolute;bottom:-3px;right:-3px;width:13px;height:13px;border-radius:50%;background:${TIDE};border:1.5px solid #fff;color:#fff;font-size:8px;line-height:1;display:flex;align-items:center;justify-content:center">✓</div>`
    : '';
  return `<div style="position:relative;width:26px;height:26px;border-radius:50%;background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;border:2px solid ${border};box-shadow:${ring}">${inner}${badge}</div>`;
}

export function PacketRouteMap({ stops }: { stops: Stop[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inst = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  // A change to any of these must redraw the map: a stop added / removed /
  // reordered, or a live arrival-state change. Recomputed each render; cheap.
  const routeKey = stops
    .map((s) => `${s.lat},${s.lng},${s.order},${s.num ?? ''},${s.state ?? ''},${s.pin === false ? 0 : 1},${s.verified ? 1 : 0}`)
    .join('|');

  useEffect(() => {
    const valid = stops
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
      .sort((a, b) => a.order - b.order);
    if (!mapRef.current || valid.length === 0) return;
    // Tear down any existing map first, so a changed stop list redraws instead of
    // being ignored (the old guard bailed once a map existed, stranding new stops).
    if (inst.current) {
      try { inst.current.remove(); } catch { /* already gone */ }
      inst.current = null;
    }

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
        // On touch devices the map is a static route picture: one-finger drag
        // must scroll the PAGE, not pan the map (the per-stop "Open in Maps"
        // pills do real navigation). Pinch zoom stays available.
        dragging: !('ontouchstart' in window),
      });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 18 }).addTo(map);

      const latlngs = valid.map((p) => [p.lat, p.lng] as [number, number]);
      valid.forEach((p, i) => {
        if (p.pin === false) return; // path-only point (return leg to the closet)
        const icon = L.divIcon({
          className: '',
          html: pinHtml(p.num ?? i + 1, p),
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        L.marker([p.lat, p.lng], { icon }).addTo(map).bindTooltip(p.label, { direction: 'top', offset: [0, -12] });
      });
      if (latlngs.length > 1) {
        const hasState = valid.some((p) => p.state);
        if (!hasState) {
          L.polyline(latlngs, { color: SIGNAL, weight: 2, opacity: 0.7, dashArray: '5 5' }).addTo(map);
        } else {
          // Traveled leg (up to and including the current stop) goes solid tide;
          // the remaining route stays dashed signal.
          let curIdx = valid.findIndex((p) => p.state === 'current');
          if (curIdx < 0) curIdx = valid.every((p) => p.state === 'done') ? valid.length - 1 : 0;
          const traveled = latlngs.slice(0, curIdx + 1);
          const remaining = latlngs.slice(curIdx);
          if (traveled.length > 1) L.polyline(traveled, { color: TIDE, weight: 3, opacity: 0.85 }).addTo(map);
          if (remaining.length > 1) L.polyline(remaining, { color: SIGNAL, weight: 2, opacity: 0.6, dashArray: '5 5' }).addTo(map);
        }
      }
      map.fitBounds(L.latLngBounds(latlngs), { padding: [28, 28], maxZoom: 15 });
      inst.current = map;
      setStatus('ready');
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).L) {
      init();
    } else {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = init;
      // Flaky signal in the field: say the map failed instead of leaving a
      // permanently blank box that reads as a bug.
      script.onerror = () => setStatus('failed');
      document.head.appendChild(script);
    }

    return () => {
      if (inst.current) {
        inst.current.remove();
        inst.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  const hasCoords = stops.some((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  if (!hasCoords) return null;
  if (status === 'failed') {
    return (
      <div style={{ border: '1px solid var(--rule)', marginBottom: 22, padding: '14px 16px', fontSize: 13, color: 'var(--ink-4)', background: 'var(--paper-2, #fff)' }}>
        Map unavailable right now. Tap a stop&apos;s address below for directions.
      </div>
    );
  }
  return (
    <div style={{ position: 'relative', marginBottom: 22 }}>
      <div
        ref={mapRef}
        style={{ width: '100%', height: 220, border: '1px solid var(--rule)', background: 'var(--paper-2, #fff)' }}
      />
      {status === 'loading' && (
        <div style={{ position: 'absolute', inset: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', pointerEvents: 'none' }}>
          Loading route…
        </div>
      )}
    </div>
  );
}
