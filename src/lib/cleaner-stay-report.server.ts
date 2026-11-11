import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { selectAllPaged } from './paged-select';
import { addDays, collapseStays, findGhostStays } from './checkout-schedule';
import { enrichCleanerGuestCounts, readCleanerCountReservation, unavailableCleanerCounts } from './cleaner-guest-counts';
import { loadCleanerCountSource, readCleanerCountToken } from './cleaner-guest-counts.server';
import {
  CLEANER_REPORT_PROPERTY as propertyId, cleanerReportPropertySchema,
  cleanerReportBookingSchema, cleanerReportAdjustmentSchema, cleanerReportSkipSchema,
  projectCleanerStayReport,
} from './cleaner-stay-report';

const BOOKING_FIELDS = 'id,property_id,check_in,check_out,status,duplicate_of,num_guests,guest_name,source,first_seen_at,last_seen_at,external_confirmation_code';
/** Shared canonical reader. Callers authorize before reading. No mutations. */
export async function readCleanerReport(db: SupabaseClient, from: string) {
  z.iso.date().parse(from);
  const through = addDays(from, 365);
  async function read<T>(query: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
    return selectAllPaged(async (start, end) => {
      const result = await query(start, end);
      // A null payload is not evidence that there are no stays.
      if (!Array.isArray(result.data)) throw Error('Cleaner schedule unavailable');
      return result;
    }, { pageSize: 500, maxRows: 5000 });
  }
  const [propertyResult, bookingRows, adjustmentRows, skipRows] = await Promise.all([
    db.from('properties').select('id,name,default_checkin_time,default_checkout_time').eq('id', propertyId).single(),
    read((start, end) => db.from('bookings').select(BOOKING_FIELDS).eq('property_id', propertyId)
      .in('status', ['confirmed', 'completed']).is('duplicate_of', null)
      .gte('check_out', from).lte('check_in', through).order('id').range(start, end)),
    read((start, end) => db.from('checkout_adjustments')
      .select('property_id,stay_check_in,original_check_out,adjusted_check_out,adjusted_checkout_time,status')
      .eq('property_id', propertyId).in('status', ['active', 'proposed'])
      .lte('stay_check_in', through).order('id').range(start, end)),
    read((start, end) => db.from('checkout_cleaning_skips').select('property_id,stay_check_in')
      .eq('property_id', propertyId).is('cleared_at', null).lte('stay_check_in', through).order('id').range(start, end)),
  ]);
  if (propertyResult.error) throw Error('Cleaner property unavailable');
  const property = cleanerReportPropertySchema.parse(propertyResult.data);
  const bookings = z.array(cleanerReportBookingSchema).parse(bookingRows);
  const adjustments = z.array(cleanerReportAdjustmentSchema).parse(adjustmentRows);
  const skips = z.array(cleanerReportSkipSchema).parse(skipRows);
  // A confirmed extension can bring an old base checkout into this window.
  // Fetch only those exact stay keys; never resurrect a cancelled/duplicate row.
  const loaded = new Set(bookings.map(b => b.check_in));
  const missing = [...new Set(adjustments.filter(a => a.status === 'active'
    && a.adjusted_check_out && a.adjusted_check_out >= from && !loaded.has(a.stay_check_in))
    .map(a => a.stay_check_in))];
  for (let i = 0; i < missing.length; i += 100) {
    const extra = await read((start, end) => db.from('bookings').select(BOOKING_FIELDS).eq('property_id', propertyId)
      .in('status', ['confirmed', 'completed']).is('duplicate_of', null)
      .in('check_in', missing.slice(i, i + 100)).order('id').range(start, end));
    bookings.push(...z.array(cleanerReportBookingSchema).parse(extra));
  }
  const collapsed = collapseStays(bookings);
  const ghosts = await findGhostStays(db, [...collapsed.values()]);
  const byId = new Map(bookings.map(b => [b.id, b]));
  const resolved = [...collapsed].filter(([key]) => !ghosts.has(key)).map(([, b]) => ({
    ...byId.get(b.id)!, conflictingCheckOut: b.conflictingCheckOut,
  }));
  return { report: projectCleanerStayReport({ property, adjustments, skips, from, through, bookings: resolved }),
    bookings: resolved };
}

/** Minimal portal report: database only, no Guesty token or external reads. */
export async function loadCalderwoodPortalReport(db: SupabaseClient, from: string) {
  return (await readCleanerReport(db, from)).report;
}

export async function loadCalderwoodCleanerReport(db: SupabaseClient, from: string) {
  const base = await readCleanerReport(db, from);
  if (!base.report.stays.some(stay => stay.guests === null)) return base.report;
  let source;
  try { source = await loadCleanerCountSource(db); }
  catch { return unavailableCleanerCounts(base.report); }
  let token: Promise<string> | undefined;
  const deadline = AbortSignal.timeout(20000);
  return enrichCleanerGuestCounts({ ...base, ...source }, {
    readReservation: async id => readCleanerCountReservation(id, await (token ??= readCleanerCountToken(db)), deadline),
    reloadContext: async () => {
      const [current, context] = await Promise.all([readCleanerReport(db, from), loadCleanerCountSource(db)]);
      return { ...current, ...context };
    },
  });
}
