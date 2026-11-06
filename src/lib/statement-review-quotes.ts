/**
 * Which guest reviews may be QUOTED on an owner statement.
 *
 * The statement's rating tile reports every review (the count and the
 * average are facts). The quoted snippets are different: they sit on a
 * document the owner keeps, and a complaint printed there reads as Rising
 * Tide endorsing it. Dotti's rule (2026-11-03, after Robin Hamblin's
 * "Parking is a HUGE PROBLEM" printed on 36 Granite's October statement):
 * no negative reviews on an owner statement, ever.
 *
 * A review is quotable when its rating is at least MIN_QUOTABLE_RATING (an
 * unrated review passes this half) AND its text carries none of the
 * complaint markers below. Both halves are needed: a 4-star review can
 * still lead with a grievance, and a rating-only row says nothing about
 * its words.
 */
export const MIN_QUOTABLE_RATING = 4;

/** Lower-cased substrings. Each is a word a guest uses to complain. */
export const COMPLAINT_MARKERS: readonly string[] = [
  'problem',
  'issue',
  'broken',
  'dirty',
  'disappoint',
  'unfortunately',
  'not clean',
  'wasn\'t clean',
  'smell',
  'bugs',
  'noisy',
  'complain',
  'uncomfortable',
  'didn\'t work',
  'did not work',
  'not work',
  'no hot water',
  'mold',
  'mildew',
  'rude',
  'terrible',
  'awful',
  'horrible',
  'worst',
  'never again',
  'refund',
  'frustrat',
  'annoying',
  'leak',
  'infest',
  'unsafe',
  'misleading',
  'not as described',
  'would not recommend',
  'wouldn\'t recommend',
];

export type QuoteCandidate = {
  rating: number | string | null | undefined;
  text: string | null | undefined;
};

export function complaintMarkerIn(text: string | null | undefined): string | null {
  const body = (text || '').toLowerCase().replace(/[‘’]/g, '\'');
  for (const marker of COMPLAINT_MARKERS) {
    if (body.includes(marker)) return marker;
  }
  return null;
}

export function isQuotableReview(r: QuoteCandidate): boolean {
  if (r.rating != null && r.rating !== '') {
    const n = typeof r.rating === 'number' ? r.rating : Number(r.rating);
    if (Number.isFinite(n) && n < MIN_QUOTABLE_RATING) return false;
  }
  return complaintMarkerIn(r.text) === null;
}
