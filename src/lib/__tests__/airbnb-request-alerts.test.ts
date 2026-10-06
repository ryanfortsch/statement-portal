import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliverRequestAlert, requestAlertText, REQUEST_ALERT_TO, type AlertDependencies } from '../airbnb-request-alerts.ts';
import { parseRequestNotification, type RequestReview } from '../airbnb-request-notifications.ts';
const now = Date.parse('2026-10-06T12:00:00Z');
const source = { messageId: 'synthetic', receivedAt: '2026-10-06T11:00:00Z', guest: 'Example', datesText: 'Jan 1 - Jan 21', amountText: '$2,000', url: 'https://airbnb.com/l/example', body: '' };
const review: RequestReview = { message_id: 'synthetic', property_id: '17_beach_back', check_in: '2027-01-01', check_out: '2027-01-21', evidence_url: 'https://www.airbnb.com/rooms/1600199261450230737', reviewed_by: 'staff@example.test', reviewed_at: source.receivedAt };
function harness() {
  let claimed = false; let sends = 0;
  const records: string[] = [];
  const deps: AlertDependencies = {
    async claim() { if (claimed) return false; claimed = true; return true; },
    async send() { sends++; return 'synthetic-provider-id'; },
    async record(status) { records.push(status); },
  };
  return { deps, records, sends: () => sends };
}
test('verified alert labels status and never parses itself as a new request', () => {
  const body = requestAlertText(source, review, now)!;
  assert.match(body, /Guest house/); assert.match(body, /NOT confirmed/);
  assert.equal(parseRequestNotification({ type: 'message.received', data: { object: { id: 'loop', body, direction: 'incoming' } } }, source.receivedAt), null);
});
test('disabled, other, stale, mismatched and self-send cannot reach provider', async () => {
  const h = harness();
  assert.equal(await deliverRequestAlert(false, '+19788652500', source, review, now, h.deps), 'disabled');
  assert.equal(await deliverRequestAlert(true, REQUEST_ALERT_TO, source, review, now, h.deps), 'unavailable');
  for (const r of [{ ...review, property_id: 'other' as const }, { ...review, message_id: 'wrong' }]) assert.equal(await deliverRequestAlert(true, '+19788652500', source, r, now, h.deps), 'skipped');
  assert.equal(await deliverRequestAlert(true, '+19788652500', source, review, now + 86400000, h.deps), 'skipped');
  assert.equal(h.sends(), 0);
});
test('concurrent/replayed submissions make one provider call', async () => {
  const h = harness();
  const results = await Promise.all([1,2,3].map(() => deliverRequestAlert(true, '+19788652500', source, review, now, h.deps)));
  assert.equal(h.sends(), 1); assert.equal(results.filter(r => r === 'accepted').length, 1);
});
test('claim failure prevents send; ambiguous provider result is not retried', async () => {
  const h = harness();
  assert.equal(await deliverRequestAlert(true, '+19788652500', source, review, now, { ...h.deps, claim: async () => { throw Error('storage'); } }), 'unavailable');
  assert.equal(h.sends(), 0);
  let attempts = 0;
  h.deps.send = async () => { attempts++; throw Error('timeout after provider may accept'); };
  assert.equal(await deliverRequestAlert(true, '+19788652500', source, review, now, h.deps), 'unknown');
  assert.equal(await deliverRequestAlert(true, '+19788652500', source, review, now, h.deps), 'already_attempted');
  assert.equal(attempts, 1); assert.deepEqual(h.records, ['unknown']);
});
test('a failed receipt write does not resend an accepted provider request', async () => {
  const h = harness(); h.deps.record = async () => { throw Error('storage'); };
  assert.equal(await deliverRequestAlert(true, '+19788652500', source, review, now, h.deps), 'unknown');
  assert.equal(await deliverRequestAlert(true, '+19788652500', source, review, now, h.deps), 'already_attempted');
  assert.equal(h.sends(), 1);
});
