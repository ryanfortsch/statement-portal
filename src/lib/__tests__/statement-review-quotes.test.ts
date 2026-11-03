import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isQuotableReview, complaintMarkerIn, MIN_QUOTABLE_RATING } from '../statement-review-quotes.ts';

test('a 3-star complaint never prints (Robin Hamblin, 36 Granite, Oct 2026)', () => {
  assert.equal(isQuotableReview({
    rating: '3.00',
    text: 'Parking is a HUGE PROBLEM. We drive a Kia and had to shoe horn the car into the dedicated space.',
  }), false);
});

test('a low rating alone is enough to exclude, whatever the words', () => {
  assert.equal(isQuotableReview({ rating: 3, text: 'Lovely home, we had a wonderful time.' }), false);
  assert.equal(isQuotableReview({ rating: MIN_QUOTABLE_RATING - 0.5, text: 'Great stay.' }), false);
});

test('a complaint alone is enough to exclude, whatever the rating', () => {
  assert.equal(isQuotableReview({ rating: 5, text: 'Beautiful place. The only issue was the hot tub never got warm.' }), false);
  assert.equal(isQuotableReview({ rating: 4, text: 'Nice spot but the shower leaked the whole week.' }), false);
  assert.equal(isQuotableReview({ rating: null, text: 'Unfortunately the house was dirty when we arrived.' }), false);
});

test('praise prints: rated or unrated', () => {
  assert.equal(isQuotableReview({ rating: '5.00', text: 'The home is well appointed and comfortable. It is immaculately clean!' }), true);
  assert.equal(isQuotableReview({ rating: 4, text: 'Allie’s place was beautifully remodeled and decorated.' }), true);
  assert.equal(isQuotableReview({ rating: null, text: 'We enjoyed mornings drinking coffee on the porch.' }), true);
});

test('curly apostrophes read as straight ones', () => {
  assert.equal(complaintMarkerIn('The heat didn’t work.'), 'didn\'t work');
});

test('the render page quotes only reviews that pass the gate', () => {
  const src = readFileSync(new URL('../../app/statements/render/page.tsx', import.meta.url), 'utf8');
  assert.match(src, /import \{ isQuotableReview \} from '@\/lib\/statement-review-quotes'/);
  // The pool that feeds pickReviews() must be filtered through the gate.
  assert.match(src, /const uniqueReviewPool = uniqueMonthReviews\.filter\(\s*r => r\.public_review && r\.public_review\.trim\(\)\.length > 15\s*&& isQuotableReview\(\{ rating: r\.overall_rating, text: r\.public_review \}\),?\s*\);/);
});
