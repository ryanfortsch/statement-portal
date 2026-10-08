/**
 * An owner's stay is a checkout too, and it never came through `bookings`.
 *
 * When the owner uses their own home, the office blocks the dates in
 * Guesty: a calendar hold, not a reservation. The hold reaches Helm only
 * as held nights in the `property_calendar_days` mirror, and the checkout
 * schedule was built from `bookings` alone, so the morning the owner left
 * had no row, Rosa's text had no stop, and the house sat dirty until the
 * next guest's arrival caught it. 21 Horton (owner out 2026-10-05) and
 * 225 Washington (owner out 2026-10-09, a guest arriving the same
 * afternoon) both fell through this way (Dotti, 2026-10-08).
 *
 * Two things about how Guesty files these, both verified on the live
 * mirror on 2026-10-08, decide the predicate:
 *
 *   - A block the OFFICE makes for the owner is `block_type 'm'` (manual)
 *     with `block_reason 'Owner block'` and a free-text note ("Owner use").
 *     Only a block the owner makes through their own portal is type 'o'.
 *     Keying on 'o' alone misses every owner stay the office enters, which
 *     is nearly all of them.
 *   - The reason is Guesty's fixed vocabulary; the note is typed. Fleet
 *     tally: 'Owner block' notes read "Owner use", "Owner Block", "owner
 *     lock", "Bed delivery", "Electrician", "Remediation project",
 *     "Blocking for now.". Other reasons: 'Channel block', 'Maintenance',
 *     'Onboarding', 'Other', or none.
 *
 * The rule: a run of held nights is an owner stay when ANY night is type
 * 'o', or carries the word "owner" in its reason or note. The checkout is
 * the morning after the run's last held night, where a run is consecutive
 * held nights at one home regardless of which Guesty ref holds each (an
 * owner stay followed straight by a roofing hold is one occupancy; the
 * crew comes once, after the roofers, before the guest). A hold whose
 * note says the owner wants no cleaning ("Owner use- no cleaning") is left
 * off entirely: that is the operator's decision, written where they wrote
 * it. Everything else owner-tagged lists, even an electrician visit, because
 * the schedule page's "No cleaning needed" mark exists for exactly that
 * call and a redundant stop costs less than a missed turnover.
 *
 * Pure and import-free so `npm test` covers it; checkout-schedule.ts reads
 * the mirror and feeds the rows in.
 */

/** The hold columns of one mirror night. */
export type HeldNight = {
  property_id: string;
  date: string;
  block_type: string | null;
  block_reason?: string | null;
  block_note?: string | null;
  /** Guesty's ref range, inclusive last held day. Gives the stay a start
   *  date that does not move with the query window. */
  block_start?: string | null;
};

export type OwnerHoldCheckout = {
  propertyId: string;
  /** First held night (the ref's own start where the mirror carries it). */
  checkIn: string;
  /** The morning after the last held night: the day the crew is sent. */
  checkOut: string;
  blockType: string;
  reason: string | null;
  note: string | null;
};

/** Mirrors calendar-holds.ts REAL_HOLD_TYPES; restated so this file imports
 *  nothing. A night with any other type is a Guesty rule artifact. */
const REAL_HOLD_TYPES: ReadonlySet<string> = new Set(['m', 'o', 'sr', 'abl', 'pt']);

const OWNER_WORD = /\bowner\b/i;
/** "Owner use- no cleaning", "sem limpeza", "nao limpar". */
const NO_CLEANING = /\bno[\s-]*clean|sem\s+limpeza|n[aã]o\s+limp/i;

export function isRealHold(night: Pick<HeldNight, 'block_type'>): boolean {
  return !!night.block_type && REAL_HOLD_TYPES.has(night.block_type);
}

/** The night belongs to the owner: portal-made, or filed under "Owner
 *  block", or the note says so. */
export function isOwnerNight(night: Pick<HeldNight, 'block_type' | 'block_reason' | 'block_note'>): boolean {
  if (!isRealHold(night)) return false;
  if (night.block_type === 'o') return true;
  return OWNER_WORD.test(night.block_reason ?? '') || OWNER_WORD.test(night.block_note ?? '');
}

/** The operator wrote on the block that no cleaning follows it. */
export function holdDeclinesCleaning(night: Pick<HeldNight, 'block_note'>): boolean {
  return NO_CLEANING.test(night.block_note ?? '');
}

function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Owner-stay checkouts from a window of mirror nights.
 *
 * `horizon` is the last date the caller fetched. A run still held on that
 * date has not ended as far as we can see, so it produces nothing: listing
 * its checkout would send the crew to a house the owner is still in. Pass
 * one day past the last checkout you want, and fetch through it.
 */
export function ownerHoldCheckouts(nights: HeldNight[], horizon: string): OwnerHoldCheckout[] {
  const byProperty = new Map<string, HeldNight[]>();
  for (const n of nights) {
    if (!isRealHold(n)) continue;
    const arr = byProperty.get(n.property_id) ?? [];
    arr.push(n);
    byProperty.set(n.property_id, arr);
  }

  const out: OwnerHoldCheckout[] = [];
  for (const [propertyId, held] of byProperty) {
    held.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let run: HeldNight[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const last = run[run.length - 1];
      const ownerNight = run.find(isOwnerNight);
      const declined = run.some(holdDeclinesCleaning);
      if (ownerNight && !declined && last.date < horizon) {
        let checkIn = run[0].date;
        for (const n of run) {
          if (n.block_start && /^\d{4}-\d{2}-\d{2}$/.test(n.block_start) && n.block_start < checkIn) checkIn = n.block_start;
        }
        out.push({
          propertyId,
          checkIn,
          checkOut: nextDay(last.date),
          blockType: ownerNight.block_type as string,
          reason: ownerNight.block_reason ?? null,
          note: ownerNight.block_note ?? null,
        });
      }
      run = [];
    };
    for (const n of held) {
      const prev = run[run.length - 1];
      if (prev && prev.date === n.date) continue; // a duplicate night row
      if (prev && nextDay(prev.date) !== n.date) flush();
      run.push(n);
    }
    flush();
  }
  out.sort((a, b) => a.checkOut.localeCompare(b.checkOut) || a.propertyId.localeCompare(b.propertyId));
  return out;
}
