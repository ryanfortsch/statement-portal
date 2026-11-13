/**
 * A partner home's calendar as its host sees it on staycapeann.com/host.
 *
 * Four kinds of night, in the order one wins over another on the same night:
 *
 *   booked     a stay booked on staycapeann.com (an accepted request)
 *   request    a request waiting for the host's answer
 *   elsewhere  a stay on the host's own calendar (Airbnb, Vrbo, their software)
 *   blocked    a night the host's own calendar closes without a stay
 *
 * The host's own nights come from partner_calendar_holds, the copy Helm reads
 * from the calendar links the office added (lib/partner-calendar.ts). A stay
 * booked here comes back from Airbnb as a block once the host imports Helm's
 * export, so a booked night outranks every other.
 *
 * Pure: the bridge route (/api/pms/host/calendar) reads, this shapes.
 */
import { isOpen, type BookingRequestRow } from './booking-requests.ts';
import { feedIsFresh, type PartnerFeedChannel } from './partner-calendar.ts';
import { hostGuestName } from './partner-host.ts';

/** How far the calendar reaches: this month and the eleven after it. */
export const HOST_CALENDAR_MONTHS = 12;

export type HostSpanKind = 'booked' | 'request' | 'elsewhere' | 'blocked';
const RANK: Record<HostSpanKind, number> = { booked: 0, request: 1, elsewhere: 2, blocked: 3 };

export type HostCalendarSpan = {
  kind: HostSpanKind;
  /** First night. */
  check_in: string;
  /** The morning after the last night. */
  check_out: string;
  /** "Jamie Rivera", "Request from Jamie R.", "Airbnb", "Blocked on Vrbo". */
  label: string;
};

export type HostFeedView = {
  channel: PartnerFeedChannel;
  label: string;
  last_read_at: string | null;
  /** Read in the last six hours. Accept waits while any of a home's calendars is not. */
  fresh: boolean;
};

export function channelLabel(channel: string): string {
  switch (channel) {
    case 'airbnb':
      return 'Airbnb';
    case 'vrbo':
      return 'Vrbo';
    case 'booking_com':
      return 'Booking.com';
    default:
      return 'your other calendar';
  }
}

/** YYYY-MM-DD in Eastern time. */
export function easternIsoDay(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** [from, to): the first of this Eastern month to the first of the month HOST_CALENDAR_MONTHS later. */
export function hostCalendarWindow(now: Date): { today: string; from: string; to: string } {
  const today = easternIsoDay(now);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1 + HOST_CALENDAR_MONTHS;
  const to = `${y + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}-01`;
  return { today, from: `${today.slice(0, 7)}-01`, to };
}

type RequestRow = Pick<BookingRequestRow, 'status' | 'respond_by' | 'check_in' | 'check_out' | 'guest_first_name' | 'guest_last_name'>;
export type HostHoldRow = { kind: 'stay' | 'block'; check_in: string; check_out: string; channel: string };

/**
 * Every span that touches [from, to), clipped to it, sorted by first night
 * and then by which kind wins. Accepted requests are booked; pending ones
 * count only while their clock runs (an expired one holds nothing).
 */
export function hostCalendarSpans(
  input: { requests: readonly RequestRow[]; holds: readonly HostHoldRow[]; from: string; to: string },
  now: Date,
): HostCalendarSpan[] {
  const { from, to } = input;
  const out: HostCalendarSpan[] = [];
  const add = (kind: HostSpanKind, check_in: string, check_out: string, label: string) => {
    if (check_out <= from || check_in >= to || check_out <= check_in) return;
    out.push({ kind, check_in: check_in < from ? from : check_in, check_out: check_out > to ? to : check_out, label });
  };
  for (const r of input.requests) {
    if (r.status === 'accepted') add('booked', r.check_in, r.check_out, hostGuestName(r, true));
    else if (isOpen(r, now)) add('request', r.check_in, r.check_out, `Request from ${hostGuestName(r, false)}`);
  }
  for (const h of input.holds) {
    const where = channelLabel(h.channel);
    if (h.kind === 'stay') add('elsewhere', h.check_in, h.check_out, where.charAt(0).toUpperCase() + where.slice(1));
    else add('blocked', h.check_in, h.check_out, `Blocked on ${where}`);
  }
  return out.sort((a, b) => (a.check_in < b.check_in ? -1 : a.check_in > b.check_in ? 1 : RANK[a.kind] - RANK[b.kind]));
}

export function hostFeedView(feed: { channel: PartnerFeedChannel; last_synced_at: string | null }, now: Date): HostFeedView {
  return { channel: feed.channel, label: channelLabel(feed.channel), last_read_at: feed.last_synced_at, fresh: feedIsFresh(feed.last_synced_at, now) };
}
