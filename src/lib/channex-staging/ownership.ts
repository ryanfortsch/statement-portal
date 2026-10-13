/** Synthetic ownership rehearsal only. Claims are NOT proof of a provider-side block. */
import { parseLedger, latestBookings, nights, TEST_START, TEST_END, type Ledger, type Member, type Hold } from './core.ts';
export type LinkedClaim = { id: string; bookingKey: string; revisionId: string; target: Member; date: string };
export type OwnershipPlan = {
  executable: false;
  claims: LinkedClaim[];
  releasedClaims: LinkedClaim[];
  nights: { target: Member; date: string; claims: string[]; independentHolds: string[]; decision: 'blocked' | 'review-only' }[];
};
const members: Member[] = ['whole', 'front', 'back'];
const affects = (source: Member, target: Member) => source === target || source === 'whole' || target === 'whole';
/** Recompute from complete revision history; never infer ownership from calendar coincidence. */
export function planOwnership(previous: Ledger, current: Ledger, holds: Hold[], complete: boolean): OwnershipPlan {
  const before = parseLedger(previous), after = parseLedger(current);
  // Refuse history loss: a missing reservation must never look like a cancellation.
  for (const revision of before.revisions) {
    if (!after.revisions.some((r) => JSON.stringify(r) === JSON.stringify(revision))) throw new Error('Incomplete ownership history');
  }
  const seen = new Set<string>();
  for (const hold of holds) {
    if (!members.includes(hold.member) || !/^[A-Za-z0-9_-]{1,160}$/.test(hold.id) || seen.has(`${hold.member}:${hold.id}`)) throw new Error('Invalid or duplicate independent hold');
    seen.add(`${hold.member}:${hold.id}`); nights(hold.checkIn, hold.checkOut);
  }
  function claims(ledger: Ledger): LinkedClaim[] {
    return latestBookings(ledger).filter((r) => r.status !== 'cancelled').flatMap((r) => {
      const bookingKey = `${r.member}:${r.bookingId}`;
      return members.filter((target) => affects(r.member, target)).flatMap((target) =>
        nights(r.checkIn, r.checkOut).filter((date) => date >= TEST_START && date < TEST_END).map((date) => ({
          id: `${bookingKey}:${target}:${date}`, bookingKey, revisionId: r.id, target, date,
        })));
    }).sort((a, b) => a.id.localeCompare(b.id));
  }
  const oldClaims = claims(before), nextClaims = claims(after);
  // Incomplete sources retain old claims as well as any newly known blockers.
  const retained = new Map(nextClaims.map((c) => [c.id, c]));
  if (!complete) for (const c of oldClaims) if (!retained.has(c.id)) retained.set(c.id, c);
  const active = [...retained.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    executable: false, claims: active,
    releasedClaims: complete ? oldClaims.filter((c) => !retained.has(c.id)) : [],
    nights: members.flatMap((target) => nights(TEST_START, TEST_END).map((date) => {
      const linked = active.filter((c) => c.target === target && c.date === date).map((c) => c.id);
      const independent = holds.filter((h) => affects(h.member, target) && h.checkIn <= date && date < h.checkOut).map((h) => `${h.member}:${h.id}`);
      return { target, date, claims: linked, independentHolds: independent, decision: !complete || linked.length || independent.length ? 'blocked' as const : 'review-only' as const };
    })),
  };
}
