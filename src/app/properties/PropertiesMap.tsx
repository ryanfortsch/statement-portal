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
 * Coordinates come from property.latitude / property.longitude on the
 * row (backfilled by migration 20260514d via Nominatim geocode). The
 * map skips any property whose lat/long is null, so a newly-onboarded
 * property without geo data drops off the map until it gets geocoded
 * rather than appearing at (0, 0).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { HelmPropertyRow } from '@/lib/properties';

// Fallback view for the first paint or for property sets with zero / one
// valid coord. Once markers are added we call fitBounds to frame the
// actual pins (which auto-extends to include 20 Enon in Beverly and 3
// South in Rockport, both of which fall outside a hardcoded center+zoom
// fit to Gloucester).
const FALLBACK_CENTER: [number, number] = [42.605, -70.690];
const FALLBACK_ZOOM = 11;

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
    const placedCoords: Array<[number, number]> = [];

    properties.forEach((p) => {
      // Skip rows that haven't been geocoded yet. Numeric columns from
      // Supabase come through as strings, so coerce + sanity-check before
      // handing to Leaflet (which silently puts NaN markers at the
      // equator).
      const lat = p.latitude != null ? Number(p.latitude) : NaN;
      const lng = p.longitude != null ? Number(p.longitude) : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const marker = L.marker([lat, lng], { icon: markerIcon });
      markersById.set(p.id, marker);
      placedCoords.push([lat, lng]);

      marker.on('click', () => {
        setActiveProperty(p);
        markersById.forEach((m, id) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (m as any).setIcon(id === p.id ? markerActiveIcon : markerIcon);
        });
      });

      marker.addTo(mapInstance.current);
    });

    // Auto-frame the actual pins. With 10 properties spread from Rockport
    // (NE) to Beverly (W), a hardcoded center+zoom was always going to
    // clip some pins; fitBounds picks the tightest viewport that contains
    // every placed marker, with padding so the pins don't hug the edge.
    // For 0 or 1 pins, leave the FALLBACK_CENTER + FALLBACK_ZOOM in
    // place (fitBounds on a single point zooms to maxZoom, which looks
    // useless on a property page).
    if (placedCoords.length >= 2) {
      const bounds = L.latLngBounds(placedCoords);
      mapInstance.current.fitBounds(bounds, { padding: [32, 32], maxZoom: 13 });
    } else if (placedCoords.length === 1) {
      mapInstance.current.setView(placedCoords[0], 13);
    }

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
        center: FALLBACK_CENTER,
        zoom: FALLBACK_ZOOM,
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
        className="rt-properties-map-tile"
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
          className="rt-properties-map-card"
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
