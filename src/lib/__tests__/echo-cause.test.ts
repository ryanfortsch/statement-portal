/**
 * Is an OTA's closure the OTA echoing nights Helm sent it? (lib/echo-cause)
 *
 * The round-7 timing cases, each reproduced by a reviewer against the rule
 * that compared creation instants:
 *   - a rebook of the same nights inside Booking.com's pull lag left the
 *     closure up for the rebook, and it was listed until checkout as a
 *     booking nobody entered;
 *   - an Airbnb stay MOVED onto a Booking.com guest's nights after the
 *     closure appeared passed as its cause (created_at predated it);
 *   - a Booking.com guest's closure that blinked out of the feed for an
 *     hour came back with a fresh age, and the Airbnb stay sold in that
 *     hour passed as its cause (freshSince).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ECHO_LAG_GRACE_MS, REVIVAL_GAP_MS, echoExplained, freshSince, heldSinceMs, type CoverRow } from '../echo-cause.ts';

const H = 3_600_000;
const T0 = Date.parse('2026-10-01T10:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const NIGHTS = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];
const closure = (at: number) => ({ check_in: '2026-11-10', check_out: '2026-11-14', created_at: iso(at), live_since: iso(at) });

let n = 0;
function cover(p: Partial<CoverRow> & { at: number }): CoverRow {
  n += 1;
  const { at, ...rest } = p;
  return { id: `c${n}`, status: 'confirmed', check_in: '2026-11-10', check_out: '2026-11-14', created_at: iso(at), live_since: null, cancelled_at: null, ...rest };
}
const judge = (c: ReturnType<typeof closure>, covers: CoverRow[], now: number, allowRecentWithdrawal = true) =>
  echoExplained({ closure: c, nights: NIGHTS, covers, now, allowRecentWithdrawal });

describe('a closure is an echo only of what held its nights before it appeared', () => {
  test('a stay that predates the closure explains it; one made after it does not', () => {
    const c = closure(T0);
    assert.equal(judge(c, [cover({ at: T0 - 5 * H })], T0 + 24 * H).explained, true);
    assert.equal(judge(c, [cover({ at: T0 + H })], T0 + 24 * H).explained, false);
  });

  test('a hold made after the closure is no cause on its own (the writer refuses one over an unexplained Booking.com closure)', () => {
    const c = closure(T0);
    assert.equal(judge(c, [cover({ at: T0 + H, status: 'block' })], T0 + 24 * H).explained, false);
  });

  test('a hold made after it, over a Guesty block that predates it, carries on when the flip cancels that block', () => {
    const c = closure(T0);
    const guestyBlock = cover({ at: T0 - 30 * 24 * H, status: 'cancelled', cancelled_at: iso(T0 + 48 * H) });
    const helmHold = cover({ at: T0 + 24 * H, status: 'block' });
    assert.equal(judge(c, [guestyBlock, helmHold], T0 + 30 * 24 * H).explained, true);
    assert.deepEqual(judge(c, [guestyBlock, helmHold], T0 + 30 * 24 * H).causes.map((r) => r.id), [helmHold.id]);
  });

  test('every night must be accounted for', () => {
    const c = closure(T0);
    const short = cover({ at: T0 - 5 * H, check_out: '2026-11-13' });
    assert.equal(judge(c, [short], T0 + 24 * H).explained, false);
  });

  test('a row let go long before the closure appeared is not its cause', () => {
    const c = closure(T0);
    const old = cover({ at: T0 - 50 * H, status: 'cancelled', cancelled_at: iso(T0 - ECHO_LAG_GRACE_MS - H) });
    const later = cover({ at: T0 + H });
    assert.equal(judge(c, [old, later], T0 + 24 * H).explained, false);
  });
});

describe('cover handed from one row to the next within the echo lag', () => {
  test("a rebook inside Booking.com's pull lag keeps the closure explained, for as long as the rebook holds", () => {
    const c = closure(T0);
    const first = cover({ at: T0 - 20 * 24 * H, status: 'cancelled', cancelled_at: iso(T0 + 15 * 24 * H) });
    const rebook = cover({ at: T0 + 15 * 24 * H + 30 * 60_000 });
    for (const later of [T0 + 15 * 24 * H + 2 * H, T0 + 25 * 24 * H, T0 + 42 * 24 * H]) {
      assert.equal(judge(c, [first, rebook], later).explained, true, new Date(later).toISOString());
    }
  });

  test('a rebook made after the lag ran out is two guests (Booking.com would have reopened)', () => {
    const c = closure(T0);
    const first = cover({ at: T0 - 20 * 24 * H, status: 'cancelled', cancelled_at: iso(T0 + 15 * 24 * H) });
    const rebook = cover({ at: T0 + 15 * 24 * H + ECHO_LAG_GRACE_MS + H });
    assert.equal(judge(c, [first, rebook], T0 + 17 * 24 * H).explained, false);
  });

  test('a chain of three rows', () => {
    const c = closure(T0);
    const a = cover({ at: T0 - 10 * H, status: 'cancelled', cancelled_at: iso(T0 + 10 * H) });
    const b = cover({ at: T0 + 12 * H, status: 'cancelled', cancelled_at: iso(T0 + 40 * H) });
    const d = cover({ at: T0 + 41 * H });
    assert.equal(judge(c, [a, b, d], T0 + 90 * H).explained, true);
    assert.equal(judge(c, [a, d], T0 + 90 * H).explained, false, 'without the middle link the gap is 31 hours');
  });

  test("the last row let go within the lag is Booking.com's lag, where the caller allows it", () => {
    const c = closure(T0);
    const gone = cover({ at: T0 - 10 * H, status: 'cancelled', cancelled_at: iso(T0 + 50 * H) });
    assert.equal(judge(c, [gone], T0 + 51 * H).explained, true);
    assert.equal(judge(c, [gone], T0 + 51 * H, false).explained, false, 'pass four needs a live row to file under');
    assert.equal(judge(c, [gone], T0 + 50 * H + ECHO_LAG_GRACE_MS + H).explained, false);
  });
});

describe('a row is aged by when its current nights began', () => {
  test('a stay moved onto the nights after the closure appeared is not its cause', () => {
    const c = closure(T0);
    const moved = cover({ at: T0 - 16 * 24 * H, live_since: iso(T0 + 2 * H) });
    assert.equal(judge(c, [moved], T0 + 2 * H + ECHO_LAG_GRACE_MS + H).explained, false);
  });

  test('within the echo lag of the move it still counts from its creation (an extension Booking.com has not pulled yet)', () => {
    const c = closure(T0);
    const extended = cover({ at: T0 - 16 * 24 * H, live_since: iso(T0 + 2 * H) });
    assert.equal(judge(c, [extended], T0 + 3 * H).explained, true);
  });

  test('a row that came back from a cancel gets no such allowance', () => {
    const c = closure(T0);
    const revived = cover({ at: T0 - 16 * 24 * H, live_since: iso(T0 + 2 * H), cancelled_at: iso(T0 - 3 * 24 * H) });
    assert.equal(judge(c, [revived], T0 + 3 * H).explained, false);
  });

  test('heldSinceMs reads live_since, else created_at', () => {
    assert.equal(heldSinceMs({ created_at: iso(T0), live_since: iso(T0 + H) }), T0 + H);
    assert.equal(heldSinceMs({ created_at: iso(T0), live_since: null }), T0);
  });
});

describe('freshSince: when ical-sync restarts a row\'s live_since', () => {
  const at = new Date(T0);
  const prior = { status: 'block', check_in: '2026-11-10', check_out: '2026-11-14', cancelled_at: null };
  const same = { check_in: '2026-11-10', check_out: '2026-11-14' };
  test('a row not on file, or one whose dates moved', () => {
    assert.equal(freshSince(null, same, at), true);
    assert.equal(freshSince(prior, { ...same, check_out: '2026-11-15' }, at), true);
  });
  test('a live row with the same dates keeps its age', () => {
    assert.equal(freshSince(prior, same, at), false);
  });
  test('a row back within REVIVAL_GAP_MS of its cancel keeps its age (a feed hiccup)', () => {
    assert.equal(freshSince({ ...prior, status: 'cancelled', cancelled_at: iso(T0 - H) }, same, at), false);
  });
  test('a row back after a longer absence starts again', () => {
    assert.equal(freshSince({ ...prior, status: 'cancelled', cancelled_at: iso(T0 - REVIVAL_GAP_MS - 60_000) }, same, at), true);
    assert.equal(freshSince({ ...prior, status: 'cancelled', cancelled_at: null }, same, at), true);
  });
  test("a Booking.com guest's closure that blinked out for an hour stays unexplained by the stay sold in that hour", () => {
    // Oct 1 the closure appears; nobody enters the guest. Oct 5 09:00 the
    // feed drops it, two looks cancel it at 10:00, an Airbnb stay is sold
    // at 10:20, the feed shows it again at 10:30.
    const appeared = T0;
    const cancelledAt = T0 + 4 * 24 * H;
    const back = new Date(cancelledAt + 30 * 60_000);
    const kept = !freshSince({ status: 'cancelled', check_in: '2026-11-10', check_out: '2026-11-14', cancelled_at: iso(cancelledAt) }, same, back);
    assert.equal(kept, true);
    const c = closure(appeared);
    const soldInGap = cover({ at: cancelledAt + 20 * 60_000 });
    assert.equal(judge(c, [soldInGap], back.getTime() + 24 * H).explained, false);
    // Restarted, as before this rule, the same stay passed as its cause.
    assert.equal(judge(closure(back.getTime()), [soldInGap], back.getTime() + 24 * H).explained, true);
  });
});
