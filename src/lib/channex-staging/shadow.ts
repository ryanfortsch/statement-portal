/** Read-only proposals. No provider calls, publish payloads or execution authority. */
import type { BoardReport } from './board.ts';
import { nights, TEST_START, TEST_END, parseLedger, latestBookings, type Member } from './core.ts';
import { parentNightCurrent, PARENT_MAX_AGE_MS } from './parent-calendar.ts';
export type ShadowAction = 'keep' | 'close' | 'review-reopen' | 'review';
export type ShadowProposal = {
  id: string; date: string; member: Member; destination: 'Guesty' | 'Channex staging';
  observed: 0 | 1 | null; desired: 0 | 1; action: ShadowAction; reasons: string[];
  provenance: 'available' | 'booked' | 'unclassified-closure' | 'unknown'; conflict: boolean;
};
export type ShadowPlan = { mode: 'shadow'; executable: false; sourceAsOf: string; evaluatedAt: string; proposals: ShadowProposal[] };
export function buildShadowPlan(report: BoardReport, now = new Date()): ShadowPlan {
  const age = now.getTime() - Date.parse(report.asOf);
  const snapshotCurrent = Number.isFinite(age) && age >= 0 && age <= PARENT_MAX_AGE_MS;
  let bookings: BoardReport['bookings'] = [], validBookings = true;
  try {
    bookings = latestBookings(parseLedger({ version: 1, revisions: report.bookings }));
    if (bookings.some((b) => b.member === 'whole')) validBookings = false;
  } catch { validBookings = false; }
  const proposals: ShadowProposal[] = [];
  for (const date of nights(TEST_START, TEST_END)) {
    const parentRows = report.parentNights.filter((night) => night.date === date);
    const parent = parentRows.length === 1 ? parentRows[0] : undefined;
    const parentCurrent = !!parent && parentNightCurrent(parent, now.getTime()) && ['available', 'booked', 'unavailable'].includes(parent.status);
    const provenance = !parent ? 'unknown' : parent.status === 'booked' ? 'booked' : parent.status !== 'available' || parent.hold ? 'unclassified-closure' : 'available';
    const parentBlocked = provenance !== 'available';
    const active = bookings.filter((b) => b.status !== 'cancelled' && b.checkIn <= date && date < b.checkOut);
    const rates = report.inventory.filter((night) => night.date === date);
    const ratesSafe = rates.length === 2 && ['front', 'back'].every((unit) => {
      const rows = rates.filter((night) => night.unit === unit);
      return rows.length === 1 && rows[0].stopSell === true && rows[0].minStay === 20 && (rows[0].inventory === 0 || rows[0].inventory === 1);
    });
    const complete = snapshotCurrent && parentCurrent && validBookings && ratesSafe && report.parent.state === 'ready' && report.channex.state === 'ready';
    for (const member of ['whole', 'front', 'back'] as Member[]) {
      const relevant = active.filter((b) => member === 'whole' || member === b.member);
      const unitConflict = ['front', 'back'].some((unit) => active.filter((b) => b.member === unit).length > 1 && (member === 'whole' || member === unit));
      const conflict = unitConflict || (provenance === 'booked' && relevant.length > 0);
      const observed = member === 'whole' ? parent ? parentBlocked ? 0 : 1 : null : rates.filter((night) => night.unit === member).length === 1 ? rates.find((night) => night.unit === member)!.inventory : null;
      const desired = !complete || parentBlocked || relevant.length ? 0 : 1;
      const reasons: string[] = [];
      if (!snapshotCurrent) reasons.push('Snapshot is stale or its clock is ahead. Refresh before reviewing changes.');
      if (!parentCurrent || report.parent.state !== 'ready') reasons.push('Whole-house source is missing, stale, ambiguous or unavailable. Keep dates closed.');
      if (!validBookings || report.channex.state !== 'ready') reasons.push('Unit booking source is unavailable or inconsistent. Keep dates closed.');
      if (!ratesSafe) reasons.push('Both unit inventories, stop-sell and 20-night minimum must be verified for this night.');
      if (provenance === 'booked') reasons.push('Whole-house calendar reports a booking. Both units must remain closed.');
      if (provenance === 'unclassified-closure') reasons.push('Whole-house closure ownership is unknown. It may be an independent hold or an inherited unit block; preserve it.');
      for (const unit of ['front', 'back']) if (relevant.some((b) => b.member === unit)) reasons.push(`${unit === 'front' ? 'Front' : 'Back'} unit has an active stay; close this listing on its occupied nights.`);
      if (conflict) reasons.push('Overlapping bookings require operator review. No booking is removed.');
      let action: ShadowAction = 'keep';
      if (!complete || conflict || provenance === 'unclassified-closure') action = 'review';
      else if (observed === 1 && desired === 0) action = 'close';
      else if (observed === 0 && desired === 1) {
        action = 'review-reopen';
        reasons.push('No current booking blocks this night, but ownership of its existing closure is unverified. Do not reopen automatically.');
      }
      if (!reasons.length) reasons.push('Observed inventory matches the current booking calculation. Preserve stop-sell.');
      proposals.push({ id: `${member}:${date}`, date, member, destination: member === 'whole' ? 'Guesty' : 'Channex staging', observed, desired, action, reasons, provenance, conflict });
    }
  }
  return { mode: 'shadow', executable: false, sourceAsOf: report.asOf, evaluatedAt: now.toISOString(), proposals };
}
