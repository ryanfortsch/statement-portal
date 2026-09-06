/**
 * Recognize a cancellation payout when it lands. Pure, no imports.
 *
 * When an Airbnb guest cancels under a policy that keeps part of the
 * payment, Airbnb records what the host earns at the cancellation and
 * releases the payout later, typically after the guest's original
 * check-in date. By then the stay is on no statement (it was cancelled,
 * and correctly not recognized), so the deposit reaches the bank review
 * queue with nothing to match, and the queue's default suggestion is the
 * nearest checkout on the statement, which is the wrong guest.
 *
 * Catherine Dixon, 20 Hammond: cancelled August 10 for an October stay,
 * $775.29 retained, payout due after October 14. Without this, whoever
 * reviews October's queue has to remember an August cancellation.
 *
 * The match is deliberately narrow: an Airbnb deposit, to the cent,
 * against exactly one cancelled Airbnb booking for the same property
 * whose LIVE Guesty host payout is that amount, within a sane distance of
 * the stay. Airbnb pays the host payout exactly, so the cent is the right
 * tolerance; two candidates at the same amount is ambiguity, not a match.
 *
 * Two texts come out of a match and they are not the same thing:
 *   label        what the owner's statement prints if the deposit is
 *                attributed. Short, plain, never an instruction.
 *   review_note  what the operator reads on the review card. Says which
 *                stay this is and what to do, including "do not attribute"
 *                when the stay is already carried on a statement and this
 *                deposit is that money arriving (attributing it again pays
 *                the owner twice). Never printed anywhere owner-facing.
 */

const EPS = 0.005;
const DAY = 24 * 60 * 60 * 1000;
/** Airbnb releases after check-in; be generous both ways for sanity only. */
const MAX_DAYS_FROM_CHECK_IN = 400;

export type CancelledCandidate = {
  code: string;
  guest_name: string | null;
  check_in: string;   // YYYY-MM-DD
  check_out: string;  // YYYY-MM-DD
  /** The LIVE retained figure. Never the cached column (see buildCancelledCandidates). */
  host_payout: number | null;
  /** The statement month that already carries this code, if any. */
  recognized_on: string | null;
};

/** A recognized Airbnb stay on the property: its code and the rental income a statement carries. */
export type RecognizedStay = { code: string; amount: number };

export type CancellationPayoutMatch = {
  code: string;
  guest_name: string;
  amount: number;
  /** Owner-facing add-on label, at most 80 characters (the attribute route's cap). */
  label: string;
  /** Operator-facing: which stay, and whether it may be attributed. */
  review_note: string;
  /** Set when the stay is already on a statement: attribute nothing, it corroborates that row. */
  already_recognized_on: string | null;
};

/** The review UI's guard: a note that begins this way must not be attributed again. */
export const ALREADY_RECOGNIZED_NOTE_PREFIX = 'ALREADY on the ';

/** A note that begins this way means the pipeline could not check this deposit against the property's cancellations. */
export const CANCELLATION_CHECK_INCOMPLETE_PREFIX = 'Cancellation check incomplete at ingest';

const ms = (d: string) => new Date(`${d}T00:00:00Z`).getTime();

export function matchCancellationPayout(
  deposit: { amount: number; source: string | null; deposit_date: string },
  candidates: CancelledCandidate[],
  /**
   * Every recognized Airbnb stay on the property, any month, plus the
   * rows on the PDF being ingested right now: code and rental income.
   * A candidate whose retained amount equals what a DIFFERENT recognized
   * stay earned is never suggested: the deposit is at least as likely
   * that stay's own money, and removing a suggestion is the safe
   * direction (the queue falls back to what it did before).
   *
   * The cancelled booking's OWN recognized row is not an exclusion. On
   * the live data three cancelled bookings retained everything and are
   * carried in full on a sent statement (Guesty marks the booking
   * cancelled while the policy keeps it all); a deposit of that amount
   * is that row's money arriving, which is exactly the already-recognized
   * case, and the note must say ALREADY rather than fall back to the
   * nearest checkout and let the money be attributed a second time.
   */
  recognized: RecognizedStay[] = [],
): CancellationPayoutMatch | null {
  if ((deposit.source || '') !== 'airbnb') return null;
  const amount = Math.round(deposit.amount * 100) / 100;
  if (!(amount > 0)) return null;
  const depMs = ms(deposit.deposit_date);
  if (!Number.isFinite(depMs)) return null;

  const hits = candidates.filter(c => {
    const hp = Number(c.host_payout);
    if (!Number.isFinite(hp) || Math.abs(hp - amount) > EPS) return false;
    if (recognized.some(r => r.code !== c.code && Number.isFinite(r.amount) && Math.abs(r.amount - amount) <= EPS)) return false;
    const ci = ms(c.check_in);
    return Number.isFinite(ci) && Math.abs(depMs - ci) <= MAX_DAYS_FROM_CHECK_IN * DAY;
  });
  if (hits.length !== 1) return null;

  const c = hits[0];
  const guest = c.guest_name || 'Guest';
  // The attribute route caps a label at 80 characters and this label is
  // what the owner's statement prints for the add-on, so it is short and
  // says what the money is. A long name is what gets cut, never the meaning.
  const label = `Cancellation payout (Airbnb policy): ${guest}`.slice(0, 80);
  const review_note = c.recognized_on
    ? `${ALREADY_RECOGNIZED_NOTE_PREFIX}${c.recognized_on} statement: ${guest}'s cancelled stay (${c.code}) is carried there at this amount, and this deposit is that money arriving. Attributing it again pays the owner twice. Dismiss it.`
    : `Matches ${guest}'s cancelled stay (${c.code}, ${c.check_in}) to the cent: the payout Airbnb retained under the cancellation policy, on no statement. Attribute it here.`;
  return { code: c.code, guest_name: guest, amount, label, review_note, already_recognized_on: c.recognized_on };
}

/** A cached cancelled booking: identity and dates only. Its money column is not consulted. */
export type CachedCancelledRow = {
  code: string;
  guest_name: string | null;
  check_in: string;
  check_out: string;
};

/** What the live probe answered for one code (src/lib/cancel-check.ts). */
export type LiveFigure = { status: string; hostPayout: number | null };

/**
 * Turn the cached cancelled rows into candidates using the LIVE figure
 * only. `guesty_reservations.host_payout` is written by the full nightly
 * sync alone; the reconciler that flips a booking to cancelled updates
 * status and nothing else, so for any booking cancelled since its last
 * full sync the cached column is the PRE-cancel amount. A full-refund
 * cancel would then carry its whole original payout in the cache, and a
 * later deposit of that amount from a rebooking by someone else would be
 * labelled the cancelled guest's payout and attributed twice; a real
 * partial retain would never equal the cached full amount and would fall
 * through silently. Neither is acceptable, so the cache supplies
 * identity and dates, and the money comes from Guesty right now.
 *
 * A code the probe did not answer for is returned in `unchecked`: unknown
 * is not "nothing retained", and the caller says so on the queue row.
 * A live figure of zero is a full refund: nothing to match. A live status
 * that is no longer cancelled is a stay again, not a cancellation.
 */
export function buildCancelledCandidates(
  cached: CachedCancelledRow[],
  live: Map<string, LiveFigure>,
  recognizedOn: Map<string, string>,
): { candidates: CancelledCandidate[]; unchecked: string[] } {
  const candidates: CancelledCandidate[] = [];
  const unchecked: string[] = [];
  for (const row of cached) {
    const l = live.get(row.code);
    if (!l || l.hostPayout === null || !Number.isFinite(l.hostPayout)) { unchecked.push(row.code); continue; }
    const s = (l.status || '').toLowerCase();
    if (s !== 'canceled' && s !== 'cancelled') continue;
    if (l.hostPayout <= EPS) continue;
    candidates.push({
      code: row.code,
      guest_name: row.guest_name,
      check_in: row.check_in,
      check_out: row.check_out,
      host_payout: Math.round(l.hostPayout * 100) / 100,
      recognized_on: recognizedOn.get(row.code) ?? null,
    });
  }
  return { candidates, unchecked };
}

/**
 * The note for an Airbnb deposit the pipeline could not clear against
 * the property's cancellations. It names what was not checked so the
 * operator knows exactly what to look at, and it carries no suggestion
 * (the caller writes none), because the nearest-checkout guess is the
 * wrong guest for a cancellation payout and a wrong suggestion written
 * once is kept by the queue's dedupe forever.
 */
export function cancellationCheckNote(input: { unchecked: string[]; readFailed: boolean }): string {
  const why = input.readFailed
    ? 'the cancelled-booking read failed'
    : `Guesty did not answer for ${input.unchecked.slice(0, 6).join(', ')}${input.unchecked.length > 6 ? ` and ${input.unchecked.length - 6} more` : ''}`;
  return `${CANCELLATION_CHECK_INCOMPLETE_PREFIX}: ${why}. Confirm this is not a cancellation payout before attributing; re-running ingest re-checks it.`;
}
