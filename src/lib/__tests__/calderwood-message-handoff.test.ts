import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calderwoodMessageHandoff, type HandoffInput } from '../calderwood-rehearsal/message-handoff.ts';
import { CALDERWOOD_MESSAGE_KEYS } from '../calderwood-rehearsal/message-schedule.ts';
function fixture(): HandoffInput {
  return {
    reservationId: 'fictional-stay', revision: 'v1', maxEvidenceAgeMs: 300_000,
    schedule: { checkIn: '2027-01-15', checkOut: '2027-01-18', confirmationAt: '2027-01-01T15:00:00Z', now: new Date('2027-01-01T15:00:00Z'), status: 'confirmed' },
    evidence: { reservationId: 'fictional-stay', revision: 'v1', observedAt: '2027-01-01T15:00:00Z', complete: true, senderStoppedAt: '2027-01-01T14:59:00Z', messages: Object.fromEntries(CALDERWOOD_MESSAGE_KEYS.map(key => [key, { sent: false, queued: false, uncertain: false, expiresAt: '2027-01-25T16:00:00Z' }])) },
  };
}
const row = (input: HandoffInput) => calderwoodMessageHandoff(input).find(row => row.key === 'key_code')!;
test('complete stopped-source evidence creates review candidates, never send permission', () => {
  const rows = calderwoodMessageHandoff(fixture());
  assert.ok(rows.every(r => r.disposition === 'candidate' && r.canSend === false));
});
test('missing, partial, wrong-stay, changed-revision, stale and future evidence fail closed', () => {
  for (const change of [
    { complete: false }, { reservationId: 'different' }, { revision: 'v0' },
    { observedAt: '2027-01-01T14:54:59Z' }, { observedAt: '2027-01-01T15:00:01Z' },
    { observedAt: '2027-01-01T15:00:00' }, { messages: {} },
  ]) {
    const input = fixture(); Object.assign(input.evidence!, change);
    assert.equal(row(input).disposition, 'review');
  }
  assert.equal(row({ ...fixture(), evidence: null }).disposition, 'review');
});
test('active Guesty queue stays with Guesty and absence cannot authorize takeover', () => {
  const input = fixture(); input.evidence!.senderStoppedAt = null;
  assert.equal(row(input).disposition, 'review');
  input.evidence!.messages.key_code!.queued = true;
  assert.equal(row(input).disposition, 'retain-guesty');
});
test('verified sent history suppresses, while sent plus queued or uncertain requires review', () => {
  const input = fixture(); input.evidence!.messages.key_code!.sent = true;
  assert.equal(row(input).disposition, 'suppress');
  input.evidence!.messages.key_code!.queued = true;
  assert.equal(row(input).disposition, 'review');
  input.evidence!.messages.key_code!.queued = false;
  input.evidence!.messages.key_code!.uncertain = true;
  assert.equal(row(input).disposition, 'review');
});
test('queue after stop and observation before stop cannot become candidates', () => {
  const input = fixture(); input.evidence!.messages.key_code!.queued = true;
  assert.equal(row(input).disposition, 'review');
  input.evidence!.messages.key_code!.queued = false;
  input.evidence!.senderStoppedAt = '2027-01-01T15:00:01Z';
  assert.equal(row(input).disposition, 'review');
});
test('holds and cancellations survive reconciliation', () => {
  const input = fixture(); input.schedule.held = ['key_code'];
  assert.equal(row(input).disposition, 'hold');
  input.schedule.status = 'cancelled';
  assert.equal(row(input).disposition, 'suppress');
  input.evidence!.messages.key_code!.queued = true;
  assert.equal(row(input).disposition, 'review');
});
test('due and overdue messages never become automatic catch-up candidates', () => {
  for (const now of ['2027-01-15T20:00:00Z', '2027-01-15T20:01:00Z']) {
    const input = fixture(); input.schedule.now = new Date(now); input.evidence!.observedAt = now;
    assert.equal(row(input).disposition, 'review');
  }
});
test('invalid identity and freshness policy rejected', () => {
  assert.throws(() => calderwoodMessageHandoff({ ...fixture(), reservationId: '' }));
  assert.throws(() => calderwoodMessageHandoff({ ...fixture(), maxEvidenceAgeMs: NaN }));
});

test('takeover candidates preserve verified expiry and refuse missing or invalid expiry', () => {
  for (const expiresAt of [undefined, 'invalid', '2027-01-25T16:00:00', '2027-01-01T15:00:00Z', '2027-01-15T20:00:00Z']) {
    const input = fixture(); input.evidence!.messages.key_code!.expiresAt = expiresAt;
    assert.equal(row(input).disposition, 'review');
  }
  assert.equal(row(fixture()).expiresAt, '2027-01-25T16:00:00Z');
});
test('guest-only evidence never presents the full handoff as ready', () => {
  const input = fixture(); input.evidence!.complete = false;
  input.evidence!.senderStoppedAt = null;
  input.evidence!.messages.confirmation!.sent = true;
  for (const key of ['pre_arrival', 'key_code', 'pre_checkout'] as const) input.evidence!.messages[key]!.queued = true;
  delete input.evidence!.messages.cleaner_reminder;
  delete input.evidence!.messages.cleaner_arrival;
  assert.ok(calderwoodMessageHandoff(input).every(r => r.disposition === 'review' && !r.canSend));
});
