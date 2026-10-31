import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_ASK_SETTINGS,
  UNAVAILABLE,
  describeAsk,
  describeReview,
  firstName,
  plainReason,
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
  const fringe = ask({ first: stage('yellow', card('pending'), { reason: "guest mentioned 'broken' during the stay" }) });
  assert.equal(describeAsk(airbnb, fringe, S, '2026-10-16').text, 'First ask waiting for your call: the guest reported something broken');
  const fu = ask({ first: stage('green', card('approved')), followup: stage('green', card('pending')) });
  assert.deepEqual(describeAsk(airbnb, fu, S, '2026-10-21'), { text: 'Asked Oct 16 · follow-up waiting for approval', tone: 'waiting' });
});

test('a stay the sweep held back says what happened, in plain words', () => {
  const red = ask({ first: stage('red', null, { reason: 'safety incident: smoke alarm' }) });
  assert.deepEqual(describeAsk(airbnb, red, S, '2026-10-17'), { text: 'Not asked: a safety issue during the stay (smoke alarm)', tone: 'skipped' });
  const refund = ask({ first: stage('red', null, { reason: "guest said 'refund'" }) });
  assert.equal(describeAsk(airbnb, refund, S, '2026-10-17').text, 'Not asked: the guest asked about a refund');
  const bad = ask({ first: stage('red', null, { reason: 'sentiment bad: the guest was upset about the noise' }) });
  assert.equal(describeAsk(airbnb, bad, S, '2026-10-17').text, 'Not asked: the conversation read as unhappy (the guest was upset about the noise)');
  const held = ask({ first: stage('green', card('approved')), followup: stage('held', null, { reason: "not green at follow-up: guest mentioned 'broken' during the stay" }) });
  assert.equal(describeAsk(airbnb, held, S, '2026-10-22').text, 'Asked Oct 16 · no follow-up: the guest reported something broken');
  const yellowSent = ask({ first: stage('yellow', card('approved'), { reason: "guest mentioned 'locked out' during the stay" }) });
  assert.equal(describeAsk(airbnb, yellowSent, S, '2026-10-18').text, 'Asked Oct 16 · no follow-up: the guest was locked out');
});

test('every reason the sweep records reads as what happened', () => {
  const cases: Array<[string, string]> = [
    ["guest said 'refund'", 'the guest asked about a refund'],
    ["guest said 'money back'", 'the guest asked about a refund'],
    ["guest said 'discount'", 'the guest asked about a discount'],
    ["guest said 'disappointed'", 'the guest said they were unhappy'],
    ["guest said 'not happy'", 'the guest said they were unhappy'],
    ["guest said 'complaint'", 'the guest made a complaint'],
    ["guest said 'mice'", 'the guest reported pests'],
    ["guest said 'filthy'", 'the guest said the home was dirty'],
    ["guest mentioned 'locked out' during the stay", 'the guest was locked out'],
    ["guest mentioned 'code didn't work' during the stay", 'the door code did not work'],
    ["guest mentioned 'no hot water' during the stay", 'the guest had no hot water'],
    ["guest mentioned 'dirty' during the stay", 'the guest said something was not clean'],
    ["guest mentioned 'broken' during the stay", 'the guest reported something broken'],
    ["guest mentioned 'not working' during the stay", 'the guest said something did not work'],
    ['guest mentioned "couldn\'t get in" during the stay', 'the guest was locked out'],
    ['safety incident: flood', 'a safety issue during the stay (flood)'],
    ['sentiment bad:', 'the conversation read as unhappy'],
    ["not green at follow-up: guest mentioned 'broken' during the stay", 'the guest reported something broken'],
    ['Guest reported a bathroom fan switch issue that would not stay depressed', 'guest reported a bathroom fan switch issue that would not stay depressed'],
    ['', 'something went wrong during the stay'],
  ];
  for (const [raw, want] of cases) assert.equal(plainReason(raw), want, raw);
  const long = plainReason('Guest ' + 'mentioned the shower handle was loose and dripping '.repeat(4));
  assert.ok(long.length <= 115 && long.endsWith('...'), long);
});

test('no row names the sweep\'s classes, which the page never defines', () => {
  const classWord = /\b(green|yellow|red|fringe|held|tier|sentiment)\b/i;
  const reasons = ['', "guest said 'refund'", 'safety incident: fire', 'sentiment bad: rude', "not green at follow-up: guest mentioned 'broken' during the stay"];
  const statuses = ['pending', 'scheduled', 'sending', 'approved', 'manual_sent', 'rejected', 'superseded', 'expired'];
  const lines: string[] = [];
  for (const tier of ['green', 'yellow', 'red', 'external', 'held']) {
    for (const reason of reasons) {
      for (const status of statuses) {
        const c = card(status, { ended_because: status === 'superseded' ? 'withdrawn' : '' });
        const withCard = tier === 'red' || tier === 'external' || tier === 'held' ? null : c;
        for (const day of ['2026-10-15', '2026-10-17', '2026-10-22', '2026-10-30']) {
          lines.push(describeAsk(airbnb, ask({ first: stage(tier, withCard, { reason }) }), S, day).text);
          lines.push(describeAsk(airbnb, ask({ first: stage('green', card('approved')), followup: stage(tier, withCard, { reason }) }), S, day).text);
          lines.push(describeAsk(airbnb, ask({ followup: stage(tier, withCard, { reason, late_first: true }) }), S, day).text);
        }
      }
    }
  }
  for (const line of lines) assert.ok(!classWord.test(line), line);
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
  assert.deepEqual(describeAsk({ checkOut: CO, channel: 'Direct' }, null, S, '2026-10-20'), { text: 'Not asked: the Google review link is not set yet', tone: 'skipped' });
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

test('direct guests: one ask, stellar stays only, once the Google review link exists', () => {
  const direct = { checkOut: CO, channel: 'Direct' };
  const on = { ...S, direct_enabled: true, direct_since: '2026-10-01' };
  // Off until the concierge holds the link; never "not asked" as if judged.
  assert.deepEqual(describeAsk(direct, null, S, '2026-10-20'), { text: 'Not asked: the Google review link is not set yet', tone: 'skipped' });
  assert.deepEqual(describeAsk(direct, null, { ...S, direct_enabled: undefined }, '2026-10-20').text, 'Not asked: the Google review link is not set yet');
  // On: the same windows as every other stay, including the late first ask.
  assert.equal(describeAsk(direct, null, on, '2026-10-15').text, 'First ask due Oct 16');
  assert.equal(describeAsk(direct, null, on, '2026-10-17').text, 'First ask not sent yet');
  assert.equal(describeAsk(direct, null, on, '2026-10-19').text, 'First ask missed; a late ask is due Oct 21');
  // Stays judged before direct asks began have no record to read.
  assert.deepEqual(describeAsk(direct, null, { ...on, direct_since: '2026-10-31' }, '2026-10-20'), { text: 'No record: before direct asks began Oct 31', tone: 'unknown' });
  // One ask: a sent first ask is the whole line, with no follow-up due or missed.
  const sent = ask({ first: stage('green', card('approved')) });
  assert.deepEqual(describeAsk(direct, sent, on, '2026-10-18'), { text: 'Asked Oct 16', tone: 'done' });
  assert.deepEqual(describeAsk(direct, sent, on, '2026-10-25'), { text: 'Asked Oct 16', tone: 'done' });
  assert.equal(describeAsk(direct, ask({ first: stage('green', card('pending')) }), on, '2026-10-18').text, 'First ask waiting for approval');
  // Stellar stays only: a held first stage says what kept the stay short of it.
  const quiet = ask({ first: stage('held', null, { reason: 'not stellar: the stay read as neutral' }) });
  assert.deepEqual(describeAsk(direct, quiet, on, '2026-10-18'), { text: 'Not asked: stellar stays only, the stay read as neutral', tone: 'skipped' });
  const snag = ask({ first: stage('held', null, { reason: "not stellar: guest mentioned 'broken' during the stay" }) });
  assert.equal(describeAsk(direct, snag, on, '2026-10-18').text, 'Not asked: stellar stays only, the guest reported something broken');
  const friction = ask({ first: stage('held', null, { reason: 'not stellar: The wifi dropped twice' }) });
  assert.equal(describeAsk(direct, friction, on, '2026-10-18').text, 'Not asked: stellar stays only, the wifi dropped twice');
  const noContact = ask({ first: stage('held', null, { reason: 'no phone or email on the reservation' }) });
  assert.equal(describeAsk(direct, noContact, on, '2026-10-18').text, 'Not asked: no phone or email on the reservation');
  assert.equal(describeAsk(direct, ask({ first: stage('red', null, { reason: "guest said 'refund'" }) }), on, '2026-10-18').text, 'Not asked: the guest asked about a refund');
  // The review itself lands on Google, which Helm does not read.
  assert.deepEqual(describeReview(direct, null, '2026-10-20', false, true), { kind: 'no_platform', text: 'Google review, not tracked here' });
  assert.deepEqual(describeReview(direct, null, '2026-10-20'), { kind: 'no_platform', text: 'No review site' });
  // An OTA stay is untouched by any of it.
  assert.equal(describeAsk(airbnb, sent, on, '2026-10-18').text, 'Asked Oct 16 · follow-up due Oct 21');
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

test('our review of them: only a red stay has a line, and it follows the ledger', async () => {
  const { describeHostReview } = await import('../review-ask-state.ts');
  const base = { stage: 'stop', check_out: CO, outcome: '', outcome_note: '', outcome_at: '', fires_at: '2026-10-17T00:00:00-04:00', due_by: '2026-10-16', window_closes: '2026-10-28', conduct: '', conduct_reason: '', card_status: 'pending' };
  const ask = (hr: ReservationReviewAsk['host_review']): ReservationReviewAsk => ({
    reservation_id: 'r', first: stage('red', null), followup: null, legacy: null, guest_reported_review: false, host_acknowledged_review: false, host_review: hr,
  });
  assert.equal(describeHostReview(null, '2026-10-16'), null);
  assert.equal(describeHostReview('unavailable', '2026-10-16'), null);
  assert.equal(describeHostReview(ask(undefined), '2026-10-16'), null);
  assert.equal(describeHostReview(ask({ stop: null, post: null }), '2026-10-16'), null);
  assert.deepEqual(describeHostReview(ask({ stop: base, post: null }), '2026-10-15'), { text: "Stop Guesty's auto review in Guesty by Oct 16", tone: 'waiting' });
  assert.equal(describeHostReview(ask({ stop: base, post: null }), '2026-10-17')?.tone, 'due');
  assert.deepEqual(describeHostReview(ask({ stop: { ...base, outcome: 'stopped' }, post: null }), '2026-10-20'), { text: "Guesty's auto review stopped · our review of them follows on day 13", tone: 'done' });
  assert.equal(describeHostReview(ask({ stop: { ...base, outcome: 'too_late' }, post: null }), '2026-10-20')?.tone, 'skipped');
  assert.equal(describeHostReview(ask({ stop: { ...base, outcome: 'let_post' }, post: null }), '2026-10-20')?.text, "Guesty's 5-star auto review allowed, by choice");
  assert.equal(describeHostReview(ask({ stop: { ...base, outcome: 'no_auto_review' }, post: null }), '2026-10-20'), null);
  const post = { ...base, stage: 'post', due_by: '2026-10-27', fires_at: '' };
  assert.deepEqual(describeHostReview(ask({ stop: { ...base, outcome: 'stopped' }, post }), '2026-10-26'), { text: 'Our review of them waiting to post, due Oct 27', tone: 'waiting' });
  assert.equal(describeHostReview(ask({ stop: { ...base, outcome: 'stopped' }, post }), '2026-10-28')?.tone, 'due');
  assert.match(describeHostReview(ask({ stop: null, post: { ...post, outcome: 'posted', outcome_at: '2026-10-27T15:00:00+00:00' } }), '2026-10-28')?.text ?? '', /^Our review of them posted /);
  assert.equal(describeHostReview(ask({ stop: null, post: { ...post, outcome: 'skipped' } }), '2026-10-28')?.text, 'No review of them, by choice');
  assert.equal(describeHostReview(ask({ stop: null, post: { ...post, outcome: 'not_possible' } }), '2026-10-28')?.tone, 'skipped');
});
