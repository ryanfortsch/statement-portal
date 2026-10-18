/**
 * Reading the day out of a trade vendor's text: "Tuesday 10/27 at 1 works".
 *
 * Deterministic and import-free, so `npm test` covers every case
 * (vendor-visit-dates.test.ts). The rule that shapes all of it: an unclear
 * date becomes a question for the operator, never a guess. A wrong guess
 * holds the wrong night and tells the slips the wrong day; a question costs
 * one tap on the card. So the reader resolves a day only when the text, the
 * calendar and the windows we offered agree on exactly one, and otherwise
 * says why it could not and which days it could mean.
 *
 * Every date is a plain YYYY-MM-DD in Eastern time. "Today" is the message's
 * own Eastern day (etDateOf), never the server's clock, so a replayed event
 * reads the way it did when it arrived.
 *
 * See docs/vendor-visit-holds.md for the table of what reads as what.
 */

export type Ymd = string;

/** A stretch of days we offered the vendor, inclusive. */
export type OfferWindow = { start: Ymd; end: Ymd };

export type VisitTime = {
  /** 24-hour 'HH:MM' the vendor arrives or starts, when said. */
  start: string | null;
  /** 24-hour 'HH:MM' the vendor is done by, when said ("by 3"). */
  end: string | null;
  /** The time in operator words: "at 1 PM", "after 11 AM", "morning". */
  label: string | null;
};

export type VisitDateRead =
  /** One day, or a short run of days (end > start for a multi-day visit). */
  | { kind: 'date'; start: Ymd; end: Ymd; time: VisitTime; basis: string }
  /** A scheduling message whose day is not certain: the card asks. The
   *  reason stands on its own after "Which day?" on the card. */
  | { kind: 'ask'; reason: string; candidates: Ymd[]; time: VisitTime; dateless: boolean }
  /** Not a visit: no day and no scheduling words, every day named was
   *  turned down, or every day named has passed. */
  | { kind: 'none'; why: 'no_date' | 'declined' | 'past' };

export type ReadContext = {
  /** The message's Eastern day. */
  today: Ymd;
  /** The windows our latest offer to this vendor named, if any. */
  windows?: readonly OfferWindow[];
  /** We texted this vendor an offer recently (even one with no windows). */
  hasOffer?: boolean;
};

/** The longest run a single confirmation may hold without a question. */
export const MAX_VISIT_DAYS = 7;
/** Further out than this is a question, not a hold. */
const MAX_DAYS_AHEAD = 180;

// ─── date arithmetic on YYYY-MM-DD ───────────────────────────────────────

function parseYmd(d: Ymd): Date {
  return new Date(`${d}T12:00:00Z`);
}

function toYmd(d: Date): Ymd {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Ymd, n: number): Ymd {
  const t = parseYmd(d);
  t.setUTCDate(t.getUTCDate() + n);
  return toYmd(t);
}

/** 0 = Sunday. */
export function weekdayOf(d: Ymd): number {
  return parseYmd(d).getUTCDay();
}

export function daysBetween(a: Ymd, b: Ymd): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86_400_000);
}

function validYmd(y: number, m: number, d: number): Ymd | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return toYmd(t);
}

/** The Eastern calendar day of an instant. */
export function etDateOf(iso: string | Date): Ymd {
  const t = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(t);
}

export function inWindows(d: Ymd, windows: readonly OfferWindow[]): boolean {
  return windows.some((w) => w.start <= d && d <= w.end);
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "Tue Oct 27". */
export function fmtDay(d: Ymd): string {
  return SHORT_FMT.format(parseYmd(d)).replace(',', '');
}

/** "1 PM", "11:30 AM", "noon". */
export function fmtClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (h === 12 && m === 0) return 'noon';
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

// ─── mentions ────────────────────────────────────────────────────────────

type Mention = {
  kind: 'date' | 'weekday' | 'relative' | 'vague';
  from: number;
  to: number;
  raw: string;
  /** A resolved calendar date (kind 'date' and 'relative'). */
  date?: Ymd;
  /** The last day of a shorthand range ("10/27-28", "Oct 27-29"). */
  end?: Ymd;
  /** Weekday named for this mention: the whole mention for kind 'weekday',
   *  the check attached to a date for kind 'date' ("Tuesday 10/27"). */
  weekday?: number;
  mod?: 'this' | 'next' | 'last' | null;
  /** Why this mention cannot be used as written. */
  problem?: string;
  negated?: boolean;
  /** A bare "the 27th": a date only in a message about scheduling. */
  soft?: boolean;
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const WEEKDAY_RE = 'sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?';

/** A day the vendor names with no year: this year's, unless that is more
 *  than two months gone, in which case next year's (a January date written
 *  in October). A date a few weeks past stays past, and reads as past. */
function yearFor(today: Ymd, m: number, d: number): Ymd | null {
  const y = Number(today.slice(0, 4));
  const thisYear = validYmd(y, m, d);
  if (thisYear && daysBetween(thisYear, today) <= 60) return thisYear;
  return validYmd(y + 1, m, d) ?? thisYear;
}

function explicitYear(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return raw.length === 2 ? 2000 + n : n;
}

/** Overlap with an already-claimed span. */
function overlaps(spans: Mention[], from: number, to: number): boolean {
  return spans.some((s) => from < s.to && s.from < to);
}

function extractMentions(text: string, today: Ymd): Mention[] {
  const out: Mention[] = [];

  // 1. Numeric month/day: 10/27, 10/27/26, with "-28" shorthand ranges.
  //    "24/7" (the line's name) fails the month check and is not a date.
  const numeric = /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])(?:\s*[-\u2013\u2014]\s*(\d{1,2})(?![\d/:]|\s*(?:am|pm|a\.m|p\.m)))?/gi;
  for (const m of text.matchAll(numeric)) {
    const after = text.slice((m.index ?? 0) + m[0].length);
    if (/^\s*(?:hrs?|hours?|mins?|minutes?|price|off)\b/i.test(after)) continue;
    const month = Number(m[1]);
    const day = Number(m[2]);
    const y = explicitYear(m[3]);
    const date = y ? validYmd(y, month, day) : yearFor(today, month, day);
    if (!date) continue;
    const mention: Mention = { kind: 'date', from: m.index ?? 0, to: (m.index ?? 0) + m[0].length, raw: m[0], date };
    if (m[4]) {
      const endDay = Number(m[4]);
      const end = validYmd(Number(date.slice(0, 4)), month, endDay);
      if (end && end > date) mention.end = end;
      else mention.problem = `"${m[0].trim()}" does not read as a run of days`;
    }
    out.push(mention);
  }

  // 2. Month names: "Oct 27", "October 27th, 2026", "Oct 27-28".
  const named = new RegExp(
    `\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?(?:\\s*[-\\u2013\\u2014]\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*(?:am|pm|:)))?`,
    'gi',
  );
  for (const m of text.matchAll(named)) {
    const from = m.index ?? 0;
    if (overlaps(out, from, from + m[0].length)) continue;
    // "may" is a verb far more often than a month: only "May 5" with a
    // capital or an ordinal reads as the month.
    if (/^may$/i.test(m[1]) && !/^May$/.test(m[1]) && !/(st|nd|rd|th)\b/i.test(m[0])) continue;
    const month = MONTHS[m[1].toLowerCase().replace(/\.$/, '')] ?? MONTHS[m[1].toLowerCase().slice(0, 3)];
    const day = Number(m[2]);
    const y = explicitYear(m[3]);
    const date = y ? validYmd(y, month, day) : yearFor(today, month, day);
    if (!date) continue;
    const mention: Mention = { kind: 'date', from, to: from + m[0].length, raw: m[0], date };
    if (m[4]) {
      const end = validYmd(Number(date.slice(0, 4)), month, Number(m[4]));
      if (end && end > date) mention.end = end;
      else mention.problem = `"${m[0].trim()}" does not read as a run of days`;
    }
    out.push(mention);
  }

  // 3. "the 27th of October", "27th October".
  const dayFirst = new RegExp(`\\b(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b`, 'gi');
  for (const m of text.matchAll(dayFirst)) {
    const from = m.index ?? 0;
    if (overlaps(out, from, from + m[0].length)) continue;
    const month = MONTHS[m[2].toLowerCase()] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
    const date = yearFor(today, month, Number(m[1]));
    if (!date) continue;
    out.push({ kind: 'date', from, to: from + m[0].length, raw: m[0], date });
  }

  // 4. A bare ordinal: "the 27th". "the 2nd floor toilet" is a floor.
  const ordinal = /\bthe\s+(\d{1,2})(st|nd|rd|th)\b(?!\s+(?:floor|fl|bath|bathroom|bedroom|br|unit|story|storey|level|toilet|time|one|house|apartment|apt|door|stall))/gi;
  for (const m of text.matchAll(ordinal)) {
    const from = m.index ?? 0;
    if (overlaps(out, from, from + m[0].length)) continue;
    const day = Number(m[1]);
    const ty = Number(today.slice(0, 4));
    const tm = Number(today.slice(5, 7));
    const td = Number(today.slice(8, 10));
    const month = day >= td ? tm : tm === 12 ? 1 : tm + 1;
    const year = day >= td ? ty : tm === 12 ? ty + 1 : ty;
    const date = validYmd(year, month, day);
    const mention: Mention = { kind: 'date', from, to: from + m[0].length, raw: m[0], date: date ?? undefined, soft: true };
    if (!date) mention.problem = `"${m[0].trim()}" is not a day next month`;
    out.push(mention);
  }

  // 5. Relative days.
  const relative = /\b(day after tomorrow|today|tonight|tomorrow|tmrw|tmw|tomm?or+ow)\b/gi;
  for (const m of text.matchAll(relative)) {
    const from = m.index ?? 0;
    if (overlaps(out, from, from + m[0].length)) continue;
    const w = m[1].toLowerCase();
    const n = w === 'day after tomorrow' ? 2 : w === 'today' || w === 'tonight' ? 0 : 1;
    out.push({ kind: 'relative', from, to: from + m[0].length, raw: m[0], date: addDays(today, n) });
  }

  // 6. Weekdays, attached to an adjacent date as its check when there is one.
  const weekday = new RegExp(`\\b(?:(this|next|coming|last)\\s+)?(${WEEKDAY_RE})\\b\\.?`, 'gi');
  for (const m of text.matchAll(weekday)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    if (overlaps(out, from, to)) continue;
    const wd = WEEKDAYS[m[2].toLowerCase()];
    if (wd === undefined) continue;
    const dateAfter = out.find((d) => d.kind === 'date' && d.from >= to && /^[\s,.]*$/.test(text.slice(to, d.from)));
    const dateBefore = out.find((d) => d.kind === 'date' && d.to <= from && /^\s*[(,]?\s*$/.test(text.slice(d.to, from)));
    const host = dateAfter ?? dateBefore;
    // "Tue and Wed 10/27-28": the weekday before this one names the run's
    // first day and this one its last.
    const prev = out[out.length - 1];
    if (
      host && host === dateAfter && host.end && host.weekday === undefined &&
      prev?.kind === 'weekday' && !prev.mod &&
      /^\s*(?:and|&|-|\u2013|to|through|thru)\s*$/i.test(text.slice(prev.to, from))
    ) {
      out.pop();
      host.weekday = prev.weekday;
      host.from = prev.from;
      if (weekdayOf(host.end) !== wd) host.problem = `the text says ${WEEKDAY_NAMES[wd]} for ${fmtDay(host.end)}, which is a ${WEEKDAY_NAMES[weekdayOf(host.end)]}`;
      continue;
    }
    if (host && host.weekday === undefined) {
      host.weekday = wd;
      host.from = Math.min(host.from, from);
      host.to = Math.max(host.to, to + (text.slice(to, to + 1) === ')' ? 1 : 0));
      continue;
    }
    // "sun", "sat", "wed" and "mon" are words too ("the sun is out"):
    // lowercase and on their own, they are not days.
    if (/^(sun|sat|wed|mon)$/.test(m[2])) continue;
    const modWord = (m[1] ?? '').toLowerCase();
    out.push({ kind: 'weekday', from, to, raw: m[0], weekday: wd, mod: modWord === 'next' ? 'next' : modWord === 'last' ? 'last' : modWord ? 'this' : null });
  }

  // 7. Vague spans of time: a scheduling answer that names no day.
  const vague = /\b(early next week|later this week|next week|this week|end of (?:the )?week|this weekend|next weekend|the weekend|next month|end of (?:the )?month)\b/gi;
  for (const m of text.matchAll(vague)) {
    const from = m.index ?? 0;
    if (overlaps(out, from, from + m[0].length)) continue;
    out.push({ kind: 'vague', from, to: from + m[0].length, raw: m[0] });
  }

  return out.sort((a, b) => a.from - b.from);
}

// ─── times ───────────────────────────────────────────────────────────────

const AMPM = '(a\\.?m\\.?|p\\.?m\\.?|a|p)';

/** A trade's hour with no am/pm: 7 to 11 is morning, 12 is noon, 1 to 6 is
 *  afternoon. Anything else needs the vendor to say. */
function toHHMM(hRaw: string, mRaw: string | undefined, ap: string | undefined): string | null {
  let h = Number(hRaw);
  const m = mRaw ? Number(mRaw) : 0;
  if (!Number.isInteger(h) || m < 0 || m > 59) return null;
  const mer = (ap ?? '').toLowerCase().replace(/\./g, '');
  if (mer.startsWith('p')) {
    if (h < 1 || h > 12) return null;
    if (h !== 12) h += 12;
  } else if (mer.startsWith('a')) {
    if (h < 1 || h > 12) return null;
    if (h === 12) h = 0;
  } else if (h >= 1 && h <= 6) {
    h += 12;
  } else if (h >= 7 && h <= 12) {
    // as written
  } else if (h >= 13 && h <= 20) {
    // a 24-hour clock
  } else {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const NOT_A_CLOCK = '(?!\\s*(?:\\/|\\d|st\\b|nd\\b|rd\\b|th\\b|days?\\b|hours?\\b|hrs?\\b|mins?\\b|minutes?\\b|weeks?\\b|%|people\\b|guests?\\b|toilets?\\b|bath|units?\\b|x\\b))';

/**
 * The time in a message, with the dates already blanked out of it. The first
 * time phrase in reading order wins; a range ("between 10 and 12") is read
 * before a single time so its halves are not read apart.
 */
export function readVisitTime(text: string): VisitTime {
  const t = text;
  const range = new RegExp(
    `\\b(?:between|from)\\s+(\\d{1,2})(?::(\\d{2}))?\\s*${AMPM}?\\s*(?:and|to|-|\\u2013)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*${AMPM}?\\b`,
    'i',
  ).exec(t);
  if (range) {
    const endAp = range[6];
    const start = toHHMM(range[1], range[2], range[3] ?? (endAp && Number(range[1]) <= Number(range[4]) ? endAp : undefined));
    const end = toHHMM(range[4], range[5], endAp);
    if (start && end) return { start, end, label: `${fmtClock(start)} to ${fmtClock(end)}` };
  }

  const qual = '(at|@|around|about|by|after|before|arrive at|arriving at|start at|starting at|there at|there by)';
  const withMeridiem = new RegExp(`(?:\\b${qual}\\s+)?\\b(\\d{1,2})(?::(\\d{2}))?\\s*${AMPM}\\b`, 'i');
  const withColon = new RegExp(`(?:\\b${qual}\\s+)?\\b(\\d{1,2}):(\\d{2})\\b`, 'i');
  const bare = new RegExp(`\\b${qual}\\s+(\\d{1,2})\\b${NOT_A_CLOCK}`, 'i');
  const hits = [
    { m: withMeridiem.exec(t), h: 2, min: 3, ap: 4 },
    { m: withColon.exec(t), h: 2, min: 3, ap: -1 },
    { m: bare.exec(t), h: 2, min: -1, ap: -1 },
  ].filter((x) => x.m) as Array<{ m: RegExpExecArray; h: number; min: number; ap: number }>;
  hits.sort((a, b) => a.m.index - b.m.index);
  for (const hit of hits) {
    const hhmm = toHHMM(hit.m[hit.h], hit.min > 0 ? hit.m[hit.min] : undefined, hit.ap > 0 ? hit.m[hit.ap] : undefined);
    if (!hhmm) continue;
    const q = (hit.m[1] ?? '').toLowerCase();
    if (q === 'by' || q === 'there by' || q === 'before') return { start: null, end: hhmm, label: `by ${fmtClock(hhmm)}` };
    if (q === 'after') return { start: hhmm, end: null, label: `after ${fmtClock(hhmm)}` };
    if (q === 'around' || q === 'about') return { start: hhmm, end: null, label: `around ${fmtClock(hhmm)}` };
    return { start: hhmm, end: null, label: `at ${fmtClock(hhmm)}` };
  }

  if (/\bnoon\b/i.test(t)) return { start: '12:00', end: null, label: 'at noon' };
  if (/\b(first thing|in the morning|morning|in the am)\b/i.test(t)) return { start: null, end: '12:00', label: 'morning' };
  if (/\bafternoon\b/i.test(t)) return { start: '12:00', end: null, label: 'afternoon' };
  if (/\b(end of (?:the )?day|eod)\b/i.test(t)) return { start: null, end: null, label: 'end of day' };
  return { start: null, end: null, label: null };
}

// ─── clauses, negation, intent ───────────────────────────────────────────

/** A day turned down in its own clause: "can't do Tuesday", "Tuesday is no
 *  good". "No problem" and "no worries" are not refusals. */
const NEGATION = /\b(can[’']?t|cannot|can not|won[’']?t|wont|unable|not (?:able|available|going to|gonna|good|great|possible|free)|(?:does|do|will)n[’']?t work|does not work|do not work|will not work|no good|isn[’']?t good|is not good|busy|out of town|away that|booked solid|booked up|fully booked)\b/i;

/** Words that make a dateless message a scheduling answer. */
const INTENT = /\b(works?|work for me|confirm(?:ed|ing)?|see you|i[’']?ll be (?:there|over|by)|will be (?:there|over|by)|can do|can come|i can|we can|sounds good|perfect|great|ok(?:ay)?|yes|yep|yup|sure|pencil|put me down|plan on|planning on|be there|come by|stop by|swing by|schedule)\b/i;

/** A yes that can stand without a day, after we offered some. Narrower
 *  than INTENT: "ok" and "great" acknowledge, they do not accept. */
const DATELESS_YES = /\b(works?|work for me|confirm(?:ed)?|see you (?:then|there)|i[’']?ll be there|will be there|can do|sounds good|yes|yep|yup|put me down|pencil me in)\b/i;

/** Not an answer yet. */
const DEFERRAL = /\b(let me (?:check|see|look)|get back to you|i[’']?ll (?:check|let you know|see)|will let you know|not sure|checking|i[’']?ll confirm|will confirm)\b/i;

/** A message about a visit that already happened. */
const PAST_TENSE = /\b(was|were|went|came|did|finished|fixed|completed|replaced|yesterday|last)\b/i;

/** Clause boundaries for negation: sentence ends, "but", and commas. */
function clauseAt(text: string, pos: number): string {
  const boundary = /[.!?;\n,]|\bbut\b|\bhowever\b|\binstead\b/gi;
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(boundary)) {
    const i = m.index ?? 0;
    if (i < pos) start = i + m[0].length;
    else {
      end = i;
      break;
    }
  }
  return text.slice(start, end);
}

function blankSpans(text: string, spans: ReadonlyArray<{ from: number; to: number }>): string {
  let out = text;
  for (const s of spans) out = out.slice(0, s.from) + ' '.repeat(s.to - s.from) + out.slice(s.to);
  return out;
}

/** The text between two mentions with any time phrases taken out, to tell
 *  "10/21 after 11 AM to 10/22" (a run) from "10/21; 10/26" (two choices). */
function connectorBetween(text: string, a: Mention, b: Mention): 'range' | 'and' | 'or' | 'other' {
  const gap = text
    .slice(a.to, b.from)
    .toLowerCase()
    .replace(/\b(?:after|by|before|from|at|around|until|til)?\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?(?=\W|$)/g, ' ')
    .replace(/\b(?:noon|morning|afternoon)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(?:-|\u2013|\u2014|to|through|thru|until|till|til)$/.test(gap)) return 'range';
  if (/^(?:and|&|\+|,|, and)$/.test(gap)) return 'and';
  if (/^(?:or|or maybe|\/|, or)$/.test(gap)) return 'or';
  return 'other';
}

// ─── resolving one mention to its candidate days ─────────────────────────

function weekdayCandidates(m: Mention, today: Ymd, windows: readonly OfferWindow[]): Ymd[] {
  const wd = m.weekday as number;
  if (m.mod === 'last') return [addDays(today, -(((weekdayOf(today) - wd + 7) % 7) || 7))];
  const ahead = (wd - weekdayOf(today) + 7) % 7;
  // The coming one (today counts only for "this"), and the one after.
  const first = addDays(today, ahead === 0 && m.mod !== 'this' ? 7 : ahead);
  let candidates = m.mod === 'next' ? [first, addDays(first, 7)] : ahead === 0 && m.mod !== 'this' ? [today, first] : [first];
  if (windows.length > 0) {
    const inWin: Ymd[] = [];
    for (const w of windows) {
      for (let d = w.start; d <= w.end; d = addDays(d, 1)) {
        if (d >= today && weekdayOf(d) === wd) inWin.push(d);
      }
    }
    const both = candidates.filter((c) => inWin.includes(c));
    if (both.length > 0) candidates = both;
    else if (inWin.length > 0) candidates = [...new Set([...candidates, ...inWin])].sort();
  }
  return candidates;
}

type Resolved = { mention: Mention; candidates: Ymd[]; end?: Ymd; problem?: string };

function resolve(m: Mention, ctx: Required<Pick<ReadContext, 'today'>> & { windows: readonly OfferWindow[] }): Resolved {
  if (m.problem) return { mention: m, candidates: [], problem: m.problem };
  if (m.kind === 'weekday') return { mention: m, candidates: weekdayCandidates(m, ctx.today, ctx.windows) };
  const date = m.date as Ymd;
  if (m.kind === 'date' && m.weekday !== undefined && weekdayOf(date) !== m.weekday) {
    // Offer both readings: the date as written, and the nearest day that
    // is the weekday they named.
    const shift = ((m.weekday - weekdayOf(date) + 10) % 7) - 3;
    return {
      mention: m,
      candidates: [date, addDays(date, shift)].sort(),
      problem: `the text says ${WEEKDAY_NAMES[m.weekday]} ${fmtDay(date).replace(/^\w+ /, '')}, but ${fmtDay(date)} is a ${WEEKDAY_NAMES[weekdayOf(date)]}`,
    };
  }
  return { mention: m, candidates: [date], end: m.end };
}

// ─── the reader ──────────────────────────────────────────────────────────

/**
 * What day the vendor means, or why the card has to ask.
 *
 * Order of reading: find every date-like mention; drop the ones turned down
 * in their own clause; let a bare weekday that names an explicit date's
 * weekday refer to that date ("Tuesday 10/27 works, see you Tuesday"); then
 * one mention is the day, two joined by "to" or "-" are a run, two joined by
 * "and" are a run when consecutive, and anything else is a question.
 */
export function readVisitDate(text: string, ctx: ReadContext): VisitDateRead {
  const windows = ctx.windows ?? [];
  const today = ctx.today;
  const body = text ?? '';
  const all = extractMentions(body, today);
  const time = readVisitTime(blankSpans(body, all.filter((m) => m.kind !== 'vague')));

  for (const m of all) m.negated = NEGATION.test(clauseAt(body, m.from));
  const concrete0 = all.filter((m) => m.kind !== 'vague');
  let concrete = concrete0.filter((m) => !m.negated);
  const vague = all.filter((m) => m.kind === 'vague' && !m.negated);
  if (concrete0.length > 0 && concrete.length === 0 && vague.length === 0) return { kind: 'none', why: 'declined' };

  // A bare weekday that matches an explicit date's weekday refers to it.
  const explicitWeekdays = new Set(
    concrete.filter((m) => m.kind === 'date' && m.date).map((m) => weekdayOf(m.date as Ymd)),
  );
  concrete = concrete.filter((m) => !(m.kind === 'weekday' && explicitWeekdays.has(m.weekday as number)));

  // "next week Tuesday": the vague span modifies the weekday.
  if (vague.some((v) => /next week/i.test(v.raw))) {
    for (const m of concrete) if (m.kind === 'weekday' && !m.mod) m.mod = 'next';
  }

  // "I can't" contains "I can": a refusal anywhere means a dateless message
  // is not a yes. A named day keeps its own clause's reading above.
  const refused = NEGATION.test(body.replace(/\bno (?:problem|worries)\b/gi, ''));
  const intent = INTENT.test(body);
  const hasOffer = !!ctx.hasOffer || windows.length > 0;

  // No day named at all.
  if (concrete.length === 0) {
    if (vague.length > 0 && !refused && (intent || hasOffer)) {
      return { kind: 'ask', reason: `"${vague[0].raw.trim()}" names no day`, candidates: [], time, dateless: true };
    }
    if (!(DATELESS_YES.test(body) && hasOffer) || refused || DEFERRAL.test(body)) return { kind: 'none', why: 'no_date' };
    const single = windows.length === 1 && windows[0].start === windows[0].end ? windows[0].start : null;
    if (single && single >= today) return { kind: 'date', start: single, end: single, time, basis: 'the only day you offered' };
    return {
      kind: 'ask',
      reason: 'a yes with no day named',
      candidates: windows.map((w) => w.start).filter((d) => d >= today).slice(0, 6),
      time,
      dateless: true,
    };
  }

  // A weekday or "the 27th" on its own is a visit only when the message is
  // about scheduling (scheduling words, a time, or our recent offer). An
  // explicit future date always is.
  const onlySoft = concrete.every((m) => m.kind !== 'date' || m.soft);
  if (onlySoft && !intent && !time.label && !hasOffer) return { kind: 'none', why: 'no_date' };
  if (onlySoft && PAST_TENSE.test(body) && !intent) return { kind: 'none', why: 'past' };

  const resolved = concrete.map((m) => resolve(m, { today, windows }));
  // Past days: a vendor naming only past days is talking about a past visit.
  const isPast = (r: Resolved) => r.candidates.length > 0 && r.candidates.every((c) => c < today);
  if (resolved.every(isPast)) return { kind: 'none', why: 'past' };
  const live = resolved.filter((r) => !isPast(r));

  const ask = (reason: string, candidates: Ymd[]): VisitDateRead => ({
    kind: 'ask',
    reason,
    candidates: [...new Set(candidates)].filter((d) => d >= today).sort().slice(0, 6),
    time,
    dateless: false,
  });

  const problem = live.find((r) => r.problem);
  if (problem) return ask(problem.problem as string, problem.candidates);

  // Collapse repeats of the same single day ("10/27 ... see you 10/27").
  const items: Resolved[] = [];
  for (const r of live) {
    const prev = items[items.length - 1];
    if (prev && !prev.end && !r.end && prev.candidates.length === 1 && r.candidates.length === 1 && prev.candidates[0] === r.candidates[0]) continue;
    items.push(r);
  }

  const done = (start: Ymd, end: Ymd, basis: string): VisitDateRead => {
    if (end < start) return ask('the days run backwards', [start, end]);
    if (daysBetween(start, end) + 1 > MAX_VISIT_DAYS) return ask(`${daysBetween(start, end) + 1} days is longer than one visit`, [start]);
    if (daysBetween(today, start) > MAX_DAYS_AHEAD) return ask(`${fmtDay(start)} is more than six months out`, [start]);
    return { kind: 'date', start, end, time, basis };
  };

  if (items.length === 1) {
    const r = items[0];
    if (r.candidates.length !== 1) {
      const wd = WEEKDAY_NAMES[r.mention.weekday as number];
      const why = windows.length > 0 ? `"${r.mention.raw.trim()}" could be more than one ${wd} you offered` : `"${r.mention.raw.trim()}" could be more than one ${wd}`;
      return ask(why, r.candidates);
    }
    const start = r.candidates[0];
    return done(start, r.end ?? start, r.mention.kind === 'weekday' ? `the coming ${WEEKDAY_NAMES[r.mention.weekday as number]}` : 'named in the text');
  }

  // Two or more days: a run only when every joint says so.
  const singles = items.every((r) => r.candidates.length === 1 && !r.end);
  if (singles) {
    const joints = items.slice(1).map((r, i) => connectorBetween(body, items[i].mention, r.mention));
    const days = items.map((r) => r.candidates[0]);
    if (items.length === 2 && joints[0] === 'range') return done(days[0], days[1], 'a run of days in the text');
    const consecutive = days.every((d, i) => i === 0 || daysBetween(days[i - 1], d) === 1);
    if (joints.every((j) => j === 'and' || j === 'range') && consecutive) return done(days[0], days[days.length - 1], 'a run of days in the text');
    if (joints.some((j) => j === 'or')) return ask(`two or more days offered: ${days.map(fmtDay).join(' or ')}`, days);
    return ask(`more than one day named: ${days.map(fmtDay).join(', ')}`, days);
  }
  return ask('more than one day named', items.flatMap((r) => r.candidates));
}

/**
 * The windows our own offer named: "Wed 10/21 after 11 AM to Thu 10/22 by
 * 3 PM; Mon 10/26 to Thu 10/29" is two windows. Our text, so nothing is
 * turned down; a day on its own is a one-day window. A weekday with no date
 * counts only when it can mean one day.
 */
export function readOfferWindows(text: string, today: Ymd): OfferWindow[] {
  const mentions = extractMentions(text ?? '', today).filter((m) => m.kind !== 'vague' && !m.problem);
  const days: Array<{ m: Mention; start: Ymd; end: Ymd }> = [];
  for (const m of mentions) {
    if (m.kind === 'weekday') {
      const c = weekdayCandidates(m, today, []);
      if (c.length === 1) days.push({ m, start: c[0], end: c[0] });
      continue;
    }
    if (m.date) days.push({ m, start: m.date, end: m.end ?? m.date });
  }
  const out: OfferWindow[] = [];
  for (let i = 0; i < days.length; i++) {
    const a = days[i];
    const b = days[i + 1];
    if (b && connectorBetween(text, a.m, b.m) === 'range' && b.start >= a.end) {
      out.push({ start: a.start, end: b.end });
      i += 1;
      continue;
    }
    out.push({ start: a.start, end: a.end });
  }
  const seen = new Set<string>();
  return out
    .filter((w) => w.end >= today)
    .filter((w) => (seen.has(`${w.start}|${w.end}`) ? false : (seen.add(`${w.start}|${w.end}`), true)))
    .sort((a, b) => a.start.localeCompare(b.start));
}
