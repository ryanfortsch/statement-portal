/**
 * Per-property operating schedules for the forward forecast.
 *
 * Which months a property is actually open for business. These are
 * operational facts the `properties` table does not carry, so they are
 * maintained here by hand and this is the ONE place to edit when a
 * property's window changes.
 *
 * Deliberately dependency-free so the rules stay pure and directly
 * runnable: `scripts/forecast_operating_windows_check.mjs` imports this
 * module on its own. `forecast-smart.ts` is the consumer.
 */

/**
 * Days in a 1-based month. Same one line as forecast-occupancy's export,
 * repeated here rather than imported to keep this module import-free.
 */
function daysInMonth(year: number, monthOneBased: number): number {
  return new Date(year, monthOneBased, 0).getDate();
}

/**
 * Properties that don't operate every month of the forecast horizon.
 * These are business facts the properties table doesn't capture, so they
 * live here and are maintained by hand.
 *
 *   seasonMonths    months-of-year (1-12) the property is open. Recurring:
 *                   applies to every year in the horizon.
 *   closedMonths    specific YYYY-MM the property is shut. Use for a
 *                   one-off gap that is not part of a recurring season.
 *   offlineFrom     first YYYY-MM the property is permanently offline.
 *   offlineFromDate YYYY-MM-DD of the LAST operating day, when a property
 *                   goes offline mid-month. That month still projects, but
 *                   pro-rated by the share of days it was available; every
 *                   month after it is zero. Takes precedence over
 *                   offlineFrom.
 *
 * Keyed by properties.id. Edit here when a property's window changes.
 */
export type OperatingWindow = {
  seasonMonths?: number[];
  closedMonths?: string[];
  offlineFrom?: string;
  offlineFromDate?: string;
};

export const OPERATING_WINDOWS: Record<string, OperatingWindow> = {
  // 4 Brier Neck is a summer-only rental. September came off the season as
  // of the Aug 2026 schedule review, so it now runs June through August.
  '4_brier_neck': { seasonMonths: [6, 7, 8] },
  // 73 Rocky Neck was slated for decommissioning after Aug 2026, then picked
  // up September and October. Last operating month is now Oct 2026.
  '73_rocky_neck': { offlineFrom: '2026-11' },
  // 16 Waterman shuts down after 31 October and reopens in May, so it is a
  // May-October property.
  '16_waterman': { seasonMonths: [5, 6, 7, 8, 9, 10] },
  // 79 Main comes off the program partway through October 2026. October
  // projects pro-rated across its first 21 days; November onward is zero.
  '79_main': { offlineFromDate: '2026-10-21' },
};

/**
 * Share of a month a property is available, 0 to 1.
 *
 * 1 for a normal operating month, 0 for a closed one, and a fraction for
 * the single month a property goes offline partway through. The last
 * operating day is inclusive: offlineFromDate '2026-10-21' means the
 * property earns across 21 of October's 31 days.
 */
export function operatingFactor(propertyId: string, ym: string): number {
  const w = OPERATING_WINDOWS[propertyId];
  if (!w) return 1;

  if (w.closedMonths?.includes(ym)) return 0;
  if (w.seasonMonths && !w.seasonMonths.includes(parseInt(ym.slice(5, 7), 10))) {
    return 0;
  }

  if (w.offlineFromDate) {
    const endYM = w.offlineFromDate.slice(0, 7);
    if (ym > endYM) return 0;
    if (ym === endYM) {
      const [y, m] = ym.split('-').map((n) => parseInt(n, 10));
      const dim = daysInMonth(y, m);
      const lastDay = parseInt(w.offlineFromDate.slice(8, 10), 10);
      if (!dim || !lastDay) return 1;
      return Math.min(1, Math.max(0, lastDay / dim));
    }
    return 1;
  }

  if (w.offlineFrom && ym >= w.offlineFrom) return 0;
  return 1;
}

/**
 * Whether a property is open for business at all in the given YYYY-MM.
 * True for a partial month — see operatingFactor for how much of it.
 */
export function isOperating(propertyId: string, ym: string): boolean {
  return operatingFactor(propertyId, ym) > 0;
}
