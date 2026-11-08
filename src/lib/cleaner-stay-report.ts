/** Minimal, read-only projection for a cleaner's future-stay report.
 * Guest identity is used only by the existing stay resolver upstream. It is
 * deliberately absent from this projection, along with booking IDs and notes.
 */
import { z } from 'zod';

export const CLEANER_REPORT_PROPERTY = '65_calderwood';
const date = z.iso.date();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).nullable();
export const cleanerReportPropertySchema = z.object({
  id: z.literal(CLEANER_REPORT_PROPERTY), name: z.string().min(1),
  default_checkin_time: time, default_checkout_time: time,
}).strict();
export const cleanerReportBookingSchema = z.object({
  id: z.string().min(1), property_id: z.literal(CLEANER_REPORT_PROPERTY),
  check_in: date, check_out: date, status: z.enum(['confirmed', 'completed']),
  duplicate_of: z.null(), num_guests: z.number().int().nonnegative().nullable(),
  guest_name: z.string().nullable(), source: z.string(),
  first_seen_at: z.string().nullable(), last_seen_at: z.string().nullable(),
  external_confirmation_code: z.string().nullable(),
}).strict().refine(b => b.check_in < b.check_out);
export const cleanerReportAdjustmentSchema = z.object({
  property_id: z.literal(CLEANER_REPORT_PROPERTY), stay_check_in: date,
  original_check_out: date, adjusted_check_out: date.nullable(),
  adjusted_checkout_time: time, status: z.enum(['active', 'proposed']),
}).strict();
export const cleanerReportSkipSchema = z.object({
  property_id: z.literal(CLEANER_REPORT_PROPERTY), stay_check_in: date,
}).strict();
export type CleanerReportBooking = z.infer<typeof cleanerReportBookingSchema>;
export type CleanerReportAdjustment = z.infer<typeof cleanerReportAdjustmentSchema>;
export type CleanerStay = {
  checkIn: string; checkOut: string; arrivalTime: string | null;
  checkoutTime: string | null; guests: number | null; staying: boolean;
  adjusted: boolean; noCleaning: boolean; needsReview: boolean;
  guestCountSource?: 'guesty';
};
export type CleanerStayReport = {
  propertyName: string; from: string; through: string; stays: CleanerStay[];
  guestCountCheck?: { status: 'verified' | 'unavailable'; checkedAt: string | null };
};

export function projectCleanerStayReport(input: {
  property: z.infer<typeof cleanerReportPropertySchema>;
  bookings: Array<CleanerReportBooking & { conflictingCheckOut?: string | null }>;
  adjustments: CleanerReportAdjustment[];
  skips: z.infer<typeof cleanerReportSkipSchema>[];
  from: string; through: string;
}): CleanerStayReport {
  const property = cleanerReportPropertySchema.parse(input.property);
  date.parse(input.from); date.parse(input.through);
  const span = (Date.parse(input.through) - Date.parse(input.from)) / 86400000;
  if (span < 0 || span > 365) throw Error('Invalid cleaner report window');
  const active = new Map<string, CleanerReportAdjustment>();
  const proposed = new Set<string>();
  for (const raw of input.adjustments) {
    const a = cleanerReportAdjustmentSchema.parse(raw);
    if (a.status === 'proposed') { proposed.add(a.stay_check_in); continue; }
    if (active.has(a.stay_check_in)) throw Error('Ambiguous checkout adjustment');
    active.set(a.stay_check_in, a);
  }
  const skipped = new Set(input.skips.map(s => cleanerReportSkipSchema.parse(s).stay_check_in));
  const seen = new Set<string>();
  const stays: CleanerStay[] = [];
  for (const raw of input.bookings) {
    const { conflictingCheckOut, ...fields } = raw;
    const b = cleanerReportBookingSchema.parse(fields);
    if (seen.has(b.check_in)) throw Error('Unresolved duplicate stay');
    seen.add(b.check_in);
    const a = active.get(b.check_in);
    const checkOut = a?.adjusted_check_out ?? b.check_out;
    if (checkOut <= b.check_in) throw Error('Invalid adjusted departure');
    // Include current stays, and arrivals through the horizon even when their
    // departure is beyond it. A long stay must not vanish at the window edge.
    if (checkOut < input.from || b.check_in > input.through) continue;
    stays.push({
      checkIn: b.check_in, checkOut,
      arrivalTime: property.default_checkin_time?.slice(0, 5) ?? null,
      checkoutTime: (a?.adjusted_checkout_time ?? property.default_checkout_time)?.slice(0, 5) ?? null,
      guests: b.num_guests, staying: b.check_in < input.from,
      adjusted: !!a, noCleaning: skipped.has(b.check_in),
      needsReview: !!conflictingCheckOut || proposed.has(b.check_in)
        || (!!a && a.original_check_out !== b.check_out && a.adjusted_check_out !== b.check_out),
    });
  }
  return { propertyName: property.name, from: input.from, through: input.through,
    stays: stays.sort((a, b) => a.checkIn.localeCompare(b.checkIn)) };
}
