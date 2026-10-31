import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOST_REVIEW_POST_REASONS,
  HOST_REVIEW_STOP_REASONS,
  POST_SKIP,
  STOP_SKIP,
  channelWord,
  hostReviewFace,
  reviewLensRules,
  reviewReplyFace,
} from '../review-lens.ts';
import type { HostReviewCard, ReviewReplyCard } from '../stay-concierge.ts';

function stop(extra: Partial<HostReviewCard> = {}): HostReviewCard {
  return {
    stage: 'stop', tier: 'red', reason: "guest said 'refund'", channel: 'airbnb2', check_out: '2026-10-26',
    fires_at: '2026-10-29T00:00:00-04:00', due_by: '2026-10-28', window_closes: '2026-11-09',
    conduct: '', conduct_reason: '', outcome: '', outcome_note: '', outcome_at: '', posted_text: '',
    guesty_url: 'https://app.guesty.com/reservations/6aadab46', channel_url: 'https://www.airbnb.com/hosting/reservations/details/HM5WM5JTWW',
    card_status: 'pending', approval_id: 'a1', ...extra,
  };
}

test("the stop card names the night Guesty posts, and goes late the day after", () => {
  const calm = hostReviewFace(stop(), 'Elijah', '2026-10-27');
  assert.equal(calm.title, "Stop Guesty's auto review");
  assert.match(calm.due, /5-star review of Elijah on Airbnb after midnight Oct 28/);
  assert.equal(calm.dueTone, 'due');
  assert.equal(calm.link?.label, 'Open in Guesty');
  assert.equal(calm.done, 'Stopped');
  assert.equal(calm.skip, 'Let it post');
  assert.match(calm.context, /Red: guest said 'refund'/);
  const tonight = hostReviewFace(stop(), 'Elijah', '2026-10-28');
  assert.match(tonight.due, /, tonight$/);
  const late = hostReviewFace(stop(), 'Elijah', '2026-10-29');
  assert.equal(late.dueTone, 'late');
  assert.match(late.due, /may already be up/);
});

test('the post card reads the conduct and the window, and links the channel', () => {
  const post = stop({ stage: 'post', due_by: '2026-11-08', conduct: 'concern', conduct_reason: 'hostile after the refund was declined', fires_at: '' });
  const face = hostReviewFace(post, 'Elijah', '2026-11-06');
  assert.equal(face.title, 'Our review of Elijah');
  assert.equal(face.dueTone, 'calm');
  assert.match(face.due, /Post on Airbnb by Nov 8 · window closes Nov 9/);
  assert.match(face.context, /read as a concern: hostile after the refund was declined/);
  assert.equal(face.link?.label, 'Open on Airbnb');
  assert.equal(face.done, 'Posted');
  assert.equal(face.skip, 'Skip');
  const fine = hostReviewFace({ ...post, conduct: 'fine', conduct_reason: 'courteous throughout' }, 'Ann', '2026-11-08');
  assert.match(fine.context, /read as fine: courteous throughout\. The stay went badly for them, not because of them\./);
  assert.equal(fine.dueTone, 'due');
  assert.match(fine.due, /, today ·/);
  const unknown = hostReviewFace({ ...post, conduct: 'unknown' }, 'Ann', '2026-11-10');
  assert.match(unknown.context, /could not be read/);
  assert.equal(unknown.dueTone, 'late');
  assert.match(unknown.due, /window closed Nov 9/);
  // Vrbo has no deep link: the card still says where.
  const vrbo = hostReviewFace({ ...post, channel: 'homeaway2', channel_url: 'https://www.vrbo.com/' }, 'Ann', '2026-11-06');
  assert.match(vrbo.due, /Post on Vrbo/);
  assert.equal(channelWord('bookingCom'), 'Booking.com');
  assert.equal(channelWord(''), 'the channel');
});

test('the reply card shows the stars, the grounds, and whether Guesty can post it', () => {
  const card: ReviewReplyCard = {
    review_id: '68f1', stars: 4, written_on: '2026-10-28', channel: 'airbnb2',
    public_review: 'Lovely house, the wifi dropped twice.', private_feedback: '', grounds: [], grounds_line: 'No removal grounds found; reply and move on.',
    policy_url: 'https://www.airbnb.com/help/article/2673', can_post: true, outcome: '',
  };
  const face = reviewReplyFace(card, 'Marta');
  assert.equal(face.title, "Marta's review on Airbnb");
  assert.equal(face.rating, '★★★★☆ 4');
  assert.equal(face.contestable, false);
  assert.equal(face.policy, null);
  assert.equal(face.canPost, true);
  const contested = reviewReplyFace({ ...card, grounds: ['retaliation'], grounds_line: 'Possible removal grounds: retaliation: they asked for money back and were told no before writing this.', can_post: false, channel: 'homeaway2', stars: null }, '');
  assert.equal(contested.contestable, true);
  assert.equal(contested.policy?.label, 'Airbnb reviews policy');
  assert.equal(contested.canPost, false);
  assert.equal(contested.rating, 'Rated below five');
  assert.equal(contested.title, "The guest's review on Vrbo");
});

test('the rules read the concierge numbers', () => {
  const lines = reviewLensRules({ auto_review_delay_days: 3, host_review_post_day: 13, host_review_cards: true });
  assert.match(lines[0], /3 days after checkout/);
  assert.match(lines[1], /day 13/);
  assert.equal(lines.length, 3);
  assert.match(reviewLensRules({ auto_review_delay_days: 1 })[0], /1 day after/);
  assert.match(reviewLensRules({ host_review_cards: false })[3], /switched off/);
});

test('the handled reasons are the contract with the concierge ledger', () => {
  // stay-concierge host_reviews.record_outcome reads a reason matching
  // "let it post" or "skip" as the no; these strings must keep saying so.
  assert.match(STOP_SKIP.toLowerCase(), /let it post/);
  assert.match(POST_SKIP.toLowerCase(), /skip/);
  assert.ok(HOST_REVIEW_STOP_REASONS.includes(STOP_SKIP));
  assert.ok(HOST_REVIEW_POST_REASONS.includes(POST_SKIP));
});
