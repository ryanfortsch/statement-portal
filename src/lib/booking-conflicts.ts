/**
 * Double-booking detection over `bookings` rows, as pure functions.
 *
 * A double-booking is two stays that will both actually happen on the same
 * property on the same night. So only rows whose status says a guest is (or
 * was) in the house take part: `confirmed` and `completed`, the same set
 * TURNOVER_STATUSES in operations.ts uses to decide what needs a turnover.
 *
 * Everything else is deliberately not a party to a conflict:
 *
 *   - inquiry / pending: nobody holds the dates yet. An inquiry over a
 *     confirmed stay is decided in the Inquiries list on /channels, where it
 *     gets confirmed or declined; it is not a double-booking. Before this
 *     rule three quarters of what the detector reported was an inquiry
 *     (measured 2026-09-21: 46 of 61 upcoming overlaps).
 *   - cancelled: gone.
 *   - block: a block is a hold, not a guest, so it can never be one of the
 *     two people who both think they have the house. In practice a block
 *     overlapping a stay IS that stay seen a second time. Guesty's
 *     advance-notice rule exports TONIGHT as a one-night "Blocked by Guesty"
 *     row (iCal uid tagged `_an_`, see calendar-holds.ts) on a listing
 *     whether or not a guest is in it, and a deliberate hold on the same
 *     dates as a direct booking is the owner's own stay, or an SCA hold,
 *     recorded twice. Every block-over-stay overlap on the books on
 *     2026-09-21 was one of those two; none was a second guest. Whether a
 *     real hold sits over a guest's dates is the calendar's hold
 *     intelligence (operations.ts), not a double-booking.
 *
 * Pure and dependency-free so it is unit-tested (booking-conflicts.test.ts)
 * and the database read in channels.ts stays a thin fetch.
 */

import type { BookingStatus } from './channels-types';

/**
 * Statuses under which a guest actually occupies the house. Mirrors
 * TURNOVER_STATUSES in operations.ts, which is module-private there.
 */
export const STAY_STATUSES = ['confirmed', 'completed'] as const satisfies readonly BookingStatus[];

export type StayStatus = (typeof STAY_STATUSES)[number];

export function isStayStatus(status: string | null | undefined): status is StayStatus {
  return !!status && (STAY_STATUSES as readonly string[]).includes(status);
}

/** The columns the detector reads. A full `Booking` satisfies this. */
export type ConflictRow = {
  id: string;
  property_id: string;
  status: string;
  /** YYYY-MM-DD */
  check_in: string;
  /** YYYY-MM-DD, exclusive: the morning the guest leaves. */
  check_out: string;
};

export type DoubleBooking<T extends ConflictRow = ConflictRow> = {
  property_id: string;
  /** The stay that checks in first (ties broken by check-out, then id). */
  a: T;
  b: T;
  /**
   * Nights both stays cover. Always at least 1: a same-day turnover, where
   * one guest's checkout morning is the next guest's check-in, is not an
   * overlap.
   */
  overlap_nights: number;
};

type DateRange = { check_in: string; check_out: string };

/** Nights shared by two [check_in, check_out) ranges. 0 when they only touch. */
export function overlapNights(a: DateRange, b: DateRange): number {
  const start = a.check_in > b.check_in ? a.check_in : b.check_in;
  const end = a.check_out < b.check_out ? a.check_out : b.check_out;
  if (end <= start) return 0;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function byCheckIn(x: ConflictRow, y: ConflictRow): number {
  return (
    x.check_in.localeCompare(y.check_in) ||
    x.check_out.localeCompare(y.check_out) ||
    x.id.localeCompare(y.id)
  );
}

/**
 * Every pair of stays on the same property that share at least one night.
 * Rows that are not a stay (see the module comment) are ignored, as is a
 * row with no nights. Output order does not depend on input order:
 * properties ascend, then the earlier check-in of each pair.
 */
export function findDoubleBookings<T extends ConflictRow>(rows: readonly T[]): DoubleBooking<T>[] {
  const byProperty = new Map<string, T[]>();
  for (const r of rows) {
    if (!isStayStatus(r.status)) continue;
    if (!r.check_in || !r.check_out || r.check_out <= r.check_in) continue;
    let list = byProperty.get(r.property_id);
    if (!list) byProperty.set(r.property_id, (list = []));
    list.push(r);
  }

  const out: DoubleBooking<T>[] = [];
  for (const propertyId of [...byProperty.keys()].sort()) {
    const list = byProperty.get(propertyId)!.sort(byCheckIn);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        // Sorted by check_in, so once b starts on or after a's checkout
        // nothing later in the list can overlap a either.
        if (b.check_in >= a.check_out) break;
        out.push({ property_id: propertyId, a, b, overlap_nights: overlapNights(a, b) });
      }
    }
  }
  return out;
}
