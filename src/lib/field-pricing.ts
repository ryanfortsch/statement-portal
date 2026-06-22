/**
 * One source of truth for packet pricing + clustering knobs.
 *
 * Pricing is time-based: we pay the inspector for the work, at an hourly rate.
 * A packet's pay = (on-site minutes across its stops + estimated drive minutes)
 * × the hourly rate. Both the operator's live preview (InspectionCalendar,
 * client) and the server-side packet writer (field-packets) import from here,
 * so the number the operator sees while bundling is what the inspector is
 * offered. Keep this module client-safe — no 'server-only', no DB.
 */
import { haversineMiles, type LatLng } from '@/lib/proximity';

// Clustering knobs (shared by client preview + server grouping).
export const PROXIMITY_MILES = 3; // max straight-line spread within one packet
export const MAX_STOPS = 5;

// ── Labor rate ────────────────────────────────────────────────────────
export const HOURLY_RATE_CENTS = 4000; // $40/hr
const PER_MINUTE_CENTS = HOURLY_RATE_CENTS / 60;

// On-site minutes by home size (the "20 min to an hour per inspection"). A
// 4-bed walk is simply more rooms than a studio.
export function onSiteMinutes(bedrooms: number | null | undefined): number {
  if (bedrooms == null) return 30;
  if (bedrooms <= 2) return 25;
  if (bedrooms === 3) return 40;
  return 55;
}
const MAINTENANCE_MINUTES = 30; // placeholder per-job estimate; operator overrides per packet

// Drive: the Cape Ann core (within this radius of HQ) is an unpaid commute,
// like any job. Beyond it we pay the real round-trip drive time, plus the hop
// across the cluster, at the same hourly rate. ~2 min/mile on local roads.
const FREE_HQ_MILES = 5;
const DRIVE_MIN_PER_MILE = 2;
// Gloucester operations base (matches projections-distance HQ origin).
const HQ: LatLng = { lat: 42.6209, lng: -70.665 };

// A visit landing within this many days of "now" is a rush; it earns a modest
// bump because the inspector has little notice to fit it in.
const RUSH_DAYS = 2;
const RUSH_MULTIPLIER = 1.15;

// Sentinel for "no operator-set rate" on properties.inspection_base_price_cents
// (the column still defaults to this). An explicit value other than this is
// treated as a flat operator override for that home.
export const DEFAULT_BASE_CENTS = 7500;

/** Per-stop pay from on-site time alone (no travel) — the size-based default. */
export function sizeBaseCents(bedrooms: number | null | undefined): number {
  return Math.round(onSiteMinutes(bedrooms) * PER_MINUTE_CENTS);
}

/** Maintenance per-job pay from the on-site estimate. */
export const MAINTENANCE_BASE_CENTS = Math.round(MAINTENANCE_MINUTES * PER_MINUTE_CENTS);

/** Effective per-stop base for a property: an explicit operator rate wins;
 *  otherwise it's the size-based on-site pay. (An exact default value reads as
 *  "unset" and falls through to the time estimate.) */
export function baseForProperty(
  columnCents: number | null | undefined,
  bedrooms: number | null | undefined,
): number {
  if (columnCents != null && columnCents !== DEFAULT_BASE_CENTS) return columnCents;
  return sizeBaseCents(bedrooms);
}

/** Straight-line miles from HQ to a cluster's center (0 if unknown). */
export function hqMiles(center: LatLng | null): number {
  return center ? haversineMiles(HQ, center) : 0;
}

/** Is `visitDate` (YYYY-MM-DD) within the rush window of today (ET)? */
export function isRushVisit(visitDate: string | null | undefined): boolean {
  if (!visitDate) return false;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const days = Math.round(
    (Date.parse(`${visitDate}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86_400_000,
  );
  return days >= 0 && days <= RUSH_DAYS;
}

/** Estimated paid drive minutes for a cluster: round-trip beyond the free core
 *  plus the spread across the stops, at ~2 min/mile. */
export function driveMinutes(center: LatLng | null, spreadMiles: number): number {
  const beyondCore = Math.max(0, hqMiles(center) - FREE_HQ_MILES);
  return (beyondCore * 2 + spreadMiles) * DRIVE_MIN_PER_MILE;
}

/**
 * The posted price for a packet = (sum of per-stop on-site pay + paid drive
 * time) × the rush multiplier, rounded to whole dollars. `basePrices` are the
 * per-stop on-site amounts (size-based or operator-overridden).
 */
export function priceCents(opts: {
  basePrices: number[];
  spreadMiles: number;
  center: LatLng | null;
  isRush?: boolean;
}): number {
  const onSite = opts.basePrices.reduce((a, b) => a + b, 0);
  const drive = Math.round(driveMinutes(opts.center, opts.spreadMiles) * PER_MINUTE_CENTS);
  const subtotal = onSite + drive;
  const total = opts.isRush ? subtotal * RUSH_MULTIPLIER : subtotal;
  return Math.round(total / 100) * 100; // whole dollars
}
