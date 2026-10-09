/**
 * The question Helm asks about every owner block: clean after it, or not?
 *
 * An owner stay lists on the cleaner schedule by default (owner-hold-
 * checkouts.ts). That is the safe default, not an answer. This module
 * decides which upcoming owner holds still need the operator's word, and
 * what the word was for the rest, from three inputs:
 *
 *   - the holds themselves (ownerHoldCheckouts over the calendar mirror)
 *   - owner_hold_decisions, the answers given on the card
 *   - live checkout_cleaning_skips, because "No cleaning needed" on the
 *     schedule page is the same answer given somewhere else, and asking
 *     again would be asking her to decide twice
 *
 * A hold whose checkout is already past is never asked about: the crew
 * either went or did not, and the question has no action left.
 *
 * Pure and import-free so `npm test` covers it. The I/O lives in
 * owner-hold-questions.ts.
 */

import type { OwnerHoldCheckout } from './owner-hold-checkouts.ts';

export type OwnerHoldDecisionRow = {
  property_id: string;
  stay_check_in: string;
  decision: 'clean' | 'no_clean';
  decided_by?: string | null;
  decided_at?: string | null;
};

export type LiveSkipRow = {
  property_id: string;
  stay_check_in: string;
  created_by?: string | null;
};

export type OwnerHoldQuestion = OwnerHoldCheckout & {
  /** 'pending' = nobody has said; the stay is on the schedule meanwhile. */
  status: 'pending' | 'clean' | 'no_clean';
  decidedBy: string | null;
  /** Where the answer came from: the card, or the schedule page's skip. */
  answeredVia: 'decision' | 'skip' | null;
};

export function stayKey(propertyId: string, checkIn: string): string {
  return `${propertyId}|${checkIn}`;
}

/**
 * Every owner hold checking out on or after `today`, each with its answer
 * or 'pending'. Sorted soonest checkout first.
 */
export function ownerHoldQuestions(
  holds: OwnerHoldCheckout[],
  decisions: OwnerHoldDecisionRow[],
  liveSkips: LiveSkipRow[],
  today: string,
): OwnerHoldQuestion[] {
  const decisionByKey = new Map<string, OwnerHoldDecisionRow>();
  for (const d of decisions) decisionByKey.set(stayKey(d.property_id, d.stay_check_in), d);
  const skipByKey = new Map<string, LiveSkipRow>();
  for (const s of liveSkips) skipByKey.set(stayKey(s.property_id, s.stay_check_in), s);

  const out: OwnerHoldQuestion[] = [];
  for (const h of holds) {
    if (h.checkOut < today) continue;
    const key = stayKey(h.propertyId, h.checkIn);
    const skip = skipByKey.get(key);
    const decision = decisionByKey.get(key);
    // A live skip is the schedule's truth: the house is off the route
    // whatever the card recorded, so that is the answer shown.
    if (skip) {
      out.push({ ...h, status: 'no_clean', decidedBy: skip.created_by ?? decision?.decided_by ?? null, answeredVia: decision ? 'decision' : 'skip' });
    } else if (decision) {
      out.push({ ...h, status: decision.decision, decidedBy: decision.decided_by ?? null, answeredVia: 'decision' });
    } else {
      out.push({ ...h, status: 'pending', decidedBy: null, answeredVia: null });
    }
  }
  out.sort((a, b) => a.checkOut.localeCompare(b.checkOut) || a.propertyId.localeCompare(b.propertyId));
  return out;
}

export function pendingOwnerHoldQuestions(questions: OwnerHoldQuestion[]): OwnerHoldQuestion[] {
  return questions.filter((q) => q.status === 'pending');
}

/** Nights in the hold: check-in through the night before checkout. */
export function holdNights(checkIn: string, checkOut: string): number {
  const a = Date.UTC(+checkIn.slice(0, 4), +checkIn.slice(5, 7) - 1, +checkIn.slice(8, 10));
  const b = Date.UTC(+checkOut.slice(0, 4), +checkOut.slice(5, 7) - 1, +checkOut.slice(8, 10));
  return Math.max(0, Math.round((b - a) / 86400_000));
}
