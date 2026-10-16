/** Read-only timing evidence and proposals. No queue, ownership, or sending decisions. */
import { addDays, zonedTimeToMs } from '../automations-core.ts';

const zone = 'America/New_York';
const local = new Intl.DateTimeFormat('en-CA', {
  timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
});
function localParts(at: number) {
  const parts = Object.fromEntries(local.formatToParts(at).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, clock: `${parts.hour}:${parts.minute}` };
}
function instant(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:00(?:\.0{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return null;
  const date = value.slice(0, 10), day = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}
export type CalderwoodTiming = { arrivalAt: string | null; departureAt: string | null; issues: string[]; clockVerified: boolean };

/** Top-level and sole stay segment must independently agree, including the local stay date. */
export function normalizeCalderwoodTiming(input: {
  arrival: unknown; departure: unknown; stayArrival: unknown; stayDeparture: unknown;
  start: string; end: string;
}): CalderwoodTiming {
  const issues: string[] = [];
  function read(value: unknown, segment: unknown, date: string, label: string) {
    const at = instant(value), stayAt = instant(segment);
    if (at === null || stayAt === null) {
      issues.push(`${label} timestamp is missing or invalid; no default assumed.`);
      return null;
    }
    if (at !== stayAt || localParts(at).date !== date) {
      issues.push(`${label} timestamp disagrees with its stay segment or local date.`);
      return null;
    }
    return new Date(at).toISOString();
  }
  return {
    arrivalAt: read(input.arrival, input.stayArrival, input.start, 'Arrival'),
    departureAt: read(input.departure, input.stayDeparture, input.end, 'Departure'), issues,
    // Matching fields do not establish timezone semantics. The live search feed
    // disagrees with Guesty's visible automation clock; independent evidence is required.
    clockVerified: false,
  };
}

/** Calendar-day offsets preserve the local clock across DST; ambiguous/missing clocks stay unknown. */
function daysBefore(at: string | null, days: number): string | null {
  if (!at) return null;
  const source = localParts(Date.parse(at)), date = addDays(source.date, -days);
  const proposed = zonedTimeToMs(date, source.clock, zone);
  const matches = (ms: number) => {
    const p = localParts(ms);
    return p.date === date && p.clock === source.clock;
  };
  if (!matches(proposed) || matches(proposed - 3600000) || matches(proposed + 3600000)) return null;
  return new Date(proposed).toISOString();
}
function minutesBefore(at: string | null, minutes: number) {
  return at ? new Date(Date.parse(at) - minutes * 60000).toISOString() : null;
}
export function reviewCalderwoodMessageTiming(reservation: { status: string; timing: CalderwoodTiming }, now: Date) {
  if (!Number.isFinite(now.getTime())) throw Error('Valid timing review time required');
  // No inferred confirmation instant from createdAt, bookingDate or channel timestamps.
  const timing = reservation.status === 'confirmed' && reservation.timing.clockVerified ? reservation.timing : { arrivalAt: null, departureAt: null };
  const rows = [
    { key: 'confirmation', label: 'Reservation confirmation', audience: 'Guest', at: null, offset: '30 minutes after confirmation' },
    { key: 'pre_arrival', label: 'Check-in instructions', audience: 'Guest', at: daysBefore(timing.arrivalAt, 1), offset: '1 day before arrival' },
    { key: 'key_code', label: 'Key code', audience: 'Guest', at: minutesBefore(timing.arrivalAt, 60), offset: '60 minutes before arrival' },
    { key: 'pre_checkout', label: 'Checkout reminder', audience: 'Guest', at: daysBefore(timing.departureAt, 1), offset: '1 day before departure' },
    { key: 'cleaner_reminder', label: 'Cleaner advance reminder', audience: 'Cleaner', at: daysBefore(timing.arrivalAt, 10), offset: '10 days before arrival' },
    { key: 'cleaner_arrival', label: 'Cleaner arrival-day reminder', audience: 'Cleaner', at: minutesBefore(timing.arrivalAt, 420), offset: '7 hours before arrival' },
  ];
  return rows.map(row => ({ ...row, canSend: false as const,
    review: !row.at ? 'Timing unverified'
      : Date.parse(row.at) <= now.getTime() ? 'Past or due time; verify history, never replay automatically'
      : 'Future time; verify queue and holds',
  }));
}
