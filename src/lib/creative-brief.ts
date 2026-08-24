import 'server-only';
import { fieldDb } from './field-db';
import { loadShootDetail, type ShootSummary } from './creative-shoots';
import { getPropertyAccess, type PropertyAccess } from './property-access';
import { dayClearReport, type DayClearInfo } from './maintenance-runs';
import { findScaListingByGuestyId } from './sca-listings';
import { scaListingUrl } from './sca-config';
import { getListingPhotos } from './guesty';
import type { AccessBundle } from './field-types';

/**
 * The SHOOT BRIEF: everything Cooper needs to walk onto a property and start
 * shooting — assembled from the systems that already know it. One loader so
 * the portal page, the log-time email/SMS, and the day-of go/no-go check can
 * never disagree about what a shoot's day looks like.
 *
 * Composition (all existing rails):
 *  - shoot + card + pay          loadShootDetail (creative-shoots)
 *  - property + address           properties row
 *  - arrival / parking / codes    property_access (+ properties.parking, with
 *                                 the guest-facing "Parking" property note as
 *                                 the fallback when properties.parking is bare)
 *  - is the day actually clear    dayClearReport (maintenance-runs) — the same
 *                                 "can we send someone into an empty house"
 *                                 check the maintenance planner trusts
 *  - know the home                staycapeann.com listing link + the listing's
 *                                 lead Guesty photo (public CDN URL, fetched
 *                                 live, never stored)
 *
 * Door codes are TIME-GATED like packet access (codes only while working):
 * the bundle carries them only from the day before the shoot through the
 * shoot day itself, and only while the shoot is still active.
 */

export type ShootBrief = {
  detail: ShootSummary;
  property: { id: string; name: string; address: string; city: string | null } | null;
  /** Arrival + parking + entry info. Codes are null outside the reveal window. */
  access: AccessBundle | null;
  /** True when the reveal window is open (codes, if any, are included). */
  codesRevealed: boolean;
  /** Day-clear verdict for the shoot date. Null when no property or no date. */
  dayStatus: DayClearInfo | null;
  /** staycapeann.com listing URL, when this home is live on SCA. */
  scaUrl: string | null;
  /** Public CDN URL of the listing's lead photo (usually the exterior). */
  heroPhotoUrl: string | null;
  mapsUrl: string | null;
};

function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Codes show from the day before the shoot through the shoot day itself. */
export function codesWindowOpen(shootDate: string, today: string = todayET()): boolean {
  return today >= addDaysIso(shootDate, -1) && today <= shootDate;
}

const ACTIVE_SHOOT_STATUSES = new Set(['scheduled', 'shot', 'delivered', 'approved']);

type PropertyLite = {
  id: string;
  name: string;
  address: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  parking: string | null;
  guest_access_method: string | null;
  smart_lock_brand: string | null;
  guesty_listing_id: string | null;
};

/** The guest-facing "Parking" note, the fallback when properties.parking is bare. */
async function parkingNoteFor(propertyId: string): Promise<string | null> {
  const { data } = await fieldDb()
    .from('property_notes')
    .select('body')
    .eq('property_id', propertyId)
    .eq('guest_facing', true)
    .is('resolved_at', null)
    .ilike('title', '%parking%')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { body: string } | null)?.body?.trim() || null;
}

function briefAccessBundle(p: PropertyLite, a: PropertyAccess, parkingFallback: string | null, revealCodes: boolean): AccessBundle {
  const smartLock =
    revealCodes && a.smart_lock_code
      ? p.smart_lock_brand
        ? `${p.smart_lock_brand}: ${a.smart_lock_code}`
        : a.smart_lock_code
      : null;
  return {
    method: p.guest_access_method,
    arrival: a.arrival_brief,
    smartLock,
    lockboxLocation: revealCodes ? a.key_code_location : null,
    gateCode: revealCodes ? a.gate_code : null,
    garageCode: revealCodes ? a.garage_code : null,
    alarm: revealCodes ? a.alarm_system : null,
    parking: p.parking || parkingFallback,
  };
}

export async function loadShootBrief(shootId: string): Promise<ShootBrief | null> {
  const detail = await loadShootDetail(shootId);
  if (!detail) return null;
  const { shoot } = detail;

  let property: PropertyLite | null = null;
  if (shoot.property_id) {
    const { data } = await fieldDb()
      .from('properties')
      .select('id, name, address, city, latitude, longitude, parking, guest_access_method, smart_lock_brand, guesty_listing_id')
      .eq('id', shoot.property_id)
      .maybeSingle();
    property = (data as PropertyLite | null) ?? null;
  }

  const active = ACTIVE_SHOOT_STATUSES.has(shoot.status);
  const codesRevealed = active && codesWindowOpen(shoot.shoot_date);

  let access: AccessBundle | null = null;
  let dayStatus: DayClearInfo | null = null;
  let scaUrl: string | null = null;
  let heroPhotoUrl: string | null = null;

  if (property) {
    const [accessRow, parkingFallback, clearMap] = await Promise.all([
      getPropertyAccess(property.id),
      parkingNoteFor(property.id).catch(() => null),
      // The day-clear check matters right up to (and on) the shoot day;
      // history gets no verdict — the day already happened.
      shoot.shoot_date >= todayET()
        ? dayClearReport([property.id], shoot.shoot_date).catch(() => new Map<string, DayClearInfo>())
        : Promise.resolve(new Map<string, DayClearInfo>()),
    ]);
    access = briefAccessBundle(property, accessRow, parkingFallback, codesRevealed);
    dayStatus = clearMap.get(property.id) ?? null;

    if (property.guesty_listing_id) {
      // Only link SCA when the home is actually in the live collection.
      if (findScaListingByGuestyId(property.guesty_listing_id)) {
        scaUrl = scaListingUrl(property.guesty_listing_id);
      }
      // Lead listing photo (public Guesty CDN). Best-effort — a dark Guesty
      // key or a flaky fetch just means no photo on the brief.
      try {
        const photos = await getListingPhotos(property.guesty_listing_id);
        heroPhotoUrl = photos[0]?.original || photos[0]?.thumbnail || null;
      } catch {
        heroPhotoUrl = null;
      }
    }
  }

  // Same shape as the packet page's maps link: coordinates first, else the
  // street address + city.
  let mapsUrl: string | null = null;
  if (property) {
    if (property.latitude != null && property.longitude != null) {
      mapsUrl = `https://www.google.com/maps/search/?api=1&query=${property.latitude},${property.longitude}`;
    } else if (property.address?.trim()) {
      const q = `${property.address.trim()}${property.city ? `, ${property.city}` : ''}`;
      mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
    }
  }

  return {
    detail,
    property: property ? { id: property.id, name: property.name, address: property.address, city: property.city } : null,
    access,
    codesRevealed,
    dayStatus,
    scaUrl,
    heroPhotoUrl,
    mapsUrl,
  };
}

/** One human line for the shoot day: clear, or why not. Contributor-safe
 *  wording (dates only, never guest names). */
export function dayStatusLine(brief: Pick<ShootBrief, 'dayStatus'>, shootDate: string): string | null {
  const d = brief.dayStatus;
  if (!d) return null;
  if (d.clear) {
    const bits: string[] = ['The home is empty that day'];
    if (d.priorCheckout === shootDate) bits.push('guests leave that morning (~11 AM), so plan for the afternoon');
    else if (d.priorCheckout) bits.push(`last guests left ${fmtShortDate(d.priorCheckout)}`);
    if (d.nextCheckin) bits.push(`next arrive ${fmtShortDate(d.nextCheckin)}`);
    return `${bits.join(' · ')}.`;
  }
  return `Heads up — ${d.reason}.`;
}

export function fmtShortDate(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
