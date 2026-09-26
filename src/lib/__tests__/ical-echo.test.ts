/**
 * The echo decision: an OTA hold is an echo of Helm's own export when every
 * night was held by a row Helm was exporting TO THAT SAME OTA.
 *
 * The scenarios named A, B, C and S1c are the ones the adversarial review
 * traced against the first version of this rule, where a stamped echo still
 * counted as a cover and a real hold could be judged an echo of its own
 * echoes. Each would have let Airbnb or VRBO sell nights a real guest held.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  coverCounts,
  echoDecisionTargets,
  isEchoAtFirstSight,
  type EchoCover,
  type EchoHold,
} from '../ical-echo.ts';

const L = { airbnb: 'listing-airbnb', vrbo: 'listing-vrbo', booking_com: 'listing-bcom' } as const;
type Ota = keyof typeof L;

const hold = (channel: Ota, check_in: string, check_out: string): EchoHold => ({ channel, check_in, check_out, channel_listing_id: L[channel] });

/** A stay imported from an OTA feed. */
const stay = (channel: Ota, check_in: string, check_out: string, over: Partial<EchoCover> = {}): EchoCover => ({
  status: 'confirmed',
  check_in,
  check_out,
  duplicate_of: null,
  source: 'ical_import',
  channel_listing_id: L[channel],
  channel,
  hold_kind: null,
  echo_seen_at: null,
  ...over,
});

/** An OTA hold on file, stamped or not. */
const otaHold = (channel: Ota, check_in: string, check_out: string, stamped: boolean): EchoCover => ({
  ...stay(channel, check_in, check_out),
  status: 'block',
  hold_kind: 'ota',
  echo_seen_at: stamped ? '2026-10-01T00:00:00Z' : null,
});

/** A hold entered in Helm (owner, maintenance). */
const helmBlock = (check_in: string, check_out: string): EchoCover => ({
  status: 'block',
  check_in,
  check_out,
  duplicate_of: null,
  source: 'manual',
  channel_listing_id: null,
  channel: 'block',
  hold_kind: 'owner',
  echo_seen_at: null,
});

describe('true echoes are recognised', () => {
  test("Airbnb's closure of nights a VRBO stay holds", () => {
    assert.equal(isEchoAtFirstSight(hold('airbnb', '2026-10-10', '2026-10-14'), [stay('vrbo', '2026-10-10', '2026-10-14')]), true);
  });

  test("Airbnb's closure of a real Booking.com reservation (an unstamped OTA hold Helm exports to Airbnb)", () => {
    assert.equal(isEchoAtFirstSight(hold('airbnb', '2026-10-10', '2026-10-14'), [otaHold('booking_com', '2026-10-10', '2026-10-14', false)]), true);
  });

  test('a coalesced span over a VRBO stay and a Helm owner block back to back', () => {
    const covers = [stay('vrbo', '2026-09-01', '2026-09-05'), helmBlock('2026-09-05', '2026-09-10')];
    assert.equal(isEchoAtFirstSight(hold('airbnb', '2026-09-01', '2026-09-10'), covers), true);
  });
});

describe('real holds are never judged echoes', () => {
  test('a hold on open nights', () => {
    assert.equal(isEchoAtFirstSight(hold('booking_com', '2026-10-10', '2026-10-14'), []), false);
  });

  test('partial coverage: some of those nights were open', () => {
    assert.equal(isEchoAtFirstSight(hold('airbnb', '2026-09-01', '2026-09-10'), [stay('vrbo', '2026-09-01', '2026-09-05')]), false);
  });

  test('A: an Airbnb owner block coalesced with a later VRBO stay stays real', () => {
    // Owner block O 10/10-10/14 on Airbnb (real, exported to VRBO and
    // Booking.com; their closures V and B stamped). A VRBO stay S 10/14-10/18
    // books. Airbnb merges everything into one new event 10/10-10/18.
    const covers = [
      otaHold('airbnb', '2026-10-10', '2026-10-14', false),
      otaHold('vrbo', '2026-10-10', '2026-10-14', true),
      otaHold('booking_com', '2026-10-10', '2026-10-14', true),
      stay('vrbo', '2026-10-14', '2026-10-18'),
    ];
    assert.equal(isEchoAtFirstSight(hold('airbnb', '2026-10-10', '2026-10-18'), covers), false);
  });

  test('B: a Booking.com guest booking nights a cancelled VRBO stay freed, while Airbnb still shows its stale echo', () => {
    // S cancelled; Airbnb's stamped echo A has not aged out yet.
    const covers = [
      stay('vrbo', '2026-10-10', '2026-10-14', { status: 'cancelled' }),
      otaHold('airbnb', '2026-10-10', '2026-10-14', true),
    ];
    assert.equal(isEchoAtFirstSight(hold('booking_com', '2026-10-10', '2026-10-14'), covers), false);
  });

  test('C: a real Booking.com reservation shortened and re-keyed stays real', () => {
    // R 10/10-10/15 real; its Airbnb and VRBO echoes are stamped; R2
    // 10/10-10/13 replaces it under a new UID.
    const covers = [
      otaHold('booking_com', '2026-10-10', '2026-10-15', false),
      otaHold('airbnb', '2026-10-10', '2026-10-15', true),
      otaHold('vrbo', '2026-10-10', '2026-10-15', true),
    ];
    assert.equal(isEchoAtFirstSight(hold('booking_com', '2026-10-10', '2026-10-13'), covers), false);
  });

  test('S1c: a stale stamped echo from another OTA never makes a new real hold an echo', () => {
    assert.equal(isEchoAtFirstSight(hold('booking_com', '2026-10-10', '2026-10-14'), [otaHold('airbnb', '2026-10-10', '2026-10-14', true)]), false);
  });
});

describe('coverCounts: only what Helm was exporting to the hold\'s own OTA', () => {
  const h = hold('airbnb', '2026-10-10', '2026-10-14');
  test('a stay or a hold from another channel counts', () => {
    assert.equal(coverCounts(h, stay('vrbo', '2026-10-10', '2026-10-14')), true);
    assert.equal(coverCounts(h, otaHold('booking_com', '2026-10-10', '2026-10-14', false)), true);
    assert.equal(coverCounts(h, helmBlock('2026-10-10', '2026-10-14')), true);
  });
  test("the hold's own channel never counts, whatever the source", () => {
    assert.equal(coverCounts(h, stay('airbnb', '2026-10-10', '2026-10-14')), false);
    assert.equal(coverCounts(h, stay('airbnb', '2026-10-10', '2026-10-14', { source: 'guesty_legacy', channel_listing_id: null })), false);
    assert.equal(coverCounts(h, otaHold('airbnb', '2026-10-10', '2026-10-14', false)), false);
  });
  test('a stamped echo never counts', () => {
    assert.equal(coverCounts(h, otaHold('vrbo', '2026-10-10', '2026-10-14', true)), false);
  });
  test('a cancelled row, an inquiry, a pending request or a duplicate never counts', () => {
    for (const status of ['cancelled', 'inquiry', 'pending']) {
      assert.equal(coverCounts(h, stay('vrbo', '2026-10-10', '2026-10-14', { status })), false, status);
    }
    assert.equal(coverCounts(h, stay('vrbo', '2026-10-10', '2026-10-14', { duplicate_of: 'x' })), false);
  });
  test('a row from the same listing never counts, even under another channel label', () => {
    assert.equal(coverCounts(h, stay('vrbo', '2026-10-10', '2026-10-14', { channel_listing_id: L.airbnb })), false);
  });
  test('an empty or reversed range is never an echo', () => {
    const covers = [stay('vrbo', '2026-10-01', '2026-10-30')];
    assert.equal(isEchoAtFirstSight(hold('airbnb', '2026-10-10', '2026-10-10'), covers), false);
    assert.equal(isEchoAtFirstSight(hold('airbnb', '2026-10-12', '2026-10-10'), covers), false);
  });
});

describe('echoDecisionTargets: when a verdict is taken', () => {
  const incoming = (uid: string, check_in: string, check_out: string, status = 'block', hold_kind: string | null = 'ota') => ({ ical_uid: uid, status, hold_kind, check_in, check_out });
  const prior = (id: string, status: string, check_in: string, check_out: string) => ({ id, status, check_in, check_out });

  test('a first-seen OTA hold is decided on insert; a stay never is', () => {
    const t = echoDecisionTargets([incoming('h1', '2026-10-10', '2026-10-14'), incoming('s1', '2026-10-10', '2026-10-14', 'confirmed', null)], new Map());
    assert.deepEqual(t.insert.map((r) => r.ical_uid), ['h1']);
    assert.deepEqual(t.redecide, []);
  });

  test('a hold that comes back after it was cancelled is decided again (its old verdict is stale)', () => {
    const t = echoDecisionTargets([incoming('h1', '2026-10-10', '2026-10-14')], new Map([['h1', prior('row-1', 'cancelled', '2026-10-10', '2026-10-14')]]));
    assert.deepEqual(t.redecide.map((r) => [r.ical_uid, r.prior_id]), [['h1', 'row-1']]);
  });

  test('a hold whose dates moved under the same UID is decided again', () => {
    const t = echoDecisionTargets([incoming('h1', '2026-10-10', '2026-10-18')], new Map([['h1', prior('row-1', 'block', '2026-10-10', '2026-10-14')]]));
    assert.deepEqual(t.redecide.map((r) => r.prior_id), ['row-1']);
  });

  test('a hold that stayed live on the same dates keeps its verdict', () => {
    const t = echoDecisionTargets([incoming('h1', '2026-10-10', '2026-10-14')], new Map([['h1', prior('row-1', 'block', '2026-10-10', '2026-10-14')]]));
    assert.deepEqual(t.insert, []);
    assert.deepEqual(t.redecide, []);
  });
});
