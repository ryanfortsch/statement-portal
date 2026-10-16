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
export type CalderwoodTiming = {
  arrivalAt: string | null; departureAt: string | null; issues: string[]; clockVerified: boolean;
  confirmation?: { source: 'guesty-v3-confirmedAt'; at: string } | null;
  localEvidence?: {
    source: 'guesty-legacy-local-fields'; arrivalBasis: string | null; departureBasis: string | null;
    searchArrivalAt: string | null; searchDepartureAt: string | null; disagreesWithSearch: boolean;
  };
};

/** Top-level and sole stay segment must agree, including the local stay date. */
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

/** Explicit local clocks, never a timezone correction to the ambiguous V3 timestamps.
 * Caller must bind the projected response to the exact reservation, listing, dates and status.
 * The legacy endpoint is a temporary preview dependency, not a production scheduling source.
 */
export function normalizeCalderwoodLocalTiming(input: {
  start: string; end: string; timezone: unknown; plannedArrival: unknown; plannedDeparture: unknown;
  defaultArrival: unknown; defaultDeparture: unknown;
}, search: CalderwoodTiming): CalderwoodTiming {
  const issues: string[] = [];
  if (input.timezone !== zone) return { ...search, clockVerified: false, localEvidence: undefined, issues: ['Listing timezone is missing or differs from New York; local timing withheld.'] };
  function read(date: string, override: unknown, fallback: unknown, label: string, overrideField: string, defaultField: string) {
    const clock = override == null ? fallback : override;
    const basis = override == null ? defaultField : overrideField;
    const day = Date.parse(date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date
      || typeof clock !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) {
      issues.push(`${label} local time is missing or invalid; no default invented.`);
      return { at: null, basis: null };
    }
    const at = uniqueLocalInstant(date, clock);
    if (!at) issues.push(`${label} local time is ambiguous or nonexistent during a daylight-saving change.`);
    return { at, basis: at ? basis : null };
  }
  const arrival = read(input.start, input.plannedArrival, input.defaultArrival, 'Arrival', 'plannedArrival', 'listing.defaultCheckInTime');
  const departure = read(input.end, input.plannedDeparture, input.defaultDeparture, 'Departure', 'plannedDeparture', 'listing.defaultCheckOutTime');
  return {
    arrivalAt: arrival.at, departureAt: departure.at, issues, clockVerified: !!(arrival.at || departure.at),
    localEvidence: { source: 'guesty-legacy-local-fields', arrivalBasis: arrival.basis, departureBasis: departure.basis,
      searchArrivalAt: search.arrivalAt, searchDepartureAt: search.departureAt,
      disagreesWithSearch: !!((arrival.at && search.arrivalAt && arrival.at !== search.arrivalAt)
        || (departure.at && search.departureAt && departure.at !== search.departureAt)),
    },
  };
}

function uniqueLocalInstant(date: string, clock: string): string | null {
  const proposed = zonedTimeToMs(date, clock, zone);
  const matches = (ms: number) => {
    const p = localParts(ms);
    return p.date === date && p.clock === clock;
  };
  if (!matches(proposed) || matches(proposed - 3600000) || matches(proposed + 3600000)) return null;
  return new Date(proposed).toISOString();
}

/** Guesty's observed queue can use elapsed hours across DST. Do not infer a
 * universal rule from one workflow: expose both candidates and withhold the time.
 */
function daysBefore(at: string | null, days: number) {
  const ms = instant(at);
  if (ms === null) return { at: null, dayOffsetConflict: null };
  const source = localParts(ms), date = addDays(source.date, -days);
  const calendarAt = uniqueLocalInstant(date, source.clock);
  const elapsedAt = new Date(ms - days * 24 * 60 * 60000).toISOString();
  return calendarAt === elapsedAt
    ? { at: calendarAt, dayOffsetConflict: null }
    : { at: null, dayOffsetConflict: { calendarAt, elapsedAt } };
}
function minutesBefore(at: string | null, minutes: number) {
  return at ? new Date(Date.parse(at) - minutes * 60000).toISOString() : null;
}
export function reviewCalderwoodMessageTiming(reservation: { status: string; timing: CalderwoodTiming }, now: Date) {
  if (!Number.isFinite(now.getTime())) throw Error('Valid timing review time required');
  // This separate evidence comes from the reservation's confirmedAt, never creation/channel dates.
  const confirmedAt = reservation.status === 'confirmed' && reservation.timing.confirmation?.source === 'guesty-v3-confirmedAt'
    ? reservation.timing.confirmation.at : null;
  const confirmationMs = confirmedAt ? Date.parse(confirmedAt) : NaN;
  const confirmationTime = Number.isFinite(confirmationMs) && confirmationMs <= now.getTime()
    ? new Date(confirmationMs + 30 * 60000).toISOString() : null;
  const timing = reservation.status === 'confirmed' && reservation.timing.clockVerified ? reservation.timing : { arrivalAt: null, departureAt: null };
  const rows = [
    { key: 'confirmation', label: 'Reservation confirmation', audience: 'Guest', at: confirmationTime, offset: '30 minutes after confirmation' },
    { key: 'pre_arrival', label: 'Check-in instructions', audience: 'Guest', ...daysBefore(timing.arrivalAt, 1), offset: '1 day before arrival' },
    { key: 'key_code', label: 'Key code', audience: 'Guest', at: minutesBefore(timing.arrivalAt, 60), offset: '60 minutes before arrival' },
    { key: 'pre_checkout', label: 'Checkout reminder', audience: 'Guest', ...daysBefore(timing.departureAt, 1), offset: '1 day before departure' },
    { key: 'cleaner_reminder', label: 'Cleaner advance reminder', audience: 'Cleaner', ...daysBefore(timing.arrivalAt, 10), offset: '10 days before arrival' },
    { key: 'cleaner_arrival', label: 'Cleaner arrival-day reminder', audience: 'Cleaner', at: minutesBefore(timing.arrivalAt, 420), offset: '7 hours before arrival' },
  ];
  return rows.map(row => ({ ...row, canSend: false as const,
    dayOffsetConflict: 'dayOffsetConflict' in row ? row.dayOffsetConflict : null,
    review: 'dayOffsetConflict' in row && row.dayOffsetConflict ? 'Daylight-saving offset differs; verify Guesty queued time'
      : !row.at ? 'Timing unverified'
      : Date.parse(row.at) <= now.getTime() ? 'Past or due time; verify history, never replay automatically'
      : 'Future time; verify queue and holds',
  }));
}
