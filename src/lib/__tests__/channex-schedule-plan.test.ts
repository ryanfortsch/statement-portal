import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileCalderwoodTemplates } from '../channex-messaging/template-migration.ts';
import { parsePreparationRules } from '../channex-messaging/preparation-rules.ts';
import { parseScheduleLedger, planCalderwoodSchedule, type ScheduleLedgerRow } from '../channex-messaging/schedule-plan.ts';
import { resolveAutomationsFor, fireAtFor, decideDispatch, planAutomationSends, type AutomationBooking } from '../automations-core.ts';
import { syntheticCapture } from './fixtures/channex-template-capture.ts';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = Date.parse('2026-11-11T16:00:00Z');
const rules = () => parsePreparationRules(compileCalderwoodTemplates(syntheticCapture, now).map((r, i) => ({ ...r, id: uid(i + 1),
  property_id: '65_calderwood', audience: r.key.startsWith('cleaner_') ? 'cleaner' : 'guest',
  trigger: r.key.startsWith('cleaner_') ? 'pre_arrival' : r.key, offset_days: 0, at_local: null,
  timezone: 'America/New_York', channel_exclusions: [], delivery: r.key.startsWith('cleaner_') ? 'sms' : 'ota_manual',
  send_mode: 'approve', min_nights: null, subject: null, enabled: false, configured_in_ota: true })));
const stay = { canonicalId: uid(100), status: 'confirmed', duplicateOf: null as string | null,
  clocks: { start: '2026-11-24', end: '2026-11-28', timezone: 'America/New_York', plannedArrival: null,
    plannedDeparture: null, defaultArrival: '16:00', defaultDeparture: '11:00', confirmedAt: '2026-11-11T15:50:00Z' } };
const input = () => ({ stay: structuredClone(stay), rules: rules(), ledger: [] as ScheduleLedgerRow[], now });
const plan = (i = input()) => planCalderwoodSchedule(i);
const entry = (patch: Partial<ScheduleLedgerRow> = {}): ScheduleLedgerRow => ({ id: uid(200), booking_id: stay.canonicalId,
  property_id: '65_calderwood', automation_id: uid(5), automation_key: 'cleaner_reminder',
  fire_at: '2026-11-14T21:00:00Z', status: 'scheduled', planned_check_in: stay.clocks.start,
  planned_check_out: stay.clocks.end, sent_at: null, provider_message_id: null, ...patch });
const cleaner = (i: ReturnType<typeof input>) => plan(i).find(r => r.key === 'cleaner_reminder')!;

test('the six captured offsets produce stable identities and exact relative instants', () => {
  const p = plan();
  assert.deepEqual(p.map(r => r.fireAt), ['2026-11-11T16:20:00.000Z', '2026-11-23T21:00:00.000Z',
    '2026-11-24T20:00:00.000Z', '2026-11-27T16:00:00.000Z', '2026-11-14T21:00:00.000Z', '2026-11-24T14:00:00.000Z']);
  assert.ok(p.every(r => r.state === 'future_candidate' && !r.canSchedule && !r.canSend));
  assert.equal(new Set(p.map(r => r.identity)).size, 6);
  assert.deepEqual(plan({ ...input(), now: now + 60_000 }), p);
  const replacement = input(); replacement.rules = replacement.rules.map((r, i) => ({ ...r, id: uid(i + 1000) }));
  assert.deepEqual(plan(replacement).map(r => r.identity), p.map(r => r.identity));
  assert.equal(JSON.stringify(p).includes('Synthetic'), false);
});
test('past and exactly due times are never bootstrapped to now on a retry', () => {
  const i = input(); i.now = Date.parse('2026-11-24T20:00:00Z');
  const p = plan(i);
  assert.equal(p.find(r => r.key === 'checkin_day')!.state, 'past_not_replayed');
  assert.equal(p.find(r => r.key === 'checkin_day')!.fireAt, '2026-11-24T20:00:00.000Z');
  assert.equal(p.find(r => r.key === 'booking_confirmed')!.state, 'past_not_replayed');
  assert.equal(p.find(r => r.key === 'pre_checkout')!.state, 'future_candidate');
});
test('seasonal times and missing explicit source clocks retain their actual meaning', () => {
  const i = input(); i.stay.clocks.start = '2027-05-20'; i.stay.clocks.end = '2027-05-24';
  assert.equal(plan(i).find(r => r.key === 'checkin_day')!.fireAt, '2027-05-20T19:00:00.000Z');
  i.stay.clocks.defaultArrival = '';
  assert.equal(cleaner(i).state, 'timing_review');
});
test('both DST changes block day offsets instead of inventing elapsed/calendar equivalence', () => {
  for (const [start, end] of [['2027-03-14', '2027-03-18'], ['2027-11-07', '2027-11-11']]) {
    const i = input(); Object.assign(i.stay.clocks, { start, end });
    assert.equal(cleaner(i).state, 'dst_review');
    assert.equal(cleaner(i).fireAt, null);
    assert.equal(plan(i).find(r => r.key === 'checkin_day')!.state, 'future_candidate');
  }
});
test('cancelled, inquiry, completed and duplicate stays never yield a new plan', () => {
  for (const status of ['cancelled', 'inquiry', 'completed', 'block']) {
    const i = input(); i.stay.status = status;
    assert.ok(plan(i).every(p => p.state === 'stay_inactive'));
  }
  const i = input(); i.stay.duplicateOf = uid(777);
  assert.ok(plan(i).every(p => p.state === 'stay_inactive'));
});
test('the same scheduled identity is retained, including at or after its due time', () => {
  const i = input(); i.ledger = [entry()];
  assert.equal(cleaner(i).state, 'existing_schedule');
  i.now = Date.parse('2026-11-15T01:00:00Z');
  assert.equal(cleaner(i).state, 'existing_schedule');
  assert.equal(cleaner(i).canSend, false);
});
test('booking date, departure date and send-time changes do not create a second row', () => {
  for (const patch of [{ start: '2026-11-25' }, { end: '2026-11-29' }, { defaultArrival: '17:00' }]) {
    const i = input(); i.ledger = [entry()]; Object.assign(i.stay.clocks, patch);
    assert.equal(cleaner(i).state, 'schedule_changed');
  }
  const i = input(); i.ledger = [entry({ fire_at: '2026-11-14T21:00:00.001Z' })];
  assert.equal(cleaner(i).state, 'schedule_changed');
});
test('sent history survives rule replacement, deletion and mismatched legacy status', () => {
  for (const patch of [{ status: 'sent' as const }, { status: 'scheduled' as const, sent_at: '2026-11-10T12:00:00Z' }]) {
    const i = input(); i.ledger = [entry({ ...patch, automation_id: uid(999) })];
    assert.equal(cleaner(i).state, 'already_sent');
    i.ledger[0].automation_id = null;
    assert.equal(cleaner(i).state, 'already_sent');
  }
});
test('in-flight, failed and provider-marked attempts never become automatic retries', () => {
  for (const patch of [{ status: 'sending' as const }, { status: 'failed' as const },
    { status: 'scheduled' as const, provider_message_id: 'PRIVATE_PROVIDER_ID' }]) {
    const i = input(); i.ledger = [entry({ ...patch, automation_id: uid(999) })];
    assert.equal(cleaner(i).state, 'delivery_uncertain');
    assert.equal(JSON.stringify(plan(i)).includes('PRIVATE_PROVIDER_ID'), false);
  }
});
test('all held and skipped decisions survive replanning and date changes', () => {
  for (const status of ['awaiting_approval', 'cancelled', 'configured_in_ota', 'skipped_no_contact',
    'skipped_channel', 'skipped_cancelled', 'skipped_dates_moved'] as const) {
    const i = input(); i.ledger = [entry({ status })]; i.stay.clocks.start = '2026-11-25';
    assert.equal(cleaner(i).state, 'held');
  }
});
test('duplicate, orphaned and contradictory histories fail closed', () => {
  const i = input(); i.ledger = [entry(), entry({ id: uid(201), automation_id: uid(999) })];
  assert.equal(cleaner(i).state, 'history_conflict');
  i.ledger = [entry({ automation_id: uid(999), automation_key: null })];
  assert.ok(plan(i).every(p => p.state === 'history_conflict'));
  i.ledger = [entry({ automation_key: 'checkin_day' })];
  assert.ok(plan(i).every(p => p.state === 'history_conflict'));
});
test('a known fleet row without a stored key still blocks the same workflow', () => {
  const i = input(); i.rules.push({ ...i.rules[4], id: uid(900), property_id: null, migration_policy: null });
  i.ledger = [entry({ automation_id: uid(900), automation_key: null, status: 'sent' })];
  assert.equal(cleaner(i).state, 'already_sent');
  i.ledger[0].status = 'scheduled';
  assert.equal(cleaner(i).state, 'history_conflict');
});
test('unrelated stays and unrelated workflow history cannot lend or suppress an identity', () => {
  const i = input(); i.ledger = [entry({ booking_id: uid(555), status: 'sent' }),
    entry({ id: uid(202), automation_id: uid(901), automation_key: 'cleaner_new_booking', status: 'sent' })];
  assert.equal(cleaner(i).state, 'future_candidate');
});
test('changed policy/body or shape never falls back to legacy midnight or immediate timing', () => {
  const changes = [{ offset_days: -1 }, { at_local: '03:00' }, { enabled: true }, { configured_in_ota: false },
    { delivery: 'sms' }, { trigger: 'pre_checkout' }, { body: 'Changed' }, { subject: 'Changed' },
    { min_nights: 1 }, { channel_exclusions: ['airbnb'] }, { timezone: 'UTC' }, { property_id: null }];
  for (const patch of changes) {
    const i = input(); Object.assign(i.rules[0], patch);
    assert.equal(plan(i)[0].state, 'template_review');
  }
  const i = input(); const policy = i.rules[0].migration_policy as Record<string, unknown>;
  policy.capturedAt = '2027-01-01T00:00:00Z';
  assert.equal(plan(i)[0].state, 'template_review');
});
test('history must be complete, valid, unique and property-scoped', () => {
  assert.deepEqual(parseScheduleLedger([]), []);
  for (const invalid of [null, undefined, {}, [entry(), entry()], [entry({ property_id: 'other' as '65_calderwood' })],
    [{ ...entry(), status: 'unknown' }], [{ ...entry(), planned_check_in: '2026-02-30' }],
    [{ ...entry(), fire_at: '2026-11-14' }], [{ ...entry(), body_rendered: 'PRIVATE' }], Array(5001).fill(entry())])
    assert.throws(() => parseScheduleLedger(invalid), /history unavailable/);
});

test('legacy planning, preview timing and dispatch refuse any migration policy even if enabled', () => {
  const captured = { ...rules()[0], enabled: true };
  const fleet = { ...captured, id: uid(888), property_id: null, migration_policy: null };
  const booking: AutomationBooking = { id: stay.canonicalId, property_id: '65_calderwood', channel: 'airbnb',
    status: 'confirmed', check_in: stay.clocks.start, check_out: stay.clocks.end, duplicate_of: null,
    first_seen_at: '2026-11-11T15:50:00Z', guest_name: 'Synthetic', guest_email: null, guest_phone: null };
  for (const migration_policy of [captured.migration_policy, {}, false, 'unknown']) {
    const rule = { ...captured, migration_policy };
    assert.deepEqual(resolveAutomationsFor('65_calderwood', [fleet, rule]), []);
    assert.equal(fireAtFor(rule, booking, null, null, new Date(now)), null);
    assert.deepEqual(planAutomationSends({ bookings: [booking], rules: [fleet, rule], plans: {}, adjustments: {}, now: new Date(now) }), []);
    const d = decideDispatch({ row: { planned_check_in: booking.check_in, planned_check_out: booking.check_out },
      booking, rule, property: { automations_enabled: true, calendar_authority: 'helm' }, guest: null,
      recipients: [], rendered: { missing: [] }, lockMapped: false, approved: true });
    assert.equal(d.outcome, 'awaiting_approval'); assert.equal(d.rail, null);
  }
  assert.equal(resolveAutomationsFor('another_home', [fleet, captured]).length, 1);
});
test('live adapters read the migration marker and only metadata from fully paged history', () => {
  const io = readFileSync(new URL('../automations.ts', import.meta.url), 'utf8');
  assert.match(io, /configured_in_ota, migration_policy, created_by/);
  assert.match(io, /migration_policy: raw\.migration_policy \?\? null/);
  const route = readFileSync(new URL('../../app/api/channex/message-preparation/route.ts', import.meta.url), 'utf8');
  assert.match(route, /from\('automation_sends'\)\.select\(MESSAGE_SCHEDULE_LEDGER_FIELDS\)/);
  assert.match(route, /eq\('property_id', '65_calderwood'\)\.order\('id'\)\.range\(from, to\)/);
  assert.ok(!route.includes('.insert(') && !route.includes('.update('));
});
