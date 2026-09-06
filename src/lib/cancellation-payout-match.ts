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
 * whose Guesty host payout is that amount, within a sane distance of the
 * stay. Airbnb pays the host payout exactly, so the cent is the right
 * tolerance; two candidates at the same amount is ambiguity, not a match.
 *
 * If the cancelled stay IS already on a statement (carried at the
 * retained amount, waiting for the money), this deposit corroborates that
 * row and must NOT be attributed as an add-on too, or the owner is paid
 * twice. The suggestion says so in its label rather than staying silent.
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
  host_payout: number | null;
  /** The statement month that already carries this code, if any. */
  recognized_on: string | null;
};

export type CancellationPayoutMatch = {
  code: string;
  guest_name: string;
  amount: number;
  /** Prefilled review label: says what this deposit is and what to do. */
  label: string;
  /** Set when the stay is already on a statement: attribute nothing, it corroborates that row. */
  already_recognized_on: string | null;
};

const ms = (d: string) => new Date(`${d}T00:00:00Z`).getTime();

export function matchCancellationPayout(
  deposit: { amount: number; source: string | null; deposit_date: string },
  candidates: CancelledCandidate[],
  /**
   * Rental income of every recognized Airbnb stay on the property, any
   * month. A cancelled booking whose retained payout equals one of these
   * to the cent is, on the live data, the same stay rebooked under a new
   * code (three of the fleet's cancellations do this), and a deposit of
   * that amount is the rebooked stay's ordinary money, not a cancellation
   * payout. Suggesting the cancelled twin would attribute it on top of
   * the stay already recognized. So an amount that any recognized stay
   * already carries is never suggested. Removing a suggestion is the safe
   * direction: the queue falls back to what it did before.
   */
  recognizedAmounts: number[] = [],
): CancellationPayoutMatch | null {
  if ((deposit.source || '') !== 'airbnb') return null;
  const amount = Math.round(deposit.amount * 100) / 100;
  if (!(amount > 0)) return null;
  if (recognizedAmounts.some(a => Number.isFinite(a) && Math.abs(a - amount) <= EPS)) return null;
  const depMs = ms(deposit.deposit_date);
  if (!Number.isFinite(depMs)) return null;

  const hits = candidates.filter(c => {
    const hp = Number(c.host_payout);
    if (!Number.isFinite(hp) || Math.abs(hp - amount) > EPS) return false;
    const ci = ms(c.check_in);
    return Number.isFinite(ci) && Math.abs(depMs - ci) <= MAX_DAYS_FROM_CHECK_IN * DAY;
  });
  if (hits.length !== 1) return null;

  const c = hits[0];
  const guest = c.guest_name || 'Guest';
  // The attribute route caps a label at 80 characters, and this label is
  // what the owner's statement prints for the add-on, so it is short and
  // says what the money is. The review row shows it in full either way.
  // The instruction comes before the name in both, so an 80-character
  // truncation eats the guest's name and never the instruction.
  const label = (c.recognized_on
    ? `ALREADY on ${c.recognized_on} statement, do not attribute: ${guest} cancellation`
    : `Cancellation payout, retained under the Airbnb policy: ${guest}`).slice(0, 80);
  return { code: c.code, guest_name: guest, amount, label, already_recognized_on: c.recognized_on };
}

/** The review UI's guard: a prefilled label that begins this way must not be attributed again. */
export const ALREADY_RECOGNIZED_LABEL_PREFIX = 'ALREADY on ';
