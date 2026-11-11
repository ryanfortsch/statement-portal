/**
 * The Tuesday brief: a printable PDF emailed at 6 AM Eastern every Tuesday
 * (Dotti, 2026-11-09). Page one is the week: Delaney's three goals on top
 * (the same tiles as the home page's Operations goals band,
 * ops-scorecard.ts) and the check-ins for the seven days starting that
 * Tuesday, by day. Page two is what guests told us: every review that
 * landed in the week before the send rated below five stars, then the
 * five-star ones that carried a private note or a category below five.
 * Every page after it is one home: its open work slips in priority order and
 * the issues flagged at the house. The homes with a check-in that week come
 * first, in the order the guests arrive; the rest follow by street (Dotti,
 * 2026-11-10). An appointment whose day has passed (the inspection on the
 * 6th) is not work this week: it prints once at the foot of its page, to
 * close out, instead of leading the page as overdue.
 *
 * Pure, so `npm test` pins the ordering and the week. The reads are in
 * weekly-brief-server.ts, the HTML in weekly-brief-html.ts, the PDF in
 * weekly-brief-pdf.ts and the send in /api/cron/weekly-brief. Nothing here
 * reads money: the brief carries no payout, fee or rate.
 */
import { dropCarryOnStays } from './home-houses.ts';
import {
  isSupplySlip,
  LANE_LABELS,
  slipDetailLine,
  slipDisplayTitle,
  slipLane,
  supplyChipLabel,
  type WorkLane,
} from './work-slip-lanes.ts';
import type { ScorecardTile } from './ops-scorecard.ts';
import type { RunScope, WorkSlipCategory } from './work-types.ts';

/** Days on page one, starting the send day: Tuesday through Monday. */
export const BRIEF_DAYS = 7;

/**
 * A home's page is one sheet, so the index's page numbers hold. The rows
 * are budgeted by their estimated printed height (pageCost) against what a
 * sheet carries when the PDF zooms it to about 0.85 (weekly-brief-pdf.ts
 * fits the last stretch); work past the budget is counted, not listed.
 * The estimates are the stylesheet's (weekly-brief-html.ts) in px at full
 * size, deliberately generous.
 */
export const PAGE_BUDGET_PX = 1400;
export const COST = {
  header: 190,        // masthead, name, address, the facts line
  headlineLine: 22,   // the work brief's headline, per wrapped line
  section: 40,        // a section's rule and title
  row: 44,            // a row: title, meta line, padding
  detailLine: 16,     // each wrapped line of a row's detail
  note: 26,           // a flagged note's title line
  noteBodyLine: 16,
  bringLine: 17,
  more: 24,           // the "N more" line
  pastLine: 22,       // a passed appointment's one line
} as const;
/** Characters per wrapped line at the row and note widths. */
const DETAIL_CHARS_PER_LINE = 105;
const HEADLINE_CHARS_PER_LINE = 85;
const BRING_CHARS_PER_LINE = 115;

/** Rows that keep their detail line; the rest print title and meta only. */
export const DETAIL_ROWS = 12;

/** How much of an issue note's body prints under its title. */
export const NOTE_BODY_MAX = 200;
/** Flagged notes listed on a page, newest first; the rest are counted. */
export const MAX_NOTES = 6;

const lines = (text: string | null | undefined, perLine: number) => (text ? Math.ceil(text.length / perLine) : 0);

export type BriefSlip = {
  id: string;
  property_id: string;
  title: string;
  description: string | null;
  action_summary: string | null;
  category: WorkSlipCategory;
  priority: string;
  status: string;
  scheduled_date: string | null;
  follow_up_date: string | null;
  created_at: string;
  location: string | null;
  assigned_to_label: string | null;
  run_scope?: RunScope | null;
  owner_action_required?: boolean;
  owner_status?: string | null;
  from_supply_key?: string | null;
  from_guest_request_key?: string | null;
  /** Explicitly linked reports collapsed into this one (work-issues.ts). */
  linked_report_ids?: string[];
};

export type BriefNote = { id: string; property_id: string; title: string; body: string; created_at: string };

export type BriefStay = {
  property_id: string;
  check_in: string;
  check_out: string;
  guest_name: string | null;
  num_guests: number | null;
  channel: string | null;
};

export type BriefHome = { id: string; name: string; address: string | null; owner_last: string | null };

// ── Dates ───────────────────────────────────────────────────────────

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)));
  const b = Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

/**
 * Page two's window: the seven days before the send day, so each Tuesday's
 * brief picks up where the last one left off and a review prints once.
 */
export function feedbackWindow(today: string): { from: string; to: string } {
  return { from: addDays(today, -BRIEF_DAYS), to: addDays(today, -1) };
}

/**
 * Midnight Eastern on a day, as a UTC instant: where page two's window
 * starts and stops, so a review that lands at 9 PM Monday is last week's
 * either side of daylight saving.
 */
export function easternMidnightIso(day: string): string {
  for (const offset of [4, 5]) {
    const t = new Date(`${day.slice(0, 10)}T0${offset}:00:00Z`);
    const hour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(t);
    if (Number(hour) === 0) return t.toISOString();
  }
  return new Date(`${day.slice(0, 10)}T05:00:00Z`).toISOString();
}

/** The brief's window: the send day and the six after it, inclusive. */
export function briefWindow(today: string): { from: string; to: string } {
  return { from: today, to: addDays(today, BRIEF_DAYS - 1) };
}

function fmt(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}

/** "Tue, Nov 10". */
export function shortDay(iso: string): string {
  return fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Tuesday, November 10". */
export function longDay(iso: string): string {
  return fmt(iso, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** "Nov 10". */
export function monthDay(iso: string): string {
  return fmt(iso, { month: 'short', day: 'numeric' });
}

// ── Page one: the week's check-ins ──────────────────────────────────

const CHANNEL_LABELS: Record<string, string> = {
  airbnb: 'Airbnb',
  airbnb2: 'Airbnb',
  vrbo: 'Vrbo',
  homeaway: 'Vrbo',
  homeaway2: 'Vrbo',
  'booking.com': 'Booking.com',
  bookingcom: 'Booking.com',
  booking: 'Booking.com',
  direct: 'Direct',
  manual: 'Direct',
  sca: 'Stay Cape Ann',
  owner: 'Owner stay',
};

/** The channel as a person says it; a channel we do not know prints as stored. */
export function channelLabel(channel: string | null | undefined): string | null {
  const c = (channel ?? '').trim();
  if (!c) return null;
  return CHANNEL_LABELS[c.toLowerCase()] ?? c.charAt(0).toUpperCase() + c.slice(1);
}

export type CheckIn = {
  propertyId: string;
  home: string;
  /** The arrival day, YYYY-MM-DD. */
  date: string;
  guest: string | null;
  nights: number;
  checkOut: string;
  guests: number | null;
  channel: string | null;
  /** Someone checks out of the same home that day: a same-day turn. */
  sameDayTurn: boolean;
};

export type BriefDay = { date: string; checkIns: CheckIn[] };

/**
 * The window's arrivals, one entry per day whether or not anyone arrives,
 * so page one shows the whole week. A stay that carries on (the same guest
 * out and back in at the same home that day) is not an arrival and does not
 * print (home-houses.ts owns that rule). Homes outside `homes` are left out.
 */
export function groupCheckIns(args: {
  today: string;
  arrivals: BriefStay[];
  departures: BriefStay[];
  homes: ReadonlyMap<string, BriefHome>;
}): BriefDay[] {
  const { from, to } = briefWindow(args.today);
  const days: BriefDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const asStay = (s: BriefStay) => ({ ...s, propertyId: s.property_id, guestName: s.guest_name });
    const ins = args.arrivals.filter((s) => s.check_in.slice(0, 10) === d && args.homes.has(s.property_id)).map(asStay);
    const outs = args.departures.filter((s) => s.check_out.slice(0, 10) === d && args.homes.has(s.property_id)).map(asStay);
    const kept = dropCarryOnStays(outs, ins);
    const leaving = new Set(kept.out.map((s) => s.property_id));
    // One row per home and guest: the same stay can sit in bookings twice
    // under two sources even with duplicate_of set on neither.
    const seen = new Set<string>();
    const checkIns: CheckIn[] = [];
    for (const s of kept.in) {
      const key = `${s.property_id}|${(s.guest_name ?? '').trim().toLowerCase()}|${s.check_out.slice(0, 10)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      checkIns.push({
        propertyId: s.property_id,
        home: args.homes.get(s.property_id)!.name,
        date: d,
        guest: s.guest_name?.trim() || null,
        nights: Math.max(0, daysBetween(s.check_in, s.check_out)),
        checkOut: s.check_out.slice(0, 10),
        guests: s.num_guests && s.num_guests > 0 ? s.num_guests : null,
        channel: channelLabel(s.channel),
        sameDayTurn: leaving.has(s.property_id),
      });
    }
    checkIns.sort((a, b) => a.home.localeCompare(b.home));
    days.push({ date: d, checkIns });
  }
  return days;
}

// ── Page two: what guests told us ───────────────────────────────────

/**
 * A review as the brief reads it: a Guesty review (public.reviews, every
 * score already in stars, reviews-normalize) or a direct guest's
 * testimonial from staycapeann.com mapped onto the same shape.
 */
export type BriefReview = {
  id: string;
  property_id: string | null;
  guest_name: string | null;
  channel: string | null;
  overall_rating: number | null;
  public_review: string | null;
  private_feedback: string | null;
  category_cleanliness?: number | null;
  category_accuracy?: number | null;
  category_checkin?: number | null;
  category_communication?: number | null;
  category_location?: number | null;
  category_value?: number | null;
  review_created_at: string;
  /** The slip reviews-to-slips filed from it, if any: its status. */
  slip_status?: string | null;
};

const CATEGORY_WORDS: Array<[keyof BriefReview, string]> = [
  ['category_cleanliness', 'Cleanliness'],
  ['category_accuracy', 'Accuracy'],
  ['category_checkin', 'Check-in'],
  ['category_communication', 'Communication'],
  ['category_location', 'Location'],
  ['category_value', 'Value'],
];

/** How much of a review's words print; the rest is on the Reviews tab. */
export const REVIEW_TEXT_MAX = 420;
export const FEEDBACK_BUDGET_PX = 1400;
export const FEEDBACK_COST = {
  header: 200,       // masthead, title, the window, the tally
  section: 40,
  item: 50,          // the item's name line and its quiet line
  textLine: 16,      // each wrapped line of a review's words
  label: 14,         // "Private feedback" above the guest's private words
  more: 24,
  empty: 30,
} as const;
const REVIEW_CHARS_PER_LINE = 110;
/** Items that always print, whatever the estimate says. */
const FEEDBACK_MIN_ITEMS = 4;

export type FeedbackItem = {
  id: string;
  home: string;
  guest: string | null;
  channel: string | null;
  /** "Nov 6", when the review landed. */
  landed: string;
  /** Stars, null when the channel sent none. */
  rating: number | null;
  /** "Cleanliness 3", every category below five. */
  lowCategories: string[];
  publicText: string | null;
  privateText: string | null;
  /** "Private feedback", or Booking.com's own words for it. */
  privateLabel: string;
  /** Where its work slip stands, when one was filed. */
  slip: string | null;
};

export type FeedbackPage = {
  /** The reviews could not be read this morning: the page says so, not "none". */
  unreadable: boolean;
  /** The window, YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
  /** Rated reviews that landed in the window, and how many were five stars. */
  total: number;
  fiveStar: number;
  avg: number | null;
  belowFive: FeedbackItem[];
  moreBelowFive: number;
  /** Five stars, with a private note or a category below five. */
  notes: FeedbackItem[];
  moreNotes: number;
};

/** "4", "4.5": stars as a person says them. */
export function starWords(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)} star${r === 1 ? '' : 's'}`;
}

function slipWords(status: string | null | undefined): string | null {
  if (!status) return null;
  if (status === 'done') return 'work slip done';
  if (status === 'dismissed') return 'work slip dismissed';
  return 'on the Work board';
}

function feedbackItem(r: BriefReview, homes: ReadonlyMap<string, BriefHome>): FeedbackItem {
  const low: string[] = [];
  for (const [key, word] of CATEGORY_WORDS) {
    const v = r[key] as number | null | undefined;
    if (typeof v === 'number' && v > 0 && v < 5) low.push(`${word} ${Math.round(v * 10) / 10}`);
  }
  const pub = r.public_review?.trim() ? clip(r.public_review, REVIEW_TEXT_MAX) : null;
  const priv = r.private_feedback?.trim() ? clip(r.private_feedback, REVIEW_TEXT_MAX) : null;
  const channel = channelLabel(r.channel);
  return {
    id: r.id,
    home: homes.get(r.property_id ?? '')?.name ?? 'A home',
    guest: r.guest_name?.trim() || null,
    channel,
    landed: monthDay(r.review_created_at.slice(0, 10)),
    rating: typeof r.overall_rating === 'number' ? r.overall_rating : null,
    lowCategories: low,
    publicText: pub,
    privateText: priv,
    privateLabel: /booking/i.test(r.channel ?? '') ? 'What could be better' : 'Private feedback',
    slip: slipWords(r.slip_status),
  };
}

export function feedbackItemCost(i: FeedbackItem): number {
  return (
    FEEDBACK_COST.item +
    lines(i.publicText, REVIEW_CHARS_PER_LINE) * FEEDBACK_COST.textLine +
    (i.privateText ? FEEDBACK_COST.label + lines(i.privateText, REVIEW_CHARS_PER_LINE) * FEEDBACK_COST.textLine : 0)
  );
}

/**
 * Page two. Below five stars first, the lowest leading, then the five-star
 * reviews whose guest still said something to us (a private note, a
 * category below five), newest first. A review with no rating counts as
 * feedback only when it carries words. Homes outside `homes` are left out,
 * as everywhere in Helm's review stats. The page is one sheet: items past
 * the budget are counted, and the below-five ones are never crowded out by
 * the notes.
 */
export function buildFeedbackPage(args: {
  from: string;
  to: string;
  /** null: the read failed. */
  reviews: BriefReview[] | null;
  homes: ReadonlyMap<string, BriefHome>;
}): FeedbackPage {
  const unreadable = args.reviews === null;
  const ours = (args.reviews ?? []).filter((r) => r.property_id && args.homes.has(r.property_id));
  const rated = ours.filter((r) => typeof r.overall_rating === 'number');
  const fiveStar = rated.filter((r) => (r.overall_rating as number) >= 5).length;
  const avg = rated.length ? rated.reduce((n, r) => n + (r.overall_rating as number), 0) / rated.length : null;

  const newest = (a: BriefReview, b: BriefReview) => b.review_created_at.localeCompare(a.review_created_at) || a.id.localeCompare(b.id);
  const below = ours
    .filter((r) => typeof r.overall_rating === 'number' && r.overall_rating < 5)
    .sort((a, b) => (a.overall_rating as number) - (b.overall_rating as number) || newest(a, b))
    .map((r) => feedbackItem(r, args.homes));
  const noted = ours
    .filter((r) => !(typeof r.overall_rating === 'number' && r.overall_rating < 5))
    .map((r) => feedbackItem(r, args.homes))
    .filter((i) => i.privateText || i.lowCategories.length || (i.rating === null && i.publicText));
  const notedOrder = new Map(ours.map((r) => [r.id, r]));
  noted.sort((a, b) => newest(notedOrder.get(a.id)!, notedOrder.get(b.id)!));

  let spent = FEEDBACK_COST.header + FEEDBACK_COST.section;
  if (!below.length) spent += FEEDBACK_COST.empty;
  const keptBelow: FeedbackItem[] = [];
  for (const [i, item] of below.entries()) {
    const cost = feedbackItemCost(item);
    const left = below.length - i - 1;
    if (i >= FEEDBACK_MIN_ITEMS && spent + cost + (left ? FEEDBACK_COST.more : 0) > FEEDBACK_BUDGET_PX) break;
    spent += cost;
    keptBelow.push(item);
  }
  if (keptBelow.length < below.length) spent += FEEDBACK_COST.more;

  const keptNotes: FeedbackItem[] = [];
  if (noted.length) {
    spent += FEEDBACK_COST.section;
    for (const [i, item] of noted.entries()) {
      const cost = feedbackItemCost(item);
      const left = noted.length - i - 1;
      if (spent + cost + (left ? FEEDBACK_COST.more : 0) > FEEDBACK_BUDGET_PX) break;
      spent += cost;
      keptNotes.push(item);
    }
  }

  return {
    unreadable,
    from: args.from,
    to: args.to,
    total: rated.length,
    fiveStar,
    avg,
    belowFive: keptBelow,
    moreBelowFive: below.length - keptBelow.length,
    notes: keptNotes,
    moreNotes: noted.length - keptNotes.length,
  };
}

/** The estimated printed height of page two, for the test that holds it to one sheet. */
export function feedbackPageCost(p: FeedbackPage): number {
  let spent = FEEDBACK_COST.header + FEEDBACK_COST.section;
  if (!p.belowFive.length) spent += FEEDBACK_COST.empty;
  for (const i of p.belowFive) spent += feedbackItemCost(i);
  if (p.moreBelowFive) spent += FEEDBACK_COST.more;
  if (p.notes.length || p.moreNotes) spent += FEEDBACK_COST.section;
  for (const i of p.notes) spent += feedbackItemCost(i);
  if (p.moreNotes) spent += FEEDBACK_COST.more;
  return spent;
}

// ── The home pages: work in priority order ──────────────────────────

const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

/** The date that puts a slip on the clock: the earlier of its visit and its follow-up. */
export function slipClock(s: Pick<BriefSlip, 'scheduled_date' | 'follow_up_date'>): string | null {
  const dates = [s.scheduled_date, s.follow_up_date].filter((d): d is string => !!d).map((d) => d.slice(0, 10)).sort();
  return dates[0] ?? null;
}

/**
 * How pressing a slip is inside its priority: past its date first, then a
 * date inside the brief's week, then work already started, then the rest.
 */
export function urgencyRank(s: Pick<BriefSlip, 'scheduled_date' | 'follow_up_date' | 'status'>, today: string): number {
  const clock = slipClock(s);
  if (clock && clock < today) return 0;
  if (clock && clock <= briefWindow(today).to) return 1;
  if (s.status === 'in_progress') return 2;
  return 3;
}

/**
 * The order a home's work prints in: priority (high, normal, low), then
 * urgency inside it, then the earliest date for work on the clock, then the
 * oldest report, so the thing that has waited longest leads its tier.
 */
export function rankSlips<T extends BriefSlip>(slips: T[], today: string): T[] {
  return [...slips].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 1;
    const pb = PRIORITY_RANK[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    const ua = urgencyRank(a, today);
    const ub = urgencyRank(b, today);
    if (ua !== ub) return ua - ub;
    // On the clock (overdue or this week), the earlier date leads. Off it,
    // a date weeks out is no reason to jump older work.
    if (ua <= 1) {
      const ca = slipClock(a) ?? '9999-12-31';
      const cb = slipClock(b) ?? '9999-12-31';
      if (ca !== cb) return ca.localeCompare(cb);
    }
    return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
  });
}

/**
 * A slip whose job was to be somewhere at a set time (an inspection, a
 * meeting, an appointment) and whose date has passed. The time is gone, so
 * it is no longer this week's work: either it happened and the slip was
 * never closed, or it was missed. Read from the title, and never a slip that
 * asks us to book one ("Schedule the chimney inspection" is still work).
 */
const APPOINTMENT_WORDS = /\b(inspections?|inspector|appointments?|meetings?|walk-?through|showing|site visit)\b/i;
const BOOKING_VERBS = /^\s*(schedule|book|arrange|set up|find|get|hire|request|call to)\b/i;

export function isPastAppointment(s: Pick<BriefSlip, 'title' | 'scheduled_date' | 'follow_up_date'>, today: string): boolean {
  const clock = slipClock(s);
  if (!clock || clock >= today) return false;
  const title = s.title ?? '';
  return APPOINTMENT_WORDS.test(title) && !BOOKING_VERBS.test(title);
}

export type BriefRow = {
  id: string;
  number: number;
  title: string;
  detail: string | null;
  priority: 'high' | 'normal' | 'low';
  lane: WorkLane;
  laneLabel: string;
  /** The quiet line under the row: where it stands, whose hands, how old. */
  meta: string;
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The meta line: the clock, the status, whose hands, the age. */
export function rowMeta(s: BriefSlip, today: string): string {
  const parts: string[] = [];
  const clock = slipClock(s);
  if (clock && clock < today) parts.push(`overdue since ${monthDay(clock)}`);
  else if (clock) parts.push(`${s.scheduled_date?.slice(0, 10) === clock ? 'scheduled' : 'follow up'} ${shortDay(clock)}`);
  if (s.status === 'in_progress') parts.push('started');
  if (s.owner_action_required) {
    parts.push(
      s.owner_status === 'approved' ? 'owner approved'
      : s.owner_status === 'declined' ? 'owner declined'
      : s.owner_status === 'questions' ? 'owner has questions'
      : s.owner_status === 'sent' ? 'asked the owner'
      : 'owner not asked yet',
    );
  }
  if (s.assigned_to_label?.trim()) parts.push(s.assigned_to_label.trim());
  if (s.location?.trim()) parts.push(s.location.trim());
  const age = Math.max(0, daysBetween(s.created_at.slice(0, 10), today));
  parts.push(age === 0 ? 'opened today' : `open ${plural(age, 'day')}`);
  if (s.linked_report_ids && s.linked_report_ids.length > 1) parts.push(`${s.linked_report_ids.length} reports`);
  return parts.join(' · ');
}

export type HomePage = {
  home: BriefHome;
  headline: string | null;
  rows: BriefRow[];
  /** Work past the page's budget, counted, not listed. */
  moreRows: number;
  /** Flagged notes past MAX_NOTES, counted, not listed. */
  moreNotes: number;
  /** The shopping list: supply slips, one line. */
  bring: string[];
  /** Appointments whose day has passed: one line each at the foot, to close out. */
  pastAppointments: Array<{ id: string; title: string; date: string }>;
  notes: Array<{ id: string; title: string; body: string | null; opened: string }>;
  checkIns: CheckIn[];
  highCount: number;
  openCount: number;
};

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:·-]+$/, '')}…`;
}

/**
 * One home's page. Supplies are a single "Bring" line, not numbered work;
 * every other slip is a numbered row in rankSlips order, numbered so a
 * phone call can say "number 4" and both people find it. The flagged notes
 * and the shopping line are placed first, then rows until the page's budget
 * is spent: the first DETAIL_ROWS with their detail line, the rest compact.
 */
export function buildHomePage(args: {
  home: BriefHome;
  slips: BriefSlip[];
  notes: BriefNote[];
  headline: string | null;
  checkIns: CheckIn[];
  today: string;
}): HomePage {
  const { home, today } = args;
  const headline = args.headline?.trim() || null;
  const supplies = args.slips.filter((s) => isSupplySlip(s) && !s.owner_action_required);
  const past = args.slips.filter((s) => !supplies.includes(s) && isPastAppointment(s, today));
  const work = rankSlips(args.slips.filter((s) => !supplies.includes(s) && !past.includes(s)), today);
  const pastAppointments = [...past]
    .sort((a, b) => (slipClock(a) ?? '').localeCompare(slipClock(b) ?? '') || a.id.localeCompare(b.id))
    .map((s) => ({ id: s.id, title: slipDisplayTitle(s.title, home.name), date: monthDay(slipClock(s) as string) }));
  const bring = rankSlips(supplies, today).map((s) => `${supplyChipLabel(s, home.name)}${s.priority === 'high' ? ' (high)' : ''}`);
  const allNotes = [...args.notes]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((n) => ({
      id: n.id,
      title: n.title.trim() || 'Untitled note',
      body: n.body?.trim() ? clip(n.body, NOTE_BODY_MAX) : null,
      opened: monthDay(n.created_at.slice(0, 10)),
    }));
  const notes = allNotes.slice(0, MAX_NOTES);

  let spent = COST.header + lines(headline, HEADLINE_CHARS_PER_LINE) * COST.headlineLine;
  if (notes.length) {
    spent += COST.section;
    for (const n of notes) spent += COST.note + lines(n.body, DETAIL_CHARS_PER_LINE) * COST.noteBodyLine;
  }
  if (bring.length) spent += COST.section + lines(bring.join(', '), BRING_CHARS_PER_LINE) * COST.bringLine;
  if (pastAppointments.length) spent += COST.section + pastAppointments.length * COST.pastLine;
  if (work.length) spent += COST.section;

  const rows: BriefRow[] = [];
  for (const [i, s] of work.entries()) {
    const detail = i < DETAIL_ROWS ? slipDetailLine(s, home.name, 150) : null;
    const cost = COST.row + lines(detail, DETAIL_CHARS_PER_LINE) * COST.detailLine;
    // Always list the first few, whatever the estimate says; past them,
    // stop where the "N more" line would no longer fit.
    const left = work.length - i - 1;
    if (i >= 5 && spent + cost + (left ? COST.more : 0) > PAGE_BUDGET_PX) break;
    spent += cost;
    const lane = slipLane(s);
    rows.push({
      id: s.id,
      number: i + 1,
      title: slipDisplayTitle(s.title, home.name),
      detail,
      priority: s.priority === 'high' || s.priority === 'low' ? s.priority : 'normal',
      lane,
      laneLabel: LANE_LABELS[lane],
      meta: rowMeta(s, today),
    });
  }
  return {
    home,
    headline,
    rows,
    moreRows: work.length - rows.length,
    bring,
    pastAppointments,
    notes,
    moreNotes: allNotes.length - notes.length,
    checkIns: args.checkIns,
    highCount: args.slips.filter((s) => s.priority === 'high').length,
    openCount: args.slips.length,
  };
}

/** The estimated printed height of a built page, for the test that holds
 *  every page inside its budget. */
export function pageCost(p: HomePage): number {
  let spent = COST.header + lines(p.headline, HEADLINE_CHARS_PER_LINE) * COST.headlineLine;
  if (p.notes.length) {
    spent += COST.section;
    for (const n of p.notes) spent += COST.note + lines(n.body, DETAIL_CHARS_PER_LINE) * COST.noteBodyLine;
  }
  if (p.bring.length) spent += COST.section + lines(p.bring.join(', '), BRING_CHARS_PER_LINE) * COST.bringLine;
  if (p.pastAppointments.length) spent += COST.section + p.pastAppointments.length * COST.pastLine;
  if (p.rows.length) spent += COST.section;
  for (const r of p.rows) spent += COST.row + lines(r.detail, DETAIL_CHARS_PER_LINE) * COST.detailLine;
  if (p.moreRows) spent += COST.more;
  return spent;
}

/** Homes in the order a binder is read: by street, the house number aside,
 *  so "17 Beach" files under B and a unit sits beside its house. */
export function compareHomeNames(a: string, b: string): number {
  const street = (n: string) => n.replace(/^\s*\d+[a-z]?\s+/i, '').toLowerCase();
  return street(a).localeCompare(street(b)) || a.localeCompare(b);
}

export type WeeklyBrief = {
  today: string;
  window: { from: string; to: string };
  scorecard: ScorecardTile[] | null;
  days: BriefDay[];
  /** Page two: what guests told us in the week before the send. */
  feedback: FeedbackPage;
  /** Homes with a check-in this week first, in arrival order; then the rest by street. */
  pages: HomePage[];
  /** How many of `pages`, from the front, are homes with a check-in this week. */
  arrivingPages: number;
  /** Active homes with no open work and no flagged issue: named on page one, no page. */
  quietHomes: string[];
};

/**
 * The whole brief. A home earns a page when it has open work or an issue
 * flagged at the house; the rest are named in one line on page one.
 */
export function buildWeeklyBrief(args: {
  today: string;
  scorecard: ScorecardTile[] | null;
  homes: BriefHome[];
  slips: BriefSlip[];
  notes: BriefNote[];
  arrivals: BriefStay[];
  departures: BriefStay[];
  headlines: Record<string, string>;
  /** Reviews that landed in the week before the send (feedbackWindow); null when the read failed. */
  reviews?: BriefReview[] | null;
}): WeeklyBrief {
  const { today } = args;
  const homes = [...args.homes].sort((a, b) => compareHomeNames(a.name, b.name));
  const byId = new Map(homes.map((h) => [h.id, h]));
  const days = groupCheckIns({ today, arrivals: args.arrivals, departures: args.departures, homes: byId });
  const pages: HomePage[] = [];
  const quietHomes: string[] = [];
  for (const home of homes) {
    const slips = args.slips.filter((s) => s.property_id === home.id);
    const notes = args.notes.filter((n) => n.property_id === home.id);
    if (slips.length === 0 && notes.length === 0) {
      quietHomes.push(home.name);
      continue;
    }
    pages.push(
      buildHomePage({
        home,
        slips,
        notes,
        headline: args.headlines[home.id] ?? null,
        checkIns: days.flatMap((d) => d.checkIns.filter((c) => c.propertyId === home.id)),
        today,
      }),
    );
  }
  // Section one: the homes a guest arrives at this week, in the order they
  // arrive (street breaks a tie). Section two: the rest, by street. The
  // sort is stable, so street order holds inside the second section.
  const firstArrival = (p: HomePage) => p.checkIns.map((c) => c.date).sort()[0] ?? null;
  pages.sort((a, b) => {
    const fa = firstArrival(a);
    const fb = firstArrival(b);
    if (fa && fb) return fa.localeCompare(fb) || compareHomeNames(a.home.name, b.home.name);
    if (fa) return -1;
    if (fb) return 1;
    return 0;
  });
  const arrivingPages = pages.filter((p) => p.checkIns.length > 0).length;
  const fw = feedbackWindow(today);
  const feedback = buildFeedbackPage({ ...fw, reviews: args.reviews === undefined ? [] : args.reviews, homes: byId });
  return { today, window: briefWindow(today), scorecard: args.scorecard, days, feedback, pages, arrivingPages, quietHomes };
}

/** "Helm weekly · Tue, Nov 10". */
export function briefSubject(today: string): string {
  return `Helm weekly · ${shortDay(today)}`;
}

/** "Helm weekly 2026-11-10.pdf". */
export function briefFilename(today: string): string {
  return `Helm weekly ${today}.pdf`;
}

/** The send gate: the cron fires at 10:00 and 11:00 UTC on Tuesdays, and
 *  only the run that lands at 6 AM Eastern sends, whichever side of daylight
 *  saving the day is on. */
export function isSendHour(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  return weekday === 'Tue' && hour === 6;
}
