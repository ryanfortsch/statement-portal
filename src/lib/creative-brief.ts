import 'server-only';
import { fieldDb } from './field-db';
import { loadShootDetail, type ShootSummary } from './creative-shoots';
import { getPropertyAccess, type PropertyAccess } from './property-access';
import { dayClearReport, type DayClearInfo } from './maintenance-runs';
import { findScaListingByGuestyId } from './sca-listings';
import { scaListingUrl } from './sca-config';
import { getListingParkingAndHero } from './guesty';
import { CREATIVE_CODE, creativeCodeEnabled } from './creative-code';
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
 * HOW THEY GET IN is a resolved chain, not a pile of fields, so every brief
 * answers the question the same way (see `resolveEntry`):
 *   1. fleet CREATIVE code -- the home has a Seam lock, so 5555 is on it
 *   2. the listing's own code -- no Seam lock, but a code is on file
 *   3. the lockbox -- no code at all, but there's a box and a location
 *   4. call the office
 * Only step 1 is a fleet constant that is safe to show any time. Steps 2-3 are
 * property secrets and stay TIME-GATED like packet access: from the day before
 * the shoot through the shoot day, and only while the shoot is still active.
 *
 * WHERE THEY PARK prefers the Guesty listing's own `parkingInstructions` over
 * anything stored in Helm. That field is what guests are told and what Guesty
 * auto-messages interpolate, so it is the authority; Helm's hand-typed copy
 * drifts (3 South read "the driveway" when the listing says a SHARED driveway,
 * two cars maximum).
 */

/**
 * How this contributor gets in the door, resolved to one answer.
 *  creative = the fleet 5555 PIN (the home is on Seam)
 *  listing  = this home's own keypad code (no Seam lock)
 *  lockbox  = a physical box, with where to find it
 *  office   = nothing on file, call us
 * `pending` means an answer exists but the reveal window has not opened yet.
 */
export type EntryPlan = {
  kind: 'creative' | 'listing' | 'lockbox' | 'office';
  /** The digits to punch, when there are digits and they're revealable. */
  code: string | null;
  /** Where the box is / which lock, when that's the shape of the answer. */
  detail: string | null;
  /** True when we hold an answer but it stays hidden until the day before. */
  pending: boolean;
};

export type ShootBrief = {
  detail: ShootSummary;
  property: { id: string; name: string; address: string; city: string | null } | null;
  /** Arrival + parking + entry info. Codes are null outside the reveal window. */
  access: AccessBundle | null;
  /** The ONE way in for this shoot, already resolved. Null with no property. */
  entry: EntryPlan | null;
  /** True when the reveal window is open (codes, if any, are included). */
  codesRevealed: boolean;
  /** The hours they have on site that day, in the home's own clock. */
  window: string | null;
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
  default_checkout_time: string | null;
  default_checkin_time: string | null;
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

/**
 * True when this home has an active lock that CARRIES the fleet creative PIN —
 * `creative_access_code_id` is the stamp ensureCreativeCode writes only after
 * Seam confirms the code on the device.
 *
 * Deliberately not "does this home have a lock". A lock that exists but hasn't
 * converged yet (newly connected, or any lock in the window between shipping
 * the code and the next Seam sync) would have the brief print 5555 at a door
 * that doesn't take it. Unstamped falls through to the home's own code, which
 * is the conservative answer: never print a code we can't prove is on the door.
 */
async function hasCreativeCode(propertyId: string): Promise<boolean> {
  const { data } = await fieldDb()
    .from('lock_devices')
    .select('device_id')
    .eq('property_id', propertyId)
    .eq('active', true)
    .not('creative_access_code_id', 'is', null)
    .limit(1);
  return ((data ?? []) as unknown[]).length > 0;
}

/** Resolve the single way in. See the EntryPlan docblock for the order. */
function resolveEntry(
  creativeOnLock: boolean,
  a: PropertyAccess,
  revealCodes: boolean,
): EntryPlan {
  // The fleet creative PIN is an operator-known constant that rides in briefs
  // (same posture as the maintenance code), so it is NOT time-gated.
  if (creativeOnLock && creativeCodeEnabled()) {
    return { kind: 'creative', code: CREATIVE_CODE, detail: null, pending: false };
  }
  const own = a.smart_lock_code?.trim();
  if (own) {
    return { kind: 'listing', code: revealCodes ? own : null, detail: null, pending: !revealCodes };
  }
  const box = a.key_code_location?.trim();
  if (box) {
    return { kind: 'lockbox', code: null, detail: revealCodes ? box : null, pending: !revealCodes };
  }
  return { kind: 'office', code: null, detail: null, pending: false };
}

/** Strip seconds off a stored HH:MM:SS and read it as a wall clock. */
function clock(t: string | null, fallback: string): string {
  const hhmm = (t ?? fallback).slice(0, 5);
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h)) return fallback;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${ampm}` : `${h12} ${ampm}`;
}

/**
 * The hours on site, in the home's own clock. Two facts at most: when the home
 * opens (a same-day checkout means waiting for the cleaners' start) and when
 * they must be out (only ever a guest arriving THAT day). An empty home with
 * nobody coming has no window worth stating, so it says so plainly.
 */
export function windowLine(
  p: { default_checkout_time: string | null; default_checkin_time: string | null } | null,
  day: DayClearInfo | null,
  shootDate: string,
): string | null {
  if (!p || !day) return null;
  const opens = clock(p.default_checkout_time, '11:00');
  const closes = clock(p.default_checkin_time, '15:00');
  // GUEST checkouts only. priorCheckout counts calendar blocks too, and a block
  // ending on the shoot date is not guests leaving — saying "once guests are
  // out" about one puts a guest on the brief who was never there.
  const checkoutDay = day.priorGuestCheckout === shootDate;
  const arrivalDay = day.nextCheckin === shootDate;
  if (checkoutDay && arrivalDay) return `${opens} to ${closes} — guests leave and arrive the same day.`;
  if (arrivalDay) return `Be out by ${closes} — guests arrive that afternoon.`;
  if (checkoutDay) return `From ${opens}, once guests are out. Nobody arrives after you.`;
  return 'The home is yours for the day. Nobody is arriving.';
}

/** `parking` arrives already resolved by the caller — Guesty listing copy
 *  first, Helm's own fields only as fallback. */
function briefAccessBundle(p: PropertyLite, a: PropertyAccess, parking: string | null, revealCodes: boolean): AccessBundle {
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
    parking,
  };
}

/**
 * OFFICE-SIDE readiness for one home: exactly what the brief will be able to
 * tell a contributor sent there. Same resolvers as loadShootBrief, so the board
 * can never promise something the brief won't show.
 *
 * The point is to catch it BEFORE anyone drives over — a home whose lock hasn't
 * taken the creative code and has no code of its own leaves the contributor
 * with "call the office" at the door, and the office has no idea.
 */
export type CreativeAccessReadiness = { entry: EntryPlan; parking: string | null };

export async function shootAccessReadiness(propertyId: string): Promise<CreativeAccessReadiness | null> {
  const { data } = await fieldDb()
    .from('properties')
    .select('id, parking, guesty_listing_id')
    .eq('id', propertyId)
    .maybeSingle();
  const p = data as { parking: string | null; guesty_listing_id: string | null } | null;
  if (!p) return null;

  const [accessRow, note, creativeOnLock] = await Promise.all([
    getPropertyAccess(propertyId),
    parkingNoteFor(propertyId).catch(() => null),
    hasCreativeCode(propertyId).catch(() => false),
  ]);
  let listingParking: string | null = null;
  if (p.guesty_listing_id) {
    listingParking = await getListingParkingAndHero(p.guesty_listing_id)
      .then((r) => r.parking)
      .catch(() => null);
  }
  return {
    // revealCodes true: the office is allowed to see what it will send.
    entry: resolveEntry(creativeOnLock, accessRow, true),
    parking: accessRow.arrival_brief?.trim() || listingParking || p.parking?.trim() || note,
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
      .select('id, name, address, city, latitude, longitude, parking, guest_access_method, smart_lock_brand, guesty_listing_id, default_checkout_time, default_checkin_time')
      .eq('id', shoot.property_id)
      .maybeSingle();
    property = (data as PropertyLite | null) ?? null;
  }

  const active = ACTIVE_SHOOT_STATUSES.has(shoot.status);
  const codesRevealed = active && codesWindowOpen(shoot.shoot_date);

  let access: AccessBundle | null = null;
  let entry: EntryPlan | null = null;
  let dayStatus: DayClearInfo | null = null;
  let scaUrl: string | null = null;
  let heroPhotoUrl: string | null = null;
  let listingParking: string | null = null;

  if (property) {
    const [accessRow, parkingFallback, clearMap, creativeOnLock] = await Promise.all([
      getPropertyAccess(property.id),
      parkingNoteFor(property.id).catch(() => null),
      // The day-clear check matters right up to (and on) the shoot day;
      // history gets no verdict — the day already happened.
      shoot.shoot_date >= todayET()
        ? dayClearReport([property.id], shoot.shoot_date).catch(() => new Map<string, DayClearInfo>())
        : Promise.resolve(new Map<string, DayClearInfo>()),
      hasCreativeCode(property.id).catch(() => false),
    ]);
    dayStatus = clearMap.get(property.id) ?? null;
    entry = resolveEntry(creativeOnLock, accessRow, codesRevealed);

    if (property.guesty_listing_id) {
      // Only link SCA when the home is actually in the live collection.
      if (findScaListingByGuestyId(property.guesty_listing_id)) {
        scaUrl = scaListingUrl(property.guesty_listing_id);
      }
      // One GET gets both the lead photo and the listing's own parking copy.
      // Best-effort — a dark Guesty key or a flaky fetch just means we fall
      // back to what Helm holds.
      try {
        const live = await getListingParkingAndHero(property.guesty_listing_id);
        heroPhotoUrl = live.heroUrl;
        listingParking = live.parking;
      } catch {
        heroPhotoUrl = null;
      }
    }

    // Guesty's listing copy outranks anything stored in Helm (see the module
    // docblock); Helm's own fields are the fallback when the listing is silent.
    const parking = listingParking || property.parking?.trim() || parkingFallback;
    access = briefAccessBundle(property, accessRow, parking, codesRevealed);
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
    entry,
    codesRevealed,
    window: windowLine(property, dayStatus, shoot.shoot_date),
    dayStatus,
    scaUrl,
    heroPhotoUrl,
    mapsUrl,
  };
}

/**
 * The go / no-go for the day, in one line. Just the verdict: the hours live on
 * the window line, so this never chains clauses about prior checkouts and
 * future arrivals. Contributor-safe (dates only, never guest names).
 */
export function dayStatusLine(brief: Pick<ShootBrief, 'dayStatus'>): string | null {
  const d = brief.dayStatus;
  if (!d) return null;
  if (d.clear) return 'The home is empty that day.';
  return `Heads up - ${d.reason}.`;
}

export function fmtShortDate(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
