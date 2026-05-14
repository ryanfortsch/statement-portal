'use client';

/**
 * Geographic portfolio view for /properties. Ported from stay-cape-ann's
 * CapeAnnMap — same Leaflet 1.9 via CDN, same CARTO light tiles, same
 * marker-click → card pattern. Adapted for Helm's editorial tokens
 * (ink/paper/signal) and Helm's data shape (HelmPropertyRow + workSlips).
 *
 * Why a map: the previous /properties UI was 10 nearly-identical list
 * rows with no geographic context. For a vacation-rental management
 * company whose business IS the locations, that read as a CSV instead
 * of a portfolio. The map gives "here is our footprint" in one glance
 * while the list below stays for fast lookup by name.
 *
 * Coordinates: hardcoded here as UI-layer data rather than seeded into
 * the `properties` table. The DB has lat/long columns but no values yet
 * (the seed migration didn't populate them) and a proper geocode
 * pipeline is out of scope for this change. Approximate coordinates are
 * fine for portfolio overview - pin precision within a block is plenty.
 * Borrowed from stay-cape-ann's mockData where the listing was
 * identifiable (3 Locust = Niles Beach, 30 Woodward = Little River) and
 * estimated from Gloucester / Rockport / Beverly street knowledge for
 * the rest.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { HelmPropertyRow } from '@/lib/properties';

// Map zoomed to fit the Cape Ann + Beverly cluster (10 active properties).
// Center is roughly the geographic midpoint of the active set.
const MAP_CENTER: [number, number] = [42.605, -70.690];
const DEFAULT_ZOOM = 11;

// Property id → [lat, lng]. Approximate coordinates for the 10 active
// Rising Tide properties as of 2026-05-14. Update as we add properties or
// when the DB column gets backfilled by a proper geocode pass.
const PROPERTY_COORDINATES: Record<string, [number, number]> = {
  '3_south_st': [42.659, -70.616],      // 3 South Street, Rockport (Old Garden Beach)
  '21_horton': [42.610, -70.656],       // 21 Horton Street, Gloucester (Rocky Neck)
  '53_rocky_neck': [42.609, -70.655],   // 53 Rocky Neck Ave, Gloucester
  '4_brier_neck': [42.617, -70.629],    // 4 Brier Neck Rd, Gloucester (Good Harbor)
  '30_woodward': [42.6215, -70.6890],   // 30 Woodward Ave, Gloucester (Little River)
  '20_hammond': [42.572, -70.692],      // 20 Hammond Street, Gloucester (Magnolia)
  '20_enon': [42.578, -70.875],         // 20 Enon Road, Beverly
  '73_rocky_neck': [42.611, -70.654],   // 73 Rocky Neck Ave, Gloucester
  '17_beach_rd': [42.611, -70.673],     // 17 Beach Road, Gloucester
  '3_locust': [42.5959, -70.6544],      // 3 Locust Lane, Gloucester (Niles Beach)
};

type Props = {
  properties: HelmPropertyRow[];
  workCounts: Record<string, { total: number; ownerAction: number }>;
};

export default function PropertiesMap({ properties, workCounts }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstance = useRef<any>(null);
  const [activeProperty, setActiveProperty] = useState<HelmPropertyRow | null>(null);
  const [loaded, setLoaded] = useState(false);

  // addMarkers is a callback so the marker-cleanup effect can list it in
  // deps without re-running on every render. It reads `properties` from
  // closure, so the dep array re-creates it when the list changes.
  const addMarkers = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const L = (window as any).L;
    if (!L || !mapInstance.current) return;

    // Clear any previous markers so re-renders don't stack pins.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mapInstance.current.eachLayer((layer: any) => {
      if (layer.options?.pane === 'markerPane' || layer instanceof L.Marker) {
        mapInstance.current.removeLayer(layer);
      }
    });

    const markerIcon = L.divIcon({
      className: 'helm-property-marker',
      html: `<div class="helm-marker-dot"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });

    const markerActiveIcon = L.divIcon({
      className: 'helm-property-marker active',
      html: `<div class="helm-marker-dot active"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

    const markersById = new Map<string, unknown>();

    properties.forEach((p) => {
      const coords = PROPERTY_COORDINATES[p.id];
      if (!coords) return;

      const marker = L.marker(coords, { icon: markerIcon });
      markersById.set(p.id, marker);

      marker.on('click', () => {
        setActiveProperty(p);
        markersById.forEach((m, id) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (m as any).setIcon(id === p.id ? markerActiveIcon : markerIcon);
        });
      });

      marker.addTo(mapInstance.current);
    });

    // Click outside any marker to deselect.
    mapInstance.current.on('click', () => {
      setActiveProperty(null);
      markersById.forEach((m) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m as any).setIcon(markerIcon);
      });
    });
  }, [properties]);

  // Lazy-load Leaflet from a CDN so we don't add a runtime npm dep. Map
  // init runs once on mount; the addMarkers effect below handles updates
  // when the properties list changes.
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    const initMap = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).L;
      if (!L || !mapRef.current) return;

      const map = L.map(mapRef.current, {
        center: MAP_CENTER,
        zoom: DEFAULT_ZOOM,
        scrollWheelZoom: false,
        zoomControl: false,
        attributionControl: false,
      });

      // CARTO light tiles - muted greyscale that lets pins read as the
      // primary visual element.
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 18,
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);
      L.control.attribution({ position: 'bottomleft', prefix: false })
        .addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>')
        .addTo(map);

      mapInstance.current = map;
      setLoaded(true);
    };

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = initMap;
    document.head.appendChild(script);

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
    // Mount-only init; properties changes are handled by the markers effect.
  }, []);

  // Re-add markers when properties change after first load.
  useEffect(() => {
    if (loaded && mapInstance.current) {
      addMarkers();
    }
  }, [loaded, addMarkers]);

  const activeCounts = activeProperty ? workCounts[activeProperty.id] : undefined;

  return (
    <div
      className="rt-properties-map-wrap"
      style={{
        position: 'relative',
        isolation: 'isolate',
        border: '1px solid var(--rule)',
        background: 'var(--paper-2)',
        overflow: 'hidden',
      }}
    >
      <div
        ref={mapRef}
        role="region"
        aria-label="Map of Rising Tide properties"
        style={{ width: '100%', height: 420, background: 'var(--paper-2)' }}
      />

      {!loaded && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--paper-2)',
            color: 'var(--ink-3)',
            fontFamily: 'var(--font-fraunces), serif',
            fontStyle: 'italic',
            fontSize: 16,
          }}
        >
          Loading map…
        </div>
      )}

      {activeProperty && (
        <div
          style={{
            position: 'absolute',
            bottom: 18,
            left: 18,
            right: 18,
            maxWidth: 360,
            zIndex: 1000,
          }}
        >
          <Link
            href={`/properties/${activeProperty.id}`}
            style={{
              display: 'block',
              background: 'var(--paper)',
              border: '1px solid var(--ink)',
              padding: '14px 16px',
              textDecoration: 'none',
              color: 'inherit',
              boxShadow: '0 12px 28px -12px rgba(30, 46, 52, 0.35)',
            }}
          >
            <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--ink-4)' }}>
              {activeProperty.city || 'Rising Tide'}
            </div>
            <h3
              className="font-serif"
              style={{
                fontSize: 22,
                fontWeight: 400,
                letterSpacing: '-0.02em',
                color: 'var(--ink)',
                margin: 0,
                lineHeight: 1.1,
              }}
            >
              {activeProperty.name}
            </h3>
            <p style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)' }}>
              {activeProperty.address}
            </p>
            <div
              style={{
                marginTop: 10,
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                {activeProperty.owner_last}
                {activeCounts && activeCounts.total > 0 && (
                  <>
                    {' · '}
                    <span style={{ color: 'var(--ink)' }}>
                      {activeCounts.total} {activeCounts.total === 1 ? 'slip' : 'slips'}
                    </span>
                    {activeCounts.ownerAction > 0 && (
                      <span style={{ color: 'var(--signal)' }}>
                        {' · '}{activeCounts.ownerAction} owner
                      </span>
                    )}
                  </>
                )}
              </span>
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: '.22em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  color: 'var(--ink)',
                }}
              >
                Open →
              </span>
            </div>
          </Link>
        </div>
      )}

      {/*
        Leaflet injects its own DOM outside of our CSS module reach so we
        scope styles globally to its classes. Colors flow through CSS
        variables so the marker stays in sync with the Helm palette.
      */}
      <style jsx global>{`
        .helm-property-marker {
          background: none !important;
          border: none !important;
        }
        .helm-marker-dot {
          width: 14px;
          height: 14px;
          background: var(--ink);
          border: 2.5px solid var(--paper);
          border-radius: 50%;
          box-shadow: 0 2px 8px rgba(30, 46, 52, 0.3);
          transition: all 0.18s ease;
        }
        .helm-marker-dot:hover {
          transform: scale(1.3);
          box-shadow: 0 3px 12px rgba(30, 46, 52, 0.4);
        }
        .helm-marker-dot.active {
          width: 18px;
          height: 18px;
          background: var(--signal);
          border-color: var(--paper);
          box-shadow: 0 3px 12px rgba(200, 90, 58, 0.45);
          transform: scale(1.2);
        }
        .leaflet-control-zoom a {
          background: var(--paper) !important;
          color: var(--ink) !important;
          border-color: var(--rule) !important;
          font-family: var(--font-inter), system-ui, sans-serif !important;
        }
        .leaflet-control-zoom a:hover {
          background: var(--paper-2) !important;
        }
        .leaflet-control-attribution {
          background: rgba(250, 247, 241, 0.88) !important;
          font-size: 10px !important;
          color: var(--ink-4) !important;
        }
        .leaflet-control-attribution a {
          color: var(--ink) !important;
        }
      `}</style>
    </div>
  );
}
