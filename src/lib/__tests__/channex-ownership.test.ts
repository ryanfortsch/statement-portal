import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRevision, emptyLedger, type Ledger, type Revision } from '../channex-staging/core.ts';
import { planOwnership } from '../channex-staging/ownership.ts';
const add = (ledger: Ledger, id: string, member: Revision['member'], bookingId = id, status: Revision['status'] = 'new', time = '01', checkIn = '2027-02-01', checkOut = '2027-02-03') => applyRevision(ledger, { id, member, bookingId, status, receivedAt: `2026-10-02T10:00:${time}Z`, checkIn, checkOut }).ledger;
const day = (p: ReturnType<typeof planOwnership>, target: Revision['member'], date = '2027-02-01') => p.nights.find((n) => n.target === target && n.date === date)!;
test('unit ownership blocks whole and itself, never its sibling; checkout excluded', () => {
 const p = planOwnership(emptyLedger(), add(emptyLedger(), 'back', 'back'), [], true);
 assert.equal(p.executable, false); assert.equal(p.nights.length, 360);
 assert.equal(day(p, 'whole').claims.length, 1); assert.equal(day(p, 'back').claims.length, 1);
 assert.equal(day(p, 'front').decision, 'review-only'); assert.equal(day(p, 'back', '2027-02-03').claims.length, 0);
});
test('cancelling one unit releases only its claims and retains another booking plus independent hold', () => {
 const before = add(add(emptyLedger(), 'b', 'back'), 'f', 'front');
 const after = add(before, 'cancel', 'back', 'b', 'cancelled', '02');
 const p = planOwnership(before, after, [{ id: 'owner', member: 'back', checkIn: '2027-02-01', checkOut: '2027-02-04' }], true);
 assert.ok(p.releasedClaims.every((c) => c.bookingKey === 'back:b'));
 assert.equal(day(p, 'whole').claims.length, 1); assert.deepEqual(day(p, 'back').independentHolds, ['back:owner']);
 assert.equal(day(p, 'back').decision, 'blocked');
});
test('whole booking owns three sets of claims; cancellation never authorizes reopening', () => {
 const before = add(emptyLedger(), 'w', 'whole');
 const p = planOwnership(before, add(before, 'wc', 'whole', 'w', 'cancelled', '02'), [], true);
 assert.equal(p.releasedClaims.length, 6); assert.equal(p.claims.length, 0);
 assert.ok(p.nights.every((n) => n.decision === 'review-only'));
});
test('date change releases only removed nights and keeps overlapping claim identity', () => {
 const before = add(emptyLedger(), 'b', 'back');
 const p = planOwnership(before, add(before, 'move', 'back', 'b', 'modified', '02', '2027-02-02', '2027-02-04'), [], true);
 assert.ok(p.releasedClaims.every((c) => c.date === '2027-02-01'));
 assert.equal(day(p, 'whole', '2027-02-02').claims[0], 'back:b:whole:2027-02-02');
});
test('incomplete source retains removed claims; missing history rejected', () => {
 const before = add(emptyLedger(), 'b', 'back');
 const p = planOwnership(before, add(before, 'c', 'back', 'b', 'cancelled', '02'), [], false);
 assert.equal(p.releasedClaims.length, 0); assert.equal(p.claims.length, 4);
 assert.ok(p.nights.every((n) => n.decision === 'blocked'));
 assert.throws(() => planOwnership(before, emptyLedger(), [], true), /Incomplete/);
});
test('late revision cannot resurrect cancelled claims; replay is deterministic', () => {
 const before = add(emptyLedger(), 'b', 'back');
 const cancelled = add(before, 'c', 'back', 'b', 'cancelled', '03');
 const late = add(cancelled, 'late', 'back', 'b', 'modified', '02');
 const p = planOwnership(before, late, [], true);
 assert.equal(p.claims.length, 0); assert.deepEqual(p, planOwnership(before, late, [], true));
});
test('same booking identifiers in different listings have distinct ownership', () => {
 const l = add(add(emptyLedger(), 'a', 'front', 'same'), 'b', 'back', 'same');
 assert.equal(new Set(day(planOwnership(emptyLedger(), l, [], true), 'whole').claims).size, 2);
});
