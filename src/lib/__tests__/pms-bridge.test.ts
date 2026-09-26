/**
 * The stateless signed quote id behind /api/pms/quote and
 * /api/pms/reservations: round trip, tamper, expiry, and the status map the
 * routes answer with.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  signQuote,
  verifyQuote,
  isQuoteId,
  bridgeStatus,
  ratePlanChannelFor,
  toBridgePick,
  QUOTE_ID_PREFIX,
  QUOTE_TTL_SECONDS,
  type QuotePayloadInput,
} from '../pms-bridge.ts';

const SECRET = 'test-secret-do-not-use';
const NOW = new Date('2026-09-26T15:00:00Z');

const payload: QuotePayloadInput = {
  property_id: '65_calderwood',
  check_in: '2026-10-15',
  check_out: '2026-10-18',
  guests: 6,
  channel: 'sca',
  total_cents: 168_450,
  currency: 'USD',
};

describe('signQuote / verifyQuote', () => {
  test('round trip returns the payload with iat and a 30-minute exp', () => {
    const id = signQuote(payload, SECRET, NOW);
    assert.ok(id.startsWith(QUOTE_ID_PREFIX));
    assert.ok(isQuoteId(id));
    const v = verifyQuote(id, SECRET, NOW);
    assert.equal(v.ok, true);
    if (!v.ok) return;
    assert.equal(v.payload.v, 1);
    assert.equal(v.payload.property_id, '65_calderwood');
    assert.equal(v.payload.check_in, '2026-10-15');
    assert.equal(v.payload.check_out, '2026-10-18');
    assert.equal(v.payload.guests, 6);
    assert.equal(v.payload.channel, 'sca');
    assert.equal(v.payload.total_cents, 168_450);
    assert.equal(v.payload.currency, 'USD');
    const iat = Math.floor(NOW.getTime() / 1000);
    assert.equal(v.payload.iat, iat);
    assert.equal(v.payload.exp, iat + QUOTE_TTL_SECONDS);
    assert.equal(QUOTE_TTL_SECONDS, 30 * 60);
  });

  test('the id is hq_ + base64url(json) + . + base64url(hmac), nothing else', () => {
    const id = signQuote(payload, SECRET, NOW);
    const rest = id.slice(QUOTE_ID_PREFIX.length);
    const [body, sig, extra] = rest.split('.');
    assert.equal(extra, undefined);
    assert.match(body, /^[A-Za-z0-9_-]+$/);
    assert.match(sig, /^[A-Za-z0-9_-]+$/);
    const json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    assert.equal(json.total_cents, 168_450);
    // sha256 is 32 bytes: 43 base64url characters without padding.
    assert.equal(sig.length, 43);
  });

  test('a changed total does not verify (tampered body)', () => {
    const id = signQuote(payload, SECRET, NOW);
    const rest = id.slice(QUOTE_ID_PREFIX.length);
    const [body, sig] = rest.split('.');
    const json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    json.total_cents = 100;
    const forged = `${QUOTE_ID_PREFIX}${Buffer.from(JSON.stringify(json)).toString('base64url')}.${sig}`;
    const v = verifyQuote(forged, SECRET, NOW);
    assert.deepEqual(v, { ok: false, reason: 'bad_signature' });
  });

  test('a changed signature does not verify', () => {
    const id = signQuote(payload, SECRET, NOW);
    const last = id[id.length - 1];
    const flipped = id.slice(0, -1) + (last === 'A' ? 'B' : 'A');
    const v = verifyQuote(flipped, SECRET, NOW);
    assert.deepEqual(v, { ok: false, reason: 'bad_signature' });
  });

  test('the wrong secret does not verify', () => {
    const id = signQuote(payload, SECRET, NOW);
    const v = verifyQuote(id, 'another-secret', NOW);
    assert.deepEqual(v, { ok: false, reason: 'bad_signature' });
  });

  test('valid at 29 minutes, expired at 30', () => {
    const id = signQuote(payload, SECRET, NOW);
    const at29 = new Date(NOW.getTime() + 29 * 60_000);
    const at30 = new Date(NOW.getTime() + 30 * 60_000);
    const at31 = new Date(NOW.getTime() + 31 * 60_000);
    assert.equal(verifyQuote(id, SECRET, at29).ok, true);
    assert.deepEqual(verifyQuote(id, SECRET, at30), { ok: false, reason: 'expired' });
    assert.deepEqual(verifyQuote(id, SECRET, at31), { ok: false, reason: 'expired' });
  });

  test('malformed ids are malformed, never a crash', () => {
    for (const bad of ['', 'hq_', 'hq_abc', 'hq_abc.', 'hq_.abc', 'gq_abc.def', 'hq_a b.cd', 'hq_YWJj.ZGVm.Z2hp', 'estimate_123']) {
      const v = verifyQuote(bad, SECRET, NOW);
      assert.equal(v.ok, false, bad);
      if (!v.ok) assert.ok(v.reason === 'malformed' || v.reason === 'bad_signature', `${bad}: ${v.reason}`);
    }
    assert.equal(isQuoteId('hq_abc'), false);
    assert.equal(isQuoteId('hq_abc.def'), true);
    assert.equal(isQuoteId(42), false);
  });

  test('a signed non-payload body verifies the signature but is malformed', () => {
    // Someone with the secret signs junk: the shape gate still refuses it.
    const body = Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64url');
    const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
    assert.deepEqual(verifyQuote(`${QUOTE_ID_PREFIX}${body}.${sig}`, SECRET, NOW), { ok: false, reason: 'malformed' });
  });

  test('refuses to sign or verify with an empty secret', () => {
    assert.throws(() => signQuote(payload, '', NOW));
    const id = signQuote(payload, SECRET, NOW);
    assert.deepEqual(verifyQuote(id, '', NOW), { ok: false, reason: 'malformed' });
  });
});

describe('bridgeStatus', () => {
  test('maps every failure to the status the spec names', () => {
    assert.equal(bridgeStatus('invalid'), 400);
    assert.equal(bridgeStatus('quote_invalid'), 400);
    assert.equal(bridgeStatus('not_found'), 404);
    assert.equal(bridgeStatus('calendar_authority_guesty'), 409);
    assert.equal(bridgeStatus('unavailable'), 409);
    assert.equal(bridgeStatus('tax_jurisdiction_unknown'), 409);
    assert.equal(bridgeStatus('booking_overlap'), 409);
    assert.equal(bridgeStatus('quote_drift'), 409);
    assert.equal(bridgeStatus('quote_expired'), 410);
    assert.equal(bridgeStatus('terms'), 422);
    assert.equal(bridgeStatus('not_configured'), 503);
  });
});

describe('ratePlanChannelFor', () => {
  test('sca stays sca, concierge and anything else price as direct', () => {
    assert.equal(ratePlanChannelFor('sca'), 'sca');
    assert.equal(ratePlanChannelFor('SCA'), 'sca');
    assert.equal(ratePlanChannelFor('concierge'), 'direct');
    assert.equal(ratePlanChannelFor('direct'), 'direct');
    assert.equal(ratePlanChannelFor(undefined), 'sca');
  });
});

describe('toBridgePick', () => {
  const booking = {
    id: 'b1',
    property_id: '65_calderwood',
    guest_name: 'Robin Sparkles',
    guest_phone: '(978) 555-0100',
    check_in: '2026-09-25',
    check_out: '2026-09-28',
    channel: 'direct' as const,
  };

  test('an in-house stay with a phone is a helm_sms pick starting today', () => {
    const pick = toBridgePick(booking, { propertyName: '65 Calderwood', thread: { id: 't1', guest_phone: null }, today: '2026-09-26' });
    assert.equal(pick.in_house, true);
    assert.equal(pick.effective_start, '2026-09-26');
    assert.equal(pick.module, 'helm_sms');
    assert.equal(pick.conversation_id, 'helm:t1');
    assert.equal(pick.guest_first, 'Robin');
    assert.equal(pick.channel, 'Direct');
  });

  test('no phone anywhere means no module, so the composer stays hidden', () => {
    const pick = toBridgePick({ ...booking, guest_phone: null }, { propertyName: null, thread: null, today: '2026-09-01' });
    assert.equal(pick.module, '');
    assert.equal(pick.conversation_id, '');
    assert.equal(pick.in_house, false);
    assert.equal(pick.effective_start, '2026-09-25');
    assert.equal(pick.property_name, '');
  });
});
