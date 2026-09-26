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
import { readFileSync } from 'node:fs';
import {
  addDays,
  adjustmentKey,
  arrivalWhen,
  withdrawnSends,
  rolledOffAfterStay,
  keyDecided,
  stayCancelPausedKeys,
  PAUSE_REASON_STAY_CANCELLED,
  PAUSE_REASON_NO_LONGER_APPLIES,
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
  isFreshlyBooked,
  isResumablePause,
  overrideBodyProblem,
  renderSubject,
  resumableKeys,
  sendKey,
  DEFAULT_SUBJECT,
  MASK,
  PAUSE_REASON_DISABLED_PREFIX,
  PAUSE_REASON_SUPERSEDED,
  STALE_AFTER_MS,
  sendStatusLabel,
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
    booked_at: over.booked_at ?? null,
    external_confirmation_code: over.external_confirmation_code ?? null,
    num_guests: over.num_guests ?? 2,
    cancel_reason: over.cancel_reason ?? null,
    cancelled_at: over.cancelled_at ?? null,
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

  test('a fire time more than 12h gone is null once the arrival day is over; within 12h still fires', () => {
    const planned = Date.parse('2026-07-14T14:00:00Z');
    const fresh = new Date(planned + STALE_AFTER_MS - 60_000);
    assert.equal(fireAtFor(rule(), booking(), PLAN, null, fresh)?.toISOString(), '2026-07-14T14:00:00.000Z');
    const afterArrival = new Date('2026-07-16T05:00:00Z');
    assert.equal(fireAtFor(rule(), booking(), PLAN, null, afterArrival), null);
    const midStay = rule({ trigger: 'mid_stay', offset_days: 0, at_local: '10:00' });
    const longStay = booking({ check_in: '2026-07-15', check_out: '2026-07-25' });
    assert.equal(fireAtFor(midStay, longStay, PLAN, null, new Date('2026-07-21T12:00:00Z')), null, 'other triggers never go late');
    const oneNight = booking({ check_in: '2026-07-15', check_out: '2026-07-16' });
    const midNoTime = rule({ trigger: 'mid_stay', offset_days: 0, at_local: null });
    assert.equal(fireAtFor(midNoTime, oneNight, PLAN, null, new Date('2026-07-15T20:00:00Z')), null, 'not even on the arrival day');
  });

  test('an arrival message whose moment passed before it was planned goes now, until the arrival day ends (round 12)', () => {
    // Booked 22:40 the evening before arrival: pre_arrival (10:00 the day
    // before) is 12h+ gone at the first planner pass.
    const late = new Date('2026-07-15T03:05:00Z'); // 23:05 EDT on the 14th
    assert.equal(fireAtFor(rule(), booking(), PLAN, null, late)?.toISOString(), late.toISOString());
    const checkinDay = rule({ trigger: 'checkin_day', offset_days: 0, at_local: '08:00' });
    const switchOn = new Date('2026-07-16T01:00:00Z'); // 21:00 EDT on arrival day, 13h after 08:00
    assert.equal(fireAtFor(checkinDay, booking(), PLAN, null, switchOn)?.toISOString(), switchOn.toISOString());
  });

  test('a stale row reads "Missed its time", not "Stay cancelled"', () => {
    assert.equal(sendStatusLabel('skipped_cancelled', 'stale: the fire time was more than 12h in the past when planned'), 'Missed its time');
    assert.equal(sendStatusLabel('skipped_cancelled', 'booking_cancelled'), 'Stay cancelled');
    assert.equal(sendStatusLabel('sent', null), 'Sent');
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

  test('arrival_when reads the guest calendar day when the text goes, so a late pre-arrival never says tomorrow on arrival day', () => {
    // 10 PM Eastern on Oct 15 is already Oct 16 in UTC: the rule zone decides.
    const eveBefore = new Date('2026-10-16T02:00:00Z');
    assert.equal(arrivalWhen('2026-10-16', eveBefore, 'America/New_York'), 'tomorrow');
    assert.equal(arrivalWhen('2026-10-16', eveBefore, 'UTC'), 'today');
    const arrivalMorning = new Date('2026-10-16T13:00:00Z');
    assert.equal(arrivalWhen('2026-10-16', arrivalMorning, 'America/New_York'), 'today');
    assert.equal(arrivalWhen('2026-10-16', new Date('2026-10-12T13:00:00Z')), 'on Friday, October 16');
    const ctx = buildMergeContext({
      booking: { guest_name: 'Jane Doe', check_in: '2026-10-16', check_out: '2026-10-18' },
      property: { name: '65 Calderwood', title: null, address: null, wifi_name: null, parking: null },
      plan: PLAN,
      adjustment: null,
      access: null,
      stayCode: null,
      lockMapped: false,
      trashDay: null,
      now: arrivalMorning,
      timeZone: 'America/New_York',
    });
    assert.equal(ctx.arrival_when, 'today');
    assert.equal(renderTemplate('Hi {{guest_first}}, see you {{arrival_when}}.', ctx).text, 'Hi Jane, see you today.');
  });

  test('the seeded fleet pre-arrival text carries no fixed day word', () => {
    const sql = readFileSync(new URL('../../../supabase/migrations/20260926200000_helm_pms_plumbing.sql', import.meta.url), 'utf8');
    const seeded = sql.split('\n').find((l) => l.includes('Door code: {{door_code}}')) ?? '';
    assert.match(seeded, /\{\{arrival_when\}\}/);
    assert.doesNotMatch(seeded, /tomorrow|tonight/i);
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

describe('renderSubject', () => {
  test('a secret in the subject reaches the wire only; the stored copy is masked', () => {
    const r = renderSubject('Your door code {{door_code}} for {{property_title}}', {
      door_code: '4321',
      property_title: 'Stay at Black Rock Harbor',
    });
    assert.equal(r.text, 'Your door code 4321 for Stay at Black Rock Harbor');
    assert.equal(r.masked, `Your door code ${MASK} for Stay at Black Rock Harbor`);
    assert.ok(!r.masked.includes('4321'));
    assert.deepEqual(r.missing, []);
  });

  test('the wifi password is masked in a subject too', () => {
    const r = renderSubject('Wifi {{wifi_name}}: {{wifi_password}}', { wifi_name: 'HarborNet', wifi_password: 'tide2026' });
    assert.equal(r.masked, `Wifi HarborNet: ${MASK}`);
    assert.ok(!r.masked.includes('tide2026'));
  });

  test('a blank subject falls back to the default, rendered', () => {
    assert.equal(renderSubject('   ', { property_title: 'Stay at Rocky Neck' }).text, 'A note about your stay at Stay at Rocky Neck');
    assert.equal(renderSubject(null, { property_title: 'Stay at Rocky Neck' }).masked, 'A note about your stay at Stay at Rocky Neck');
    assert.ok(DEFAULT_SUBJECT.includes('{{property_title}}'));
  });
});

describe('overrideBodyProblem', () => {
  const template = 'Door code: {{door_code}}. See you {{check_in_long}}.';
  const ctx = { door_code: '4821', check_in_long: 'Friday, October 16' };

  test('a draft edited from the MASKED render is refused, so the guest never gets the mask', () => {
    const stored = renderTemplate(template, ctx).masked;
    assert.equal(stored, `Door code: ${MASK}. See you Friday, October 16.`);
    const edited = `${stored} Enjoy!`;
    // Re-rendering the edited text finds no tokens, so without the guard it would go out verbatim.
    const reRendered = renderTemplate(edited, ctx);
    assert.deepEqual(reRendered.missing, []);
    assert.ok(reRendered.text.includes(MASK));
    const problem = overrideBodyProblem(edited);
    assert.ok(problem);
    assert.match(problem, /masked value/);
  });

  test('an unfilled [field] marker copied from the render is refused', () => {
    const stored = renderTemplate('Hi {{guest_first}}, welcome.', { guest_first: '' }).masked;
    assert.equal(stored, 'Hi [guest_first], welcome.');
    const problem = overrideBodyProblem(stored);
    assert.ok(problem);
    assert.match(problem, /\[guest_first\]/);
    assert.ok(overrideBodyProblem('Code [door_code] at the side door'));
  });

  test('a draft edited from the TEMPLATE passes and fills the real value at send time', () => {
    const edited = `${template} Enjoy!`;
    assert.equal(overrideBodyProblem(edited), null);
    const r = renderTemplate(edited, ctx);
    assert.equal(r.text, 'Door code: 4821. See you Friday, October 16. Enjoy!');
    assert.equal(r.masked, `Door code: ${MASK}. See you Friday, October 16. Enjoy!`);
  });

  test('an operator\'s own bracketed words, and no draft at all, are fine', () => {
    assert.equal(overrideBodyProblem('Parking [see map] and the [blue] door.'), null);
    assert.equal(overrideBodyProblem(null), null);
    assert.equal(overrideBodyProblem(''), null);
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

  test('booked_at gate: a stay first seen now but booked days ago is not a new booking', () => {
    const imported = booking({ id: 'imported', first_seen_at: '2026-07-10T11:00:00Z', booked_at: '2026-06-02T09:00:00Z' });
    const bookedNow = booking({ id: 'booked-now', first_seen_at: '2026-07-10T11:00:00Z', booked_at: '2026-07-10T10:59:00Z' });
    const unknown = booking({ id: 'unknown', first_seen_at: '2026-07-10T11:00:00Z', booked_at: null });
    const rows = planAutomationSends({ bookings: [imported, bookedNow, unknown], rules: [confirm], plans: {}, adjustments: {}, now });
    // No booked_at falls back to first sight.
    assert.deepEqual(rows.map((r) => r.booking_id).sort(), ['booked-now', 'unknown']);
    assert.equal(isFreshlyBooked(imported, now.getTime(), undefined), false);
  });

  test('enable-stamp gate: a stay already on the calendar when the switch went on is never confirmed', () => {
    const before = booking({ id: 'before', first_seen_at: '2026-07-10T08:00:00Z' });
    const after = booking({ id: 'after', first_seen_at: '2026-07-10T10:30:00Z' });
    const enabledAt = { '65_calderwood': '2026-07-10T10:00:00Z' };
    const rows = planAutomationSends({ bookings: [before, after], rules: [confirm], plans: {}, adjustments: {}, enabledAt, now });
    assert.deepEqual(rows.map((r) => r.booking_id), ['after']);
  });

  test('enable-stamp gate reads an unknown stamp as "not yet", never "long ago"', () => {
    const b = booking({ id: 'b', first_seen_at: '2026-07-10T10:30:00Z' });
    const plan = (enabledAt: Record<string, string | null>) =>
      planAutomationSends({ bookings: [b], rules: [confirm], plans: {}, adjustments: {}, enabledAt, now });
    assert.deepEqual(plan({ '65_calderwood': null }), []);
    assert.deepEqual(plan({}), []);
    // Only booking_confirmed is gated: a pre_arrival rule still plans for the same stay.
    const pre = planAutomationSends({ bookings: [b], rules: [rule({ id: 'f-pre' })], plans: {}, adjustments: {}, enabledAt: {}, now });
    assert.equal(pre.length, 1);
  });

  test('both gates hold together: booked in the window AND first seen after the enable stamp', () => {
    const enabledAt = { '65_calderwood': '2026-07-10T10:00:00Z' };
    const ms = now.getTime();
    assert.equal(isFreshlyBooked(booking({ first_seen_at: '2026-07-10T10:30:00Z', booked_at: '2026-07-10T10:29:00Z' }), ms, enabledAt), true);
    assert.equal(isFreshlyBooked(booking({ first_seen_at: '2026-07-10T10:30:00Z', booked_at: '2026-07-01T10:29:00Z' }), ms, enabledAt), false);
    assert.equal(isFreshlyBooked(booking({ first_seen_at: '2026-07-10T09:30:00Z', booked_at: '2026-07-10T09:29:00Z' }), ms, enabledAt), false);
  });

  test('a confirmation the engine paused skips the enable stamp an off/on just moved, never the booked window', () => {
    const b = booking({ id: 'paused', first_seen_at: '2026-07-10T08:00:00Z' });
    const enabledAt = { '65_calderwood': '2026-07-10T11:40:00Z' };
    const resumable = new Set([sendKey('paused', 'f-conf')]);
    const base = { bookings: [b], rules: [confirm], plans: {}, adjustments: {}, enabledAt, now };
    assert.deepEqual(planAutomationSends(base), []);
    assert.deepEqual(planAutomationSends({ ...base, resumable }).map((r) => r.booking_id), ['paused']);
    // Booked three days ago: a pause never revives a stale confirmation.
    const old = booking({ id: 'paused', first_seen_at: '2026-07-07T08:00:00Z' });
    assert.deepEqual(planAutomationSends({ ...base, bookings: [old], resumable }), []);
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

  const paused = (error: string | null): ExistingSend => ({
    id: 'p',
    booking_id: 'bk-1',
    automation_id: 'f-pre',
    fire_at: '2026-07-14T14:00:00.000Z',
    status: 'cancelled',
    error,
    planned_check_in: '2026-07-15',
    planned_check_out: '2026-07-18',
  });

  test('switching automations off then on resumes the paused rows, re-timed, guarded on the exact reason', () => {
    const reason = `${PAUSE_REASON_DISABLED_PREFIX}dotti@risingtidestr.com`;
    const d = diffPlan(planned, [paused(reason)]);
    assert.equal(d.frozen, 0);
    assert.equal(d.resumed, 1);
    assert.equal(d.updates.length, 1);
    assert.equal(d.updates[0].resumeFrom, reason);
    assert.equal(d.updates[0].patch.status, 'scheduled');
    assert.equal(d.updates[0].patch.error, null);
    assert.equal(d.updates[0].patch.fire_at, '2026-07-14T14:00:00.000Z');
  });

  test('a row superseded by an override resumes when the rule applies again', () => {
    const d = diffPlan(planned, [paused(PAUSE_REASON_SUPERSEDED)]);
    assert.equal(d.resumed, 1);
    assert.equal(d.updates[0].resumeFrom, PAUSE_REASON_SUPERSEDED);
  });

  test('an operator skip, a dead stay and an ordinary re-time are not resumes', () => {
    assert.equal(diffPlan(planned, [paused('skipped by dotti@risingtidestr.com')]).frozen, 1);
    assert.equal(diffPlan(planned, [paused(null)]).frozen, 1);
    assert.equal(isResumablePause({ status: 'sent', error: PAUSE_REASON_SUPERSEDED }), false);
    const retime = diffPlan(planned, [{ ...paused(null), status: 'scheduled', fire_at: '2026-07-13T14:00:00.000Z' }]);
    assert.equal(retime.resumed, 0);
    assert.equal(retime.updates[0].resumeFrom, null);
  });

  test('a paused row whose moment has passed resumes straight to skipped, never briefly scheduled', () => {
    const late = planAutomationSends({
      bookings: [booking()],
      rules: [rule({ id: 'f-pre' })],
      plans: {},
      adjustments: {},
      now: new Date('2026-07-16T12:00:00Z'),
    });
    const d = diffPlan(late, [paused(PAUSE_REASON_SUPERSEDED)]);
    assert.equal(d.updates[0].patch.status, 'skipped_cancelled');
  });

  test('resumableKeys collects only the engine\'s own pauses', () => {
    const keys = resumableKeys([
      paused(PAUSE_REASON_SUPERSEDED),
      { ...paused('skipped by x'), automation_id: 'f-other' },
      { ...paused(`${PAUSE_REASON_DISABLED_PREFIX}x`), booking_id: 'bk-2' },
    ]);
    assert.deepEqual([...keys].sort(), [sendKey('bk-1', 'f-pre'), sendKey('bk-2', 'f-pre')]);
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

  test('"configured in Airbnb" answers for Airbnb stays only: a VRBO guest still gets the paste card (round 11)', () => {
    const vrbo = booking({ channel: 'vrbo', guest_phone: null, guest_email: null });
    const d = decideDispatch({ ...clean, booking: vrbo, rule: rule({ configured_in_ota: true }) });
    assert.deepEqual([d.outcome, d.rail], ['awaiting_approval', 'ota_manual']);
    const bcom = booking({ channel: 'booking_com', guest_phone: null, guest_email: null });
    assert.equal(decideDispatch({ ...clean, booking: bcom, rule: rule({ configured_in_ota: true }) }).outcome, 'awaiting_approval');
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

  test('a secret whose address comes only from the guest record waits for approval (round 13)', () => {
    const secret = rule({ body: 'Door {{door_code}}', send_mode: 'auto' });
    const record = { phone_e164: '+16175550199', phone: null, email: 'dana@example.com' };
    const bare = booking({ guest_phone: null, guest_email: null });
    const parked = decideDispatch({ ...clean, rule: secret, booking: bare, guest: record });
    assert.deepEqual(parked, { outcome: 'awaiting_approval', rail: 'sms', reason: 'contact from the guest record, not the stay' });
    assert.equal(decideDispatch({ ...clean, rule: secret, booking: bare, guest: record, approved: true }).outcome, 'send');
    // The stay's own phone: sends in auto.
    assert.equal(decideDispatch({ ...clean, rule: secret, guest: record }).outcome, 'send');
    // Email rail on the record's address parks too; on the stay's own address it sends.
    const byEmail = rule({ body: 'Wifi {{wifi_password}}', send_mode: 'auto', delivery: 'email' });
    assert.equal(decideDispatch({ ...clean, rule: byEmail, booking: bare, guest: record }).outcome, 'awaiting_approval');
    assert.equal(decideDispatch({ ...clean, rule: byEmail, booking: booking({ guest_email: 'dana@example.com' }), guest: record }).outcome, 'send');
    // No secret in the text: the record's address is fine.
    assert.equal(decideDispatch({ ...clean, rule: rule({ send_mode: 'auto' }), booking: bare, guest: record }).outcome, 'send');
  });

  test('cleaner rules go to covering recipients on the cleaner rail', () => {
    const cleaner = rule({ audience: 'cleaner', trigger: 'booking_confirmed', delivery: 'sms' });
    const luana: RecipientLike = { phone: '203-555-0101', display_name: 'Luana', enabled: true, property_ids: ['65_calderwood'], region: 'bridgeport_ct' };
    assert.deepEqual(decideDispatch({ ...clean, rule: cleaner, recipients: [luana] }), { outcome: 'send', rail: 'cleaner_sms', reason: null });
    assert.equal(decideDispatch({ ...clean, rule: cleaner, recipients: [] }).outcome, 'skipped_no_contact');
  });
});

describe('round 14: pauses that resume, moved cards, key dedupe, withdrawals', () => {
  const now = new Date('2026-07-10T12:00:00Z');
  const pre = rule({ id: 'f-pre', key: 'pre_arrival' });
  const planned = planAutomationSends({ bookings: [booking()], rules: [pre], plans: {}, adjustments: {}, now });
  const row = (over: Partial<ExistingSend>): ExistingSend => ({
    id: 'x',
    booking_id: 'bk-1',
    automation_id: 'f-pre',
    automation_key: 'pre_arrival',
    fire_at: '2026-07-14T14:00:00.000Z',
    status: 'scheduled',
    error: null,
    planned_check_in: '2026-07-15',
    planned_check_out: '2026-07-18',
    ...over,
  });

  test('a stay cancel is a pause: the same stay coming back resumes its messages', () => {
    assert.equal(isResumablePause({ status: 'cancelled', error: PAUSE_REASON_STAY_CANCELLED }), true);
    assert.equal(isResumablePause({ status: 'cancelled', error: PAUSE_REASON_NO_LONGER_APPLIES }), true);
    assert.equal(isResumablePause({ status: 'cancelled', error: 'skipped by dotti@risingtidestr.com' }), false);
    const d = diffPlan(planned, [row({ status: 'cancelled', error: PAUSE_REASON_STAY_CANCELLED })]);
    assert.equal(d.resumed, 1);
    assert.equal(d.updates[0].resumeFrom, PAUSE_REASON_STAY_CANCELLED);
    assert.equal(d.updates[0].patch.status, 'scheduled');
    // The SQL writes the same text (helm_cancel_booking).
    const sql = readFileSync(new URL('../../../supabase/migrations/20260926200000_helm_pms_plumbing.sql', import.meta.url), 'utf8');
    assert.ok(sql.includes(`set status = 'cancelled', error = '${PAUSE_REASON_STAY_CANCELLED}'`));
  });

  test('a parked card for dates the stay no longer has is re-planned, guarded on the old dates', () => {
    const parked = row({ status: 'awaiting_approval', planned_check_in: '2026-07-02', planned_check_out: '2026-07-05' });
    const d = diffPlan(planned, [parked]);
    assert.equal(d.updates.length, 1);
    assert.deepEqual(d.updates[0].movedFrom, { planned_check_in: '2026-07-02', planned_check_out: '2026-07-05' });
    assert.equal(d.updates[0].patch.planned_check_in, '2026-07-15');
    // Same dates: the card is the operator's, left alone.
    assert.equal(diffPlan(planned, [row({ status: 'awaiting_approval' })]).frozen, 1);
  });

  test('a message key settled under another rule row is not planned again (Remove override, then on again)', () => {
    const oldSent = row({ id: 'old', automation_id: null, status: 'sent' });
    const d = diffPlan(planned, [oldSent]);
    assert.equal(d.inserts.length, 0);
    assert.equal(d.keyed, 1);
    assert.equal(diffPlan(planned, [row({ id: 'old', automation_id: 'gone', status: 'cancelled', error: 'skipped by x' })]).keyed, 1);
    // A pause, a stale row or a failure under the old row does not settle it.
    for (const e of [row({ id: 'old', automation_id: 'gone', status: 'cancelled', error: 'rule superseded or disabled' }), row({ id: 'old', automation_id: 'gone', status: 'failed' }), row({ id: 'old', automation_id: 'gone', status: 'skipped_cancelled', error: 'stale: x' })]) {
      assert.equal(diffPlan(planned, [e]).inserts.length, 1, `${e.status} ${e.error}`);
    }
    assert.equal(keyDecided({ status: 'configured_in_ota', error: null }), true);
    assert.equal(keyDecided({ status: 'awaiting_approval', error: null }), true);
  });

  test('a continuation seam that appears after planning withdraws the first stay\'s departure messages, never its confirmation', () => {
    const preCheckout = rule({ id: 'f-out', key: 'pre_checkout', trigger: 'pre_checkout', offset_days: -1, at_local: '17:00' });
    const confirm = rule({ id: 'f-conf', key: 'booking_confirmed', trigger: 'booking_confirmed', offset_days: 0, at_local: null });
    const b1 = booking({ id: 'b1', check_in: '2026-07-15', check_out: '2026-07-18' });
    const b2 = booking({ id: 'b2', check_in: '2026-07-18', check_out: '2026-07-21' });
    const before = planAutomationSends({ bookings: [b1], rules: [preCheckout], plans: {}, adjustments: {}, now });
    assert.equal(before.length, 1);
    const after = planAutomationSends({ bookings: [b1, b2], rules: [preCheckout, confirm], plans: {}, adjustments: {}, now });
    assert.ok(!after.some((p) => p.booking_id === 'b1' && p.automation_id === 'f-out'), 'the seam hides b1 checkout');
    const existing = [
      row({ id: 's-out', booking_id: 'b1', automation_id: 'f-out', automation_key: 'pre_checkout', planned_check_out: '2026-07-18' }),
      row({ id: 's-conf', booking_id: 'b1', automation_id: 'f-conf', automation_key: 'booking_confirmed', status: 'awaiting_approval' }),
      row({ id: 's-old', booking_id: 'b1', automation_id: 'superseded-id', status: 'scheduled' }),
      row({ id: 's-sent', booking_id: 'b1', automation_id: 'f-out', status: 'sent' }),
    ];
    const ids = withdrawnSends(after, existing, [preCheckout, confirm], new Set(['f-out', 'f-conf']));
    assert.deepEqual(ids, ['s-out']);
    // b2 cancelled later: the pair is planned again and the pause resumes.
    const d = diffPlan(before, [row({ id: 's-out', booking_id: 'b1', automation_id: 'f-out', status: 'cancelled', error: PAUSE_REASON_NO_LONGER_APPLIES })]);
    assert.equal(d.resumed, 1);
  });

  test('an approval is for the rail the card showed: a phone that arrived since parks the message again', () => {
    const clean = {
      row: { planned_check_in: '2026-07-15', planned_check_out: '2026-07-18' },
      booking: booking({ channel: 'vrbo' }),
      rule: rule({ body: 'Door {{door_code}}', send_mode: 'approve' }),
      property: { automations_enabled: true, calendar_authority: 'helm' },
      guest: null,
      recipients: [],
      rendered: { missing: [] },
      lockMapped: true,
      approved: true,
    };
    const d = decideDispatch({ ...clean, approvedRail: 'ota_manual' });
    assert.equal(d.outcome, 'awaiting_approval');
    assert.equal(d.rail, 'sms');
    assert.equal(decideDispatch({ ...clean, approvedRail: 'sms' }).outcome, 'send');
    assert.equal(decideDispatch({ ...clean, booking: booking({ channel: 'vrbo', guest_phone: null, guest_email: null }), approvedRail: 'ota_manual' }).outcome, 'send');
  });

  test('a finished stay rolling off its feed still gets post_checkout; a real cancel does not', () => {
    const post = rule({ key: 'post_checkout', trigger: 'post_checkout', offset_days: 2, send_mode: 'auto' });
    const base = {
      row: { planned_check_in: '2026-07-15', planned_check_out: '2026-07-18' },
      rule: post,
      property: { automations_enabled: true, calendar_authority: 'helm' },
      guest: null,
      recipients: [],
      rendered: { missing: [] },
      lockMapped: true,
      approved: false,
    };
    const rolled = booking({ status: 'cancelled', cancel_reason: 'missing_from_feed', cancelled_at: '2026-07-20T00:00:00Z' });
    assert.equal(rolledOffAfterStay(rolled), true);
    assert.equal(decideDispatch({ ...base, booking: rolled }).outcome, 'send');
    assert.equal(decideDispatch({ ...base, rule: rule({ send_mode: 'auto' }), booking: rolled }).outcome, 'skipped_cancelled');
    const realCancel = booking({ status: 'cancelled', cancel_reason: 'missing_from_feed', cancelled_at: '2026-07-12T00:00:00Z' });
    assert.equal(rolledOffAfterStay(realCancel), false);
    assert.equal(decideDispatch({ ...base, booking: realCancel }).outcome, 'skipped_cancelled');
    assert.equal(rolledOffAfterStay(booking({ status: 'cancelled', cancel_reason: 'guest', cancelled_at: '2026-07-20T00:00:00Z' })), false);
  });

  test('the ledger labels an engine pause as a pause', () => {
    assert.equal(sendStatusLabel('cancelled', PAUSE_REASON_STAY_CANCELLED), 'Paused: stay cancelled');
    assert.equal(sendStatusLabel('cancelled', PAUSE_REASON_NO_LONGER_APPLIES), 'Paused: no longer applies');
    assert.equal(sendStatusLabel('cancelled', 'skipped by x'), 'Cancelled');
  });
});

describe('round 15: promoted inquiries, revived confirmation cards, cleaner arrival notices', () => {
  const now = new Date('2026-07-10T12:00:00Z');
  const confirm = rule({ id: 'f-conf', key: 'booking_confirmed', trigger: 'booking_confirmed', offset_days: 0, at_local: null });

  test('an inquiry asked before automations went on and confirmed after is a booking made after', () => {
    const promoted = booking({ first_seen_at: '2026-07-08T12:00:00Z', booked_at: '2026-07-10T11:00:00Z' });
    const enabledAt = { '65_calderwood': '2026-07-09T00:00:00Z' };
    assert.equal(isFreshlyBooked(promoted, now.getTime(), enabledAt), true);
    // A stay first seen and booked before the switch is still not confirmed by it.
    assert.equal(isFreshlyBooked(booking({ first_seen_at: '2026-07-08T12:00:00Z', booked_at: '2026-07-08T12:00:00Z' }), now.getTime(), enabledAt), false);
  });

  test('a confirmation card paused by a stay cancel comes back when the stay does, past the 24h window', () => {
    const revived = booking({ first_seen_at: '2026-07-08T12:00:00Z', booked_at: '2026-07-08T12:00:00Z' });
    const existing: ExistingSend[] = [
      { id: 's', booking_id: 'bk-1', automation_id: 'f-conf', automation_key: 'booking_confirmed', fire_at: '2026-07-08T12:00:00Z', status: 'cancelled', error: PAUSE_REASON_STAY_CANCELLED, planned_check_in: '2026-07-15', planned_check_out: '2026-07-18' },
    ];
    const keys = stayCancelPausedKeys(existing);
    assert.deepEqual([...keys], ['bk-1|f-conf']);
    const with_ = planAutomationSends({ bookings: [revived], rules: [confirm], plans: {}, adjustments: {}, pausedByStayCancel: keys, now });
    assert.equal(with_.length, 1);
    assert.equal(diffPlan(with_, existing).resumed, 1);
    const without = planAutomationSends({ bookings: [revived], rules: [confirm], plans: {}, adjustments: {}, now });
    assert.equal(without.length, 0);
    // Only stay-cancel pauses: a switch-off pause keeps the 24h window.
    assert.equal(stayCancelPausedKeys([{ ...existing[0], error: 'automations disabled by x' }]).size, 0);
  });

  test('a seam at checkout drops departure and cleaner-turnover notices, never the cleaner arrival notice', () => {
    const flags = { arrivalContinuation: false, departureContinuation: true };
    const b = booking();
    assert.equal(triggerAppliesTo({ trigger: 'pre_arrival', audience: 'cleaner' }, b, flags), true);
    assert.equal(triggerAppliesTo({ trigger: 'checkin_day', audience: 'cleaner' }, b, flags), true);
    assert.equal(triggerAppliesTo({ trigger: 'pre_checkout', audience: 'cleaner' }, b, flags), false);
    assert.equal(triggerAppliesTo({ trigger: 'booking_confirmed', audience: 'cleaner' }, b, flags), false);
    assert.equal(triggerAppliesTo({ trigger: 'pre_checkout', audience: 'guest' }, b, flags), false);
  });
});
