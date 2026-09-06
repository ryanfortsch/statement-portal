/**
 * Loader for the crew's schedule: our checkout schedule, the vendor's own
 * bookings, and the reconciliation between them, as CleaningDay rows.
 *
 * The one read path behind /turnovers/cleanings and the home strip. Keep
 * it that way: two surfaces composing the same day differently is how a
 * strip and a page end up disagreeing about whether a cleaner is coming.
 *
 * Failure posture, in order of what it costs a reader:
 *   - our schedule cannot be built (ScheduleUnavailableError): the vendor's
 *     bookings still list, marked 'unchecked', and `scheduleError` carries
 *     the reason. The crew IS coming; that is worth showing on its own.
 *   - the vendor read fails or has nothing: `horizon` is null and every
 *     day is 'unannounced'. Silence, never a fake "nothing booked".
 */

import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildCheckoutSchedule,
  ScheduleUnavailableError,
  addDays,
  todayET,
  formatTime12,
  type ScheduleDay,
} from '@/lib/checkout-schedule';
import { loadVendorAppointments, reconcileDay, VENDOR_ID } from '@/lib/vendor-schedule';
import {
  composeCleaningDay,
  composeVendorOnlyDay,
  collectCleaningFlags,
  type CleaningDay,
  type CleaningFlag,
} from '@/lib/cleaning-days';

/** How the reminder texts last got read into vendor_appointments. */
export type VendorIngestStatus = {
  /** Last successful read. */
  at: string | null;
  /** Last attempt, successful or not. */
  attemptedAt: string | null;
  status: string | null;
  error: string | null;
  scanned: number | null;
  parsed: number | null;
  /** Reminder addresses that matched no property. Each is a visit Helm is blind to. */
  unmatched: string[];
};

export type CleaningSchedule = {
  today: string;
  startDate: string;
  /** Furthest day the vendor has announced anywhere, or null with nothing on file. */
  horizon: string | null;
  /** When the vendor last texted a reminder. */
  lastAnnouncedAt: string | null;
  days: CleaningDay[];
  /** Set when our own checkout schedule could not be built. */
  scheduleError: string | null;
  ingest: VendorIngestStatus | null;
};

export async function loadCleaningSchedule(
  supabase: SupabaseClient,
  opts: { startDate?: string; days: number },
): Promise<CleaningSchedule> {
  const today = todayET();
  const startDate = opts.startDate ?? today;
  const endDate = addDays(startDate, opts.days - 1);

  const [schedule, vendor, propsRes, lastRes, ingestRes] = await Promise.all([
    buildCheckoutSchedule(supabase, { startDate, days: opts.days })
      .then((days) => ({ days: days as ScheduleDay[] | null, error: null as string | null }))
      .catch((err: unknown) => {
        if (err instanceof ScheduleUnavailableError) {
          return { days: null as ScheduleDay[] | null, error: err.message as string | null };
        }
        throw err;
      }),
    loadVendorAppointments(supabase, startDate, endDate),
    supabase.from('properties').select('id, name'),
    supabase
      .from('vendor_appointments')
      .select('announced_at')
      .eq('vendor', VENDOR_ID)
      .not('announced_at', 'is', null)
      .order('announced_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('sync_status')
      .select('last_synced_at, last_attempted_at, last_status, last_error, last_result')
      .eq('source', 'vendor-appointments')
      .maybeSingle(),
  ]);

  const propertyNames = new Map<string, string>(
    ((propsRes.data ?? []) as Array<{ id: string; name: string | null }>).map((p) => [p.id, p.name ?? p.id]),
  );

  const days: CleaningDay[] = [];
  for (let i = 0; i < opts.days; i++) {
    const date = addDays(startDate, i);
    if (schedule.days) {
      const day: ScheduleDay = schedule.days.find((d) => d.date === date) ?? {
        date,
        rows: [],
        counts: { checkouts: 0, sameDay: 0, adjusted: 0, proposed: 0 },
      };
      days.push(composeCleaningDay(day, reconcileDay(day, vendor.rows, vendor.horizon, propertyNames)));
    } else {
      days.push(composeVendorOnlyDay(date, vendor.rows, vendor.horizon, propertyNames));
    }
  }

  const ingestRow = ingestRes.data as {
    last_synced_at: string | null;
    last_attempted_at: string | null;
    last_status: string | null;
    last_error: string | null;
    last_result: Record<string, unknown> | null;
  } | null;
  const result = ingestRow?.last_result ?? null;
  const ingest: VendorIngestStatus | null = ingestRow
    ? {
        at: ingestRow.last_synced_at,
        attemptedAt: ingestRow.last_attempted_at,
        status: ingestRow.last_status,
        error: ingestRow.last_error,
        scanned: typeof result?.scanned === 'number' ? result.scanned : null,
        parsed: typeof result?.parsed === 'number' ? result.parsed : null,
        unmatched: Array.isArray(result?.unmatched)
          ? (result.unmatched as unknown[]).filter((u): u is string => typeof u === 'string')
          : [],
      }
    : null;

  return {
    today,
    startDate,
    horizon: vendor.horizon,
    lastAnnouncedAt: (lastRes.data as { announced_at: string | null } | null)?.announced_at ?? null,
    days,
    scheduleError: schedule.error,
    ingest,
  };
}

/**
 * Today, tomorrow and the day after: exactly the vendor's announcement
 * horizon. Memoized per request (React cache, keyed on the client
 * singleton) so the home strip and the morning brief, which render on the
 * same page, share one read instead of building the schedule twice.
 */
export const loadCleaningOutlook = cache(
  async (supabase: SupabaseClient): Promise<CleaningSchedule> => loadCleaningSchedule(supabase, { days: 3 }),
);

/** "Today", "Tomorrow", then the weekday. */
export function labelCleaningDay(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

/** The attention items of a schedule as one-line flags for the brief. */
export function cleaningFlags(sched: CleaningSchedule): CleaningFlag[] {
  return collectCleaningFlags(sched.days, {
    labelDay: (date) => labelCleaningDay(date, sched.today),
    formatTime: formatTime12,
  });
}
