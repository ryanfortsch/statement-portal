/**
 * Delivery & sync's words for Helm's background syncs: what each feed is,
 * in the operator's language, and whether it is Delayed or Broken (the same
 * two words the channel rows above it use, `channelWord` in inbox-status).
 *
 * Until 2026-10-18 the retired /today page listed these as source keys in
 * monospace with the raw last error ("ical · stale · last tried 4 hr ago").
 * A new operations manager cannot act on that. The raw error rides in a
 * title attribute for whoever is debugging; the row says what stopped.
 *
 * Pure, so `npm test` pins every source has a name.
 */

export const FEED_NAMES: Record<string, string> = {
  'guesty-listings': 'Guesty listings',
  'guesty-reviews': 'Guest reviews from Guesty',
  'guesty-reservations': 'Reservations from Guesty',
  'guesty-cancel-reconcile': 'Cancellations check against Guesty',
  'guesty-reservation-gaps': 'Missing reservations check',
  'guesty-calendar': 'Calendar from Guesty',
  'guesty-guests': 'Guest list from Guesty',
  'gmail-replies': 'Email inbox',
  quo: 'Texts and calls from Quo',
  'vendor-appointments': "Cape Ann Elite's cleaning bookings",
  seam: 'Smart locks',
  ical: 'Channel calendars',
  'helm-calendar': 'Calendars Helm runs',
  automations: 'Scheduled guest messages',
  stripe: 'Stripe fees',
  'csv-fallback': 'Guesty reservations CSV',
};

export function feedName(source: string): string {
  return FEED_NAMES[source] ?? source.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** "4 hours ago", "2 days ago", "just now". */
export function agoWords(iso: string | null, nowMs: number = Date.now()): string | null {
  if (!iso) return null;
  const mins = Math.round((nowMs - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins)) return null;
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export type FeedHealthLike = {
  source: string;
  status: 'error' | 'stale';
  lastAttemptedAt: string | null;
  lastSyncedAt: string | null;
  errorCount: number;
};

/** One line for a feed: its name, Broken or Delayed, and when it last ran. */
export function feedLine(f: FeedHealthLike, nowMs: number = Date.now()): { name: string; word: 'Broken' | 'Delayed'; detail: string } {
  const word = f.status === 'error' ? 'Broken' : 'Delayed';
  const ran = agoWords(f.lastSyncedAt, nowMs);
  const tried = agoWords(f.lastAttemptedAt, nowMs);
  let detail: string;
  if (f.status === 'error') {
    const times = f.errorCount > 1 ? `failed ${f.errorCount} times in a row` : 'the last run failed';
    detail = ran ? `${times}; last worked ${ran}` : `${times}; it has not worked yet`;
  } else {
    detail = ran ? `last ran ${ran}` : tried ? `last tried ${tried}` : 'has not run';
  }
  return { name: feedName(f.source), word, detail };
}

/** ISO dates inside a Helm-run home's notes, made plain ("Tue, Nov 3"). */
export function plainDates(text: string): string {
  return text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (iso) => {
    const d = new Date(`${iso}T12:00:00Z`);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  });
}
