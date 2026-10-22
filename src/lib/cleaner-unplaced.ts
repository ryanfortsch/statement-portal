/**
 * A cleaner's text Helm could not place on a house.
 *
 * A known cleaner texting "done" is placed by the body ("21 horton all
 * set") or, failing that, by the cleaner's only home. When neither works the
 * text used to throw inside the Quo ingest and land in
 * quo_events.process_error, which no page reads, so the turnover never got
 * its completion. Now it is a row in cleaner_unplaced_texts, shown on the
 * home feed's "Cleanings to check" with a house picker: Attach writes what
 * a placed text writes (recordCleanerText in quo-ingest.ts), Set aside
 * closes it with nothing written.
 *
 * The rules here are pure so `npm test` pins them. The reads and writes are
 * in cleaner-unplaced-server.ts.
 */

import { operatingDate } from './operating-date.ts';

/** How far back the feed looks. An older text is still attachable from the
 *  table, it just stops asking for a hand on the home page. */
export const UNPLACED_WINDOW_DAYS = 14;

/** Rows the feed shows at once; the rest wait behind them. */
export const UNPLACED_FEED_LIMIT = 6;

export type AttachChoice = { id: string; name: string };

export type AttachChoices = {
  /** Houses with a checkout on the text's day, the cleaner's own homes first. */
  likely: AttachChoice[];
  /** Every other active house, by name. */
  rest: AttachChoice[];
};

/**
 * The houses a person picks from, likeliest first. A "done" text is almost
 * always the same day's turnover, so the homes that checked out that day
 * lead; among them, the homes on the cleaner's own list. Every other house
 * follows, because the text failed to place precisely when the obvious
 * answer was missing, and the picker must never hide the right one.
 */
export function attachChoices(args: {
  properties: AttachChoice[];
  /** Property ids with a checkout on the text's operating day. */
  checkedOut: Iterable<string>;
  /** cleaner_phones.property_ids; empty means the cleaner serves every home. */
  cleanerHomes: string[];
}): AttachChoices {
  const out = new Set(args.checkedOut);
  const mine = new Set(args.cleanerHomes);
  const byName = (a: AttachChoice, b: AttachChoice) => a.name.localeCompare(b.name, 'en', { numeric: true });
  const likely = args.properties
    .filter((p) => out.has(p.id))
    .sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)) || byName(a, b));
  const rest = args.properties.filter((p) => !out.has(p.id)).sort(byName);
  return { likely, rest };
}

/** The operating day a text arrived on, YYYY-MM-DD in Eastern time. A 9 PM
 *  "done" belongs to that evening's turnover, not the UTC tomorrow. */
export function textDay(iso: string): string {
  return operatingDate(new Date(iso));
}

const WHEN_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "Tue, 10/20, 3:12 PM" in Eastern time, for the row's date column. */
export function textWhen(iso: string): string {
  return WHEN_FMT.format(new Date(iso));
}

/** The cleaner's words on one line, clipped, so a long text keeps the row
 *  to one line. The full text is on the row's title for a hover. */
export function textLine(body: string, max = 90): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** Is this cleaner text worth a person's hand? The ingest's rule: a real
 *  completion or a reported problem. Chatter ("OK I will") is not filed. */
export function worthFiling(flags: { issue: boolean; completion: boolean }): boolean {
  return flags.issue || flags.completion;
}

/**
 * The error the ingest throws when it cannot even file the text (the table
 * is missing, the write failed). It lands in quo_events.process_error and in
 * the Vercel log, so it names the Quo message id and nothing a person said
 * or a phone number: the message id is enough to find the event.
 */
export function unfiledTextError(messageId: string, reason: string): string {
  return `cleaner text ${messageId} could not be placed on a house and was not filed: ${reason}`;
}
