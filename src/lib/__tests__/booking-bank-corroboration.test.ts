import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bookingTransferCorroborates } from '../booking-bank-corroboration.ts';

test('transfer matching the stay corroborates', () => {
  assert.equal(bookingTransferCorroborates(1752.5, 1752.5, [-1752.5]), 1752.5);
});
test('batched transfer covering the month corroborates', () => {
  assert.equal(bookingTransferCorroborates(1000, 2500, [2501]), 2501);
});
test('no transfer, or a wrong amount, does not', () => {
  assert.equal(bookingTransferCorroborates(1752.5, 1752.5, []), null);
  assert.equal(bookingTransferCorroborates(1752.5, 1752.5, [3348.82]), null);
});
test('ingest and fill-gap no longer match on mere Booking.com activity', () => {
  for (const f of ['../../app/api/ingest/route.ts', '../../app/api/fill-gap/route.ts']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /hasBookingActivity/);
    assert.match(src, /bookingTransferCorroborates\(/);
  }
});
