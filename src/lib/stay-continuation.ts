/**
 * A checkout that is not a checkout: the same guest checks back in the
 * same day at the same house.
 *
 * Guesty lets an owner block their own home as a run of one-night
 * reservations under their own name. Simon Prudenzi on 53 Rocky Neck
 * Downstairs, 2026-09-04 to 09-08, is four rows and one stay. Every row
 * ends with a checkout, so the schedule brain listed a cleaning each
 * morning, the cleanings page flagged "nothing booked" each day, and
 * Rosa's digest carried a turnover nobody was doing. Nobody leaves until
 * the LAST row's checkout, and that is the only one the crew needs.
 *
 * The rule: a stay whose effective checkout day has an arrival at the
 * same property on that day under the same REAL guest name is a
 * continuation, and is not listed. Placeholder names ("Reservation",
 * "Blocked") never match: two placeholders in a row could be two
 * different guests, and a redundant cleaning beats a missed one. A
 * different real name on the arrival is a same-day turnover, exactly as
 * before.
 *
 * On live data the rule touched three rows in two months (Aug 1 to Sep 30
 * 2026), all of them that one stay. It is narrow by design.
 *
 * Import-free so `npm test` covers it without a bundler. The guest-name
 * helpers moved here from checkout-schedule.ts unchanged; that module
 * re-imports them.
 */

/** Same placeholder test as the turnover rail (operations.ts guestNameScore):
 *  the first token gives an ical placeholder away. */
export const PLACEHOLDER_FIRST_TOKEN = /^(reservation|tbd|guest|n\/a|hold|blocked|airbnb|vrbo|not)$/i;

/** 0 = empty, 1 = placeholder, 2 = a real guest name. */
export function guestNameScore(name: string | null | undefined): number {
  const t = (name ?? '').trim();
  if (!t) return 0;
  return PLACEHOLDER_FIRST_TOKEN.test(t.split(/\s+/)[0]) ? 1 : 2;
}

/** The name as a human surface shows it: real names only, placeholders blank. */
export function displayGuestName(name: string | null | undefined): string {
  return guestNameScore(name) === 2 ? (name ?? '').trim() : '';
}

/** Case- and whitespace-insensitive identity for a real guest name.
 *  Empty for a placeholder or a blank, so those can never match anything. */
export function guestNameKey(name: string | null | undefined): string {
  return displayGuestName(name).toLowerCase().replace(/\s+/g, ' ');
}

export type ContinuationStay = {
  propertyId: string;
  guestName: string | null | undefined;
  /** The day the stay's checkout falls on after any adjustment. */
  effectiveCheckOut: string;
};

/**
 * True when the same real guest checks back in at the same house on the
 * stay's checkout day. `arrivalGuestNameAt` answers "who arrives at this
 * property on this date", or undefined when nobody does.
 */
export function isContinuation(
  stay: ContinuationStay,
  arrivalGuestNameAt: (propertyId: string, date: string) => string | null | undefined,
): boolean {
  const key = guestNameKey(stay.guestName);
  if (!key) return false;
  const arriving = arrivalGuestNameAt(stay.propertyId, stay.effectiveCheckOut);
  if (arriving === undefined) return false;
  return guestNameKey(arriving) === key;
}

// ─── merging segments into one stay ───────────────────────────────────

export type StaySegment = {
  propertyId: string;
  guestName: string | null | undefined;
  checkIn: string;
  checkOut: string;
};

export type StayChain = {
  /** Index of the head segment (the earliest) in the input. */
  index: number;
  /** The chain's real checkout: the last segment's. */
  checkOut: string;
  /** Indexes of the rows absorbed into the head: later segments of the same
   *  stay, plus any twin fully inside the merged span that carries a
   *  placeholder name or the same guest's name. Drop them. */
  merged: number[];
};

/**
 * The source-side form of the continuation rule, for readers that work
 * from a list of booking rows (the Turnovers pipeline and its calendar).
 *
 * A row whose check-in lands on the checkout of a same-named row at the
 * same house continues that stay. The earliest row is the head; the rest
 * are absorbed and the head's checkout moves to the chain's end. Rows come
 * back in check-in order, one entry per surviving stay.
 *
 * Placeholder names never chain, so two "Reservation" rows in a row stay
 * two rows. A twin sitting fully inside a merged span is absorbed only if
 * it is a placeholder or the same guest; a different real name that
 * overlaps is left alone, visible, for a human to notice.
 */
export function chainStays<T>(rows: T[], read: (row: T) => StaySegment): StayChain[] {
  const segs = rows.map(read);
  const order = segs
    .map((_, i) => i)
    .sort((a, b) => {
      const sa = segs[a];
      const sb = segs[b];
      if (sa.propertyId !== sb.propertyId) return sa.propertyId < sb.propertyId ? -1 : 1;
      if (sa.checkIn !== sb.checkIn) return sa.checkIn < sb.checkIn ? -1 : 1;
      return a - b;
    });
  const byArrival = new Map<string, number[]>();
  for (const i of order) {
    const k = `${segs[i].propertyId}|${segs[i].checkIn}`;
    const list = byArrival.get(k) ?? [];
    list.push(i);
    byArrival.set(k, list);
  }

  const consumed = new Set<number>();
  const out: StayChain[] = [];
  for (const i of order) {
    if (consumed.has(i)) continue;
    const head = segs[i];
    const key = guestNameKey(head.guestName);
    let end = head.checkOut;
    const merged: number[] = [];
    if (key) {
      // Bounded walk: a corrupt pair can never spin.
      for (let hops = 0; hops < 400; hops++) {
        const next = (byArrival.get(`${head.propertyId}|${end}`) ?? []).find(
          (j) => j !== i && !consumed.has(j) && segs[j].checkOut > end && guestNameKey(segs[j].guestName) === key,
        );
        if (next === undefined) break;
        consumed.add(next);
        merged.push(next);
        end = segs[next].checkOut;
      }
      if (merged.length > 0) {
        // Twins inside the merged span: the same guest again, or a placeholder.
        for (const j of order) {
          if (j === i || consumed.has(j)) continue;
          const s = segs[j];
          if (s.propertyId !== head.propertyId) continue;
          if (s.checkIn < head.checkIn || s.checkOut > end) continue;
          const k = guestNameKey(s.guestName);
          if (k === '' || k === key) {
            consumed.add(j);
            merged.push(j);
          }
        }
      }
    }
    out.push({ index: i, checkOut: end, merged });
  }
  return out;
}
