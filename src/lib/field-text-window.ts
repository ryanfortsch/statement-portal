import 'server-only';
import { fieldDb } from './field-db';

/**
 * When an inspector was texting the office on a given day — first message to
 * last — as a second, human read on how long they actually worked.
 *
 * The door timestamps already give minutes on site, but they only see homes
 * with a mapped Seam lock, and a stop left open inflates them (a packet can
 * read "720 min on site" for a day that was really eight). The texting window
 * is independent of both: it comes from Quo, it covers driving and supply runs
 * and the shop, and it's what the operator already felt happening that day.
 *
 * Read-only over the raw `quo_events` webhook log, since that keeps every
 * message with its own Quo `createdAt`. Bodies are never returned — only the
 * clock — so the approve screen stays a payout tool, not an inbox.
 */
export type TextWindow = {
  /** ET wall clock, e.g. "8:01 AM". */
  firstAt: string;
  lastAt: string;
  /** Minutes between the first and last inbound message. */
  spanMinutes: number;
  /** How many messages they sent (inbound only). */
  count: number;
};

const ET = 'America/New_York';
const etParts = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: ET,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
    .formatToParts(new Date(iso))
    .reduce<Record<string, string>>((a, p) => (p.type === 'literal' ? a : { ...a, [p.type]: p.value }), {});

const clock = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

/** Digits only, so "+1 (917) 657-7163" and "9176577163" compare equal. */
const digits = (p: string) => p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

export async function loadTextWindow(phone: string | null, dateET: string): Promise<TextWindow | null> {
  const want = phone ? digits(phone) : '';
  if (want.length < 10) return null;

  // Quo's own createdAt is the message clock; received_at is when OUR webhook
  // logged it. Filter on a generous UTC range around the ET day, then pin each
  // message to its ET calendar date below.
  const { data } = await fieldDb()
    .from('quo_events')
    .select('payload')
    .eq('event_type', 'message.received')
    .gte('received_at', `${addDay(dateET, -1)}T00:00:00Z`)
    .lt('received_at', `${addDay(dateET, 2)}T00:00:00Z`);

  type Ev = { payload?: { data?: { object?: { from?: string; createdAt?: string; direction?: string } } } };
  const times = ((data ?? []) as Ev[])
    .map((e) => e.payload?.data?.object)
    .filter((o): o is { from: string; createdAt: string; direction?: string } => !!o?.from && !!o.createdAt)
    .filter((o) => digits(o.from) === want)
    .map((o) => o.createdAt)
    .filter((iso) => {
      const p = etParts(iso);
      return `${p.year}-${p.month}-${p.day}` === dateET;
    })
    .sort();

  if (times.length === 0) return null;
  const first = times[0];
  const last = times[times.length - 1];
  return {
    firstAt: clock(first),
    lastAt: clock(last),
    spanMinutes: Math.max(0, Math.round((Date.parse(last) - Date.parse(first)) / 60000)),
    count: times.length,
  };
}

function addDay(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** "8h 38m", or "45m" under an hour. */
export function fmtSpan(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
