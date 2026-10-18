/**
 * Next and last visit per contractor, for the roster card's summary line
 * ("who can I send tomorrow" reads the calendar, not a score).
 *
 * A packet counts once it is someone's: claimed or on site is a visit to come
 * (or today's), submitted or approved is one that happened. A creative shoot
 * counts from scheduled on; an offer or a pass is never work (the same rule
 * as shoot-offer-optin.test.ts), and a cancellation is neither.
 *
 * Pure, so the rule is tested; the loader lives in field-packets.ts.
 */

export type VisitPacketRow = { awarded_contractor_id: string | null; visit_date: string; status: string };
export type VisitShootRow = { contractor_id: string | null; shoot_date: string; status: string };
export type ContractorVisits = { next: string | null; last: string | null };

/** Packet statuses that are someone's work. */
export const VISIT_PACKET_STATUSES = ['claimed', 'in_progress', 'submitted', 'approved'] as const;
/** Shoot statuses that are work (not an offer, a pass or a cancellation). */
export const VISIT_SHOOT_STATUSES = ['scheduled', 'shot', 'delivered', 'approved', 'settled'] as const;

const UPCOMING_PACKET = new Set(['claimed', 'in_progress']);
const DONE_PACKET = new Set(['in_progress', 'submitted', 'approved']);
const UPCOMING_SHOOT = new Set(['scheduled']);
const DONE_SHOOT = new Set(['shot', 'delivered', 'approved', 'settled']);

export function summarizeVisits(
  packets: VisitPacketRow[],
  shoots: VisitShootRow[],
  today: string,
): Map<string, ContractorVisits> {
  const out = new Map<string, ContractorVisits>();
  const note = (cid: string | null, date: string, upcoming: boolean, done: boolean) => {
    if (!cid || !date) return;
    const v = out.get(cid) ?? { next: null, last: null };
    if (upcoming && date >= today && (v.next == null || date < v.next)) v.next = date;
    if (done && date <= today && (v.last == null || date > v.last)) v.last = date;
    out.set(cid, v);
  };
  for (const p of packets) note(p.awarded_contractor_id, p.visit_date, UPCOMING_PACKET.has(p.status), DONE_PACKET.has(p.status));
  for (const s of shoots) note(s.contractor_id, s.shoot_date, UPCOMING_SHOOT.has(s.status), DONE_SHOOT.has(s.status));
  return out;
}
