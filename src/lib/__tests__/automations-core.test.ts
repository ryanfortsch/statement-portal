/**
 * The pure rules behind the message-automation engine: when a rule fires
 * (DST-correct), which rule wins for a home, how a template renders with
 * secrets masked, which rail carries it, what the planner writes, and what
 * the dispatcher decides after re-reading the stay.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  adjustmentKey,
  anchorDateFor,
  buildMergeContext,
  continuationFlags,
  decideDispatch,
  diffPlan,
  effectiveRulesFor,
  fireAtFor,
  formatClock,
  formatLongDate,
  formatShortDate,
  isProxyEmail,
  nightsBetween,
  pickRail,
  planAutomationSends,
  recipientsCovering,
  renderTemplate,
  resolveAutomationsFor,
  templateFields,
  templateHasDoorCode,
  templateHasSecret,
  triggerAppliesTo,
  zonedTimeToMs,
  MASK,
  STALE_AFTER_MS,
  type AutomationBooking,
  type AutomationRule,
  type ExistingSend,
  type RecipientLike,
} from '../automations-core.ts';

// ── Fixtures ─────────────────────────────────────────────────────────────

function rule(over: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: over.id ?? 'rule-1',
    key: over.key ?? 'pre_arrival',
    property_id: over.property_id ?? null,
    audience: over.audience ?? 'guest',
    trigger: over.trigger ?? 'pre_arrival',
    offset_days: over.offset_days ?? -1,
    at_local: over.at_local === undefined ? '10:00' : over.at_local,
    timezone: over.timezone ?? 'America/New_York',
    channel_exclusions: over.channel_exclusions ?? [],
    delivery: over.delivery ?? 'sms_then_email',
    send_mode: over.send_mode ?? 'auto',
    min_nights: over.min_nights ?? null,
    subject: over.subject ?? null,
    body: over.body ?? 'Hi {{guest_first}}, see you {{check_in_long}}.',
    enabled: over.enabled ?? true,
    configured_in_ota: over.configured_in_ota ?? false,
  };
}

function booking(over: Partial<AutomationBooking> = {}): AutomationBooking {
  return {
    id: over.id ?? 'bk-1',
    property_id: over.property_id ?? '65_calderwood',
    channel: over.channel ?? 'direct',
    status: over.status ?? 'confirmed',
    check_in: over.check_in ?? '2026-07-15',
    check_out: over.check_out ?? '2026-07-18',
    guest_name: over.guest_name === undefined ? 'Jane Doe' : over.guest_name,
    guest_phone: over.guest_phone === undefined ? '978-555-0100' : over.guest_phone,
    guest_email: over.guest_email === undefined ? 'jane@example.com' : over.guest_email,
    guest_id: over.guest_id ?? null,
    duplicate_of: over.duplicate_of ?? null,
    first_seen_at: over.first_seen_at ?? '2026-07-01T12:00:00Z',
    external_confirmation_code: over.external_confirmation_code ?? null,
    num_guests: over.num_guests ?? 2,
  };
}

const PLAN = { checkin_time: '16:00', checkout_time: '11:00' };

// ── Time ─────────────────────────────────────────────────────────────────

describe('fireAtFor', () => {
  test('a 10:00 ET send the day before arrival lands at 14:00Z in EDT', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const at = fireAtFor(rule(), booking({ check_in: '2026-07-15' }), PLAN, null, now);
    assert.equal(at?.toISOString(), '2026-07-14T14:00:00.000Z');
  });

  test('the same rule on an EST date lands at 15:00Z', () => {
    const now = new Date('2027-01-01T00:00:00Z');
    const at = fireAtFor(rule(), booking({ check_in: '2027-01-15', check_out: '2027-01-18' }), PLAN, null, now);
    assert.equal(at?.toISOString(), '2027-01-14T15:00:00.000Z');
  });

  test('booking_confirmed fires now', () => {
    const now = new Date('2026-07-01T09:30:00Z');
    const at = fireAtFor(rule({ trigger: 'booking_confirmed', offset_days: 0, at_local: null }), booking(), PLAN, null, now);
    assert.equal(at?.getTime(), now.getTime());
  });

  test('a fire time more than 12h gone is null; within 12h still fires', () => {
    const planned = Date.parse('2026-07-14T14:00:00Z');
    const stale = new Date(planned + STALE_AFTER_MS + 60_000);
    const fresh = new Date(planned + STALE_AFTER_MS - 60_000);
    assert.equal(fireAtFor(rule(), booking(), PLAN, null, stale), null);
    assert.equal(fireAtFor(rule(), booking(), PLAN, null, fresh)?.toISOString(), '2026-07-14T14:00:00.000Z');
  });

  test('a paid late checkout moves pre_checkout and the anchor date', () => {
    const r = rule({ trigger: 'pre_checkout', offset_days: -1, at_local: '17:00' });
    const b = booking({ check_in: '2026-07-15', check_out: '2026-07-18' });
    const adj = { adjusted_check_out: '2026-07-20', adjusted_checkout_time: null };
    assert.equal(anchorDateFor(r, b, null), '2026-07-18');
    assert.equal(anchorDateFor(r, b, adj), '2026-07-20');
    const at = fireAtFor(r, b, PLAN, adj, new Date('2026-07-01T00:00:00Z'));
    assert.equal(at?.toISOString(), '2026-07-19T21:00:00.000Z');
  });

  test('post_checkout with no at_local fires at the effective checkout time', () => {
    const r = rule({ trigger: 'post_checkout', offset_days: 0, at_local: null });
    const b = booking({ check_in: '2026-07-15', check_out: '2026-07-18' });
    const at = fireAtFor(r, b, PLAN, { adjusted_check_out: null, adjusted_checkout_time: '13:00' }, new Date('2026-07-01T00:00:00Z'));
    assert.equal(at?.toISOString(), '2026-07-18T17:00:00.000Z');
  });

  test('mid_stay anchors on the middle night', () => {
    const r = rule({ trigger: 'mid_stay', offset_days: 0, at_local: '09:00' });
    assert.equal(anchorDateFor(r, booking({ check_in: '2026-07-10', check_out: '2026-07-16' }), null), '2026-07-13');
  });

  test('zonedTimeToMs crosses the spring-forward gap without a tz library', () => {
    // 2026-03-08 02:30 does not exist in New York; the two-pass settle lands on a real instant.
    const ms = zonedTimeToMs('2026-03-08', '02:30', 'America/New_York');
    assert.ok(Number.isFinite(ms));
    assert.equal(zonedTimeToMs('2026-03-08', '01:00', 'America/New_York'), Date.parse('2026-03-08T06:00:00Z'));
    assert.equal(zonedTimeToMs('2026-03-08', '04:00', 'America/New_York'), Date.parse('2026-03-08T08:00:00Z'));
  });

  test('date helpers', () => {
    assert.equal(addDays('2026-07-31', 1), '2026-08-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(nightsBetween('2026-07-15', '2026-07-18'), 3);
    assert.equal(formatLongDate('2026-10-16'), 'Friday, October 16');
    assert.equal(formatShortDate('2026-10-16'), 'Oct 16');
    assert.equal(formatClock('16:00'), '4:00 PM');
    assert.equal(formatClock('11:00:00'), '11:00 AM');
    assert.equal(formatClock('00:15'), '12:15 AM');
    assert.equal(formatClock('nope'), '');
  });
});

// ── Resolution ───────────────────────────────────────────────────────────

describe('resolveAutomationsFor', () => {
  const fleet = rule({ id: 'f-pre', key: 'pre_arrival', property_id: null, enabled: true });
  const fleetOff = rule({ id: 'f-mid', key: 'mid_stay', trigger: 'mid_stay', property_id: null, enabled: false });
  const override = rule({ id: 'p-pre', key: 'pre_arrival', property_id: '65_calderwood', at_local: '09:00', enabled: true });
  const silence = rule({ id: 'p-pre-off', key: 'pre_arrival', property_id: '65_calderwood', enabled: false });
  const other = rule({ id: 'o-pre', key: 'pre_arrival', property_id: '3_locust', at_local: '08:00', enabled: true });

  test('a property row with the same key overrides the fleet row', () => {
    const rules = resolveAutomationsFor('65_calderwood', [fleet, override, other]);
    assert.deepEqual(rules.map((r) => r.id), ['p-pre']);
  });

  test('a disabled property row silences the fleet row', () => {
    assert.deepEqual(resolveAutomationsFor('65_calderwood', [fleet, silence]), []);
    const eff = effectiveRulesFor('65_calderwood', [fleet, silence]);
    assert.equal(eff.length, 1);
    assert.equal(eff[0].silenced, true);
    assert.equal(eff[0].active, false);
  });

  test('another home\'s override never leaks; a disabled fleet row never fires', () => {
    const rules = resolveAutomationsFor('65_calderwood', [fleet, fleetOff, other]);
    assert.deepEqual(rules.map((r) => r.id), ['f-pre']);
    const eff = effectiveRulesFor('65_calderwood', [fleet, fleetOff, other]);
    assert.deepEqual(eff.map((e) => [e.rule.key, e.source, e.active]), [
      ['mid_stay', 'fleet', false],
      ['pre_arrival', 'fleet', true],
    ]);
  });
});

// ── Rendering ────────────────────────────────────────────────────────────

describe('renderTemplate', () => {
  test('fills fields, reports the missing ones, masks door and wifi in the stored copy', () => {
    const body = 'Hi {{guest_first}}. Door: {{door_code}}. Wifi {{wifi_name}} / {{wifi_password}}. {{parking}}';
    const r = renderTemplate(body, {
      guest_first: 'Jane',
      door_code: '4321',
      wifi_name: 'HarborNet',
      wifi_password: 'tide2026',
      parking: '',
    });
    assert.equal(r.text, 'Hi Jane. Door: 4321. Wifi HarborNet / tide2026. [parking]');
    assert.equal(r.masked, `Hi Jane. Door: ${MASK}. Wifi HarborNet / ${MASK}. [parking]`);
    assert.deepEqual(r.missing, ['parking']);
    assert.ok(!r.masked.includes('4321'));
    assert.ok(!r.masked.includes('tide2026'));
  });

  test('an unknown field is missing, not silently blank', () => {
    const r = renderTemplate('Hello {{nope}}', { guest_first: 'Jane' });
    assert.deepEqual(r.missing, ['nope']);
    assert.equal(r.text, 'Hello [nope]');
  });

  test('template introspection', () => {
    assert.deepEqual(templateFields('{{a}} {{ b }} {{a}}'), ['a', 'b']);
    assert.equal(templateHasSecret('Code {{door_code}}'), true);
    assert.equal(templateHasSecret('Wifi {{wifi_name}}'), false);
    assert.equal(templateHasDoorCode('{{wifi_password}}'), false);
    assert.equal(templateHasDoorCode('{{door_code}}'), true);
  });

  test('buildMergeContext prefers the stay code when a lock is mapped, then the lock code, then the key location', () => {
    const base = {
      booking: { guest_name: 'Jane Doe', check_in: '2026-10-16', check_out: '2026-10-18' },
      property: { name: '65 Calderwood', title: 'Stay at Black Rock Harbor', address: '65 Calderwood Ave', wifi_name: 'HarborNet', parking: 'Driveway in back.' },
      plan: PLAN,
      adjustment: null,
      access: { smart_lock_code: '1111', key_code_location: 'Lockbox by the door', wifi_password: 'pw' },
      trashDay: null,
    };
    const withStay = buildMergeContext({ ...base, stayCode: '2222', lockMapped: true });
    assert.equal(withStay.door_code, '2222');
    assert.equal(withStay.guest_first, 'Jane');
    assert.equal(withStay.property_title, 'Stay at Black Rock Harbor');
    assert.equal(withStay.check_in_long, 'Friday, October 16');
    assert.equal(withStay.check_out_short, 'Oct 18');
    assert.equal(withStay.check_in_time, '4:00 PM');
    assert.equal(withStay.check_out_time, '11:00 AM');
    assert.equal(withStay.nights, '2');
    const noLock = buildMergeContext({ ...base, stayCode: '2222', lockMapped: false });
    assert.equal(noLock.door_code, '1111');
    const keyOnly = buildMergeContext({ ...base, stayCode: null, lockMapped: false, access: { smart_lock_code: null, key_code_location: 'Lockbox', wifi_password: null } });
    assert.equal(keyOnly.door_code, 'Lockbox');
    assert.equal(keyOnly.wifi_password, '');
  });

  test('a placeholder guest name yields no name; a late checkout changes the time field', () => {
    const ctx = buildMergeContext({
      booking: { guest_name: 'Reserved', check_in: '2026-10-16', check_out: '2026-10-18' },
      property: { name: '65 Calderwood', title: null, address: null, wifi_name: null, parking: null },
      plan: PLAN,
      adjustment: { adjusted_check_out: null, adjusted_checkout_time: '13:00' },
      access: null,
      stayCode: null,
      lockMapped: false,
      trashDay: null,
    });
    assert.equal(ctx.guest_first, '');
    assert.equal(ctx.guest_name, '');
    assert.equal(ctx.property_title, '65 Calderwood');
    assert.equal(ctx.check_out_time, '1:00 PM');
  });
});

// ── Rails ────────────────────────────────────────────────────────────────

describe('pickRail', () => {
  const luana: RecipientLike = { phone: '203-555-0101', display_name: 'Luana', enabled: true, property_ids: ['65_calderwood'], region: 'bridgeport_ct' };
  const rosa: RecipientLike = { phone: '978-555-0102', display_name: 'Rosa', enabled: true, property_ids: [], region: 'cape_ann' };

  test('sms_then_email: phone wins, then a real email', () => {
    assert.equal(pickRail(rule(), booking(), null, []), 'sms');
    assert.equal(pickRail(rule(), booking({ guest_phone: null }), null, []), 'email');
    assert.equal(pickRail(rule({ delivery: 'email' }), booking(), null, []), 'email');
    assert.equal(pickRail(rule({ delivery: 'sms' }), booking({ guest_phone: null }), null, []), null);
  });

  test('an OTA relay address is not a rail; an OTA guest with no contact falls to ota_manual', () => {
    assert.equal(isProxyEmail('abc123@guest.airbnb.com'), true);
    assert.equal(isProxyEmail('x@mchat.booking.com'), true);
    assert.equal(isProxyEmail('jane@example.com'), false);
    const airbnb = booking({ channel: 'airbnb', guest_phone: null, guest_email: 'abc@guest.airbnb.com' });
    assert.equal(pickRail(rule(), airbnb, null, []), 'ota_manual');
    assert.equal(pickRail(rule({ delivery: 'ota_manual' }), airbnb, null, []), 'ota_manual');
  });

  test('a direct guest with no contact has no rail at all', () => {
    assert.equal(pickRail(rule(), booking({ guest_phone: null, guest_email: null }), null, []), null);
    assert.equal(pickRail(rule({ delivery: 'ota_manual' }), booking({ channel: 'direct' }), null, []), null);
  });

  test('the linked guest record supplies a phone the booking lacks', () => {
    assert.equal(pickRail(rule({ delivery: 'sms' }), booking({ guest_phone: null }), { phone_e164: '+19785550199' }, []), 'sms');
  });

  test('cleaner rules ride to covering recipients only', () => {
    const cleaner = rule({ audience: 'cleaner', trigger: 'booking_confirmed', delivery: 'sms' });
    const covering = recipientsCovering([luana, rosa], { id: '65_calderwood', region: 'bridgeport_ct' });
    assert.deepEqual(covering.map((r) => r.display_name), ['Luana']);
    assert.equal(pickRail(cleaner, booking(), null, covering), 'cleaner_sms');
    assert.equal(pickRail(cleaner, booking(), null, []), null);
    const capeAnn = recipientsCovering([luana, rosa], { id: '3_locust', region: 'cape_ann' });
    assert.deepEqual(capeAnn.map((r) => r.display_name), ['Rosa']);
    assert.deepEqual(recipientsCovering([{ ...rosa, enabled: false }], { id: '3_locust', region: 'cape_ann' }), []);
  });
});

// ── Continuation ─────────────────────────────────────────────────────────

describe('continuation seams', () => {
  const first = booking({ id: 'a', guest_name: 'Simon Prudenzi', check_in: '2026-09-04', check_out: '2026-09-05' });
  const second = booking({ id: 'b', guest_name: 'Simon Prudenzi', check_in: '2026-09-05', check_out: '2026-09-06' });
  const stranger = booking({ id: 'c', guest_name: 'Ana Silva', check_in: '2026-09-06', check_out: '2026-09-08' });
  const all = [first, second, stranger];

  test('the earlier row keeps its arrival and loses its departure; the later row the reverse', () => {
    assert.deepEqual(continuationFlags(first, all), { arrivalContinuation: false, departureContinuation: true });
    assert.deepEqual(continuationFlags(second, all), { arrivalContinuation: true, departureContinuation: false });
    assert.deepEqual(continuationFlags(stranger, all), { arrivalContinuation: false, departureContinuation: false });
  });

  test('triggerAppliesTo honours the seams and the cleaner audience', () => {
    const dep = continuationFlags(first, all);
    assert.equal(triggerAppliesTo(rule({ trigger: 'pre_arrival' }), first, dep), true);
    assert.equal(triggerAppliesTo(rule({ trigger: 'pre_checkout' }), first, dep), false);
    assert.equal(triggerAppliesTo(rule({ audience: 'cleaner', trigger: 'booking_confirmed' }), first, dep), false);
    const arr = continuationFlags(second, all);
    assert.equal(triggerAppliesTo(rule({ trigger: 'booking_confirmed' }), second, arr), false);
    assert.equal(triggerAppliesTo(rule({ trigger: 'pre_checkout' }), second, arr), true);
    assert.equal(triggerAppliesTo(rule({ trigger: 'pre_arrival' }), booking({ status: 'cancelled' }), arr), false);
    assert.equal(triggerAppliesTo(rule({ trigger: 'post_checkout' }), booking({ status: 'completed' }), arr), true);
    assert.equal(triggerAppliesTo(rule({ trigger: 'pre_arrival' }), booking({ status: 'completed' }), arr), false);
  });
});

// ── Planner ──────────────────────────────────────────────────────────────

describe('planAutomationSends', () => {
  const now = new Date('2026-07-10T12:00:00Z');
  const pre = rule({ id: 'f-pre', key: 'pre_arrival' });
  const confirm = rule({ id: 'f-conf', key: 'booking_confirmed', trigger: 'booking_confirmed', offset_days: 0, at_local: null });

  test('plans a scheduled row per applicable rule and skips excluded channels', () => {
    const rows = planAutomationSends({
      bookings: [booking({ id: 'bk-1', channel: 'airbnb', first_seen_at: '2026-07-10T11:00:00Z' })],
      rules: [pre, rule({ ...confirm, channel_exclusions: ['airbnb'] })],
      plans: { '65_calderwood': PLAN },
      adjustments: {},
      now,
    });
    assert.deepEqual(rows.map((r) => [r.automation_id, r.status, r.fire_at]), [['f-pre', 'scheduled', '2026-07-14T14:00:00.000Z']]);
    assert.equal(rows[0].planned_check_in, '2026-07-15');
    assert.equal(rows[0].planned_check_out, '2026-07-18');
  });

  test('booking_confirmed only for stays first seen in the last 24h', () => {
    const fresh = booking({ id: 'fresh', first_seen_at: '2026-07-10T01:00:00Z' });
    const old = booking({ id: 'old', first_seen_at: '2026-07-01T01:00:00Z' });
    const rows = planAutomationSends({ bookings: [fresh, old], rules: [confirm], plans: {}, adjustments: {}, now });
    assert.deepEqual(rows.map((r) => r.booking_id), ['fresh']);
    assert.equal(rows[0].fire_at, now.toISOString());
  });

  test('a cancelled or duplicate stay is never planned; min_nights filters', () => {
    const rows = planAutomationSends({
      bookings: [
        booking({ id: 'cancelled', status: 'cancelled' }),
        booking({ id: 'dup', duplicate_of: 'bk-1' }),
        booking({ id: 'short', check_in: '2026-07-15', check_out: '2026-07-16' }),
      ],
      rules: [rule({ ...pre, min_nights: 2 })],
      plans: {},
      adjustments: {},
      now,
    });
    assert.deepEqual(rows, []);
  });

  test('a stale fire time is written skipped_cancelled with a note, never sent', () => {
    const rows = planAutomationSends({
      bookings: [booking({ check_in: '2026-07-09', check_out: '2026-07-12' })],
      rules: [pre],
      plans: {},
      adjustments: {},
      now,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'skipped_cancelled');
    assert.match(rows[0].error ?? '', /stale/);
    assert.equal(rows[0].fire_at, '2026-07-08T14:00:00.000Z');
  });

  test('a moved checkout re-times pre_checkout through the adjustment map', () => {
    const preOut = rule({ id: 'f-out', key: 'pre_checkout', trigger: 'pre_checkout', at_local: '17:00' });
    const b = booking({ check_in: '2026-07-15', check_out: '2026-07-18' });
    const rows = planAutomationSends({
      bookings: [b],
      rules: [preOut],
      plans: {},
      adjustments: { [adjustmentKey(b.property_id, b.check_in)]: { adjusted_check_out: '2026-07-20', adjusted_checkout_time: null } },
      now,
    });
    assert.equal(rows[0].fire_at, '2026-07-19T21:00:00.000Z');
  });

  test('a silenced rule plans nothing for that home only', () => {
    const silence = rule({ id: 'p-off', key: 'pre_arrival', property_id: '65_calderwood', enabled: false });
    const rows = planAutomationSends({
      bookings: [booking({ id: 'ct' }), booking({ id: 'ma', property_id: '3_locust' })],
      rules: [pre, silence],
      plans: {},
      adjustments: {},
      now,
    });
    assert.deepEqual(rows.map((r) => r.booking_id), ['ma']);
  });
});

describe('diffPlan', () => {
  const planned = planAutomationSends({
    bookings: [booking()],
    rules: [rule({ id: 'f-pre' })],
    plans: {},
    adjustments: {},
    now: new Date('2026-07-10T12:00:00Z'),
  });

  test('inserts a new row, re-times a scheduled row, leaves history alone', () => {
    const fresh = diffPlan(planned, []);
    assert.equal(fresh.inserts.length, 1);

    const moved: ExistingSend = { id: 'x', booking_id: 'bk-1', automation_id: 'f-pre', fire_at: '2026-07-13T14:00:00.000Z', status: 'scheduled', planned_check_in: '2026-07-14', planned_check_out: '2026-07-17' };
    const d = diffPlan(planned, [moved]);
    assert.equal(d.updates.length, 1);
    assert.equal(d.updates[0].patch.fire_at, '2026-07-14T14:00:00.000Z');
    assert.equal(d.updates[0].patch.planned_check_in, '2026-07-15');

    const same: ExistingSend = { ...moved, fire_at: '2026-07-14T14:00:30.000Z', planned_check_in: '2026-07-15', planned_check_out: '2026-07-18' };
    assert.equal(diffPlan(planned, [same]).unchanged, 1);

    const sent: ExistingSend = { ...moved, status: 'sent' };
    assert.equal(diffPlan(planned, [sent]).frozen, 1);

    const datesMoved: ExistingSend = { ...moved, status: 'skipped_dates_moved' };
    assert.equal(diffPlan(planned, [datesMoved]).updates[0]?.patch.status, 'scheduled');
  });
});

// ── Dispatcher ───────────────────────────────────────────────────────────

describe('decideDispatch', () => {
  const row = { planned_check_in: '2026-07-15', planned_check_out: '2026-07-18' };
  const property = { automations_enabled: true, calendar_authority: 'helm' };
  const clean = { row, booking: booking(), rule: rule(), property, guest: null, recipients: [], rendered: { missing: [] }, lockMapped: true, approved: false };

  test('a clean auto row sends by sms', () => {
    assert.deepEqual(decideDispatch(clean), { outcome: 'send', rail: 'sms', reason: null });
  });

  test('a cancelled booking skips; a duplicate skips; a missing booking skips', () => {
    assert.equal(decideDispatch({ ...clean, booking: booking({ status: 'cancelled' }) }).outcome, 'skipped_cancelled');
    assert.equal(decideDispatch({ ...clean, booking: booking({ duplicate_of: 'other' }) }).outcome, 'skipped_cancelled');
    assert.equal(decideDispatch({ ...clean, booking: null }).outcome, 'skipped_cancelled');
  });

  test('moved dates skip so the planner re-plans', () => {
    const d = decideDispatch({ ...clean, booking: booking({ check_out: '2026-07-19' }) });
    assert.equal(d.outcome, 'skipped_dates_moved');
  });

  test('a disabled rule or a home no longer automated cancels the row', () => {
    assert.equal(decideDispatch({ ...clean, rule: rule({ enabled: false }) }).outcome, 'cancelled');
    assert.equal(decideDispatch({ ...clean, property: { ...property, automations_enabled: false } }).outcome, 'cancelled');
    assert.equal(decideDispatch({ ...clean, property: { ...property, calendar_authority: 'guesty' } }).outcome, 'cancelled');
  });

  test('channel exclusion at dispatch time', () => {
    assert.equal(decideDispatch({ ...clean, rule: rule({ channel_exclusions: ['direct'] }) }).outcome, 'skipped_channel');
  });

  test('no contact is recorded loudly, never as sent', () => {
    const d = decideDispatch({ ...clean, booking: booking({ guest_phone: null, guest_email: null }) });
    assert.equal(d.outcome, 'skipped_no_contact');
    assert.equal(d.rail, null);
  });

  test('an OTA guest with no contact parks with the deep link, or is honestly configured_in_ota', () => {
    const airbnb = booking({ channel: 'airbnb', guest_phone: null, guest_email: 'x@guest.airbnb.com' });
    assert.deepEqual(decideDispatch({ ...clean, booking: airbnb }), { outcome: 'awaiting_approval', rail: 'ota_manual', reason: 'paste into the OTA app' });
    assert.equal(decideDispatch({ ...clean, booking: airbnb, rule: rule({ configured_in_ota: true }) }).outcome, 'configured_in_ota');
    assert.equal(decideDispatch({ ...clean, booking: airbnb, approved: true }).outcome, 'send');
  });

  test('missing fields park the row even in auto mode', () => {
    const d = decideDispatch({ ...clean, rendered: { missing: ['door_code'] } });
    assert.equal(d.outcome, 'awaiting_approval');
    assert.match(d.reason ?? '', /door_code/);
  });

  test('a door code without a mapped lock is forced to approve; approve mode parks; an approval sends', () => {
    const doorRule = rule({ body: 'Door {{door_code}}', send_mode: 'auto' });
    assert.equal(decideDispatch({ ...clean, rule: doorRule, lockMapped: false }).outcome, 'awaiting_approval');
    assert.equal(decideDispatch({ ...clean, rule: doorRule, lockMapped: true }).outcome, 'send');
    assert.equal(decideDispatch({ ...clean, rule: rule({ send_mode: 'approve' }) }).outcome, 'awaiting_approval');
    assert.equal(decideDispatch({ ...clean, rule: rule({ send_mode: 'approve' }), approved: true }).outcome, 'send');
    assert.equal(decideDispatch({ ...clean, rule: doorRule, lockMapped: false, approved: true }).outcome, 'send');
  });

  test('cleaner rules go to covering recipients on the cleaner rail', () => {
    const cleaner = rule({ audience: 'cleaner', trigger: 'booking_confirmed', delivery: 'sms' });
    const luana: RecipientLike = { phone: '203-555-0101', display_name: 'Luana', enabled: true, property_ids: ['65_calderwood'], region: 'bridgeport_ct' };
    assert.deepEqual(decideDispatch({ ...clean, rule: cleaner, recipients: [luana] }), { outcome: 'send', rail: 'cleaner_sms', reason: null });
    assert.equal(decideDispatch({ ...clean, rule: cleaner, recipients: [] }).outcome, 'skipped_no_contact');
  });
});
