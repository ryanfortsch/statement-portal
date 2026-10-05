import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequestNotification, airbnbUrl, validateReview, conflictProperties, overlaps, validStay } from '../airbnb-request-notifications.ts';
const body = 'Airbnb: Example Guest requests to stay Dec 30 - Jan 2 for $1,036.81 airbnb.com/l/example';
const event = { type: 'message.received', data: { object: { id: 'synthetic-message', body, direction: 'incoming' } } };
const at = '2026-12-01T18:00:00Z';
test('keeps year and property unknown, preserves source and quoted amount', () => {
  const parsed = parseRequestNotification(event, at)!;
  assert.equal(parsed.guest, 'Example Guest'); assert.equal(parsed.datesText, 'Dec 30 - Jan 2');
  assert.equal(parsed.amountText, '$1,036.81'); assert.equal(parsed.url, 'https://airbnb.com/l/example');
  assert.equal('property' in parsed, false); assert.equal('checkIn' in parsed, false);
});
test('does not treat auto replies, confirmed stays or outgoing messages as requests', () => {
  for (const text of ['To reply, please visit airbnb.com/l/example or use the Airbnb app.', 'Airbnb: Your reservation is confirmed', 'Thank you for contacting Rising Tide.']) {
    assert.equal(parseRequestNotification({ ...event, data: { object: { ...event.data.object, body: text } } }, at), null);
  }
  assert.equal(parseRequestNotification({ ...event, type: 'message.delivered' }, at), null);
  assert.equal(parseRequestNotification({ ...event, data: { object: { ...event.data.object, direction: 'outgoing' } } }, at), null);
  assert.equal(parseRequestNotification(null, at), null);
});
test('blocks deceptive links and unsafe protocols', () => {
  for (const url of ['https://airbnb.com.evil.example/l/x', 'https://airbnb.com@evil.example/l/x', 'http://airbnb.com/l/x', 'javascript:alert(1)', 'https://airbnb.com:444/l/x', 'https://airbnb.com/login', 'https://evil.example/l/x']) assert.equal(airbnbUrl(url), null);
  assert.equal(airbnbUrl('https://www.airbnb.com/hosting/stay/EXAMPLE?tracking=x'), 'https://www.airbnb.com/hosting/stay/EXAMPLE');
});
const review = { property: '17_beach_front', start: '2027-01-01', end: '2027-01-21', evidence: 'https://www.airbnb.com/rooms/1600199579054946669', verified: 'yes' };
test('requires verification and rejects wrong unit, spoofed property and invalid dates', () => {
  assert.equal(validateReview(review).property, '17_beach_front');
  for (const patch of [{ property: '17_beach_back' }, { property: 'toString' }, { verified: '' }, { evidence: 'https://airbnb.com/l/example' }, { end: '2027-01-01' }, { start: '2027-02-30' }]) assert.throws(() => validateReview({ ...review, ...patch }));
  assert.equal(validStay('2026-12-30', '2027-01-02'), true);
});
test('checks requested unit and whole house, not sibling; checkout is exclusive', () => {
  assert.deepEqual(conflictProperties('17_beach_front'), ['17_beach_front', '17_beach_rd']);
  assert.deepEqual(conflictProperties('17_beach_back'), ['17_beach_back', '17_beach_rd']);
  assert.equal(overlaps('2027-01-01', '2027-01-10', '2027-01-10', '2027-01-12'), false);
  assert.equal(overlaps('2027-01-01', '2027-01-10', '2027-01-09', '2027-01-12'), true);
});
