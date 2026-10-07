/**
 * Pure view model for the two Channels calendars: the fleet multi-calendar
 * (one row per home, one column per night) and the per-property month grid
 * (seven columns, one cell per night).
 *
 * Everything here is arithmetic on ISO dates and plain rows so node:test can
 * load it (src/lib/__tests__/calendar-model.test.ts) and so the client
 * components that draw the grids never import a server module:
 *
 *   buildMonthGrid   the 7-column month with its leading and trailing
 *                    padding cells from the neighbouring months
 *   barSegments      booking bars clipped to a window, with the flags that
 *                    say a stay continues past either edge
 *   splitByRow       a linear segment cut at the grid's row boundaries
 *   cellPrice        what a vacant night is priced at and WHO set it: Helm's
 *                    rate plan on a helm-run home, the Guesty mirror on a
 *                    guesty-run one (which is what PriceLabs / Guesty set),
 *                    and 'none' when neither knows
 *   freshnessOf      fresh / aging / stale / never for a feed import and for
 *                    the OTA's pull of Helm's export, the two dots the
 *                    coverage grid shows per cell
 *   sourceGlyph      one glyph per bookings.source so a row says where the
 *                    stay came from at a glance
 *   unsellableReason why a vacant night cannot be sold (past, closed, off
 *                    season, advance notice, booking window)
 *
 * Dates are YYYY-MM-DD; a stay is [check_in, check_out). Relative imports
 * only, and only from pure modules.
 */

import {
  resolveMinNights,
  resolveNightlyCents,
  zonedTimeToMs,
  type RateDayRow,
  type RatePlanRow,
} from './rate-plan.ts';
import { nightsBetween, shiftIsoDay } from './sca-quotes-types.ts';

// ── Months ──────────────────────────────────────────────────────────────────

export type MonthCell = {
  /** YYYY-MM-DD */
  date: string;
  dayOfMonth: number;
  /** 0 = Sunday .. 6 = Saturday */
  weekday: number;
  /** false for the padding cells that belong to the previous / next month. */
  inMonth: boolean;
};

export type MonthGrid = {
  year: number;
  /** 1..12 */
  month: number;
  /** "September 2026" */
  label: string;
  /** First and last day OF THE MONTH (not of the padded grid). */
  start: string;
  end: string;
  /** First and last day of the padded grid (always whole weeks, Sunday first). */
  gridStart: string;
  gridEnd: string;
  cells: MonthCell[];
  /** cells in rows of 7 */
  weeks: MonthCell[][];
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Days in a month, proleptic Gregorian. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** UTC weekday of an ISO date, 0 = Sunday. */
export function weekdayOf(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay();
}

/**
 * The month as a Sunday-first grid of whole weeks. A 31-day month starting on
 * a Saturday needs six rows; February 2026 (starts Sunday, 28 days) needs
 * four. Padding cells carry inMonth: false so the grid can dim them.
 */
export function buildMonthGrid(year: number, month: number): MonthGrid {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`buildMonthGrid: invalid month ${year}-${month}`);
  }
  const start = `${year}-${pad2(month)}-01`;
  const count = daysInMonth(year, month);
  const end = `${year}-${pad2(month)}-${pad2(count)}`;
  const gridStart = shiftIsoDay(start, -weekdayOf(start));
  const gridEnd = shiftIsoDay(end, 6 - weekdayOf(end));

  const cells: MonthCell[] = [];
  for (let d = gridStart; d <= gridEnd && cells.length < 42; d = shiftIsoDay(d, 1)) {
    cells.push({
      date: d,
      dayOfMonth: Number(d.slice(8, 10)),
      weekday: weekdayOf(d),
      inMonth: d >= start && d <= end,
    });
  }
  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return {
    year,
    month,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    start,
    end,
    gridStart,
    gridEnd,
    cells,
    weeks,
  };
}

/** "YYYY-MM" -> {year, month}, or null when malformed. */
export function parseMonthParam(value: string | null | undefined): { year: number; month: number } | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || year < 1970 || year > 2200) return null;
  return { year, month };
}

export function monthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

/** The month `delta` months away (negative allowed). */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12 + 12) % 12 + 1 };
}

/** The month an ISO date falls in. */
export function monthOf(iso: string): { year: number; month: number } {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

/** Every date in [start, end] inclusive, bounded. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start.slice(0, 10); d <= end.slice(0, 10) && out.length < 3660; d = shiftIsoDay(d, 1)) out.push(d);
  return out;
}

// ── Bars ────────────────────────────────────────────────────────────────────

/** The slice of a bookings row a bar needs. */
export type BarBooking = {
  id: string;
  property_id?: string;
  status: string;
  channel: string;
  source?: string | null;
  check_in: string;
  check_out: string;
  guest_name?: string | null;
  external_confirmation_code?: string | null;
  hold_kind?: string | null;
  notes?: string | null;
  created_by?: string | null;
  duplicate_of?: string | null;
};

export type BarSegment<T extends BarBooking = BarBooking> = {
  booking: T;
  /** Column index of the first night drawn, from range.start. */
  startIdx: number;
  /** Exclusive column index one past the last night drawn. */
  endIdx: number;
  /** Nights drawn in this window. */
  nights: number;
  /** The stay checks in before the window: draw the bar flush left. */
  startsBefore: boolean;
  /** The stay checks out after the window: draw the bar flush right. */
  endsAfter: boolean;
};

export type DateWindow = { start: string; end: string };

/** Statuses that occupy nights on a calendar. Inquiries and pendings hold nothing. */
export const DRAWN_STATUSES: ReadonlySet<string> = new Set(['confirmed', 'completed', 'block']);

/**
 * Bars for the bookings that touch [range.start, range.end] (inclusive
 * dates). Cancelled, inquiry and pending rows never draw; neither does a
 * duplicate (an echo of another row) or a stay with no nights. Output is
 * ordered by check-in, then check-out, then id, so a render is stable.
 */
export function barSegments<T extends BarBooking>(bookings: readonly T[], range: DateWindow): BarSegment<T>[] {
  const start = range.start.slice(0, 10);
  const end = range.end.slice(0, 10);
  const endExclusive = shiftIsoDay(end, 1);
  const out: BarSegment<T>[] = [];
  for (const b of bookings) {
    if (b.duplicate_of) continue;
    if (!DRAWN_STATUSES.has(String(b.status ?? '').toLowerCase())) continue;
    const ci = b.check_in.slice(0, 10);
    const co = b.check_out.slice(0, 10);
    if (co <= ci) continue;
    if (co <= start || ci >= endExclusive) continue;
    const clippedStart = ci < start ? start : ci;
    const clippedEnd = co > endExclusive ? endExclusive : co;
    const startIdx = nightsBetween(start, clippedStart);
    const endIdx = nightsBetween(start, clippedEnd);
    if (endIdx <= startIdx) continue;
    out.push({
      booking: b,
      startIdx,
      endIdx,
      nights: endIdx - startIdx,
      startsBefore: ci < start,
      endsAfter: co > endExclusive,
    });
  }
  return out.sort(
    (a, b) =>
      a.booking.check_in.localeCompare(b.booking.check_in) ||
      a.booking.check_out.localeCompare(b.booking.check_out) ||
      a.booking.id.localeCompare(b.booking.id),
  );
}

export type RowPiece<T extends BarBooking = BarBooking> = {
  segment: BarSegment<T>;
  /** Grid row this piece sits on. */
  row: number;
  /** Column within the row, 0-based. */
  col: number;
  /** Columns spanned within the row. */
  span: number;
  /** This piece continues from the previous row. */
  continuesFromPrevious: boolean;
  /** This piece continues onto the next row. */
  continuesToNext: boolean;
};

/** Cut a linear segment at row boundaries of a `cols`-wide grid. */
export function splitByRow<T extends BarBooking>(segment: BarSegment<T>, cols = 7): RowPiece<T>[] {
  const pieces: RowPiece<T>[] = [];
  let idx = segment.startIdx;
  while (idx < segment.endIdx) {
    const row = Math.floor(idx / cols);
    const rowEnd = (row + 1) * cols;
    const pieceEnd = Math.min(rowEnd, segment.endIdx);
    pieces.push({
      segment,
      row,
      col: idx - row * cols,
      span: pieceEnd - idx,
      continuesFromPrevious: idx !== segment.startIdx,
      continuesToNext: pieceEnd !== segment.endIdx,
    });
    idx = pieceEnd;
  }
  return pieces;
}

/** The text on a bar: the guest's name when a source gave one, else the code, else the channel. */
export function barLabel(b: BarBooking, channelLabel: (channel: string) => string): string {
  if (String(b.status).toLowerCase() === 'block') {
    const kind = String(b.hold_kind ?? '').toLowerCase();
    const head = kind === 'owner' ? 'Owner' : kind === 'maintenance' ? 'Maintenance' : kind === 'ota' ? 'Channel block' : 'Block';
    return b.notes ? `${head}: ${b.notes}` : head;
  }
  if (b.guest_name && b.guest_name.trim()) return b.guest_name.trim();
  if (b.external_confirmation_code && b.external_confirmation_code.trim()) return b.external_confirmation_code.trim();
  return channelLabel(b.channel);
}

// ── Prices ──────────────────────────────────────────────────────────────────

export type PriceSource = 'helm' | 'guesty_mirror' | 'none';

/** The slice of a property_calendar_days row the price cell reads. */
export type MirrorDayLite = {
  status?: string | null;
  /** Dollars, as calendar-days.ts stores it. */
  price?: number | null;
  min_nights?: number | null;
  cta?: boolean | null;
  ctd?: boolean | null;
  block_type?: string | null;
  block_note?: string | null;
  block_reason?: string | null;
  block_created_by?: string | null;
};

export type CellPriceInput = {
  /** The night being priced; needed for the weekend rule when no override exists. */
  date?: string;
  rateDay?: RateDayRow | null;
  plan?: RatePlanRow | null;
  mirrorDay?: MirrorDayLite | null;
  calendarAuthority: string | null | undefined;
};

export type CellPrice = {
  cents: number | null;
  source: PriceSource;
  minNights: number | null;
  cta: boolean;
  ctd: boolean;
  closed: boolean;
};

/**
 * Who prices this night. A helm-run home reads its own plan (override wins,
 * then weekend, then base); it never falls back to the mirror, because after
 * the flip the mirror IS Helm's own output and a missing plan should read as
 * "no price yet", not as Guesty's stale number. A guesty-run home reads the
 * mirror, which carries whatever Guesty or PriceLabs last pushed.
 */
export function cellPrice(input: CellPriceInput): CellPrice {
  const helmRun = input.calendarAuthority === 'helm';
  const day = input.rateDay ?? null;
  if (helmRun) {
    if (!input.plan) {
      return { cents: null, source: 'none', minNights: day?.min_nights ?? null, cta: !!day?.cta, ctd: !!day?.ctd, closed: !!day?.closed };
    }
    const date = input.date ?? day?.date ?? '1970-01-01';
    return {
      cents: resolveNightlyCents(input.plan, day, date),
      source: 'helm',
      minNights: resolveMinNights(input.plan, day),
      cta: !!day?.cta,
      ctd: !!day?.ctd,
      closed: !!day?.closed,
    };
  }
  const m = input.mirrorDay ?? null;
  if (!m || m.price == null || !Number.isFinite(Number(m.price))) {
    return { cents: null, source: 'none', minNights: m?.min_nights ?? null, cta: !!m?.cta, ctd: !!m?.ctd, closed: false };
  }
  return {
    cents: Math.round(Number(m.price) * 100),
    source: 'guesty_mirror',
    minNights: m.min_nights ?? null,
    cta: !!m.cta,
    ctd: !!m.ctd,
    closed: false,
  };
}

export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  helm: 'Set in Helm',
  guesty_mirror: 'Set in Guesty / PriceLabs',
  none: 'No price',
};

/** "$350" for 35000; whole dollars, because a calendar cell has no room for cents. */
export function fmtCellPrice(cents: number | null): string {
  if (cents == null) return '';
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString('en-US')}`;
}

// ── Freshness ───────────────────────────────────────────────────────────────

export type Freshness = 'fresh' | 'aging' | 'stale' | 'never';

export type FreshnessThresholds = { freshHours: number; agingHours: number };

/**
 * Helm imports every feed on the 30-minute cron, so an import older than two
 * hours means the cron or the feed is failing (the cutover preflight uses the
 * same 2h line).
 */
export const IMPORT_THRESHOLDS: FreshnessThresholds = { freshHours: 2, agingHours: 6 };

/**
 * Airbnb pulls an imported calendar roughly every three hours; VRBO and
 * Booking.com are similar. The preflight wants a pull within 24h; past that
 * the OTA has been reading a stale calendar for a day, which is the
 * double-booking window.
 */
export const PULL_THRESHOLDS: FreshnessThresholds = { freshHours: 6, agingHours: 24 };

const FRESHNESS_RANK: Record<Freshness, number> = { fresh: 0, aging: 1, stale: 2, never: 3 };

/** One timestamp against one set of thresholds. */
export function stampFreshness(
  iso: string | null | undefined,
  now: Date | number,
  thresholds: FreshnessThresholds,
): Freshness {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'never';
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const ageHours = Math.max(0, nowMs - t) / 3_600_000;
  if (ageHours <= thresholds.freshHours) return 'fresh';
  if (ageHours <= thresholds.agingHours) return 'aging';
  return 'stale';
}

export function importFreshness(iso: string | null | undefined, now: Date | number = Date.now()): Freshness {
  return stampFreshness(iso, now, IMPORT_THRESHOLDS);
}

export function pullFreshness(iso: string | null | undefined, now: Date | number = Date.now()): Freshness {
  return stampFreshness(iso, now, PULL_THRESHOLDS);
}

export type FreshnessInput = {
  /** channel_listings.last_imported_at; null = never imported. */
  lastImportedAt?: string | null;
  /**
   * The OTA's last pull of Helm's export (ical_export_pulls.pulled_at). Pass
   * null for "expected but never happened" (a helm-run home) and leave the
   * key undefined when a pull is not expected (a guesty-run home, where the
   * OTAs read Guesty's calendar, not Helm's).
   */
  lastPulledAt?: string | null;
  now?: Date | number;
};

/**
 * The worst of the stamps that were provided. An undefined stamp is not
 * applicable and is ignored; a null one counts as never. Nothing provided at
 * all reads as never.
 */
export function freshnessOf(input: FreshnessInput): Freshness {
  const now = input.now ?? Date.now();
  const states: Freshness[] = [];
  if (input.lastImportedAt !== undefined) states.push(importFreshness(input.lastImportedAt, now));
  if (input.lastPulledAt !== undefined) states.push(pullFreshness(input.lastPulledAt, now));
  if (states.length === 0) return 'never';
  return states.reduce((worst, s) => (FRESHNESS_RANK[s] > FRESHNESS_RANK[worst] ? s : worst), 'fresh');
}

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  fresh: 'fresh',
  aging: 'aging',
  stale: 'stale',
  never: 'never',
};

/** The dot colour per state, as CSS variables from the Helm palette. */
export const FRESHNESS_COLOR: Record<Freshness, string> = {
  fresh: 'var(--positive)',
  aging: 'var(--signal)',
  stale: 'var(--negative)',
  never: 'var(--rule)',
};

export const FRESHNESS_LEGEND: ReadonlyArray<{ key: Freshness; label: string; color: string }> = (
  ['fresh', 'aging', 'stale', 'never'] as Freshness[]
).map((k) => ({ key: k, label: FRESHNESS_LABEL[k], color: FRESHNESS_COLOR[k] }));

/**
 * The bar tint per channel, the same muted mapping channel-style.ts uses on
 * the turnover list and the occupancy calendar: rust for Airbnb, blue for
 * VRBO, navy for Booking.com, green for our own direct and manual stays,
 * grey for a hold.
 */
export function channelColor(channel: string, isHold: boolean): string {
  if (isHold) return 'var(--ink-4)';
  switch (String(channel ?? '').toLowerCase()) {
    case 'airbnb':
      return 'var(--negative)';
    case 'vrbo':
      return 'var(--tide)';
    case 'booking_com':
      return 'var(--tide-deep)';
    case 'direct':
    case 'manual':
      return 'var(--positive)';
    default:
      return 'var(--ink-3)';
  }
}

/** "2h ago", "3d ago", "never". Whole units; UTC math. */
export function relativeAge(iso: string | null | undefined, now: Date | number = Date.now()): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'never';
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const m = Math.round((nowMs - t) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

// ── Source glyphs ───────────────────────────────────────────────────────────

export type SourceGlyph = {
  key: 'ical' | 'manual' | 'direct' | 'email' | 'legacy' | 'block' | 'unknown';
  /** A single character for tight columns. */
  glyph: string;
  label: string;
};

const SOURCE_GLYPHS: Record<SourceGlyph['key'], SourceGlyph> = {
  ical: { key: 'ical', glyph: '↻', label: 'iCal feed' },
  manual: { key: 'manual', glyph: '✎', label: 'Entered in Helm' },
  direct: { key: 'direct', glyph: '★', label: 'Direct booking' },
  email: { key: 'email', glyph: '✉', label: 'Parsed from email' },
  legacy: { key: 'legacy', glyph: 'G', label: 'Guesty history' },
  block: { key: 'block', glyph: '▦', label: 'Block' },
  unknown: { key: 'unknown', glyph: '·', label: 'Unknown source' },
};

/** The provenance glyph for a row: a block is a block whatever wrote it. */
export function sourceGlyph(b: Pick<BarBooking, 'source' | 'status'>): SourceGlyph {
  if (String(b.status ?? '').toLowerCase() === 'block') return SOURCE_GLYPHS.block;
  switch (String(b.source ?? '').toLowerCase()) {
    case 'ical_import':
      return SOURCE_GLYPHS.ical;
    case 'manual':
      return SOURCE_GLYPHS.manual;
    case 'direct_booking':
      return SOURCE_GLYPHS.direct;
    case 'email_parse':
      return SOURCE_GLYPHS.email;
    case 'guesty_legacy':
      return SOURCE_GLYPHS.legacy;
    default:
      return SOURCE_GLYPHS.unknown;
  }
}

// ── Authority badge ─────────────────────────────────────────────────────────

export type AuthorityBadge = { kind: 'guesty' | 'shadow' | 'helm'; label: string; detail: string };

/**
 * Guesty: Guesty runs the calendar and Helm has no direct OTA feed for the
 * home. Shadow: Guesty still runs it, but Helm imports at least one OTA feed
 * directly, so the Helm calendar is being populated before the flip. Helm:
 * Helm is authoritative since cutover_at.
 */
export function authorityBadge(
  p: { calendar_authority: string | null | undefined; cutover_at?: string | null },
  hasDirectFeed: boolean,
): AuthorityBadge {
  if (p.calendar_authority === 'helm') {
    const since = p.cutover_at ? p.cutover_at.slice(0, 10) : null;
    return { kind: 'helm', label: since ? `Helm since ${since}` : 'Helm', detail: 'Helm runs this calendar; Guesty passes skip the home.' };
  }
  if (hasDirectFeed) {
    return { kind: 'shadow', label: 'Shadow', detail: 'Guesty runs the calendar; Helm imports the OTA feeds directly so its calendar is populated before the flip.' };
  }
  return { kind: 'guesty', label: 'Guesty', detail: 'Guesty runs the calendar; Helm mirrors it.' };
}

// ── Unsellable nights ───────────────────────────────────────────────────────

export type UnsellableReason = 'past' | 'closed' | 'off_season' | 'advance_notice' | 'booking_window' | 'stay' | 'block';

export const UNSELLABLE_LABEL: Record<UnsellableReason, string> = {
  past: 'Past',
  closed: 'Closed',
  off_season: 'Off season',
  advance_notice: 'Inside advance notice',
  booking_window: 'Beyond booking window',
  stay: 'Booked',
  block: 'Held',
};

export type UnsellableInput = {
  date: string;
  /** Today's ISO date in the property's zone. */
  today: string;
  isStayNight?: boolean;
  isBlockNight?: boolean;
  rateDay?: RateDayRow | null;
  plan?: RatePlanRow | null;
  /** From rental-periods isOpenOn; defaults to open. */
  isOpen?: boolean;
  now?: Date | number;
  timeZone?: string;
};

/**
 * Why a night cannot be sold, or null when it can. Occupancy wins over rules
 * so a booked night reads as booked, not as "closed" too. Advance notice and
 * booking window need a plan; without one only occupancy, closure, season
 * and the past apply.
 */
export function unsellableReason(input: UnsellableInput): UnsellableReason | null {
  if (input.isStayNight) return 'stay';
  if (input.isBlockNight) return 'block';
  if (input.date < input.today) return 'past';
  if (input.rateDay?.closed) return 'closed';
  if (input.isOpen === false) return 'off_season';
  const plan = input.plan ?? null;
  if (plan) {
    const nowMs = input.now == null ? Date.now() : typeof input.now === 'number' ? input.now : input.now.getTime();
    const noticeHours = Math.max(0, Number(plan.advance_notice_hours) || 0);
    const checkinMs = zonedTimeToMs(input.date, plan.checkin_time ?? '16:00', input.timeZone ?? 'America/New_York');
    if (checkinMs - nowMs < noticeHours * 3_600_000) return 'advance_notice';
    const windowDays = Number(plan.booking_window_days) || 0;
    if (windowDays > 0 && nightsBetween(input.today, input.date) > windowDays) return 'booking_window';
  }
  return null;
}

// ── The wire shapes the client grids draw ───────────────────────────────────
// Built on the server from the loaded rows, serialised to the two client
// components (MultiCalendarGrid, PropertyMonthCalendar). Plain data only.

export type CalendarCellVM = {
  date: string;
  priceCents: number | null;
  priceSource: PriceSource;
  minNights: number | null;
  cta: boolean;
  ctd: boolean;
  closed: boolean;
  /** Why the night cannot be sold; null when it can. */
  reason: UnsellableReason | null;
  /** A human line for the reason (a block's note, the mirror's reason). */
  reasonDetail: string | null;
  /** The rate day's operator note, when one exists. */
  note: string | null;
  /** Inquiries and pending requests that name this night (they hold nothing). */
  requests: number;
};

export type CalendarBarVM = {
  id: string;
  status: string;
  channel: string;
  source: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  label: string;
  startIdx: number;
  endIdx: number;
  startsBefore: boolean;
  endsAfter: boolean;
  isHold: boolean;
  hold_kind: string | null;
  notes: string | null;
  created_by: string | null;
  guest_name: string | null;
  code: string | null;
  glyph: string;
  glyphLabel: string;
};

export type BuildCellsInput = {
  dates: readonly string[];
  bookings: readonly BarBooking[];
  calendarAuthority: string | null | undefined;
  plan?: RatePlanRow | null;
  rateDays?: ReadonlyMap<string, RateDayRow>;
  /** property_calendar_days rows keyed by date (the Guesty mirror). */
  mirror?: ReadonlyMap<string, MirrorDayLite>;
  /** From rental-periods isOpenOn; omit for open year-round. */
  isOpen?: (date: string) => boolean;
  today: string;
  now?: Date | number;
  timeZone?: string;
};

const MIRROR_BLOCK_LABEL: Record<string, string> = {
  o: 'Owner stay',
  m: 'Blocked',
  sr: 'Off season',
  abl: 'Blocked',
  pt: 'Blocked',
  an: 'Advance notice',
  bw: 'Booking window',
};

/** One cell per date with price, rules, occupancy and the unsellable reason. */
export function buildCalendarCells(input: BuildCellsInput): CalendarCellVM[] {
  const stayNights = new Set<string>();
  const blockNights = new Map<string, BarBooking>();
  const requestNights = new Map<string, number>();
  for (const b of input.bookings) {
    if (b.duplicate_of) continue;
    const status = String(b.status ?? '').toLowerCase();
    if (b.check_out <= b.check_in) continue;
    const nights = dateRange(b.check_in, shiftIsoDay(b.check_out, -1));
    if (status === 'confirmed' || status === 'completed') {
      for (const n of nights) stayNights.add(n);
    } else if (status === 'block') {
      for (const n of nights) if (!blockNights.has(n)) blockNights.set(n, b);
    } else if (status === 'inquiry' || status === 'pending') {
      for (const n of nights) requestNights.set(n, (requestNights.get(n) ?? 0) + 1);
    }
  }

  const helmRun = input.calendarAuthority === 'helm';
  return input.dates.map((date) => {
    const rateDay = input.rateDays?.get(date) ?? null;
    const mirrorDay = input.mirror?.get(date) ?? null;
    const price = cellPrice({ date, rateDay, plan: input.plan ?? null, mirrorDay, calendarAuthority: input.calendarAuthority });
    const block = blockNights.get(date);
    let reason = unsellableReason({
      date,
      today: input.today,
      isStayNight: stayNights.has(date),
      isBlockNight: !!block,
      rateDay: helmRun ? rateDay : null,
      plan: helmRun ? input.plan ?? null : null,
      isOpen: helmRun ? (input.isOpen ? input.isOpen(date) : true) : true,
      now: input.now,
      timeZone: input.timeZone,
    });
    let reasonDetail: string | null = null;
    if (reason === 'block' && block) {
      reasonDetail = barLabel(block, (c) => c);
    } else if (reason === 'closed') {
      reasonDetail = rateDay?.note ?? 'Closed in Helm';
    } else if (!helmRun && reason == null && mirrorDay) {
      // Guesty runs it: the mirror carries Guesty's own holds and rule artifacts.
      const status = String(mirrorDay.status ?? '').toLowerCase();
      if (status === 'booked') {
        reason = 'stay';
        reasonDetail = 'Booked in Guesty';
      } else if (status === 'unavailable') {
        const t = String(mirrorDay.block_type ?? '').toLowerCase();
        if (t === 'sr') reason = 'off_season';
        else if (t === 'an') reason = 'advance_notice';
        else if (t === 'bw') reason = 'booking_window';
        else reason = 'block';
        reasonDetail = mirrorDay.block_note ?? mirrorDay.block_reason ?? MIRROR_BLOCK_LABEL[t] ?? 'Unavailable in Guesty';
      }
    }
    return {
      date,
      priceCents: price.cents,
      priceSource: price.source,
      minNights: price.minNights,
      cta: price.cta,
      ctd: price.ctd,
      closed: price.closed,
      reason,
      reasonDetail,
      note: rateDay?.note ?? null,
      requests: requestNights.get(date) ?? 0,
    };
  });
}

/** Bars for the window, labelled and flagged, ready to draw. */
export function buildCalendarBars(
  bookings: readonly BarBooking[],
  range: DateWindow,
  channelLabel: (channel: string) => string,
): CalendarBarVM[] {
  return barSegments(bookings, range).map((s) => {
    const b = s.booking;
    const g = sourceGlyph(b);
    return {
      id: b.id,
      status: String(b.status),
      channel: String(b.channel),
      source: b.source ?? null,
      check_in: b.check_in.slice(0, 10),
      check_out: b.check_out.slice(0, 10),
      nights: nightsBetween(b.check_in.slice(0, 10), b.check_out.slice(0, 10)),
      label: barLabel(b, channelLabel),
      startIdx: s.startIdx,
      endIdx: s.endIdx,
      startsBefore: s.startsBefore,
      endsAfter: s.endsAfter,
      isHold: String(b.status).toLowerCase() === 'block',
      hold_kind: b.hold_kind ?? null,
      notes: b.notes ?? null,
      created_by: b.created_by ?? null,
      guest_name: b.guest_name ?? null,
      code: b.external_confirmation_code ?? null,
      glyph: g.glyph,
      glyphLabel: g.label,
    };
  });
}
