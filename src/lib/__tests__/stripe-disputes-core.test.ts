import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkoutTermsState,
  daysLeft,
  disputePacketPath,
  disputeTask,
  disputeTaskTag,
  needsResponse,
  planDisputeTasks,
  sortDisputes,
  type DisputeListing,
} from '../stripe-disputes-core.ts';
import { TEAM_MEMBERS } from '../team.ts';

const d = (over: Partial<DisputeListing> = {}): DisputeListing => ({
  propertyId: '21_horton',
  disputeId: 'dp_1',
  chargeId: 'ch_1',
  amountCents: 81100,
  reason: 'credit_not_processed',
  status: 'needs_response',
  dueBy: '2026-11-20',
  openedOn: '2026-11-01',
  ...over,
});

test('only the statuses that wait on us need a response', () => {
  assert.ok(needsResponse('needs_response'));
  assert.ok(needsResponse('warning_needs_response'));
  for (const s of ['under_review', 'won', 'lost', 'warning_closed', null]) assert.ok(!needsResponse(s));
});

test('a dispute waiting on us becomes one high-priority to-do, due Stripe\'s deadline, linking the packet', () => {
  const t = disputeTask(d(), '21 Horton', 'https://helm.risingtidestr.com/');
  assert.equal(t.title, 'Answer the $811.00 card dispute at 21 Horton');
  assert.equal(t.due_date, '2026-11-20');
  assert.equal(t.priority, 'high');
  assert.deepEqual(t.property_ids, ['21_horton']);
  assert.ok(t.tags.includes(disputeTaskTag('dp_1')));
  assert.ok(t.description.includes('https://helm.risingtidestr.com/payments/disputes/21_horton/ch_1'));
  assert.ok(t.description.includes('Helm submits nothing'));
});

test('the run files each waiting dispute once, even after the to-do was dismissed', () => {
  const plan = planDisputeTasks(
    [d(), d({ disputeId: 'dp_2' }), d({ disputeId: 'dp_3' })],
    [
      { id: 't1', tags: ['stripe-dispute:dp_1', 'stripe-dispute'], status: 'open' },
      { id: 't2', tags: ['stripe-dispute:dp_2', 'stripe-dispute'], status: 'archived' },
    ],
  );
  assert.deepEqual(plan.create.map((x) => x.disputeId), ['dp_3']);
  assert.deepEqual(plan.close, []);
});

test('a to-do closes once Stripe no longer waits on us; a dispute not read this run is left alone', () => {
  const plan = planDisputeTasks(
    [d({ status: 'under_review' }), d({ disputeId: 'dp_2', status: 'lost' })],
    [
      { id: 't1', tags: ['stripe-dispute:dp_1'], status: 'open' },
      { id: 't2', tags: ['stripe-dispute:dp_2'], status: 'done' },
      { id: 't9', tags: ['stripe-dispute:dp_9'], status: 'open' },
    ],
  );
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.close, ['t1']);
});

test('the list puts waiting disputes first, soonest deadline first', () => {
  const s = sortDisputes([
    d({ disputeId: 'won', status: 'won', openedOn: '2026-10-01' }),
    d({ disputeId: 'late', dueBy: '2026-11-30' }),
    d({ disputeId: 'soon', dueBy: '2026-11-10' }),
  ]);
  assert.deepEqual(s.map((x) => x.disputeId), ['soon', 'late', 'won']);
});

test('daysLeft counts calendar days', () => {
  assert.equal(daysLeft('2026-11-10', '2026-11-06'), 4);
  assert.equal(daysLeft('2026-11-05', '2026-11-06'), -1);
  assert.equal(daysLeft(null, '2026-11-06'), null);
});

test('the packet path is encoded', () => {
  assert.equal(disputePacketPath({ propertyId: '21_horton', chargeId: 'ch_1' }), '/payments/disputes/21_horton/ch_1');
});

test('checkout terms: required only when the link itself requires them', () => {
  assert.equal(checkoutTermsState({ consent_collection: { terms_of_service: 'required' } }, 'ok'), 'required');
  assert.equal(checkoutTermsState({ consent_collection: null }, 'ok'), 'refused');
  assert.equal(checkoutTermsState(null, 'none'), 'no_recent_link');
  assert.equal(checkoutTermsState(null, 'failed'), 'unread');
});

test('someone holds the disputes duty, and the cron never submits to Stripe', () => {
  assert.ok(TEAM_MEMBERS.some((m) => m.active && m.duties?.includes('disputes')));
  const route = readFileSync(new URL('../../app/api/cron/stripe-disputes/route.ts', import.meta.url), 'utf8');
  assert.ok(route.includes('authorizeCron'));
  assert.ok(!/stripePost|method:\s*'POST'/.test(route), 'read-only: no Stripe write');
  const loader = readFileSync(new URL('../stripe-disputes.ts', import.meta.url), 'utf8');
  assert.ok(!/stripePost|method:\s*'POST'/.test(loader), 'read-only: no Stripe write');
});
