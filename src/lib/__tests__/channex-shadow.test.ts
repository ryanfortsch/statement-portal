import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShadowPlan } from '../channex-staging/shadow.ts';
import { buildBoardReport } from '../channex-staging/board.ts';
import { nights, TEST_START, TEST_END, type Revision } from '../channex-staging/core.ts';
const now = new Date('2026-10-02T14:00:00Z');
const sources = { channex: { state: 'ready' as const, message: '' }, parent: { state: 'ready' as const, message: '' } };
const booking = (member: 'front' | 'back' = 'back', extra: Partial<Revision> = {}): Revision => ({ member, id: member, bookingId: member, status: 'new', checkIn: '2027-02-01', checkOut: '2027-03-01', receivedAt: '2026-10-02T12:00:00Z', ...extra });
const report = (bookings: Revision[] = []) => buildBoardReport({ mappings: [], bookings, inventory: (['front', 'back'] as const).flatMap((unit) => nights(TEST_START, TEST_END).map((date) => ({ unit, date, inventory: 1 as const, stopSell: true, minStay: 20 }))) }, { nights: nights(TEST_START, TEST_END).map((date) => ({ date, status: 'available' as const, hold: false, syncedAt: now.toISOString() })) }, structuredClone(sources), now);
const cell = (r: ReturnType<typeof report>, member = 'whole', date = '2027-02-01') => buildShadowPlan(r, now).proposals.find((p) => p.member === member && p.date === date)!;
test('shadow plan is non-executable, covers exactly 360 scoped nights and proposes unit-to-whole closure', () => {
  const r = report([booking()]), plan = buildShadowPlan(r, now);
  assert.equal(plan.executable, false); assert.equal(plan.mode, 'shadow'); assert.equal(plan.proposals.length, 360);
  assert.equal(cell(r).action, 'close'); assert.equal(cell(r).destination, 'Guesty');
  assert.equal(cell(r, 'back').action, 'close'); assert.equal(cell(r, 'front').action, 'keep');
  assert.equal(cell(r, 'whole', '2027-03-01').action, 'keep');
});
test('whole-house booking proposes both unit closures, but an unclassified hold requires review', () => {
  const r = report(), night = r.parentNights.find((n) => n.date === '2027-02-01')!;
  night.status = 'booked';
  assert.equal(cell(r, 'front').action, 'close'); assert.equal(cell(r, 'back').action, 'close');
  night.status = 'unavailable';
  assert.equal(cell(r).provenance, 'unclassified-closure'); assert.equal(cell(r).action, 'review');
  assert.equal(cell(r, 'front').action, 'review'); assert.equal(cell(r, 'front').desired, 0);
  night.status = 'available'; night.hold = true;
  assert.equal(cell(r).action, 'review');
});
test('cancellation cannot automatically reopen pre-existing zero inventory', () => {
  const r = report([booking('back', { status: 'cancelled' })]);
  r.inventory.find((n) => n.date === '2027-02-01' && n.unit === 'back')!.inventory = 0;
  assert.equal(cell(r, 'back').action, 'review-reopen'); assert.equal(cell(r, 'back').desired, 1);
  assert.match(cell(r, 'back').reasons.join(' '), /ownership.*unverified/);
});
test('replayed older revisions do not resurrect cancelled stays or duplicate occupancy', () => {
  const r = report([booking(), booking('back', { id: 'cancel', status: 'cancelled', receivedAt: '2026-10-02T13:00:00Z' }), booking('back', { id: 'late', status: 'modified', receivedAt: '2026-10-02T12:30:00Z' })]);
  assert.equal(cell(r).action, 'keep'); assert.equal(cell(r).desired, 1);
});
test('ambiguous revisions, failed sources, stale snapshots and future clocks freeze proposals', () => {
  const r = report([booking(), booking('back', { id: 'ambiguous' })]);
  assert.equal(cell(r).action, 'review'); assert.equal(cell(r).desired, 0);
  for (const age of [7200001, -1]) {
    const plan = buildShadowPlan(report(), new Date(now.getTime() + age));
    assert.ok(plan.proposals.every((p) => p.action === 'review' && p.desired === 0));
  }
  const failed = report(); failed.channex.state = 'failed';
  assert.equal(cell(failed).action, 'review');
});
test('missing or duplicated parent nights and unsafe rate data never produce reopen proposals', () => {
  for (const failure of ['missing', 'duplicate', 'stop', 'minimum', 'inventory']) {
    const r = report();
    if (failure === 'missing') r.parentNights = r.parentNights.filter((n) => n.date !== '2027-02-01');
    if (failure === 'duplicate') r.parentNights.push(r.parentNights.find((n) => n.date === '2027-02-01')!);
    const rate = r.inventory.find((n) => n.date === '2027-02-01')!;
    if (failure === 'stop') rate.stopSell = false;
    if (failure === 'minimum') rate.minStay = 2;
    if (failure === 'inventory') rate.inventory = null;
    assert.equal(cell(r).action, 'review', failure); assert.equal(cell(r).desired, 0, failure);
  }
});
test('simultaneous siblings are valid; same-unit or whole/unit overlaps are review-only', () => {
  assert.equal(cell(report([booking(), booking('front')])).conflict, false);
  const r = report([booking(), booking('back', { id: 'second', bookingId: 'second' })]);
  assert.equal(cell(r).conflict, true); assert.equal(cell(r).action, 'review');
  const whole = report([booking()]); whole.parentNights.find((n) => n.date === '2027-02-01')!.status = 'booked';
  assert.equal(cell(whole).conflict, true);
});
test('date changes retain sibling closures and proposal identity is stable across reevaluation', () => {
  const r = report([booking(), booking('front'), booking('front', { id: 'move', status: 'modified', checkIn: '2027-02-10', checkOut: '2027-03-02', receivedAt: '2026-10-02T13:00:00Z' })]);
  assert.equal(cell(r).action, 'close', JSON.stringify(cell(r))); assert.equal(cell(r, 'front').action, 'keep');
  assert.equal(cell(r).id, buildShadowPlan(r, new Date(now.getTime() + 1000)).proposals.find((p) => p.date === '2027-02-01' && p.member === 'whole')!.id);
});
