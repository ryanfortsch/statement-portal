/**
 * What the Reviews tab says about each recent stay: did we ask this guest for
 * a review, is a follow-up due, and has the review come in.
 *
 * Since 2026-10-04 the guest messaging service (stay-concierge) asks for
 * reviews itself, not Guesty: a first ask on days 2 to 4 after checkout under
 * the green / yellow / red light, and a follow-up on days 7 to 10 for green
 * stays only. Every decision lands in its review_asks ledger, which Helm reads
 * through `GET /api/review-asks` (`getReviewAsks` in stay-concierge.ts). This
 * module turns that answer, the stay and Helm's own review row into two plain
 * lines. It is import-free apart from the date helpers, so `npm test` covers
 * every sentence the page can print.
 *
 * Two rules are load-bearing:
 * - When the ledger cannot be read, the page says "Ask history unavailable".
 *   A stay is never shown as "not asked" because the service did not answer.
 * - Airbnb and VRBO keep a guest's review sealed until the host reviews back
 *   or 14 days pass, so before day 14 "no review" is never certain. Those
 *   stays read "Sealed until <date>" instead.
 */

import { shiftIsoDay } from './sca-quotes-types.ts';

// ── The bridge payload (stay-concierge src/api_review_asks.py) ─────────────

export type ReviewAskCard = {
  /** pending | scheduled | sending | approved | manual_sent | rejected | superseded | expired | auto_rejected_stale */
  status: string;
  created_at: string;
  /** When it was sent or decided, UTC ISO. */
  resolved_at: string;
  /** When a scheduled send fires, UTC ISO. */
  send_at: string;
  /** Marked handled with the reply she actually sent. */
  sent_by_hand: boolean;
  /** Why a card that did not go out stopped, as the concierge classifies it. */
  ended_because:
    | ''
    | 'declined'
    | 'handled'
    | 'review_arrived'
    | 'guest_reported_review'
    | 'window_closed'
    | 'went_stale'
    | 'not_recorded'
    | 'withdrawn'
    | string;
  /** The operator's Mark handled reason. */
  note: string;
  decided_by: string;
};

export type ReviewAskStage = {
  /** green | yellow | red | external | held */
  tier: string;
  reason: string;
  recorded_at: string;
  /** A first ask raised in the follow-up window because the first was missed. */
  late_first: boolean;
  card: ReviewAskCard | null;
};

export type ReservationReviewAsk = {
  reservation_id: string;
  first: ReviewAskStage | null;
  followup: ReviewAskStage | null;
  /** The one ask the engine made before 2026-10-04. */
  legacy: { requested_at: string; card: ReviewAskCard | null } | null;
  /** The thread says the guest submitted a review. A report, not proof. */
  guest_reported_review: boolean;
  host_acknowledged_review: boolean;
};

export type ReviewAskSettings = {
  sweep_enabled: boolean;
  green_autosend: boolean;
  first_ask_days: [number, number];
  followup_days: [number, number];
  /** Helm property ids the sweep never asks for (Ryan's own homes). */
  excluded_slugs: string[];
  /** YYYY-MM-DD of the ledger's first decision. */
  ledger_started: string;
};

export type ReviewAsksPayload = ReviewAskSettings & {
  as_of: string;
  reservations: ReservationReviewAsk[];
};

// ── Inputs from Helm ───────────────────────────────────────────────────────

export type StayFacts = {
  /** YYYY-MM-DD */
  checkOut: string;
  /** Helm's channel label: Airbnb, VRBO, Booking.com, Direct. */
  channel: string;
};

export type StayReview = {
  rating: number | null;
  /** When the guest wrote it, ISO. */
  createdAt: string | null;
} | null;

export type AskTone = 'done' | 'waiting' | 'due' | 'skipped' | 'unknown';
export type AskLine = { text: string; tone: AskTone };
export type ReviewLine = { kind: 'reviewed' | 'sealed' | 'none' | 'no_platform'; text: string };

/** What the page uses when the concierge's own windows are unknown. They
 *  match review_requests.py as shipped on 2026-10-04; the live answer wins. */
export const DEFAULT_ASK_SETTINGS: ReviewAskSettings = {
  sweep_enabled: true,
  green_autosend: true,
  first_ask_days: [2, 4],
  followup_days: [7, 10],
  excluded_slugs: [],
  ledger_started: '2026-10-04',
};

/** Airbnb and VRBO hold a guest's review until the host reviews back or this
 *  many days pass after checkout. Booking.com publishes on its own clock. */
export const SEALED_DAYS = 14;
const SEALED_CHANNELS = new Set(['airbnb', 'vrbo']);

export const UNAVAILABLE = 'Ask history unavailable';

// ── Dates ──────────────────────────────────────────────────────────────────

function dayDiff(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** "Oct 14" for a YYYY-MM-DD day. */
export function shortDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Oct 14" for a UTC instant, on Gloucester's calendar. */
export function shortInstant(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
}

function isDirect(channel: string): boolean {
  const c = channel.trim().toLowerCase();
  return c === '' || c === 'direct' || c === 'manual';
}

// ── The ask line ───────────────────────────────────────────────────────────

/** A red reason as the sweep wrote it, said plainly. */
function redReason(reason: string): string {
  const r = reason.trim();
  if (!r) return 'red stay';
  if (/^sentiment bad/i.test(r)) return 'red stay, the thread read badly';
  return `red stay, ${r}`;
}

type CardText = { text: string; tone: AskTone; went: boolean };

/** One card, from the operator's side. `what` names the ask ("First ask",
 *  "Follow-up", "Late first ask") and `sentVerb` is how a sent one reads. */
function cardText(card: ReviewAskCard, what: string, sentVerb: string, tier: string): CardText {
  const when = (iso: string) => (iso ? ` ${shortInstant(iso)}` : '');
  switch (card.status) {
    case 'approved':
      return { text: `${sentVerb}${when(card.resolved_at)}`, tone: 'done', went: true };
    case 'manual_sent':
      if (card.sent_by_hand) return { text: `${sentVerb} by hand${when(card.resolved_at)}`, tone: 'done', went: true };
      return {
        text: `${what} marked handled${when(card.resolved_at)}${card.note ? ` (${card.note})` : ''}`,
        tone: 'skipped',
        went: true, // the sweep counts a handled first ask as sent
      };
    case 'scheduled':
      return { text: `${what} scheduled for${when(card.send_at)}`, tone: 'waiting', went: false };
    case 'sending':
      return { text: `${what} sending now`, tone: 'waiting', went: false };
    case 'pending':
      return {
        text: tier === 'yellow' ? `${what} waiting for your call (fringe stay)` : `${what} waiting for approval`,
        tone: 'waiting',
        went: false,
      };
  }
  const because: Record<string, string> = {
    declined: 'declined',
    handled: 'marked handled',
    review_arrived: 'a review arrived first',
    guest_reported_review: 'guest said they already reviewed',
    window_closed: 'the card expired unanswered',
    went_stale: 'the card went stale',
    not_recorded: 'the card was withdrawn',
    withdrawn: 'the card was withdrawn',
  };
  const why = because[card.ended_because] ?? (card.status === 'rejected' ? 'declined' : 'the card was withdrawn');
  const lead = what === 'Follow-up' ? 'No follow-up' : 'Not asked';
  return { text: `${lead}: ${why}`, tone: 'skipped', went: false };
}

/** The first ask, or null when the ledger has no first-stage decision. */
function firstText(stage: ReviewAskStage, what: string, sentVerb: string): CardText {
  switch (stage.tier) {
    case 'red':
      return { text: `Not asked: ${redReason(stage.reason)}`, tone: 'skipped', went: false };
    case 'external':
      return { text: 'Asked earlier in the thread', tone: 'done', went: true };
  }
  if (!stage.card) return { text: `${what} recorded, card missing`, tone: 'unknown', went: false };
  return cardText(stage.card, what, sentVerb, stage.tier);
}

/**
 * The ask line for one stay, e.g. "Asked Oct 14 · follow-up due Oct 19".
 *
 * `ask` is the concierge's entry for this reservation, null when it has none,
 * or 'unavailable' when the ledger could not be read at all. `today` is
 * YYYY-MM-DD in Gloucester. `review` is Helm's own review row for the stay.
 */
export function describeAsk(
  stay: StayFacts,
  ask: ReservationReviewAsk | null | 'unavailable',
  settings: ReviewAskSettings,
  today: string,
  review: StayReview = null,
): AskLine {
  if (ask === 'unavailable') return { text: UNAVAILABLE, tone: 'unknown' };
  const [firstFrom, firstTo] = settings.first_ask_days;
  const [followFrom, followTo] = settings.followup_days;
  const days = dayDiff(stay.checkOut, today);
  const first = ask?.first ?? null;
  const followup = ask?.followup ?? null;

  // ── The first ask ──
  let head: CardText;
  if (first) {
    head = firstText(first, 'First ask', 'Asked');
  } else if (followup?.late_first) {
    // The first window was missed, so the ask went out in the follow-up
    // window worded as a first ask. It is the only ask that stay gets.
    const late = firstText(followup, 'Late first ask', 'Asked late');
    return { text: late.text, tone: late.tone };
  } else if (followup) {
    // A follow-up decision with no first-stage row: the first ask was
    // Guesty's, or written by hand, before the ledger saw the stay.
    if (followup.tier === 'red') return { text: `Not asked: ${redReason(followup.reason)}`, tone: 'skipped' };
    head = { text: 'Asked earlier in the thread', tone: 'done', went: true };
  } else if (ask?.legacy) {
    // The engine's single week-after ask, from before the two-ask ledger.
    // A stay it reached is never asked again.
    const old = ask.legacy.card
      ? cardText(ask.legacy.card, 'Ask', 'Asked', 'green')
      : { text: `Asked ${shortInstant(ask.legacy.requested_at)}`, tone: 'done' as AskTone, went: true };
    return { text: old.text, tone: old.tone };
  } else {
    // Nothing recorded. Say what the stay itself tells us, never "not asked"
    // as if the ledger had said so.
    if (isDirect(stay.channel)) return { text: 'Not asked: direct booking', tone: 'skipped' };
    if (settings.ledger_started && shiftIsoDay(stay.checkOut, firstTo) < settings.ledger_started) {
      return { text: `No record: before our own asks began ${shortDay(settings.ledger_started)}`, tone: 'unknown' };
    }
    if (!settings.sweep_enabled) return { text: 'Not asked: review asks are switched off', tone: 'skipped' };
    if (ask?.guest_reported_review) return { text: 'Not asked: guest said they already reviewed', tone: 'skipped' };
    if (review?.createdAt && review.createdAt.slice(0, 10) <= shiftIsoDay(stay.checkOut, firstTo)) {
      // The sweep passes over a stay that is already reviewed, without a record.
      return { text: 'Not asked: they reviewed on their own', tone: 'skipped' };
    }
    if (days < firstFrom) return { text: `First ask due ${shortDay(shiftIsoDay(stay.checkOut, firstFrom))}`, tone: 'due' };
    if (days <= firstTo) return { text: 'First ask not sent yet', tone: 'due' };
    if (days < followFrom) {
      return { text: `First ask missed; a late ask is due ${shortDay(shiftIsoDay(stay.checkOut, followFrom))}`, tone: 'due' };
    }
    if (days <= followTo) return { text: 'First ask missed; late ask not sent yet', tone: 'due' };
    return { text: 'Not asked (no reason recorded)', tone: 'unknown' };
  }

  // ── The follow-up, only after a first ask that went ──
  if (!head.went) return { text: head.text, tone: head.tone };
  let tail: { text: string; tone: AskTone } | null = null;
  if (followup) {
    if (followup.tier === 'held') tail = { text: 'no follow-up: not a clean stay by day 7', tone: 'skipped' };
    else if (followup.tier === 'red') tail = { text: `no follow-up: ${redReason(followup.reason)}`, tone: 'skipped' };
    else if (followup.card) {
      const t = cardText(followup.card, 'Follow-up', 'Follow-up sent', followup.tier);
      tail = { text: t.text.charAt(0).toLowerCase() + t.text.slice(1), tone: t.tone };
    }
  } else if (first?.tier === 'yellow') {
    tail = { text: 'no follow-up for a fringe stay', tone: 'skipped' };
  } else if (review) {
    tail = null; // a reviewed stay is never followed up
  } else if (days < followFrom) {
    tail = { text: `follow-up due ${shortDay(shiftIsoDay(stay.checkOut, followFrom))}`, tone: 'due' };
  } else if (days <= followTo) {
    tail = { text: 'follow-up not sent yet', tone: 'due' };
  } else {
    tail = { text: 'no follow-up sent', tone: 'unknown' };
  }
  if (!tail) return { text: head.text, tone: head.tone };
  // The line takes the tone of its most pressing part: something waiting or
  // due outranks a finished first ask.
  const rank: Record<AskTone, number> = { waiting: 4, due: 3, unknown: 2, skipped: 1, done: 0 };
  return { text: `${head.text} · ${tail.text}`, tone: rank[tail.tone] > rank[head.tone] ? tail.tone : head.tone };
}

// ── The review line ────────────────────────────────────────────────────────

export function stars(rating: number): string {
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

/** Has the review come in, and if not, can we know yet. */
export function describeReview(
  stay: StayFacts,
  review: StayReview,
  today: string,
  guestReported = false,
): ReviewLine {
  if (review) {
    if (review.rating == null) return { kind: 'reviewed', text: 'Reviewed, no rating shown' };
    return { kind: 'reviewed', text: `Reviewed ${stars(review.rating)}` };
  }
  if (isDirect(stay.channel)) return { kind: 'no_platform', text: 'No review site' };
  const said = guestReported ? 'Guest says they reviewed · ' : '';
  if (SEALED_CHANNELS.has(stay.channel.trim().toLowerCase())) {
    const opens = shiftIsoDay(stay.checkOut, SEALED_DAYS);
    if (today < opens) return { kind: 'sealed', text: `${said}Sealed until ${shortDay(opens)}` };
  }
  return { kind: 'none', text: guestReported ? 'Guest says they reviewed, none on file' : 'No review' };
}

// ── Which stays the list shows ─────────────────────────────────────────────

/** Guesty statuses that mean the stay happened. `closed` is Guesty retiring a
 *  record: after checkout it is usually the real stay, but beside a live
 *  record of the same nights it is a superseded twin (an altered Airbnb code,
 *  a Booking.com placeholder). See guesty-legacy-status.ts. */
const LIVE_STATUSES = new Set([
  'confirmed', 'reserved', 'checked_in', 'checked-in', 'checkedin',
  'checked_out', 'checked-out', 'checkedout', 'completed',
]);

export type StayRow = {
  reservationId: string;
  propertyId: string;
  checkIn: string | null;
  checkOut: string;
  status: string | null;
};

/** The real stays among Guesty's records: live statuses, plus a closed record
 *  only when no live record holds any of the same nights at that home. An
 *  absent status is kept, since a stay we know nothing about is more safely
 *  shown than hidden. One row per reservation id. */
export function realStays<T extends StayRow>(rows: T[]): T[] {
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    if (!r.reservationId || seen.has(r.reservationId)) return false;
    seen.add(r.reservationId);
    return true;
  });
  const status = (r: T) => (r.status ?? '').trim().toLowerCase();
  const live = unique.filter((r) => !r.status || LIVE_STATUSES.has(status(r)));
  const overlaps = (a: T, b: T) =>
    a.propertyId === b.propertyId &&
    (a.checkIn ?? a.checkOut) < b.checkOut &&
    (b.checkIn ?? b.checkOut) < a.checkOut;
  const closed = unique.filter((r) => status(r) === 'closed' && !live.some((l) => overlaps(l, r)));
  const keep = new Set([...live, ...closed]);
  return unique.filter((r) => keep.has(r));
}

/** The smallest window on the Reviews tab that still reaches a day, so a link
 *  between a review and its stay lands on a list that holds it. */
export function windowCovering(dayIso: string, today: string, windows: readonly number[]): number {
  const back = dayDiff(dayIso.slice(0, 10), today);
  return windows.find((w) => back <= w) ?? windows[windows.length - 1];
}

/** Guest name as the list shows it: the first name only. */
export function firstName(full: string | null | undefined): string {
  const t = (full ?? '').trim();
  return t ? t.split(/\s+/)[0] : 'Guest';
}
