/** Migration review only. These are proposals, never a scheduling/send authorization. */
import { addDays, zonedTimeToMs } from '../automations-core.ts';

export const CALDERWOOD_MESSAGE_WORKFLOWS = [
  { key: 'booking_confirmed', label: 'Reservation confirmed', audience: 'guest', offset: '30 minutes after confirmation' },
  { key: 'pre_arrival', label: 'Check-in instructions', audience: 'guest', offset: '1 day before arrival' },
  { key: 'checkin_day', label: 'Key code', audience: 'guest', offset: '60 minutes before arrival' },
  { key: 'pre_checkout', label: 'Checkout reminder', audience: 'guest', offset: '1 day before departure' },
  { key: 'cleaner_reminder', label: 'Cleaner advance reminder', audience: 'cleaner', offset: '10 days before arrival' },
  { key: 'cleaner_arrival', label: 'Cleaner arrival-day reminder', audience: 'cleaner', offset: '7 hours before arrival' },
] as const;
export type CalderwoodMessageKey = typeof CALDERWOOD_MESSAGE_WORKFLOWS[number]['key'];
/** One offset contract for capture validation, rehearsal and the migration planner. */
export const MIGRATION_TIMING = {
  booking_confirmed: { anchor: 'confirmed_at', minutes: 30 },
  pre_arrival: { anchor: 'arrival', days: -1, dayMode: 'verify_source_queue' },
  checkin_day: { anchor: 'arrival', minutes: -60 },
  pre_checkout: { anchor: 'departure', days: -1, dayMode: 'verify_source_queue' },
  cleaner_reminder: { anchor: 'arrival', days: -10, dayMode: 'verify_source_queue' },
  cleaner_arrival: { anchor: 'arrival', minutes: -420 },
} as const;
export const MESSAGE_TIMEZONE = 'America/New_York';
const local = new Intl.DateTimeFormat('en-CA', { timeZone: MESSAGE_TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
function parts(ms: number) {
  const p = Object.fromEntries(local.formatToParts(ms).map(p => [p.type, p.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, clock: `${p.hour}:${p.minute}` };
}
function dateValid(day: string) {
  const ms = Date.parse(day + 'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day;
}
/** Reject impossible dates, missing timezone, and future confirmation timestamps. */
export function confirmationInstant(value: unknown, now: number): string | null {
  if (!Number.isFinite(now)) throw Error('Valid observation time required');
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    || !dateValid(value.slice(0, 10))) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= now ? new Date(ms).toISOString() : null;
}
function uniqueLocalInstant(day: string, clock: unknown): string | null {
  if (!dateValid(day) || typeof clock !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) return null;
  const ms = zonedTimeToMs(day, clock, MESSAGE_TIMEZONE);
  const matches = (ms: number) => { const p = parts(ms); return p.day === day && p.clock === clock; };
  // New York's overlap and gap must not silently choose a different hour.
  if (!Number.isFinite(ms) || !matches(ms) || matches(ms - 3600000) || matches(ms + 3600000)) return null;
  return new Date(ms).toISOString();
}
export type SourceClocks = {
  start: string; end: string; timezone: unknown; plannedArrival: unknown; plannedDeparture: unknown;
  defaultArrival: unknown; defaultDeparture: unknown; confirmedAt: unknown;
};
/** The retained Calderwood copy names fixed arrival/departure times. A verified
 * override changes the trigger, not those literal promises. Review and every
 * execution planner must use the same refusal; never silently rewrite the archive. */
export function calderwoodTimeWordingNeedsReview(key: string, clocks: SourceClocks) {
  const arrival = clocks.plannedArrival === null ? clocks.defaultArrival : clocks.plannedArrival;
  const departure = clocks.plannedDeparture === null ? clocks.defaultDeparture : clocks.plannedDeparture;
  return (['booking_confirmed', 'pre_arrival', 'cleaner_arrival'].includes(key) && arrival !== '16:00')
    || (['pre_arrival', 'pre_checkout'].includes(key) && departure !== '11:00');
}
export function reviewCalderwoodTiming(input: SourceClocks, now: number) {
  if (!Number.isFinite(now) || !dateValid(input.start) || !dateValid(input.end) || input.start >= input.end)
    throw Error('Invalid timing review');
  // An omitted override is unknown. Only explicit null permits the listing default.
  const arrival = input.timezone === MESSAGE_TIMEZONE
    ? uniqueLocalInstant(input.start, input.plannedArrival === null ? input.defaultArrival : input.plannedArrival) : null;
  const departure = input.timezone === MESSAGE_TIMEZONE
    ? uniqueLocalInstant(input.end, input.plannedDeparture === null ? input.defaultDeparture : input.plannedDeparture) : null;
  const confirmed = confirmationInstant(input.confirmedAt, now);
  const minutes = (at: string | null, offset: number) => at ? new Date(Date.parse(at) + offset * 60000).toISOString() : null;
  const days = (at: string | null, count: number) => {
    if (!at) return { at: null, conflict: null };
    const ms = Date.parse(at), p = parts(ms);
    const calendarAt = uniqueLocalInstant(addDays(p.day, -count), p.clock);
    const elapsedAt = new Date(ms - count * 86400000).toISOString();
    // Guesty queued-time evidence must settle elapsed vs local-day semantics at DST.
    return calendarAt === elapsedAt ? { at: calendarAt, conflict: null }
      : { at: null, conflict: { calendarAt, elapsedAt } };
  };
  const candidates = CALDERWOOD_MESSAGE_WORKFLOWS.map(flow => {
    const policy = MIGRATION_TIMING[flow.key];
    const anchor = policy.anchor === 'confirmed_at' ? confirmed : policy.anchor === 'arrival' ? arrival : departure;
    return 'minutes' in policy ? { at: minutes(anchor, policy.minutes), conflict: null } : days(anchor, -policy.days);
  });
  return CALDERWOOD_MESSAGE_WORKFLOWS.map((flow, i) => {
    const { at, conflict } = candidates[i];
    return { key: flow.key, at, conflict, canSend: false as const,
      status: conflict ? 'dst_review' as const : !at ? 'unverified' as const
        : Date.parse(at) <= now ? 'past_or_due' as const : 'future' as const };
  });
}
