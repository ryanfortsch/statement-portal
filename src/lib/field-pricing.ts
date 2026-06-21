/**
 * One source of truth for packet pricing + clustering knobs.
 *
 * Both the operator's live preview (InspectionCalendar, client) and the
 * server-side packet writer (field-packets) import from here, so the number
 * the operator sees while bundling is the number the inspector is offered.
 * Keep this module client-safe — no 'server-only', no DB, pure functions.
 */
import { haversineMiles, type LatLng } from '@/lib/proximity';

// Clustering knobs (shared by client preview + server grouping).
export const PROXIMITY_MILES = 3; // max straight-line spread within one packet
export const MAX_STOPS = 5;

// Pricing knobs.
export const DEFAULT_BASE_CENTS = 7500; // the per-stop placeholder rate ($75)
export const TRAVEL_PER_MILE_CENTS = 300; // premium per mile of in-cluster spread
// Cape Ann core is "free"; clusters whose center sits beyond it pay for the
// real drive out and back, so a far/solo job (Beverly, Fairfield) isn't priced
// like a Gloucester one even when its own spread is zero.
const FREE_HQ_MILES = 5;
const HQ_PER_MILE_CENTS = 250; // round-trip drive premium beyond the core
// Gloucester operations base (matches projections-distance HQ origin).
const HQ: LatLng = { lat: 42.6209, lng: -70.665 };

// A visit landing within this many days of "now" is a rush; it earns a modest
// bump because the inspector has little notice to fit it in.
const RUSH_DAYS = 2;
const RUSH_MULTIPLIER = 1.15;

/** Per-stop base by home size when the property has no operator-set override.
 *  A 4-bed walk is simply more rooms than a studio. */
export function sizeBaseCents(bedrooms: number | null | undefined): number {
  if (bedrooms == null) return DEFAULT_BASE_CENTS;
  if (bedrooms <= 2) return 6000;
  if (bedrooms === 3) return 8000;
  return 10000;
}

/** Effective per-stop base for a property: an explicit operator rate wins;
 *  otherwise derive from size. (We can't distinguish "operator set exactly
 *  $75" from "unset default $75", so an exact default falls through to size —
 *  operators who want a flat $75 on a big home can set $76/$74, or we add a
 *  real rate card later.) */
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

/**
 * The posted price for a packet: sum of per-stop bases + an in-cluster spread
 * premium + a drive premium for clusters beyond the Cape Ann core, times a
 * rush multiplier for short-notice visits. Rounded to whole cents.
 */
export function priceCents(opts: {
  basePrices: number[];
  spreadMiles: number;
  center: LatLng | null;
  isRush?: boolean;
}): number {
  const base = opts.basePrices.reduce((a, b) => a + b, 0);
  const spreadTravel = Math.round(opts.spreadMiles * TRAVEL_PER_MILE_CENTS);
  const driveTravel = Math.round(Math.max(0, hqMiles(opts.center) - FREE_HQ_MILES) * HQ_PER_MILE_CENTS);
  const subtotal = base + spreadTravel + driveTravel;
  return Math.round(opts.isRush ? subtotal * RUSH_MULTIPLIER : subtotal);
}
