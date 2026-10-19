import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_ASK_SETTINGS,
  UNAVAILABLE,
  describeAsk,
  describeReview,
  firstName,
  realStays,
  windowCovering,
  type ReservationReviewAsk,
  type ReviewAskCard,
  type ReviewAskStage,
} from '../review-ask-state.ts';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

// Checked out Wed Oct 14, 2026. Day 2 is Oct 16, day 7 Oct 21, day 14 Oct 28.
const CO = '2026-10-14';
const airbnb = { checkOut: CO, channel: 'Airbnb' };
const S = DEFAULT_ASK_SETTINGS;

function card(status: string, extra: Partial<ReviewAskCard> = {}): ReviewAskCard {
  return {
    status,
    created_at: '2026-10-16T14:00:00+00:00',
    resolved_at: status === 'approved' || status === 'manual_sent' ? '2026-10-16T15:12:00+00:00' : '',
    send_at: '',
    sent_by_hand: false,
    ended_because: '',
    note: '',
    decided_by: '',
    ...extra,
  };
}
function stage(tier: string, c: ReviewAskCard | null, extra: Partial<ReviewAskStage> = {}): ReviewAskStage {
  return { tier, reason: '', recorded_at: '2026-10-16T14:00:00+00:00', late_first: false, card: c, ...extra };
}
function ask(extra: Partial<ReservationReviewAsk> = {}): ReservationReviewAsk {
  return {
    reservation_id: 'r1',
    first: null,
    followup: null,
    legacy: null,
    guest_reported_review: false,
    host_acknowledged_review: false,
    ...extra,
  };
}

test('asked, with the follow-up still to come', () => {
  const a = ask({ first: stage('green', card('approved')) });
  assert.deepEqual(describeAsk(airbnb, a, S, '2026-10-17'), { text: 'Asked Oct 16 · follow-up due Oct 21', tone: 'due' });
});

test('asked and followed up', () => {
  const a = ask({
    first: stage('green', card('approved')),
    followup: stage('green', card('approved', { resolved_at: '2026-10-21T14:40:00+00:00' })),
  });
  assert.equal(describeAsk(airbnb, a, S, '2026-10-22').text, 'Asked Oct 16 · follow-up sent Oct 21');
});

test('a sent time is read on Gloucester\'s calendar, not UTC', () => {
  // 01:30 UTC on the 17th is 9:30 PM on the 16th in Gloucester.
  const a = ask({ first: stage('green', card('approved', { resolved_at: '2026-10-17T01:30:00+00:00' })) });
  assert.match(describeAsk(airbnb, a, S, '2026-10-17').text, /^Asked Oct 16/);
});

test('cards still in flight say so, and a yellow one names whose call it is', () => {
  const sched = ask({ first: stage('green', card('scheduled', { send_at: '2026-10-16T18:07:00+00:00' })) });
  assert.deepEqual(describeAsk(airbnb, sched, S, '2026-10-16'), { text: 'First ask scheduled for Oct 16', tone: 'waiting' });
  const fringe = ask({ first: stage('yellow', card('pending'), { reason: "guest mentioned 'broken'" }) });
  assert.equal(describeAsk(airbnb, fringe, S, '2026-10-16').text, 'First ask waiting for your call (fringe stay)');
  const fu = ask({ first: stage('green', card('approved')), followup: stage('green', card('pending')) });
  assert.deepEqual(describeAsk(airbnb, fu, S, '2026-10-21'), { text: 'Asked Oct 16 · follow-up waiting for approval', tone: 'waiting' });
});

test('red, held and fringe stays say why there is no ask', () => {
  const red = ask({ first: stage('red', null, { reason: 'safety incident: smoke alarm' }) });
  assert.deepEqual(describeAsk(airbnb, red, S, '2026-10-17'), { text: 'Not asked: red stay, safety incident: smoke alarm', tone: 'skipped' });
  const bad = ask({ first: stage('red', null, { reason: 'sentiment bad: the guest was upset about the noise' }) });
  assert.equal(describeAsk(airbnb, bad, S, '2026-10-17').text, 'Not asked: red stay, the thread read badly');
  const held = ask({ first: stage('green', card('approved')), followup: stage('held', null, { reason: "not green at follow-up: guest mentioned 'broken'" }) });
  assert.equal(describeAsk(airbnb, held, S, '2026-10-22').text, 'Asked Oct 16 · no follow-up: not a clean stay by day 7');
  const yellowSent = ask({ first: stage('yellow', card('approved')) });
  assert.equal(describeAsk(airbnb, yellowSent, S, '2026-10-18').text, 'Asked Oct 16 · no follow-up for a fringe stay');
});

test('a card that did not go out says why', () => {
  const cases: Array<[Partial<ReviewAskCard> & { status: string }, string]> = [
    [{ status: 'manual_sent', ended_because: 'handled', note: 'Not worth a reply' }, 'First ask marked handled Oct 16 (Not worth a reply)'],
    [{ status: 'superseded', ended_because: 'review_arrived' }, 'Not asked: a review arrived first'],
    [{ status: 'superseded', ended_because: 'guest_reported_review' }, 'Not asked: guest said they already reviewed'],
    [{ status: 'expired', ended_because: 'window_closed' }, 'Not asked: the card expired unanswered'],
    [{ status: 'rejected', ended_because: 'declined' }, 'Not asked: declined'],
  ];
  for (const [c, want] of cases) {
    const a = ask({ first: stage('green', card(c.status, c)) });
    assert.ok(describeAsk(airbnb, a, S, '2026-10-17').text.startsWith(want), `${c.status}: ${describeAsk(airbnb, a, S, '2026-10-17').text}`);
  }
  const byHand = ask({ first: stage('green', card('manual_sent', { sent_by_hand: true })) });
  assert.match(describeAsk(airbnb, byHand, S, '2026-10-17').text, /^Asked by hand Oct 16/);
});

test('a first ask marked handled still reads as followed up, because the sweep treats it as sent', () => {
  const a = ask({ first: stage('green', card('manual_sent', { ended_because: 'handled', note: 'Not worth a reply' })) });
  assert.equal(describeAsk(airbnb, a, S, '2026-10-17').text, 'First ask marked handled Oct 16 (Not worth a reply) · follow-up due Oct 21');
});

test('Guesty\'s or a hand-written ask counts as the first ask', () => {
  const ext = ask({ first: stage('external', null) });
  assert.equal(describeAsk(airbnb, ext, S, '2026-10-17').text, 'Asked earlier in the thread · follow-up due Oct 21');
  const noFirstRow = ask({ followup: stage('green', card('approved', { resolved_at: '2026-10-21T14:00:00+00:00' })) });
  assert.equal(describeAsk(airbnb, noFirstRow, S, '2026-10-22').text, 'Asked earlier in the thread · follow-up sent Oct 21');
});

test('a late first ask is the only ask', () => {
  const a = ask({ followup: stage('green', card('approved', { resolved_at: '2026-10-21T14:00:00+00:00' }), { late_first: true }) });
  assert.equal(describeAsk(airbnb, a, S, '2026-10-24').text, 'Asked late Oct 21');
});

test('nothing recorded: the stay itself decides what can be said', () => {
  assert.deepEqual(describeAsk({ checkOut: CO, channel: 'Direct' }, null, S, '2026-10-20'), { text: 'Not asked: direct booking', tone: 'skipped' });
  assert.equal(describeAsk(airbnb, null, S, '2026-10-15').text, 'First ask due Oct 16');
  assert.equal(describeAsk(airbnb, null, S, '2026-10-17').text, 'First ask not sent yet');
  assert.equal(describeAsk(airbnb, null, S, '2026-10-19').text, 'First ask missed; a late ask is due Oct 21');
  assert.equal(describeAsk(airbnb, null, S, '2026-10-22').text, 'First ask missed; late ask not sent yet');
  assert.deepEqual(describeAsk(airbnb, null, S, '2026-10-30'), { text: 'Not asked (no reason recorded)', tone: 'unknown' });
  const said = ask({ guest_reported_review: true });
  assert.equal(describeAsk(airbnb, said, S, '2026-10-17').text, 'Not asked: guest said they already reviewed');
  const early = describeAsk(airbnb, null, S, '2026-10-20', { rating: 5, createdAt: '2026-10-15T12:00:00Z' });
  assert.equal(early.text, 'Not asked: they reviewed on their own');
  const old = describeAsk({ checkOut: '2026-09-20', channel: 'VRBO' }, null, S, '2026-10-19');
  assert.equal(old.text, 'No record: before our own asks began Oct 4');
});

test('the old single ask is reported as the only ask', () => {
  const a = ask({ legacy: { requested_at: '2026-09-27T14:00:00+00:00', card: card('approved', { resolved_at: '2026-09-27T15:00:00+00:00' }) } });
  assert.equal(describeAsk({ checkOut: '2026-09-20', channel: 'VRBO' }, a, S, '2026-10-19').text, 'Asked Sep 27');
});

test('a reviewed stay is never told a follow-up is due', () => {
  const a = ask({ first: stage('green', card('approved')) });
  const line = describeAsk(airbnb, a, S, '2026-10-18', { rating: 5, createdAt: '2026-10-17T12:00:00Z' });
  assert.equal(line.text, 'Asked Oct 16');
});

test('an unreadable ledger never reads as "not asked"', () => {
  for (const today of ['2026-10-15', '2026-10-17', '2026-10-30']) {
    const line = describeAsk(airbnb, 'unavailable', S, today);
    assert.equal(line.text, UNAVAILABLE);
    assert.ok(!/not asked/i.test(line.text));
  }
  // Even a direct booking: the page does not know what the ledger would say.
  assert.equal(describeAsk({ checkOut: CO, channel: 'Direct' }, 'unavailable', S, '2026-10-20').text, UNAVAILABLE);
});

test('the windows come from the concierge, not a copy', () => {
  const wider = { ...S, first_ask_days: [3, 5] as [number, number], followup_days: [8, 11] as [number, number] };
  assert.equal(describeAsk(airbnb, null, wider, '2026-10-15').text, 'First ask due Oct 17');
  const a = ask({ first: stage('green', card('approved')) });
  assert.equal(describeAsk(airbnb, a, wider, '2026-10-17').text, 'Asked Oct 16 · follow-up due Oct 22');
});

test('Airbnb and VRBO are sealed for 14 days; then "no review" is true', () => {
  assert.deepEqual(describeReview(airbnb, null, '2026-10-20'), { kind: 'sealed', text: 'Sealed until Oct 28' });
  assert.deepEqual(describeReview({ checkOut: CO, channel: 'VRBO' }, null, '2026-10-27'), { kind: 'sealed', text: 'Sealed until Oct 28' });
  assert.deepEqual(describeReview(airbnb, null, '2026-10-28'), { kind: 'none', text: 'No review' });
  assert.deepEqual(describeReview({ checkOut: CO, channel: 'Booking.com' }, null, '2026-10-20'), { kind: 'none', text: 'No review' });
  assert.deepEqual(describeReview({ checkOut: CO, channel: 'Direct' }, null, '2026-10-20'), { kind: 'no_platform', text: 'No review site' });
  assert.equal(describeReview(airbnb, null, '2026-10-20', true).text, 'Guest says they reviewed · Sealed until Oct 28');
});

test('a review that came in shows its stars', () => {
  assert.equal(describeReview(airbnb, { rating: 5, createdAt: '2026-10-17' }, '2026-10-20').text, 'Reviewed ★★★★★');
  assert.equal(describeReview(airbnb, { rating: 4, createdAt: '2026-10-17' }, '2026-10-20').text, 'Reviewed ★★★★☆');
  assert.equal(describeReview(airbnb, { rating: null, createdAt: '2026-10-17' }, '2026-10-20').text, 'Reviewed, no rating shown');
});

test('a closed record is the stay only when no live record holds the same nights', () => {
  const rows = [
    { reservationId: 'a', propertyId: 'p', checkIn: '2026-10-10', checkOut: '2026-10-14', status: 'confirmed' },
    // Superseded twin of the same nights (an altered Airbnb code).
    { reservationId: 'b', propertyId: 'p', checkIn: '2026-10-10', checkOut: '2026-10-14', status: 'closed' },
    // A real stay Guesty retired after checkout.
    { reservationId: 'c', propertyId: 'p', checkIn: '2026-10-01', checkOut: '2026-10-05', status: 'closed' },
    { reservationId: 'd', propertyId: 'p', checkIn: '2026-10-05', checkOut: '2026-10-08', status: 'canceled' },
    { reservationId: 'e', propertyId: 'q', checkIn: '2026-10-10', checkOut: '2026-10-14', status: null },
    { reservationId: 'a', propertyId: 'p', checkIn: '2026-10-10', checkOut: '2026-10-14', status: 'confirmed' },
  ];
  assert.deepEqual(realStays(rows).map((r) => r.reservationId), ['a', 'c', 'e']);
});

test('a link lands on the smallest window that holds its row', () => {
  const W = [7, 30, 90, 365] as const;
  assert.equal(windowCovering('2026-10-14', '2026-10-19', W), 7);
  assert.equal(windowCovering('2026-10-01', '2026-10-19', W), 30);
  assert.equal(windowCovering('2026-08-01', '2026-10-19', W), 90);
  assert.equal(windowCovering('2025-01-01', '2026-10-19', W), 365);
});

test('the list shows a first name only', () => {
  assert.equal(firstName('Ann Marie Smith'), 'Ann');
  assert.equal(firstName('  '), 'Guest');
  assert.equal(firstName(null), 'Guest');
});

test('every sentence it can print is free of em dashes, and the module has no Helm imports', () => {
  const src = read('src/lib/review-ask-state.ts');
  assert.ok(!src.includes('—'), 'em dash in review-ask-state.ts');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./sca-quotes-types.ts']);
});

test('Recent stays is a page, not a queue: the home feed does not read it', () => {
  for (const p of ['src/lib/home-feed-order.ts', 'src/app/(home)/page.tsx']) {
    let src = '';
    try {
      src = read(p);
    } catch {
      continue;
    }
    assert.ok(!/recent-stays|review-ask-state|getReviewAsks/.test(src), `${p} reads the review asks`);
  }
  const tab = read('src/app/guests/ReviewsTab.tsx');
  assert.ok(tab.includes("params.view === 'stays'"), 'the Reviews tab carries the Recent stays view');
  assert.ok(tab.includes('#stay-') && tab.includes('#review-'), 'a review links to its stay and back');
});
