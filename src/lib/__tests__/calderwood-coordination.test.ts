import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendEvents, rehearseCoordination, type Event, type Coverage } from '../calderwood-rehearsal/coordination.ts';
const event = (changes: Partial<Event> = {}): Event => ({ mode: 'synthetic', source: 'guesty', id: 'HELMTEST-a1', resourceId: 'HELMTEST-a', revision: 1, kind: 'reservation', status: 'active', start: '2027-01-01', end: '2027-01-04', ...changes });
const coverage: Coverage[] = [{ source: 'guesty', complete: true, observedAt: 1000 }, { source: 'channex', complete: true, observedAt: 1000 }];
const plan = (events: Event[], overrides = {}) => rehearseCoordination({ events, coverage, start: '2027-01-01', end: '2027-01-05', now: 1100, maxAgeMs: 200, ...overrides });
test('cancellation preserves another channel reservation and an independent hold', () => {
  let ledger = appendEvents([], [event(), event({ source: 'channex', id: 'HELMTEST-b1', resourceId: 'HELMTEST-b', start: '2027-01-02' }), event({ id: 'HELMTEST-h1', resourceId: 'HELMTEST-h', kind: 'independent-hold', start: '2027-01-03' })]);
  assert.equal(plan(ledger).nights[1].possibleReservationConflict, true);
  ledger = appendEvents(ledger, [event({ id: 'HELMTEST-a2', revision: 2, status: 'cancelled' })]);
  const result = plan(ledger);
  assert.equal(result.nights[0].decision, 'clear-for-review');
  assert.equal(result.nights[1].decision, 'blocked');
  assert.equal(result.nights[2].blockers.length, 2);
  assert.equal(result.nights[3].decision, 'clear-for-review');
  assert.equal(result.executable, false);
});
test('late active revision cannot resurrect cancelled booking; duplicates and restart replay are stable', () => {
  const cancelled = event({ id: 'HELMTEST-a2', revision: 2, status: 'cancelled' });
  const ledger = appendEvents([cancelled], [event(), cancelled]);
  assert.equal(ledger.length, 2);
  assert.deepEqual(plan(appendEvents(JSON.parse(JSON.stringify(ledger)), [event()])), plan(ledger));
  assert.ok(plan(ledger).nights.every(n => n.decision === 'clear-for-review'));
});
test('empty incremental reads retain booking; date alteration moves only its claim', () => {
  const ledger = appendEvents([event()], []);
  assert.equal(plan(ledger).nights[0].decision, 'blocked');
  const changed = appendEvents(ledger, [event({ id: 'HELMTEST-a2', revision: 2, start: '2027-01-02', end: '2027-01-03' })]);
  assert.deepEqual(plan(changed).nights.map(n => n.decision), ['clear-for-review', 'blocked', 'clear-for-review', 'clear-for-review']);
});
test('missing, incomplete, stale and future source observations withhold all nights', () => {
  for (const rows of [coverage.slice(0, 1), [coverage[0], { ...coverage[1], complete: false }], [coverage[0], { ...coverage[1], observedAt: 800 }], [coverage[0], { ...coverage[1], observedAt: 1200 }]]) {
    const result = plan([event()], { coverage: rows });
    assert.deepEqual(result.incompleteSources, ['channex']);
    assert.ok(result.nights.every(n => n.decision === 'withhold'));
    assert.equal(result.nights[0].blockers.length, 1);
  }
});
test('unknown block remains independent of reservation cancellation', () => {
  const events = appendEvents([event({ kind: 'unknown-block' })], [event({ source: 'channex', status: 'cancelled' })]);
  assert.equal(plan(events).nights[0].decision, 'blocked');
});
test('ambiguous revisions and resource kind changes are rejected without mutating input', () => {
  const initial = [event()];
  for (const change of [{ start: '2027-01-02' }, { id: 'HELMTEST-other' }, { id: 'HELMTEST-a2', revision: 2, kind: 'independent-hold' as const }]) assert.throws(() => appendEvents(initial, [event(change)]));
  assert.deepEqual(initial, [event()]);
});
test('rejects live IDs, bad dates and duplicate coverage; retains no arbitrary guest fields', () => {
  assert.throws(() => appendEvents([], [event({ resourceId: 'live-id' })]));
  assert.throws(() => appendEvents([], [event({ start: '2027-02-30' })]));
  assert.throws(() => plan([], { coverage: [coverage[0], coverage[0]] }));
  assert.throws(() => plan([], { maxAgeMs: Infinity }));
  const withExtra = { ...event(), guestName: 'Synthetic Guest' };
  assert.equal('guestName' in appendEvents([], [withExtra])[0], false);
});
