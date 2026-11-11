import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { formatGuestyMessageDate, parsePreparationRenderInputs, rehearsePreparedMessages, reviewPreparationInputs } from '../channex-messaging/preparation-render.ts';
import { compileCalderwoodTemplates } from '../channex-messaging/template-migration.ts';
import { parsePreparationRules } from '../channex-messaging/preparation-rules.ts';
import { syntheticCapture } from './fixtures/channex-template-capture.ts';
import type { GuestyHandoffStay } from '../channex-bookings/message-identity.ts';
import type { SourceClocks } from '../channex-messaging/preparation-timing.ts';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stay: GuestyHandoffStay = { canonicalId: uid(10), id: '0'.repeat(24), listingId: '0'.repeat(24), accountId: '0'.repeat(24),
  code: 'SYNTHETIC', start: '2027-02-21', end: '2027-02-24', status: 'confirmed' };
const clocks: SourceClocks = { start: stay.start, end: stay.end, timezone: 'America/New_York',
  plannedArrival: null, plannedDeparture: null, defaultArrival: '16:00', defaultDeparture: '11:00', confirmedAt: null };
const raw = () => ({ property: { id: '65_calderwood', name: 'Synthetic home', wifi_name: 'PRIVATE_NETWORK' },
  access: { smart_lock_code: 'PRIVATE_DOOR', key_code_location: 'PRIVATE_LOCATION', wifi_password: 'PRIVATE_WIFI' }, lockMapped: false, cleanerRecipients: [] as { enabled: boolean; property_ids: string[]; region: string }[],
  bookings: [{ id: stay.canonicalId, property_id: '65_calderwood', check_in: stay.start, check_out: stay.end,
    status: 'confirmed', guest_name: 'PrivateGuest FullName' }] });
const rules = () => parsePreparationRules(compileCalderwoodTemplates(syntheticCapture, Date.now()).map((r, i) => ({ ...r, id: uid(i + 1),
  property_id: '65_calderwood', audience: r.key.startsWith('cleaner_') ? 'cleaner' : 'guest',
  trigger: r.key.startsWith('cleaner_') ? 'pre_arrival' : r.key, offset_days: 0, at_local: null,
  timezone: 'America/New_York', channel_exclusions: [], delivery: r.key.startsWith('cleaner_') ? 'sms' : 'ota_manual',
  send_mode: 'approve', min_nights: null, subject: null, enabled: false, configured_in_ota: true })));
const render = (value = raw(), sourceClocks = clocks) => rehearsePreparedMessages(rules(), parsePreparationRenderInputs(value, [stay]), stay, sourceClocks);

test('source date display retains month, ordinal and year, independent of timezone', () => {
  for (const [day, suffix] of [[1, 'st'], [2, 'nd'], [3, 'rd'], [4, 'th'], [11, 'th'], [12, 'th'], [13, 'th'], [21, 'st'], [22, 'nd'], [23, 'rd'], [31, 'st']] as const)
    assert.equal(formatGuestyMessageDate(`2027-01-${String(day).padStart(2, '0')}`), `Jan ${day}${suffix}, 2027`);
  assert.equal(formatGuestyMessageDate('2028-02-29'), 'Feb 29th, 2028');
  for (const invalid of ['2027-02-29', '2027-02-31', '2027-1-01', '2027-13-01', 'PRIVATE'])
    assert.throws(() => formatGuestyMessageDate(invalid), /Invalid message date/);
});
test('all six rehearsals use actual stay dates but never expose names or access values', () => {
  const result = render(), json = JSON.stringify(result);
  assert.equal(result.length, 6); assert.ok(result.every(r => r.canSend === false));
  for (const secret of ['PRIVATE_', 'PrivateGuest', 'FullName']) assert.equal(json.includes(secret), false);
  const arrival = result.find(r => r.key === 'pre_arrival')!;
  assert.equal(arrival.preview, 'Hello [Guest],\nArrival Feb 21st, 2027; departure Feb 24th, 2027.');
  assert.equal(arrival.status, 'fields_present');
  assert.equal(result.find(r => r.key === 'checkin_day')!.status, 'fields_present');
  assert.deepEqual(result.find(r => r.key === 'cleaner_reminder')!.missingFields, ['cleaner_schedule_url']);
  assert.ok(!json.includes('https://app.guesty.com'));
});
test('unknown or placeholder names, missing protected data and unverified cleaner links stay missing', () => {
  for (const name of ['Reserved', 'Airbnb (Not available)', 'Closed', '', null]) {
    const value = raw(); value.bookings[0].guest_name = name as string;
    value.access.smart_lock_code = ''; value.access.wifi_password = ''; value.property.wifi_name = '';
    const result = render(value);
    assert.ok(result[0].missingFields.includes('guest_first'));
    assert.deepEqual(result.find(r => r.key === 'checkin_day')!.missingFields, ['guest_first', 'door_code', 'wifi_name', 'wifi_password']);
  }
});
test('a key location or a mapped device does not stand in for a verified entry code', () => {
  const value = raw(); value.lockMapped = true;
  assert.ok(render(value).find(r => r.key === 'checkin_day')!.missingFields.includes('door_code'));
  value.lockMapped = false; value.access.smart_lock_code = '';
  assert.ok(render(value).find(r => r.key === 'checkin_day')!.missingFields.includes('door_code'));
});
test('literal default-time wording is flagged for changed or unknown arrival and departure times', () => {
  const custom = render(raw(), { ...clocks, plannedArrival: '18:00', plannedDeparture: '12:00' });
  assert.deepEqual(custom.filter(r => r.timeWordingReview).map(r => r.key), ['booking_confirmed', 'pre_arrival', 'pre_checkout', 'cleaner_arrival']);
  assert.equal(render(raw(), { ...clocks, plannedArrival: undefined }).find(r => r.key === 'pre_arrival')!.timeWordingReview, true);
  assert.ok(render().every(r => r.timeWordingReview === false));
});
test('missing, duplicated, wrong-property and changed-date canonical rows cannot be rehearsed', () => {
  for (const change of [(v: ReturnType<typeof raw>) => { v.bookings = []; },
    (v: ReturnType<typeof raw>) => { v.bookings.push(v.bookings[0]); },
    (v: ReturnType<typeof raw>) => { v.bookings[0].property_id = 'other'; },
    (v: ReturnType<typeof raw>) => { v.bookings[0].check_out = '2027-02-25'; },
    (v: ReturnType<typeof raw>) => { v.bookings[0].status = 'cancelled'; }]) {
    const value = raw(); change(value); assert.throws(() => parsePreparationRenderInputs(value, [stay]));
  }
});
test('only valid disabled property preparations can display a rehearsal', () => {
  for (const change of [(r: ReturnType<typeof rules>) => { r[0].enabled = true; },
    (r: ReturnType<typeof rules>) => { r[0].configured_in_ota = false; },
    (r: ReturnType<typeof rules>) => { r[0].body += ' changed'; },
    (r: ReturnType<typeof rules>) => { r[0].property_id = null; }]) {
    const value = rules(); change(value);
    assert.equal(rehearsePreparedMessages(value, parsePreparationRenderInputs(raw(), [stay]), stay, clocks)[0].preview, null);
  }
});
test('known credentials accidentally repeated in template literals are also removed', () => {
  const value = rules(); value[0].body += ' PRIVATE_DOOR PRIVATE_WIFI PRIVATE_NETWORK PrivateGuest FullName';
  value[0].migration_policy = { ...(value[0].migration_policy as object), bodySha256: createHash('sha256').update(value[0].body).digest('hex') };
  const result = rehearsePreparedMessages(value, parsePreparationRenderInputs(raw(), [stay]), stay, clocks);
  for (const secret of ['PRIVATE_', 'PrivateGuest', 'FullName']) assert.equal(JSON.stringify(result).includes(secret), false);
});


test('handover inputs distinguish stored values, missing data and mapped-lock stay codes', () => {
  const value = raw();
  assert.deepEqual(reviewPreparationInputs(parsePreparationRenderInputs(value, [stay])), {
    entryCode: 'stored', wifiName: true, wifiPassword: true,
    cleaner: { configuredRecipients: 0, enabledRecipients: 0, status: 'not_configured', scheduleLinkConfigured: false, scheduleAccessVerified: false, recipientVerified: false },
  });
  value.lockMapped = true;
  assert.equal(reviewPreparationInputs(parsePreparationRenderInputs(value, [stay])).entryCode, 'stay_code_review');
  value.lockMapped = false; value.access.smart_lock_code = ' '; value.access.wifi_password = ''; value.property.wifi_name = ' ';
  const missing = reviewPreparationInputs(parsePreparationRenderInputs(value, [stay]));
  assert.equal(missing.entryCode, 'missing'); assert.equal(missing.wifiName, false); assert.equal(missing.wifiPassword, false);
});
test('cleaner review honors exact scope and region, without granting access or exposing recipients', () => {
  const value = raw();
  value.cleanerRecipients = [{ enabled: true, property_ids: [], region: 'cape_ann' },
    { enabled: true, property_ids: ['other-home'], region: 'bridgeport_ct' }];
  const check = () => reviewPreparationInputs(parsePreparationRenderInputs(value, [stay])).cleaner;
  assert.equal(check().status, 'not_configured');
  value.cleanerRecipients.push({ enabled: false, property_ids: ['65_calderwood'], region: 'bridgeport_ct' });
  assert.equal(check().status, 'disabled');
  value.cleanerRecipients[2].enabled = true;
  assert.equal(check().status, 'access_review');
  value.cleanerRecipients.push({ enabled: true, property_ids: [], region: 'bridgeport_ct' });
  assert.equal(check().status, 'multiple_recipients');
  assert.equal(check().enabledRecipients, 2); assert.equal(check().configuredRecipients, 2);
  assert.equal(check().scheduleAccessVerified, false); assert.equal(check().recipientVerified, false);
  assert.deepEqual(render(value).find(r => r.key === 'cleaner_reminder')!.missingFields, ['cleaner_schedule_url']);
  assert.equal(JSON.stringify(check()).includes('other-home'), false);
});
test('missing or malformed cleaner metadata cannot look like an empty successful read', () => {
  for (const cleanerRecipients of [undefined, null, [{ enabled: true, property_ids: null, region: 'bridgeport_ct' }],
    [{ enabled: true, property_ids: [], region: null }], [{ enabled: true, property_ids: [], region: 'bridgeport_ct', portal_token: 'PRIVATE' }]]) {
    assert.throws(() => parsePreparationRenderInputs({ ...raw(), cleanerRecipients }, [stay]), /Message render inputs unavailable/);
  }
});

test('configured reminder link rehearses masked without exposing a phone, token or access attestation', () => {
  const recipient = { enabled: true, property_ids: ['65_calderwood'], region: 'bridgeport_ct',
    phone: '+12025550100', portal_token: 'a'.repeat(32), language: 'en' };
  const input = parsePreparationRenderInputs({ ...raw(), cleanerRecipients: [recipient] }, [stay]);
  const review = reviewPreparationInputs(input), result = rehearsePreparedMessages(rules(), input, stay, clocks);
  assert.equal(review.cleaner.scheduleLinkConfigured, true);
  assert.equal(review.cleaner.scheduleAccessVerified, false);
  assert.equal(review.cleaner.recipientVerified, false);
  const reminder = result.find(r => r.key === 'cleaner_reminder')!;
  assert.deepEqual(reminder.missingFields, []); assert.ok(reminder.preview?.includes('••••'));
  assert.equal(reminder.canSend, false);
  for (const privateValue of [recipient.phone, recipient.portal_token, '/c/'])
    assert.equal(JSON.stringify({ review, result }).includes(privateValue), false);
});

test('a literal contact or bearer token in captured wording is also removed from rehearsal output', () => {
  const recipient = { enabled: true, property_ids: ['65_calderwood'], region: 'bridgeport_ct',
    phone: '+12025550100', portal_token: 'a'.repeat(32), language: 'en' };
  const input = parsePreparationRenderInputs({ ...raw(), cleanerRecipients: [recipient] }, [stay]);
  const value = rules(); value[4].body += ` ${recipient.phone} https://helm.risingtidestr.com/c/${recipient.portal_token}/stays`;
  value[4].migration_policy = { ...(value[4].migration_policy as object), bodySha256: createHash('sha256').update(value[4].body).digest('hex') };
  const output = JSON.stringify(rehearsePreparedMessages(value, input, stay, clocks));
  assert.equal(output.includes(recipient.phone), false); assert.equal(output.includes(recipient.portal_token), false);
});
