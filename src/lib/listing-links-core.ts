/**
 * Linked listings: one house sold as a whole AND as units on separate
 * listings (17 Beach Road: "Stay at Good Harbor Beach" is the whole house;
 * "Good Harbor Beach House" is the front unit, Guesty-run, Airbnb only;
 * "Good Harbor Beach - Guest House" is the back unit, a plain Airbnb
 * listing). Nothing on Guesty's side knows they are one house, so:
 *
 *   - the WHOLE house booked closes every unit for those nights;
 *   - a UNIT booked closes the whole house (the other unit stays open).
 *
 * Pure rules here; listing-links.ts reads the bookings and writes the
 * blocks (Guesty calendar for a Guesty-run member, Helm's linked iCal feed
 * for a member Guesty does not run). Every block Helm writes carries
 * helmLinkNote(sourceKey), and only a day carrying exactly that note is ever
 * reopened, so an owner hold or a block someone typed is never touched.
 */

export type LinkRole = 'whole' | 'unit';

export type LinkMember = {
  group_key: string;
  member_key: string;
  label: string;
  role: LinkRole;
  /** Set when Guesty runs this listing: blocks are written to its calendar. */
  guesty_listing_id: string | null;
  /** The member's own export feed, read for bookings when Guesty does not run it. */
  ical_url: string | null;
};

/** A booking on one member: a Guesty reservation, or a reserved iCal event. */
export type LinkBooking = {
  member_key: string;
  /** Stable per booking: 'guesty:<reservation id>' or 'ical:<uid>'. */
  source_key: string;
  /** YYYY-MM-DD; check_out exclusive (the morning the guest leaves). */
  check_in: string;
  check_out: string;
  /** Guest-facing summary for the notice, e.g. the confirmation code. */
  label?: string | null;
};

export type DesiredBlock = {
  group_key: string;
  target_member: string;
  source_member: string;
  source_key: string;
  check_in: string;
  check_out: string;
};

export type ExistingBlock = DesiredBlock & {
  id: string;
  status: 'active' | 'removed' | 'failed';
};

export const HELM_LINK_NOTE_PREFIX = 'Helm linked listing: ';

/** The note Helm writes on every block it places, and the only note it will reopen. */
export function helmLinkNote(sourceKey: string): string {
  return `${HELM_LINK_NOTE_PREFIX}${sourceKey}`;
}

export function blockKey(b: Pick<DesiredBlock, 'target_member' | 'source_key'>): string {
  return `${b.target_member}|${b.source_key}`;
}

/**
 * The blocks one group's bookings call for. A whole-house booking closes
 * every unit; a unit booking closes every whole-house listing. Units never
 * close each other. A booking with no nights is ignored.
 */
export function desiredBlocks(members: readonly LinkMember[], bookings: readonly LinkBooking[]): DesiredBlock[] {
  const byKey = new Map(members.map((m) => [m.member_key, m]));
  const out: DesiredBlock[] = [];
  for (const b of bookings) {
    const src = byKey.get(b.member_key);
    if (!src || !(b.check_out > b.check_in)) continue;
    for (const t of members) {
      if (t.group_key !== src.group_key || t.member_key === src.member_key) continue;
      const linked = src.role === 'whole' ? t.role === 'unit' : t.role === 'whole';
      if (!linked) continue;
      out.push({
        group_key: src.group_key,
        target_member: t.member_key,
        source_member: src.member_key,
        source_key: b.source_key,
        check_in: b.check_in,
        check_out: b.check_out,
      });
    }
  }
  return out;
}

export type BlockDiff = {
  /** To place (new, dates moved, or an earlier attempt that failed). */
  create: DesiredBlock[];
  /** Placed by Helm and no longer wanted (the booking went away or moved). */
  remove: ExistingBlock[];
  unchanged: number;
};

/**
 * What to change. A booking whose dates moved is one remove (the old
 * nights) plus one create (the new). A failed row is retried as a create.
 */
export function diffBlocks(desired: readonly DesiredBlock[], existing: readonly ExistingBlock[]): BlockDiff {
  const live = new Map<string, ExistingBlock>();
  for (const e of existing) if (e.status === 'active') live.set(blockKey(e), e);
  const diff: BlockDiff = { create: [], remove: [], unchanged: 0 };
  const wanted = new Set<string>();
  for (const d of desired) {
    const k = blockKey(d);
    wanted.add(k);
    const e = live.get(k);
    if (e && e.check_in === d.check_in && e.check_out === d.check_out) {
      diff.unchanged += 1;
      continue;
    }
    if (e) diff.remove.push(e);
    diff.create.push(d);
  }
  for (const [k, e] of live) if (!wanted.has(k)) diff.remove.push(e);
  return diff;
}

/** Nights of [check_in, check_out) as YYYY-MM-DD. */
export function nightsOf(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  for (let d = checkIn; d < checkOut && out.length < 800; d = addDay(d)) out.push(d);
  return out;
}

function addDay(ymd: string): string {
  const t = new Date(`${ymd}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

export type CalendarDayLite = {
  date: string;
  status?: string | null;
  note?: string | null;
  blockRefs?: Array<{ type?: string | null; note?: string | null }> | null;
};

/**
 * May Helm reopen this day? Only when the day's only blocks are manual ones
 * carrying Helm's own note for this source: a reservation, an owner hold,
 * any other block, or a note someone edited, and the day is left closed.
 */
export function mayReopenDay(day: CalendarDayLite, note: string): boolean {
  const status = String(day.status ?? '').toLowerCase();
  if (status === 'booked' || status === 'reserved') return false;
  const refs = day.blockRefs ?? [];
  if (refs.length === 0) return status === 'unavailable' && (day.note ?? '') === note;
  return refs.every((r) => String(r.type ?? '').toLowerCase() === 'm' && (r.note ?? '') === note);
}

/** Contiguous runs of dates, for as few calendar writes as possible. */
export function contiguousRuns(dates: readonly string[]): Array<{ start: string; end: string }> {
  const sorted = [...new Set(dates)].sort();
  const runs: Array<{ start: string; end: string }> = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && addDay(last.end) === d) last.end = d;
    else runs.push({ start: d, end: d });
  }
  return runs;
}

/** An Airbnb export event that is a guest's booking (not a block or an imported calendar). */
export function isReservedEvent(summary: string | null | undefined): boolean {
  return /^\s*reserved\b/i.test(summary ?? '');
}

/**
 * Two bookings on linked listings that overlap: a double sale of one house.
 * Returned so the notice can say it loudly; Helm cannot undo a booking.
 */
export function linkedOverlaps(
  members: readonly LinkMember[],
  bookings: readonly LinkBooking[],
): Array<{ a: LinkBooking; b: LinkBooking }> {
  const role = new Map(members.map((m) => [m.member_key, m.role]));
  const out: Array<{ a: LinkBooking; b: LinkBooking }> = [];
  for (let i = 0; i < bookings.length; i++) {
    for (let j = i + 1; j < bookings.length; j++) {
      const a = bookings[i];
      const b = bookings[j];
      if (a.member_key === b.member_key) continue;
      const ra = role.get(a.member_key);
      const rb = role.get(b.member_key);
      if (!ra || !rb || (ra === 'unit' && rb === 'unit')) continue;
      if (a.check_in < b.check_out && b.check_in < a.check_out) out.push({ a, b });
    }
  }
  return out;
}

/** The iCal body Helm serves to a member Guesty does not run (it imports this on Airbnb). */
export function linkedIcal(memberLabel: string, blocks: ReadonlyArray<Pick<DesiredBlock, 'source_key' | 'check_in' | 'check_out'>>, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rising Tide Helm//Linked listings//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:Helm closures for ${memberLabel.replace(/[\r\n]/g, ' ')}`];
  for (const b of blocks) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${fnv1a(b.source_key)}-${b.check_in.replace(/-/g, '')}@helm-linked`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${b.check_in.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${b.check_out.replace(/-/g, '')}`,
      'SUMMARY:Not available',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** A stable, opaque id: the feed never names the booking behind a closure. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
