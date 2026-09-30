/** Serializable, credential-free model for the read-only staging board. */
import { availability, nights, TEST_START, TEST_END, type Member, type Revision, type Hold } from './core.ts';
import { parentNightCurrent, type ParentCalendar, type ParentNight } from './parent-calendar.ts';
import type { StagingSnapshot, StagingNight } from './client.ts';

export type SourceState = 'ready' | 'unconfigured' | 'failed';
export type BoardSource = { state: SourceState; message: string };
export type ReviewCell = { member: Member; date: string; state: 'clear' | 'blocked' | 'unknown'; reasons: string[]; overlap: boolean };
export type BoardReport = {
  asOf: string; channex: BoardSource; parent: BoardSource; bookings: Revision[]; inventory: StagingNight[];
  parentNights: ParentNight[]; cells: ReviewCell[]; currentParentNights: number; stoppedNights: number; overlapNights: number;
};
export function stagingBoardEnabled(env: { CHANNEX_STAGING_ENABLED?: string; VERCEL_ENV?: string; NODE_ENV?: string }): boolean {
  return env.CHANNEX_STAGING_ENABLED === 'true' && (env.VERCEL_ENV === 'preview' || ((!env.VERCEL_ENV || env.VERCEL_ENV === 'development') && env.NODE_ENV !== 'production'));
}
export function buildBoardReport(snapshot: StagingSnapshot | null, parent: ParentCalendar | null, sources: { channex: BoardSource; parent: BoardSource }, now = new Date()): BoardReport {
  const dates = nights(TEST_START, TEST_END), bookings = snapshot?.bookings ?? [];
  const parentByDate = new Map(parent?.nights.map((night) => [night.date, night]));
  const holds: Hold[] = (parent?.nights ?? []).filter((night) => night.status !== 'available' || night.hold).map((night) => ({ id: `whole-${night.date}`, member: 'whole', checkIn: night.date, checkOut: new Date(Date.parse(night.date) + 86400000).toISOString().slice(0, 10) }));
  const cells: ReviewCell[] = [];
  let currentParentNights = 0, overlapNights = 0;
  for (const date of dates) {
    const parentNight = parentByDate.get(date), current = sources.parent.state === 'ready' && parentNightCurrent(parentNight, now.getTime());
    if (current) currentParentNights++;
    const end = new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10);
    const unitBookings = bookings.filter((b) => b.status !== 'cancelled' && b.checkIn <= date && date < b.checkOut);
    const wholeBlocked = !!parentNight && (parentNight.status !== 'available' || parentNight.hold);
    const overlapping = wholeBlocked && unitBookings.length > 0;
    if (overlapping) overlapNights++;
    const complete = !!snapshot && sources.channex.state === 'ready' && current;
    const projected = availability({ version: 1, revisions: bookings }, holds, date, end, { whole: complete, front: complete, back: complete });
    for (const day of projected) {
      const reasons: string[] = [];
      if (sources.channex.state !== 'ready' || !snapshot) reasons.push('Channex test bookings could not be verified.');
      if (!current) reasons.push(!parentNight ? 'No verified whole-house calendar row for this night.' : 'The whole-house calendar copy is stale or its clock is ahead.');
      if (wholeBlocked) reasons.push(parentNight!.status === 'booked' ? 'Whole house is booked in the Guesty calendar copy.' : parentNight!.hold ? 'Whole house has an owner or maintenance hold.' : 'Whole house is closed in the Guesty calendar copy.');
      const relevant = unitBookings.filter((b) => day.member === 'whole' || b.member === day.member);
      for (const booking of relevant) reasons.push(`${booking.member === 'front' ? 'Front' : 'Back'} unit has an active test booking.`);
      if (relevant.length > 1 && day.member !== 'whole') reasons.push('More than one test booking occupies this unit.');
      cells.push({ member: day.member, date, state: !complete ? 'unknown' : day.availability === 0 ? 'blocked' : 'clear', reasons, overlap: overlapping || (day.member !== 'whole' && relevant.length > 1) });
    }
  }
  return { asOf: now.toISOString(), ...sources, bookings, inventory: snapshot?.inventory ?? [], parentNights: parent?.nights ?? [], cells, currentParentNights, stoppedNights: snapshot?.inventory.filter((d) => d.stopSell === true).length ?? 0, overlapNights };
}
