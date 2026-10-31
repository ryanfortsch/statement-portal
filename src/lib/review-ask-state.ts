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
 *
 * Direct (staycapeann.com) guests joined the sweep on 2026-10-31, for stellar
 * stays only (Dotti, 2026-10-30): one ask linking a testimonial form on
 * staycapeann.com, by text or email, and no follow-up. The concierge says
 * whether direct asks are on (`direct_enabled`) and from when direct stays
 * were judged (`direct_since`); a direct stay it held back carries its reason
 * like any other. What the guest writes is a `guest_testimonials` row, read
 * here as the stay's review; the Google review the form's thank-you page
 * invites them to leave as well is never tracked.
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

/** One stage of our review OF the guest (concierge host_reviews): the stop
 *  of Guesty's auto review, or our own review to post. */
export type HostReviewStage = {
  /** stop | post */
  stage: string;
  check_out: string;
  /** '' while open; stopped | let_post | too_late | expired | no_auto_review
   *  (stop), posted | skipped | expired | not_possible (post). */
  outcome: string;
  outcome_note: string;
  outcome_at: string;
  fires_at: string;
  due_by: string;
  window_closes: string;
  conduct: string;
  conduct_reason: string;
  card_status: string;
};

export type ReservationReviewAsk = {
  reservation_id: string;
  first: ReviewAskStage | null;
  followup: ReviewAskStage | null;
  /** Our review OF the guest, by stage. Only a red stay has one; absent on
   *  an older concierge. */
  host_review?: { stop: HostReviewStage | null; post: HostReviewStage | null } | null;
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
  /** Guesty's Auto reviews delay, as the concierge is told it (host_reviews). */
  auto_review_delay_days?: number;
  /** The day after checkout our own review of a red guest is due. */
  host_review_post_day?: number;
  host_review_cards?: boolean;
  /** Direct (staycapeann.com) guests are asked only once the concierge's
   *  direct asks are switched on. Absent on an older concierge: read as off. */
  direct_enabled?: boolean;
  /** YYYY-MM-DD from which direct stays are judged at all. */
  direct_since?: string;
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

/** A direct guest's testimonial (guest_testimonials), or null when none. */
export type StayTestimonial = {
  /** invited | submitted | approved | hidden */
  status: string;
  rating: number | null;
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
  direct_enabled: false,
  direct_since: '2026-10-31',
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

/** Cut a free-text reason at a word boundary so a row stays one line. */
function clip(text: string, max = 110): string {
  const t = text.trim().replace(/\s+/g, ' ').replace(/[.\s]+$/, '');
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : max)}...`;
}

/** What a guest's own word, caught by the sweep's tripwires, means. */
function guestWord(word: string): string {
  const w = word.toLowerCase();
  if (/refund|reimburs|money\s+back|compensat/.test(w)) return 'the guest asked about a refund';
  if (/discount/.test(w)) return 'the guest asked about a discount';
  if (/disappointed|frustrat|unacceptable|upset|unhappy|dissatisf|not\s+happy/.test(w)) return 'the guest said they were unhappy';
  if (/complain/.test(w)) return 'the guest made a complaint';
  if (/bed\s*bug|roach|rodent|mice|mouse|infestation/.test(w)) return 'the guest reported pests';
  if (/filthy|disgusting|mold|mildew/.test(w)) return 'the guest said the home was dirty';
  if (/locked\s+out|couldn'?t\s+get\s+in/.test(w)) return 'the guest was locked out';
  if (/\bcode\b/.test(w)) return 'the door code did not work';
  if (/^no\s+\S/.test(w)) return `the guest had ${w}`;
  if (/dirty|unclean|not\s+clean|wasn'?t\s+clean|stained/.test(w)) return 'the guest said something was not clean';
  if (/broke|out\s+of\s+order|wouldn'?t\s+turn\s+on/.test(w)) return 'the guest reported something broken';
  if (/work/.test(w)) return 'the guest said something did not work';
  return `the guest said "${word}"`;
}

/**
 * Why the sweep held back, in plain words. The concierge records its reasons
 * in its own terms ("safety incident: smoke alarm", "guest said 'refund'",
 * "sentiment bad: ...", "not green at follow-up: ..."), and its classes
 * (green, yellow, red, fringe, held) are never defined on the page, so none
 * of them reaches a row: only what happened during the stay does.
 */
export function plainReason(raw: string): string {
  const r = (raw ?? '').trim().replace(/^not green at follow-up:\s*/i, '').trim();
  if (!r) return 'something went wrong during the stay';
  // A direct guest is asked after a stellar stay only; the rest of the
  // reason is what kept this one short of that.
  const stellar = r.match(/^not stellar:\s*(.+)$/i);
  if (stellar) return `stellar stays only, ${plainReason(stellar[1])}`;
  const safety = r.match(/^safety incident:\s*(.+)$/i);
  if (safety) return `a safety issue during the stay (${clip(safety[1], 40)})`;
  const mood = r.match(/^sentiment bad:?\s*(.*)$/i);
  if (mood) return mood[1].trim() ? `the conversation read as unhappy (${clip(mood[1], 90)})` : 'the conversation read as unhappy';
  if (/^a host review ask was already in the thread/i.test(r)) return 'someone already asked in the thread';
  const said = r.match(/^guest (?:said|mentioned)\s+(['"])(.+)\1(?:\s+during the stay)?$/i);
  if (said) return guestWord(said[2]);
  // The sentiment model's own sentence about what went wrong.
  const text = clip(r);
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

type CardText = { text: string; tone: AskTone; went: boolean };

/** One card, from the operator's side. `what` names the ask ("First ask",
 *  "Follow-up", "Late first ask") and `sentVerb` is how a sent one reads.
 *  `concern` is set when the sweep raised the card for the operator to decide
 *  because something went wrong during the stay. */
function cardText(card: ReviewAskCard, what: string, sentVerb: string, concern: string | null): CardText {
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
        text: concern !== null ? `${what} waiting for your call: ${plainReason(concern)}` : `${what} waiting for approval`,
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
    case 'held': // a direct stay short of stellar, or one with no phone or email
      return { text: `Not asked: ${plainReason(stage.reason)}`, tone: 'skipped', went: false };
    case 'external':
      return { text: 'Asked earlier in the thread', tone: 'done', went: true };
  }
  if (!stage.card) return { text: `${what} recorded, card missing`, tone: 'unknown', went: false };
  return cardText(stage.card, what, sentVerb, stage.tier === 'yellow' ? stage.reason : null);
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
    if (followup.tier === 'red') return { text: `Not asked: ${plainReason(followup.reason)}`, tone: 'skipped' };
    head = { text: 'Asked earlier in the thread', tone: 'done', went: true };
  } else if (ask?.legacy) {
    // The engine's single week-after ask, from before the two-ask ledger.
    // A stay it reached is never asked again.
    const old = ask.legacy.card
      ? cardText(ask.legacy.card, 'Ask', 'Asked', null)
      : { text: `Asked ${shortInstant(ask.legacy.requested_at)}`, tone: 'done' as AskTone, went: true };
    return { text: old.text, tone: old.tone };
  } else {
    // Nothing recorded. Say what the stay itself tells us, never "not asked"
    // as if the ledger had said so.
    if (isDirect(stay.channel)) {
      // A direct guest is asked only once the concierge holds the Google
      // review link, and only for stays judged since direct asks began.
      if (!settings.direct_enabled) return { text: 'Not asked: direct asks are not switched on yet', tone: 'skipped' };
      if (settings.direct_since && shiftIsoDay(stay.checkOut, firstTo) < settings.direct_since) {
        return { text: `No record: before direct asks began ${shortDay(settings.direct_since)}`, tone: 'unknown' };
      }
    }
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
    if (followup.tier === 'held' || followup.tier === 'red') {
      tail = { text: `no follow-up: ${plainReason(followup.reason)}`, tone: 'skipped' };
    }
    else if (followup.card) {
      const t = cardText(followup.card, 'Follow-up', 'Follow-up sent', followup.tier === 'yellow' ? followup.reason : null);
      tail = { text: t.text.charAt(0).toLowerCase() + t.text.slice(1), tone: t.tone };
    }
  } else if (isDirect(stay.channel)) {
    tail = null; // a direct guest gets one ask and no second knock
  } else if (first?.tier === 'yellow') {
    // A stay where something went wrong gets one ask, never a second.
    tail = { text: `no follow-up: ${plainReason(first.reason)}`, tone: 'skipped' };
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

// ── Our review of them ─────────────────────────────────────────────────────

/**
 * Our review OF the guest, in one line, for the Recent stays view. Only a red
 * stay has a record (the concierge files host-review cards for red first-stage
 * decisions alone); on every other stay Guesty's auto review runs unseen, so
 * the line is null and the row stays as it was.
 */
export function describeHostReview(ask: ReservationReviewAsk | null | 'unavailable', today: string): AskLine | null {
  if (!ask || ask === 'unavailable') return null;
  const stop = ask.host_review?.stop ?? null;
  const post = ask.host_review?.post ?? null;
  if (post) {
    switch (post.outcome) {
      case 'posted':
        return { text: `Our review of them posted${post.outcome_at ? ` ${shortInstant(post.outcome_at)}` : ''}`, tone: 'done' };
      case 'skipped':
        return { text: 'No review of them, by choice', tone: 'skipped' };
      case 'expired':
        return { text: 'Our review of them: the window closed with the card open', tone: 'unknown' };
      case 'not_possible':
        return { text: "Guesty's 5-star auto review went up; a stay gets one host review", tone: 'skipped' };
      default:
        if (post.due_by && today > post.due_by) return { text: `Our review of them overdue since ${shortDay(post.due_by)}`, tone: 'due' };
        return { text: `Our review of them waiting to post, due ${shortDay(post.due_by)}`, tone: 'waiting' };
    }
  }
  if (!stop) return null;
  switch (stop.outcome) {
    case 'stopped':
      return { text: "Guesty's auto review stopped · our review of them follows on day 13", tone: 'done' };
    case 'let_post':
      return { text: "Guesty's 5-star auto review allowed, by choice", tone: 'skipped' };
    case 'too_late':
      return { text: "Guesty's 5-star auto review went up before the stay read red", tone: 'skipped' };
    case 'expired':
      return { text: "Guesty's 5-star auto review went up: the stop card was not acted on", tone: 'unknown' };
    case 'no_auto_review':
      return null;
    default:
      if (stop.due_by && today > stop.due_by) return { text: "Stop Guesty's auto review: past due, check the reservation", tone: 'due' };
      return { text: `Stop Guesty's auto review in Guesty by ${shortDay(stop.due_by)}`, tone: 'waiting' };
  }
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
  directReviews = false,
  testimonial: StayTestimonial = null,
): ReviewLine {
  if (review) {
    if (review.rating == null) return { kind: 'reviewed', text: 'Reviewed, no rating shown' };
    return { kind: 'reviewed', text: `Reviewed ${stars(review.rating)}` };
  }
  if (isDirect(stay.channel)) {
    // A direct guest's review is the testimonial they leave on
    // staycapeann.com; the Google review they may also leave is not tracked.
    if (testimonial) {
      const s = testimonial.rating != null ? ` ${stars(testimonial.rating)}` : '';
      switch (testimonial.status) {
        case 'submitted':
          return { kind: 'reviewed', text: `Testimonial${s} · waiting for your approval` };
        case 'approved':
          return { kind: 'reviewed', text: `Testimonial${s} · on the site` };
        case 'hidden':
          return { kind: 'none', text: `Testimonial${s} · hidden` };
        default:
          return { kind: 'none', text: 'Form link sent, no testimonial yet' };
      }
    }
    return { kind: 'no_platform', text: directReviews ? 'No testimonial yet' : 'No review site' };
  }
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
