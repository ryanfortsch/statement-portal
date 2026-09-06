/**
 * Does the cleaning vendor's own schedule agree with ours?
 *
 * The pure half of vendor-schedule.ts: the verdict types, the per-day
 * reconciliation, and the labels. Import-free at runtime so `npm test`
 * covers every verdict without a bundler or a database; the parser and
 * the loaders that touch quo_events and vendor_appointments stay in
 * vendor-schedule.ts, which re-exports everything here so its callers
 * need not know about the split.
 *
 * Vocabulary, because "nothing booked" once read as a vacancy: every
 * verdict is about the CLEANER. "No cleaner booked" means a guest leaves
 * and the vendor has no visit for that house that day. "Before checkout"
 * means the cleaner is booked before the guest is out. "After check-in"
 * means the cleaner is booked at or after the next guest's arrival on a
 * same-day turnover, which is the one case where the cleaner's time can
 * be too LATE.
 */

import type { ScheduleDay } from '@/lib/checkout-schedule';

/** Stored key: names the Jobber sender the parser keys on, not the brand. */
export const VENDOR_ID = 'a1_maintenance';
/** What the operator sees. Cape Ann Elite is the DBA the whole rest of Helm
 *  uses (bank charges, cleaner_phones.vendor), so the chip matches it. */
export const VENDOR_LABEL = 'Cape Ann Elite';

export type VendorVerdict =
  /** Cleaner is coming, after checkout, and before any same-day arrival. */
  | { kind: 'agree'; time: string }
  /** Cleaner is coming BEFORE the house frees up. */
  | { kind: 'early'; time: string; checkoutTime: string }
  /** Same-day turnover, and the cleaner is booked at or after the next guest's check-in. */
  | { kind: 'late'; time: string; checkinTime: string }
  /** A guest leaves and the vendor has no cleaner booked for the house that day. */
  | { kind: 'no_appointment' }
  /** Cleaner is coming, but nobody checks out (extension, cancellation, owner in). */
  | { kind: 'no_checkout'; time: string; propertyId: string; propertyName: string }
  /** Beyond the vendor's announcement horizon: unknowable, not a problem. */
  | { kind: 'unannounced' };

export type VendorDayReport = {
  /** Verdict per schedule row, keyed `${propertyId}|${checkIn}`. */
  byRow: Map<string, VendorVerdict>;
  /** Vendor visits with no matching checkout that day. */
  orphans: Array<{ propertyId: string; propertyName: string; time: string }>;
  /** True when this day is at or before the vendor's announced horizon. */
  announced: boolean;
};

export type VendorAppointmentRow = {
  property_id: string;
  service_date: string;
  service_time: string;
};

/** Compare one schedule day against the vendor's bookings for that day. */
export function reconcileDay(
  day: ScheduleDay,
  appointments: VendorAppointmentRow[],
  horizon: string | null,
  propertyNames: Map<string, string>,
): VendorDayReport {
  const announced = !!horizon && day.date <= horizon;
  const byRow = new Map<string, VendorVerdict>();
  const forDay = appointments.filter((a) => a.service_date === day.date);
  const used = new Set<string>();

  for (const row of day.rows) {
    const key = `${row.propertyId}|${row.checkIn}`;
    if (!announced) {
      byRow.set(key, { kind: 'unannounced' });
      continue;
    }
    const appt = forDay.find((a) => a.property_id === row.propertyId);
    if (!appt) {
      byRow.set(key, { kind: 'no_appointment' });
      continue;
    }
    used.add(appt.property_id);
    if (appt.service_time < row.time) {
      byRow.set(key, { kind: 'early', time: appt.service_time, checkoutTime: row.time });
    } else if (row.sameDayTurnover && row.nextCheckinTime && appt.service_time >= row.nextCheckinTime) {
      // A cleaner arriving as the next guest does is the same failure as
      // one arriving before the last guest left: an occupied house.
      byRow.set(key, { kind: 'late', time: appt.service_time, checkinTime: row.nextCheckinTime });
    } else {
      byRow.set(key, { kind: 'agree', time: appt.service_time });
    }
  }

  const scheduled = new Set(day.rows.map((r) => r.propertyId));
  const orphans = announced
    ? forDay
        .filter((a) => !scheduled.has(a.property_id) && !used.has(a.property_id))
        .map((a) => ({
          propertyId: a.property_id,
          propertyName: propertyNames.get(a.property_id) ?? a.property_id,
          time: a.service_time,
        }))
    : [];

  return { byRow, orphans, announced };
}

/** One-line summary for a row's verdict, or null when there is nothing
 *  worth saying (unannounced days stay silent). */
export function verdictLabel(v: VendorVerdict | undefined): { text: string; tone: 'ok' | 'warn' | 'bad' } | null {
  if (!v) return null;
  switch (v.kind) {
    case 'agree':
      return { text: `${VENDOR_LABEL} ${v.time}`, tone: 'ok' };
    case 'early':
      return { text: `${VENDOR_LABEL} ${v.time} · before ${v.checkoutTime} checkout`, tone: 'warn' };
    case 'late':
      return { text: `${VENDOR_LABEL} ${v.time} · after ${v.checkinTime} check-in`, tone: 'bad' };
    case 'no_appointment':
      return { text: `${VENDOR_LABEL} has no cleaner booked`, tone: 'bad' };
    case 'no_checkout':
      return { text: `${VENDOR_LABEL} ${v.time} · nobody checks out`, tone: 'bad' };
    case 'unannounced':
      return null;
  }
}

/** Row-level verdicts for a whole schedule window, plus the day reports. */
export function summarize(reports: VendorDayReport[]): {
  agree: number;
  early: number;
  late: number;
  missing: number;
  orphans: number;
} {
  let agree = 0;
  let early = 0;
  let late = 0;
  let missing = 0;
  let orphans = 0;
  for (const r of reports) {
    for (const v of r.byRow.values()) {
      if (v.kind === 'agree') agree += 1;
      else if (v.kind === 'early') early += 1;
      else if (v.kind === 'late') late += 1;
      else if (v.kind === 'no_appointment') missing += 1;
    }
    orphans += r.orphans.length;
  }
  return { agree, early, late, missing, orphans };
}
