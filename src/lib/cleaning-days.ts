/**
 * The cleaning crew's day as one flat list a page can print.
 *
 * Cape Ann Elite's own bookings (parsed from their Jobber reminder texts,
 * see vendor-schedule.ts) laid against our checkout schedule, so every
 * line answers the two questions that matter about a turnover: is a
 * cleaner coming, and does their time work with when the house frees up.
 *
 * Import-free at runtime on purpose, so `npm test` can exercise it with
 * no bundler and no database: it takes the reconciliation REPORT
 * (vendor-schedule's reconcileDay output) rather than producing it. The
 * loader that wires the database, the reconciliation and this file
 * together is cleaning-schedule.ts. Both the /turnovers/cleanings page and
 * the home strip read that loader, so the two can never disagree.
 */

import type { ScheduleDay } from '@/lib/checkout-schedule';
import type { VendorAppointmentRow, VendorDayReport } from '@/lib/vendor-schedule';

export type CleaningStatus =
  /** Vendor is coming, at or after our checkout. */
  | 'agree'
  /** Vendor is coming BEFORE the house frees up. */
  | 'early'
  /** We have a checkout and the vendor has nothing booked. */
  | 'no_appointment'
  /** Vendor is coming and nobody checks out (extension, cancellation, owner in). */
  | 'no_checkout'
  /** Past the vendor's announcement horizon. Not yet knowable, not a problem. */
  | 'unannounced'
  /** Our own checkout schedule failed to load, so the visit stands unjudged. */
  | 'unchecked';

/** The statuses worth a human's attention. Everything else is quiet. */
export const ATTENTION_STATUSES: ReadonlySet<CleaningStatus> = new Set<CleaningStatus>([
  'early',
  'no_appointment',
  'no_checkout',
]);

export type CleaningItem = {
  propertyId: string;
  propertyName: string;
  /** Who is leaving, per our schedule. Null for a vendor visit with no checkout. */
  guestName: string | null;
  /** The stay's check-in, for linking back to the schedule row. Null for orphans. */
  checkIn: string | null;
  /** The vendor's booked time, HH:MM 24h. Null when they have nothing booked. */
  cleaningTime: string | null;
  /** Our effective checkout time, HH:MM 24h. Null for a vendor visit with no checkout. */
  checkoutTime: string | null;
  sameDayTurnover: boolean;
  nextCheckinTime: string | null;
  status: CleaningStatus;
};

export type CleaningDay = {
  date: string;
  /** At or before the vendor's announced horizon: a blank here means nothing booked. */
  announced: boolean;
  /** Route order: the vendor's times first, then unbooked checkouts by checkout time. */
  items: CleaningItem[];
  /** Vendor visits booked that day. */
  booked: number;
  /** Checkouts on our schedule that day. */
  checkouts: number;
  /** Items carrying an ATTENTION status. */
  attention: number;
};

/**
 * The crew works their route in the vendor's time order, so that is the
 * order the day reads in. Checkouts with nothing booked follow, by the
 * time the house frees up, so the next thing to chase is at the top of
 * that tail.
 */
function compareItems(a: CleaningItem, b: CleaningItem): number {
  if (a.cleaningTime && b.cleaningTime && a.cleaningTime !== b.cleaningTime) {
    return a.cleaningTime.localeCompare(b.cleaningTime);
  }
  if (a.cleaningTime && !b.cleaningTime) return -1;
  if (!a.cleaningTime && b.cleaningTime) return 1;
  const ac = a.checkoutTime ?? '99:99';
  const bc = b.checkoutTime ?? '99:99';
  if (ac !== bc) return ac.localeCompare(bc);
  return a.propertyName.localeCompare(b.propertyName);
}

function finish(date: string, announced: boolean, items: CleaningItem[]): CleaningDay {
  items.sort(compareItems);
  return {
    date,
    announced,
    items,
    booked: items.filter((i) => i.cleaningTime !== null).length,
    checkouts: items.filter((i) => i.checkoutTime !== null).length,
    attention: items.filter((i) => ATTENTION_STATUSES.has(i.status)).length,
  };
}

/** One schedule day plus its reconciliation report, flattened. */
export function composeCleaningDay(day: ScheduleDay, report: VendorDayReport): CleaningDay {
  const items: CleaningItem[] = day.rows.map((row) => {
    const verdict = report.byRow.get(`${row.propertyId}|${row.checkIn}`);
    const status: CleaningStatus = verdict?.kind ?? 'unannounced';
    const cleaningTime =
      verdict && (verdict.kind === 'agree' || verdict.kind === 'early') ? verdict.time : null;
    return {
      propertyId: row.propertyId,
      propertyName: row.propertyName,
      guestName: row.guestName || null,
      checkIn: row.checkIn,
      cleaningTime,
      checkoutTime: row.time,
      sameDayTurnover: row.sameDayTurnover,
      nextCheckinTime: row.nextCheckinTime,
      status,
    };
  });
  for (const o of report.orphans) {
    items.push({
      propertyId: o.propertyId,
      propertyName: o.propertyName,
      guestName: null,
      checkIn: null,
      cleaningTime: o.time,
      checkoutTime: null,
      sameDayTurnover: false,
      nextCheckinTime: null,
      status: 'no_checkout',
    });
  }
  return finish(day.date, report.announced, items);
}

/**
 * The vendor's bookings alone, for a day our checkout schedule could not
 * be built. Every visit is 'unchecked': shown, because the crew IS coming,
 * but never judged against a schedule we do not have.
 */
export function composeVendorOnlyDay(
  date: string,
  appointments: VendorAppointmentRow[],
  horizon: string | null,
  propertyNames: Map<string, string>,
): CleaningDay {
  const items: CleaningItem[] = appointments
    .filter((a) => a.service_date === date)
    .map((a) => ({
      propertyId: a.property_id,
      propertyName: propertyNames.get(a.property_id) ?? a.property_id,
      guestName: null,
      checkIn: null,
      cleaningTime: a.service_time,
      checkoutTime: null,
      sameDayTurnover: false,
      nextCheckinTime: null,
      status: 'unchecked' as const,
    }));
  return finish(date, !!horizon && date <= horizon, items);
}
