/**
 * A paid early arrival moves the next guest's arrival, never their
 * reservation.
 *
 * When a guest pays for a night before check-in (stay-concierge
 * `early_arrival.py`), the concierge holds that night off sale in Guesty as
 * a calendar block noted "Early arrival hold - <guest> (paid, Helm)" and
 * leaves the reservation alone, the same as a paid extension. `bookings`
 * keeps the old check-in, so the checkout schedule read the stay before it
 * as an ordinary clean when the house was now a same-day turn. The only
 * way Rosa heard was a separate card in the Team inbox, and her schedule
 * said otherwise (7 Sumac, arriving Tue 11/24 instead of Wed 11/25; Dotti,
 * 2026-11-11: "shouldn't this just be updated in her schedule").
 *
 * The rule: a real hold whose note says "early arrival", and whose last
 * held night is the night before a stay's check-in at the same home, moves
 * that stay's arrival to the hold's first night. The schedule reads it
 * when it builds; nothing is written. The hold is the record, so a refunded
 * early arrival whose hold comes off the calendar drops off the schedule on
 * the next read. That is the difference from extension-holds.ts, which
 * moves a CHECKOUT row and so needs a stored adjustment an operator can
 * override; an early arrival only changes who is coming in, which no
 * operator edits.
 *
 * Pure: checkout-schedule.ts reads the mirror and the arrivals and feeds
 * them in.
 */

import { isRealHold, type HeldNight } from './owner-hold-checkouts.ts';

/** "Early arrival hold - Elisa Grassi (paid, Helm)", or an operator's own
 *  "early arrival" on a hand-made block. */
const EARLY_ARRIVAL_NOTE = /\bearly[\s-]*arrival\b/i;

/**
 * How many days past a schedule window the caller must fetch arrivals: an
 * early arrival landing inside the window belongs to a reservation that
 * starts after it. The concierge sells at most three nights before
 * check-in; a week is slack for a hand-made hold.
 */
export const EARLY_ARRIVAL_REACH_DAYS = 7;

export type ArrivingStay = { property_id: string; check_in: string };

export type EarlyArrival = {
  propertyId: string;
  /** The check-in Guesty still has on the reservation. */
  bookedCheckIn: string;
  /** The first held night: the day the guest actually arrives. */
  arrives: string;
};

/** The hold's note says it is an early arrival. Never an extension, never
 *  an owner stay, whatever else abuts it. */
export function isEarlyArrivalNote(note: string | null | undefined): boolean {
  return EARLY_ARRIVAL_NOTE.test(note ?? '');
}

export function isEarlyArrivalNight(night: Pick<HeldNight, 'block_type' | 'block_note'>): boolean {
  return isRealHold(night) && isEarlyArrivalNote(night.block_note);
}

function addDay(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isDate(v: string | null | undefined): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * The early arrivals a window of mirror nights proves, against the stays
 * arriving at those homes.
 *
 * A hold is a run of consecutive early-arrival nights at one home. Its
 * first night is the earliest of the run and any `block_start` it carries;
 * its last is the latest of the run and any `block_end` (Guesty's
 * `block_end` is the last HELD night, inclusive), so a hold the caller's
 * window cut short still reaches the check-in it abuts. Only a stay whose
 * check-in is exactly the morning after the last held night moves; a hold
 * that abuts nothing, or ends a day early, changes nothing.
 */
export function earlyArrivals(nights: HeldNight[], stays: ArrivingStay[]): EarlyArrival[] {
  const byProperty = new Map<string, HeldNight[]>();
  for (const n of nights) {
    if (!isEarlyArrivalNight(n)) continue;
    const arr = byProperty.get(n.property_id) ?? [];
    arr.push(n);
    byProperty.set(n.property_id, arr);
  }
  if (byProperty.size === 0) return [];

  const checkIns = new Set(stays.map((s) => `${s.property_id}|${s.check_in}`));
  const out: EarlyArrival[] = [];
  const seen = new Set<string>();

  for (const [propertyId, held] of byProperty) {
    held.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let run: HeldNight[] = [];
    const flush = () => {
      if (run.length === 0) return;
      let first = run[0].date;
      let last = run[run.length - 1].date;
      for (const n of run) {
        if (isDate(n.block_start) && n.block_start < first) first = n.block_start;
        if (isDate(n.block_end) && n.block_end > last) last = n.block_end;
      }
      run = [];
      const bookedCheckIn = addDay(last, 1);
      if (!checkIns.has(`${propertyId}|${bookedCheckIn}`)) return;
      if (first >= bookedCheckIn || addDay(first, EARLY_ARRIVAL_REACH_DAYS) < bookedCheckIn) return;
      const key = `${propertyId}|${bookedCheckIn}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ propertyId, bookedCheckIn, arrives: first });
    };
    for (const n of held) {
      const prev = run[run.length - 1];
      if (prev && n.date !== addDay(prev.date, 1) && n.date !== prev.date) flush();
      run.push(n);
    }
    flush();
  }
  return out;
}
