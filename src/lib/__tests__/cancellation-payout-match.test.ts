import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchCancellationPayout,
  buildCancelledCandidates,
  cancellationCheckNote,
  ALREADY_RECOGNIZED_NOTE_PREFIX,
  CANCELLATION_CHECK_INCOMPLETE_PREFIX,
  type CancelledCandidate,
  type CachedCancelledRow,
  type LiveFigure,
} from '../cancellation-payout-match.ts';

const dixon: CancelledCandidate = {
  code: 'HMSRJ5FRBT', guest_name: 'Catherine Dixon', check_in: '2026-10-14', check_out: '2026-10-18',
  host_payout: 775.29, recognized_on: null,
};
const dep = (amount: number, over: Partial<{ source: string; deposit_date: string }> = {}) =>
  ({ amount, source: 'airbnb', deposit_date: '2026-10-15', ...over });

test('Catherine Dixon: the October Airbnb deposit of $775.29 is recognized as her cancellation payout', () => {
  const m = matchCancellationPayout(dep(775.29), [dixon]);
  assert.ok(m);
  assert.equal(m.code, 'HMSRJ5FRBT');
  assert.equal(m.amount, 775.29);
  assert.equal(m.already_recognized_on, null);
  assert.equal(m.label, 'Cancellation payout (Airbnb policy): Catherine Dixon');
  assert.ok(m.label.length <= 80, 'the attribute route caps labels at 80 characters');
  assert.match(m.review_note, /Catherine Dixon's cancelled stay \(HMSRJ5FRBT, 2026-10-14\)/);
  assert.match(m.review_note, /Attribute it here/);
  assert.ok(!m.review_note.startsWith(ALREADY_RECOGNIZED_NOTE_PREFIX));
});

test('to the cent: a deposit a cent off is not her payout', () => {
  assert.equal(matchCancellationPayout(dep(775.28), [dixon]), null);
  assert.equal(matchCancellationPayout(dep(775.30), [dixon]), null);
  assert.ok(matchCancellationPayout(dep(775.294), [dixon]));
});

test('Airbnb deposits only: a Stripe or unknown deposit never matches a cancelled Airbnb stay', () => {
  assert.equal(matchCancellationPayout(dep(775.29, { source: 'stripe' }), [dixon]), null);
  assert.equal(matchCancellationPayout(dep(775.29, { source: 'other' }), [dixon]), null);
  assert.equal(matchCancellationPayout(dep(775.29, { source: null as unknown as string }), [dixon]), null);
});

test('two cancelled stays retaining the same amount is ambiguity, not a match', () => {
  const twin = { ...dixon, code: 'HMOTHER', guest_name: 'Someone Else', check_in: '2026-09-02', check_out: '2026-09-05' };
  assert.equal(matchCancellationPayout(dep(775.29), [dixon, twin]), null);
});

test('a candidate with no payout, or a payout that does not match, is ignored', () => {
  const none = { ...dixon, code: 'X', host_payout: null };
  const other = { ...dixon, code: 'Y', host_payout: 500 };
  assert.equal(matchCancellationPayout(dep(775.29), [none, other]), null);
  assert.ok(matchCancellationPayout(dep(775.29), [none, other, dixon]));
});

test('a stay from years away is not the same money', () => {
  const ancient = { ...dixon, check_in: '2024-01-01', check_out: '2024-01-05' };
  assert.equal(matchCancellationPayout(dep(775.29), [ancient]), null);
});

test('already on a statement: the note says do NOT attribute, the label stays owner-clean, the code is still suggested', () => {
  const carried = { ...dixon, recognized_on: '2026-08' };
  const m = matchCancellationPayout(dep(775.29), [carried]);
  assert.ok(m);
  assert.equal(m.code, 'HMSRJ5FRBT');
  assert.equal(m.already_recognized_on, '2026-08');
  assert.ok(m.review_note.startsWith(`${ALREADY_RECOGNIZED_NOTE_PREFIX}2026-08 statement`));
  assert.match(m.review_note, /pays the owner twice/);
  // The instruction lives in the note. If an operator confirms through the
  // guard anyway, what prints on the owner's statement is still a label.
  assert.equal(m.label, 'Cancellation payout (Airbnb policy): Catherine Dixon');
  assert.ok(!/ALREADY|do not attribute/i.test(m.label));
});

test('a zero or negative deposit never matches', () => {
  assert.equal(matchCancellationPayout(dep(0), [{ ...dixon, host_payout: 0 }]), null);
  assert.equal(matchCancellationPayout(dep(-775.29), [dixon]), null);
});

test('a very long guest name is cut by the label cap, and the note keeps the whole name', () => {
  const name = 'Maximiliana Wilhelmina Featherstonehaugh-Cholmondeley of Gloucester';
  const m = matchCancellationPayout(dep(775.29), [{ ...dixon, guest_name: name, recognized_on: '2026-08' }])!;
  assert.ok(m.label.length <= 80);
  assert.match(m.label, /^Cancellation payout \(Airbnb policy\): Maximiliana/);
  assert.ok(m.review_note.includes(name));
});

test('an amount that a DIFFERENT recognized stay on the property carries is never suggested: the deposit is as likely that row\'s own money', () => {
  const rec = (code: string, amount: number) => ({ code, amount });
  assert.equal(matchCancellationPayout(dep(775.29), [dixon], [rec('A', 1250), rec('B', 775.29), rec('C', 900)]), null);
  assert.ok(matchCancellationPayout(dep(775.29), [dixon], [rec('A', 1250), rec('B', 775.31), rec('C', 900)]), 'a cent apart is a different stay');
  assert.ok(matchCancellationPayout(dep(775.29), [dixon], []), 'no recognized stays, no exclusion');
});

test('the cancelled booking\'s OWN recognized row is not an exclusion: that is the already-recognized case, and the note says so', () => {
  // Byron Crowe, 16 Waterman (live data 2026-09-06): cancelled, fully
  // retained ($626.14), carried on the August statement in full. His
  // payout landing in September is that row's money. The queue must say
  // ALREADY, not fall back to the nearest checkout and let it be
  // attributed a second time.
  const crowe: CancelledCandidate = {
    code: 'HM9NAHMA9T', guest_name: 'Byron Crowe', check_in: '2026-08-22', check_out: '2026-08-25',
    host_payout: 626.14, recognized_on: '2026-08',
  };
  const m = matchCancellationPayout(
    { amount: 626.14, source: 'airbnb', deposit_date: '2026-09-03' },
    [crowe],
    [{ code: 'HM9NAHMA9T', amount: 626.14 }, { code: 'OTHER', amount: 1100 }],
  );
  assert.ok(m);
  assert.equal(m.code, 'HM9NAHMA9T');
  assert.ok(m.review_note.startsWith(`${ALREADY_RECOGNIZED_NOTE_PREFIX}2026-08 statement`));
});

// ── The candidate set is built from the LIVE figure ────────────────────

const cachedDixon: CachedCancelledRow = { code: 'HMSRJ5FRBT', guest_name: 'Catherine Dixon', check_in: '2026-10-14', check_out: '2026-10-18' };
const liveOf = (entries: [string, LiveFigure][]) => new Map<string, LiveFigure>(entries);
const noneRecognized = new Map<string, string>();

test('the cached money column is never consulted: the candidate carries what Guesty says live', () => {
  const { candidates, unchecked } = buildCancelledCandidates(
    [cachedDixon],
    liveOf([['HMSRJ5FRBT', { status: 'canceled', hostPayout: 775.29 }]]),
    noneRecognized,
  );
  assert.equal(unchecked.length, 0);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].host_payout, 775.29);
  assert.equal(candidates[0].recognized_on, null);
});

test('a full-refund cancel (live $0) is not a candidate, whatever the cache once said', () => {
  // The reconciler flips status only, so the cache would still hold the
  // pre-cancel amount. A rebooking by another guest at that price must
  // not be labelled this guest's cancellation payout.
  const { candidates, unchecked } = buildCancelledCandidates(
    [cachedDixon],
    liveOf([['HMSRJ5FRBT', { status: 'canceled', hostPayout: 0 }]]),
    noneRecognized,
  );
  assert.equal(candidates.length, 0);
  assert.equal(unchecked.length, 0);
});

test('a code the probe did not answer for is unchecked, not "nothing retained"', () => {
  const other: CachedCancelledRow = { code: 'HMUNKNOWN', guest_name: 'Pat', check_in: '2026-11-01', check_out: '2026-11-04' };
  const { candidates, unchecked } = buildCancelledCandidates(
    [cachedDixon, other],
    liveOf([['HMSRJ5FRBT', { status: 'canceled', hostPayout: 775.29 }]]),
    noneRecognized,
  );
  assert.equal(candidates.length, 1);
  assert.deepEqual(unchecked, ['HMUNKNOWN']);
});

test('a live row without a money block is unchecked too: null is unknown, not zero', () => {
  const { candidates, unchecked } = buildCancelledCandidates(
    [cachedDixon],
    liveOf([['HMSRJ5FRBT', { status: 'canceled', hostPayout: null }]]),
    noneRecognized,
  );
  assert.equal(candidates.length, 0);
  assert.deepEqual(unchecked, ['HMSRJ5FRBT']);
});

test('a booking that is live confirmed again is a stay, not a cancellation', () => {
  const { candidates, unchecked } = buildCancelledCandidates(
    [cachedDixon],
    liveOf([['HMSRJ5FRBT', { status: 'confirmed', hostPayout: 775.29 }]]),
    noneRecognized,
  );
  assert.equal(candidates.length, 0);
  assert.equal(unchecked.length, 0);
});

test('the recognized-on month rides onto the candidate', () => {
  const { candidates } = buildCancelledCandidates(
    [cachedDixon],
    liveOf([['HMSRJ5FRBT', { status: 'cancelled', hostPayout: 775.29 }]]),
    new Map([['HMSRJ5FRBT', '2026-08']]),
  );
  assert.equal(candidates[0].recognized_on, '2026-08');
});

test('the incomplete-check note names what was not checked and carries the guard prefix', () => {
  const n1 = cancellationCheckNote({ unchecked: ['HMA', 'HMB'], readFailed: false });
  assert.ok(n1.startsWith(CANCELLATION_CHECK_INCOMPLETE_PREFIX));
  assert.match(n1, /HMA, HMB/);
  const n2 = cancellationCheckNote({ unchecked: [], readFailed: true });
  assert.ok(n2.startsWith(CANCELLATION_CHECK_INCOMPLETE_PREFIX));
  assert.match(n2, /read failed/);
  const many = cancellationCheckNote({ unchecked: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], readFailed: false });
  assert.match(many, /and 2 more/);
});
