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
 * module on its own. `forecast-smart.ts` is the consumer, and so is
 * `revenue-snapshot.ts`: /revenue's Pacing view will not project a home this
 * module says is shut, or it would forecast a month for an offboarded home.
 *
 * There are TWO seasonality sources and they are not rivals. This one is
 * code-maintained and carries the facts an operator cannot express in a
 * form: permanent exits and non-renewals. `property_rental_periods` (see
 * src/lib/rental-periods.ts) is the operator-editable one, edited on the
 * property page, for recurring open windows. A home is open only when BOTH
 * agree it is.
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
 *   seasonLastDay   'MM-DD', the last operating day of a RECURRING season
 *                   that ends mid-month. That month pro-rates by the share
 *                   of days before it; the season still returns next year.
 *                   Distinct from offlineFromDate, which never returns.
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
  seasonLastDay?: string;
  closedMonths?: string[];
  offlineFrom?: string;
  offlineFromDate?: string;
};

export const OPERATING_WINDOWS: Record<string, OperatingWindow> = {
  // 4 Brier Neck is a summer-only rental. September came off the season as
  // of the Aug 2026 schedule review, so it ran June through August. Jane
  // Armstrong gave notice on 2026-08-31; the agreement runs to 2026-12-31 and
  // is not renewed for 2027, so nothing projects after August 2026.
  '4_brier_neck': { seasonMonths: [6, 7, 8], offlineFrom: '2026-09' },
  // 73 Rocky Neck was slated for decommissioning after Aug 2026, then picked
  // up September and October, and was then carried to a sale. Dotti called
  // the sale off on 2026-09-16, so the home has no end date again and is
  // deliberately absent from this table: no window means open every month.
  // 16 Waterman shuts down after 31 October and reopens in May, so it is a
  // May-October property.
  '16_waterman': { seasonMonths: [5, 6, 7, 8, 9, 10] },
  // 79 Main is SEASONAL, not leaving: June 1 through October 20 every year
  // (Dotti, 2026-09-16). It was previously recorded as offlineFromDate
  // '2026-10-21', which read the end of its 2026 season as a permanent exit
  // and zeroed every month after it, 2027's summer included.
  '79_main': { seasonMonths: [6, 7, 8, 9, 10], seasonLastDay: '10-20' },
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
  const monthOfYear = parseInt(ym.slice(5, 7), 10);
  if (w.seasonMonths && !w.seasonMonths.includes(monthOfYear)) {
    return 0;
  }
  // A recurring season that ends mid-month: that month pro-rates, and unlike
  // offlineFromDate the season comes back the following year.
  if (w.seasonLastDay && parseInt(w.seasonLastDay.slice(0, 2), 10) === monthOfYear) {
    const [y, m] = ym.split('-').map((n) => parseInt(n, 10));
    const dim = daysInMonth(y, m);
    const lastDay = parseInt(w.seasonLastDay.slice(3, 5), 10);
    if (dim && lastDay) return Math.min(1, Math.max(0, lastDay / dim));
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

/**
 * Whether a property is open on one specific YYYY-MM-DD.
 *
 * The month-granular `operatingFactor` is what the forecast needs, because it
 * works in whole months. /revenue prices individual nights, so it needs to
 * know that 79 Main's October 21st is shut while its October 20th is open.
 * Same windows, finer resolution.
 */
export function isOperatingOnDate(propertyId: string, iso: string): boolean {
  const ym = iso.slice(0, 7);
  const w = OPERATING_WINDOWS[propertyId];
  if (!w) return true;
  if (operatingFactor(propertyId, ym) <= 0) return false;

  const day = parseInt(iso.slice(8, 10), 10);
  const monthOfYear = parseInt(iso.slice(5, 7), 10);

  // Recurring season that ends mid-month: shut after its last day, and open
  // again when the season comes back next year.
  if (w.seasonLastDay && parseInt(w.seasonLastDay.slice(0, 2), 10) === monthOfYear) {
    if (day > parseInt(w.seasonLastDay.slice(3, 5), 10)) return false;
  }
  // Permanent exit mid-month: shut from the day after the last operating one.
  if (w.offlineFromDate && ym === w.offlineFromDate.slice(0, 7)) {
    if (day > parseInt(w.offlineFromDate.slice(8, 10), 10)) return false;
  }
  return true;
}

/**
 * Whether a property is open for at least one month of `year`. A seasonal
 * home is (16 Waterman May to October, 79 Main June to 20 October); a home
 * offline before the year is not (4 Brier Neck, non-renewed).
 * forecast-model.ts takes this as its OpenInYear predicate so the yearly
 * roster agrees with the smart layer.
 */
export function opensInYear(propertyId: string, year: number): boolean {
  for (let m = 1; m <= 12; m++) {
    if (operatingFactor(propertyId, `${year}-${String(m).padStart(2, '0')}`) > 0) return true;
  }
  return false;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * A one-line description of a property's code-maintained window, or null
 * when it has none. The Rental season panel prints it so an operator can see
 * why a home reads as closed when its own season list is empty.
 */
export function describeOperatingWindow(propertyId: string): string | null {
  const w = OPERATING_WINDOWS[propertyId];
  if (!w) return null;
  const parts: string[] = [];
  if (w.seasonMonths?.length) {
    const first = MONTH_NAMES[w.seasonMonths[0] - 1];
    const lastMonth = w.seasonMonths[w.seasonMonths.length - 1];
    const last =
      w.seasonLastDay && parseInt(w.seasonLastDay.slice(0, 2), 10) === lastMonth
        ? `${MONTH_NAMES[lastMonth - 1]} ${parseInt(w.seasonLastDay.slice(3, 5), 10)}`
        : MONTH_NAMES[lastMonth - 1];
    parts.push(`open ${first} to ${last} each year`);
  }
  if (w.offlineFromDate) parts.push(`offline after ${w.offlineFromDate}`);
  else if (w.offlineFrom) parts.push(`offline from ${w.offlineFrom}`);
  if (w.closedMonths?.length) parts.push(`shut ${w.closedMonths.join(', ')}`);
  return parts.length > 0 ? parts.join('; ') : null;
}

/**
 * The predicate forecast-model.ts takes (OpenInYear): with a month it asks
 * whether the home operates in that month, without one whether it operates
 * at all in the year. The month form scales the card and the contractor
 * bench on the homes actually open each month; the year form builds the
 * roster and the hire trigger.
 */
export function opensIn(propertyId: string, year: number, month?: number): boolean {
  if (month == null) return opensInYear(propertyId, year);
  return isOperating(propertyId, `${year}-${String(month).padStart(2, '0')}`);
}
