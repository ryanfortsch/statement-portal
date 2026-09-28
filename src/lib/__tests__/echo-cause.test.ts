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
 *     hour passed as its cause (nextAge).
 * And round 8, against the ages themselves: an extension or a revival lost
 * the nights a stay had held (its own echo listed for good), a Helm row
 * moved onto a guest's nights kept its creation age (the guest hidden),
 * and a declined inquiry passed as a stay Booking.com was sent.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ECHO_LAG_GRACE_MS, REVIVAL_GAP_MS, closureNightSinceMs, echoExplained, heldBeforeCancel, heldSinceMs, movedAge, nextAge, nightHeldSinceMs, type AgeRow, type CoverRow, type PriorRow } from '../echo-cause.ts';

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

describe('a row is aged night by night by when it began holding each one', () => {
  test('a stay moved onto the nights after the closure appeared is not its cause', () => {
    const c = closure(T0);
    const moved = cover({ at: T0 - 16 * 24 * H, live_since: iso(T0 + 2 * H) });
    assert.equal(judge(c, [moved], T0 + 3 * H).explained, false, 'no allowance: the move started these nights');
  });

  test("an extension keeps the age of the nights it already held, so its old closures stay its echo", () => {
    const c = closure(T0);
    const prior = { check_in: '2026-11-10', check_out: '2026-11-14', created_at: iso(T0 - 16 * 24 * H) };
    const age = movedAge(prior, { check_in: '2026-11-10', check_out: '2026-11-16' }, new Date(T0 + 5 * 24 * H));
    assert.deepEqual(age.held_ages, [{ from: '2026-11-10', to: '2026-11-14', since: iso(T0 - 16 * 24 * H) }]);
    const extended = cover({ at: T0 - 16 * 24 * H, check_out: '2026-11-16', ...age });
    assert.equal(judge(c, [extended], T0 + 40 * 24 * H).explained, true);
    // Booking.com closing the two added nights later is explained too.
    const added = { check_in: '2026-11-14', check_out: '2026-11-16', created_at: iso(T0 + 5 * 24 * H + 3 * H), live_since: iso(T0 + 5 * 24 * H + 3 * H) };
    assert.equal(echoExplained({ closure: added, nights: ['2026-11-14', '2026-11-15'], covers: [extended], now: T0 + 40 * 24 * H, allowRecentWithdrawal: true }).explained, true);
  });

  test("a stay moved so it keeps only some nights: the rest start at the move", () => {
    const prior = { check_in: '2026-12-01', check_out: '2026-12-05', created_at: iso(T0 - 16 * 24 * H) };
    const age = movedAge(prior, { check_in: '2026-11-10', check_out: '2026-11-14' }, new Date(T0 + 2 * H));
    assert.deepEqual(age, { live_since: iso(T0 + 2 * H), held_ages: null }, 'no night shared');
    const r = { ...prior, ...movedAge(prior, { check_in: '2026-12-03', check_out: '2026-12-08' }, new Date(T0 + 2 * H)), check_in: '2026-12-03', check_out: '2026-12-08' };
    assert.equal(nightHeldSinceMs(r, '2026-12-04'), T0 - 16 * 24 * H);
    assert.equal(nightHeldSinceMs(r, '2026-12-06'), T0 + 2 * H);
  });

  test('two moves: every night keeps exactly its own age', () => {
    const first = { check_in: '2026-11-10', check_out: '2026-11-14', created_at: iso(T0 - 30 * 24 * H) };
    const a1 = movedAge(first, { check_in: '2026-11-10', check_out: '2026-11-16' }, new Date(T0));
    const second = { ...first, ...a1, check_out: '2026-11-16' };
    const a2 = movedAge(second, { check_in: '2026-11-11', check_out: '2026-11-13' }, new Date(T0 + H));
    assert.deepEqual(a2.held_ages, [{ from: '2026-11-11', to: '2026-11-13', since: iso(T0 - 30 * 24 * H) }]);
    // Shifted to share nights of both ages: each keeps its own.
    const a3 = movedAge(second, { check_in: '2026-11-13', check_out: '2026-11-18' }, new Date(T0 + H));
    assert.deepEqual(a3.held_ages, [
      { from: '2026-11-13', to: '2026-11-14', since: iso(T0 - 30 * 24 * H) },
      { from: '2026-11-14', to: '2026-11-16', since: iso(T0) },
    ]);
  });

  test('heldSinceMs reads live_since, else created_at', () => {
    assert.equal(heldSinceMs({ created_at: iso(T0), live_since: iso(T0 + H) }), T0 + H);
    assert.equal(heldSinceMs({ created_at: iso(T0), live_since: null }), T0);
  });
});

describe("nextAge: the ages a writer stores (ical-sync, and helm_move_booking in SQL)", () => {
  const at = new Date(T0);
  const prior = (p: Partial<PriorRow> = {}): PriorRow => ({ status: 'confirmed', check_in: '2026-11-10', check_out: '2026-11-14', created_at: iso(T0 - 20 * 24 * H), cancelled_at: null, ...p });
  const same = { check_in: '2026-11-10', check_out: '2026-11-14' };
  test('a row not on file, or one that held nothing (an inquiry confirmed), is new', () => {
    assert.equal(nextAge(null, same, at)?.live_since, iso(T0));
    assert.equal(nextAge(prior({ status: 'inquiry' }), same, at)?.live_since, iso(T0));
  });
  test('a live row with the same dates keeps its ages; moved dates keep the shared nights', () => {
    assert.equal(nextAge(prior(), same, at), null);
    assert.deepEqual(nextAge(prior(), { ...same, check_out: '2026-11-16' }, at)?.held_ages?.map((a) => a.to), ['2026-11-14']);
  });
  test("an OTA's closure back within REVIVAL_GAP_MS keeps its age; later, it starts again", () => {
    const ota = { ...same, hold_kind: 'ota' };
    assert.equal(nextAge(prior({ status: 'cancelled', cancelled_at: iso(T0 - H) }), ota, at), null);
    assert.equal(nextAge(prior({ status: 'cancelled', cancelled_at: iso(T0 - REVIVAL_GAP_MS - 60_000) }), ota, at)?.live_since, iso(T0));
    assert.equal(nextAge(prior({ status: 'cancelled', cancelled_at: null }), ota, at)?.live_since, iso(T0));
  });
  test('a stay back within the echo lag keeps its age (a chain would bridge the gap); later, it starts again', () => {
    assert.equal(nextAge(prior({ status: 'cancelled', cancelled_at: iso(T0 - 5 * H) }), same, at), null);
    assert.equal(nextAge(prior({ status: 'cancelled', cancelled_at: iso(T0 - ECHO_LAG_GRACE_MS - 60_000) }), same, at)?.live_since, iso(T0));
  });
  test("round 8: an Airbnb stay dropped for 2.5 hours still explains its own Booking.com echo", () => {
    const c = closure(T0 - 10 * 24 * H);
    const created = T0 - 16 * 24 * H;
    const cancelledAt = T0 - 150 * 60_000;
    const age = nextAge(prior({ status: 'cancelled', created_at: iso(created), cancelled_at: iso(cancelledAt) }), same, at);
    assert.equal(age, null, 'its age is kept');
    const back = cover({ at: created });
    assert.equal(judge(c, [back], T0 + 20 * 24 * H).explained, true);
  });
  test("a Booking.com guest's closure that blinked out for an hour stays unexplained by the stay sold in that hour", () => {
    // Oct 1 the closure appears; nobody enters the guest. Oct 5 the feed
    // drops it, two looks cancel it at 10:00, an Airbnb stay is sold at
    // 10:20, the feed shows it again at 10:30.
    const cancelledAt = T0 + 4 * 24 * H;
    const back = new Date(cancelledAt + 30 * 60_000);
    assert.equal(nextAge(prior({ status: 'cancelled', cancelled_at: iso(cancelledAt) }), { ...same, hold_kind: 'ota' }, back), null, 'the closure keeps its age');
    const soldInGap = cover({ at: cancelledAt + 20 * 60_000 });
    assert.equal(judge(closure(T0), [soldInGap], back.getTime() + 24 * H).explained, false);
    // Restarted, as before round 7, the same stay passed as its cause.
    assert.equal(judge(closure(back.getTime()), [soldInGap], back.getTime() + 24 * H).explained, true);
  });
});

describe('heldBeforeCancel: only a row that held nights is a link', () => {
  test('a feed row always held; a Helm row only once it held (live_since)', () => {
    assert.equal(heldBeforeCancel({ source: 'ical_import' }), true);
    assert.equal(heldBeforeCancel({ source: 'guesty_legacy' }), true);
    assert.equal(heldBeforeCancel({ source: 'direct_booking', live_since: null }), false, 'a declined inquiry');
    assert.equal(heldBeforeCancel({ source: 'manual', live_since: iso(T0) }), true);
  });
});

describe("a closure's own nights keep their age when Booking.com extends it", () => {
  test("a Booking.com guest who extends: the stay double-booked on their original nights is still no cause", () => {
    // C: Nov 10-14 since Oct 1, extended on Booking.com to Nov 10-16 on
    // Oct 20 (kept Nov 10-14 since Oct 1). S: an Airbnb stay made Oct 10
    // over all six nights, a double booking.
    const oct = (d: number) => Date.parse(`2026-10-${String(d).padStart(2, '0')}T12:00:00Z`);
    const c = { check_in: '2026-11-10', check_out: '2026-11-16', created_at: iso(oct(1)), live_since: iso(oct(20)), held_ages: [{ from: '2026-11-10', to: '2026-11-14', since: iso(oct(1)) }] };
    const s = cover({ at: oct(10), check_out: '2026-11-16' });
    const nights = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];
    assert.equal(echoExplained({ closure: c, nights, covers: [s], now: oct(25), allowRecentWithdrawal: true }).explained, false);
  });
});

describe('round 9: a closure grown twice, re-issued, or a declined inquiry re-confirmed', () => {
  const h = (d: number, hh = 0) => Date.parse(`2026-10-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:30:00Z`);
  const nights = (from: string, to: string) => {
    const out: string[] = [];
    for (let d = from; d < to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) out.push(d);
    return out;
  };
  test("a Booking.com guest's closure grown twice in place still dates their nights from when they closed", () => {
    // G books Nov 10-14 (C imported Oct 1 10:30); an Airbnb stay S (Nov
    // 10-16) is imported at 11:30 in the iCal race; C grows to Nov 10-16 at
    // 14:30, then to Nov 10-18 on Oct 5.
    let c: AgeRow & { check_in: string; check_out: string } = { check_in: '2026-11-10', check_out: '2026-11-14', created_at: iso(h(1, 10)), live_since: iso(h(1, 10)) };
    const g1 = movedAge(c, { check_in: '2026-11-10', check_out: '2026-11-16' }, new Date(h(1, 14)));
    c = { ...c, ...g1, check_out: '2026-11-16' };
    const g2 = movedAge(c, { check_in: '2026-11-10', check_out: '2026-11-18' }, new Date(h(5, 9)));
    c = { ...c, ...g2, check_out: '2026-11-18' };
    assert.equal(nightHeldSinceMs(c, '2026-11-11'), h(1, 10), "the guest's night keeps its own age");
    const s = cover({ at: h(1, 11), check_out: '2026-11-16' });
    const h2 = cover({ at: h(5, 8), check_in: '2026-11-16', check_out: '2026-11-18' });
    const judged = echoExplained({ closure: c, nights: nights('2026-11-10', '2026-11-18'), covers: [s, h2], now: h(20), allowRecentWithdrawal: true });
    assert.equal(judged.explained, false, 'the double booking stays listed');
  });

  test('a run re-issued under a new UID is aged from the first one (closureNightSinceMs)', () => {
    const first = { id: 'u1', status: 'cancelled', check_in: '2026-11-10', check_out: '2026-11-14', created_at: iso(h(1, 10)), live_since: iso(h(1, 10)), cancelled_at: iso(h(1, 15)) };
    const reissued = { check_in: '2026-11-10', check_out: '2026-11-16', created_at: iso(h(1, 14)), live_since: iso(h(1, 14)) };
    assert.equal(closureNightSinceMs(reissued, '2026-11-11', [first]), h(1, 10));
    assert.equal(closureNightSinceMs(reissued, '2026-11-15', [first]), h(1, 14), 'a night the first never closed');
    const longGone = { ...first, cancelled_at: iso(h(1, 10) + REVIVAL_GAP_MS) };
    const later = { ...reissued, created_at: iso(h(1, 10) + 3 * REVIVAL_GAP_MS), live_since: iso(h(1, 10) + 3 * REVIVAL_GAP_MS) };
    assert.equal(closureNightSinceMs(later, '2026-11-11', [longGone]), h(1, 10) + 3 * REVIVAL_GAP_MS, 'a real reopen and re-close starts again');
    const s = cover({ at: h(1, 11), check_out: '2026-11-16' });
    assert.equal(echoExplained({ closure: reissued, nights: ['2026-11-10', '2026-11-11'], covers: [s], now: h(20), allowRecentWithdrawal: true, closureSiblings: [first] }).explained, false);
    assert.equal(echoExplained({ closure: reissued, nights: ['2026-11-10', '2026-11-11'], covers: [s], now: h(20), allowRecentWithdrawal: true }).explained, true, 'read alone, the re-issue hid the guest');
  });

  test('a declined inquiry re-confirmed within the lag starts holding now', () => {
    const declined: PriorRow = { status: 'cancelled', source: 'direct_booking', check_in: '2026-11-10', check_out: '2026-11-14', created_at: iso(h(1)), live_since: null, cancelled_at: iso(h(1, 9)) };
    assert.equal(nextAge(declined, { check_in: '2026-11-10', check_out: '2026-11-14' }, new Date(h(1, 12)))?.live_since, iso(h(1, 12)));
    const heldStay: PriorRow = { ...declined, live_since: iso(h(1)) };
    assert.equal(nextAge(heldStay, { check_in: '2026-11-10', check_out: '2026-11-14' }, new Date(h(1, 12))), null, 'a real stay back within the lag keeps its age');
  });
});

describe("round 10: a closure chains only to one its feed still showed a beat earlier", () => {
  const at = (hh: number, mm = 0) => Date.parse(`2026-10-01T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
  test("a leftover opened in the extranet, then Helm's owner hold and its echo: the echo is the hold's", () => {
    // X1 (leftover since Sep 20) missed at 10:00, cancelled at the next
    // look 10:30; owner hold H written 10:35; Booking.com closes the nights
    // again, X2 at 11:00. Measured from the cancel X1 looked like it was
    // still up; its feed stopped showing it an hour before X2.
    const x1 = { id: 'X1', status: 'cancelled', check_in: '2026-11-10', check_out: '2026-11-20', created_at: '2026-09-20T00:00:00Z', live_since: '2026-09-20T00:00:00Z', missing_since: iso(at(10)), cancelled_at: iso(at(10, 30)) };
    const x2 = { check_in: '2026-11-10', check_out: '2026-11-20', created_at: iso(at(11)), live_since: iso(at(11)) };
    assert.equal(closureNightSinceMs(x2, '2026-11-12', [x1]), at(11), 'X1 was gone an hour: a different closure');
    const hold = cover({ at: at(10, 35), status: 'block', check_out: '2026-11-20' });
    const ns = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'];
    assert.equal(echoExplained({ closure: x2, nights: ns, covers: [hold], now: at(23), allowRecentWithdrawal: true, closureSiblings: [x1] }).explained, true);
  });
  test('a re-issue in the same fetch still chains (the old event missed in the sync that first sees the new one)', () => {
    const old = { id: 'U1', status: 'block', check_in: '2026-11-10', check_out: '2026-11-14', created_at: '2026-09-20T00:00:00Z', live_since: '2026-09-20T00:00:00Z', missing_since: iso(at(14, 30)) };
    const fresh = { check_in: '2026-11-10', check_out: '2026-11-16', created_at: iso(at(14, 30)), live_since: iso(at(14, 30)) };
    assert.equal(closureNightSinceMs(fresh, '2026-11-11', [old]), Date.parse('2026-09-20T00:00:00Z'));
  });
});
