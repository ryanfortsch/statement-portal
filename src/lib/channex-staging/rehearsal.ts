/** Fixed synthetic rehearsal, shared by the preview and stopped-inventory CLI.
 * Never accepts customer data and never sends a request. Guesty writes are not implemented.
 */
import { applyRevision, availability, emptyLedger, latestBookings, nights, normalizeRevision, PILOTS, TEST_START, TEST_END, type AvailabilityDay, type Hold, type Member, type Revision } from './core.ts';
import { buildBoardReport, type BoardSource, type ReviewCell } from './board.ts';
import { normalizeParentCalendar, PARENT_LISTING, PARENT_PROPERTY, PARENT_MAX_AGE_MS } from './parent-calendar.ts';

export const REHEARSAL_START = '2027-02-01';
export const REHEARSAL_END = '2027-02-04';
export const REHEARSAL_DATES = nights(REHEARSAL_START, REHEARSAL_END);
const NOW = new Date('2026-09-30T18:00:00Z');
const MEMBERS: Member[] = ['whole', 'front', 'back'];
type Vector = readonly [0 | 1, 0 | 1, 0 | 1];
type Expected = readonly [Vector, Vector, Vector];
export type RehearsalStep = {
  id: string; title: string; explanation: string; passed: boolean;
  inventory: AvailabilityDay[]; cells: ReviewCell[]; expected: Expected;
  mismatches: string[]; overlapNights: number;
};

export function bookingRehearsal(): RehearsalStep[] {
  let ledger = emptyLedger();
  let holds: Hold[] = [];
  let tick = 0;
  const result: RehearsalStep[] = [];
  function event(member: Member, status: Revision['status'], checkIn: string, checkOut: string, bookingId: string = member) {
    const revision: Revision = { id: `rehearsal-${++tick}`, bookingId, member, status, checkIn, checkOut, receivedAt: new Date(NOW.getTime() + tick * 1000).toISOString() };
    // Exercise the real normalization boundary for both test units.
    const normalized = member === 'whole' ? revision : normalizeRevision({ id: revision.id, attributes: {
      booking_id: bookingId, property_id: PILOTS[member].propertyId, ota_name: 'Offline', ota_reservation_code: `HELMTEST-rehearsal-${bookingId}`,
      status, arrival_date: checkIn, departure_date: checkOut, inserted_at: revision.receivedAt,
      rooms: [{ room_type_id: PILOTS[member].roomTypeId, checkin_date: checkIn, checkout_date: checkOut }],
    } });
    ledger = applyRevision(ledger, normalized).ledger;
    return normalized;
  }
  function capture(id: string, title: string, explanation: string, expected: Expected, options: { stale?: boolean; missing?: string; channexFailed?: boolean; overlap?: number } = {}) {
    const parentBookings = latestBookings(ledger).filter((b) => b.member === 'whole');
    const parentDays = availability({ version: 1, revisions: parentBookings }, holds, TEST_START, TEST_END, { whole: true, front: true, back: true }).filter((day) => day.member === 'whole');
    const rawParent = parentDays.filter((day) => day.date !== options.missing).map((day) => ({
      property_id: PARENT_PROPERTY, date: day.date,
      status: parentBookings.some((b) => b.status !== 'cancelled' && b.checkIn <= day.date && day.date < b.checkOut) ? 'booked' : day.availability ? 'available' : 'unavailable',
      block_type: holds.some((h) => h.checkIn <= day.date && day.date < h.checkOut) ? 'm' : null,
      synced_at: new Date(NOW.getTime() - (options.stale ? PARENT_MAX_AGE_MS + 1 : 0)).toISOString(),
    }));
    const parent = normalizeParentCalendar({ id: PARENT_PROPERTY, calendar_authority: 'guesty' }, [{ property_id: PARENT_PROPERTY, listing_id: PARENT_LISTING }], rawParent);
    const ready: BoardSource = { state: 'ready', message: 'Synthetic rehearsal source' };
    const report = buildBoardReport(options.channexFailed ? null : { mappings: [], inventory: [], bookings: latestBookings(ledger).filter((b) => b.member !== 'whole') }, parent, {
      parent: ready, channex: options.channexFailed ? { state: 'failed', message: 'Simulated outage' } : ready,
    }, NOW);
    const cells = report.cells.filter((cell) => REHEARSAL_DATES.includes(cell.date));
    // Unknown inputs always yield zero. These are test inventory values, never sellable nights.
    const inventory: AvailabilityDay[] = cells.map((cell) => ({ member: cell.member, date: cell.date, availability: cell.state === 'clear' ? 1 : 0, blockers: cell.reasons }));
    const mismatches: string[] = [];
    REHEARSAL_DATES.forEach((date, d) => MEMBERS.forEach((member, m) => {
      if (inventory.find((day) => day.member === member && day.date === date)?.availability !== expected[d][m]) mismatches.push(`${date}: ${member}`);
    }));
    if (report.overlapNights !== (options.overlap ?? 0)) mismatches.push('Unexpected overlap count');
    result.push({ id, title, explanation, inventory, cells, expected, mismatches, overlapNights: report.overlapNights, passed: mismatches.length === 0 });
  }
  const open: Vector = [1, 1, 1], closed: Vector = [0, 0, 0], back: Vector = [0, 1, 0], front: Vector = [0, 0, 1];
  capture('empty', 'No stays or holds', 'All three listings have unoccupied inventory in the model. Both staging units still remain stopped.', [open, open, open]);
  event('whole', 'new', '2027-02-01', '2027-03-01');
  capture('whole-booked', 'Whole house booked', 'A whole-house stay consumes both physical units.', [closed, closed, closed]);
  event('whole', 'modified', '2027-02-03', '2027-03-03');
  capture('whole-moved', 'Whole-house dates move', 'Only the vacated nights are released. February 3 remains occupied in all three listings.', [open, open, closed]);
  holds = [{ id: 'independent-maintenance', member: 'whole', checkIn: '2027-02-02', checkOut: '2027-02-03' }];
  event('whole', 'cancelled', '2027-02-03', '2027-03-03');
  capture('hold-survives', 'Cancellation preserves a hold', 'The stay is cancelled, but the independent February 2 maintenance hold still closes both units.', [open, closed, open]);
  holds = [];
  event('back', 'new', '2027-01-15', '2027-03-15');
  capture('back-long-stay', 'Back unit books for two months', 'The whole house closes. The front unit stays independent, with its 20-night minimum unchanged.', [back, back, back]);
  const originalFront = event('front', 'new', '2027-02-01', '2027-02-21');
  capture('both-units', 'Both units book separately', 'Concurrent front and back stays are valid. The whole house stays closed.', [closed, closed, closed]);
  event('front', 'modified', '2027-02-03', '2027-02-23');
  capture('front-moved', 'Front-unit dates move', 'February 1 and 2 reopen only in front. The back stay keeps the whole house closed.', [back, back, closed]);
  event('back', 'cancelled', '2027-01-15', '2027-03-15');
  capture('back-cancelled', 'Back stay cancels first', 'The front stay still blocks the whole house on February 3.', [open, open, front]);
  event('front', 'cancelled', '2027-02-03', '2027-02-23');
  capture('both-cancelled', 'Both stays cancelled', 'The calculation releases the nights only after both stays and all holds are gone.', [open, open, open]);
  ledger = applyRevision(ledger, originalFront).ledger;
  ledger = applyRevision(ledger, { ...originalFront, id: 'late-front-revision' }).ledger;
  capture('delayed-replay', 'Old booking arrives again', 'Duplicate and late pre-cancellation revisions cannot restore the cancelled stay.', [open, open, open]);
  capture('stale-parent', 'Whole-house copy goes stale', 'A copy older than two hours closes calculated inventory across all three listings.', [closed, closed, closed], { stale: true });
  capture('missing-night', 'One whole-house night is missing', 'Only the missing night is unverified. That night closes all three listings.', [open, closed, open], { missing: '2027-02-02' });
  capture('unit-outage', 'Channex read fails', 'An unavailable unit source is never treated as an empty booking list.', [closed, closed, closed], { channexFailed: true });
  capture('recovered', 'Fresh sources recover', 'A complete fresh read recalculates every listing from current stays and holds.', [open, open, open]);
  event('back', 'new', '2027-02-01', '2027-02-21', 'overlap-back');
  event('whole', 'new', '2027-02-01', '2027-02-21', 'overlap-whole');
  capture('conflicting-bookings', 'Whole-house and unit overlap', 'Overlapping stays are flagged for review and retained. Nothing is silently cancelled.', [closed, closed, closed], { overlap: 20 });
  return result;
}
