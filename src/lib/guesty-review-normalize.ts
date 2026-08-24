/**
 * Guesty's /v1/reviews feed hands back each channel's own review payload
 * verbatim under `rawReview`, and every channel shapes that payload
 * differently. Guesty publishes no normalized rating/text fields of its
 * own, so whoever reads the feed has to speak all of the dialects.
 *
 * Helm only ever spoke Airbnb's (`overall_rating`, `public_review`,
 * `category_ratings_*`). Every VRBO and Booking.com review therefore
 * landed as a row with a real guest, listing and date but a null rating
 * and null text, and the Reviews surfaces filter null ratings out. Result:
 * 123 VRBO and 17 Booking.com reviews sat invisible in the table while
 * /guests looked like an Airbnb-only business.
 *
 * This module is the translation layer. Airbnb, Booking.com and VRBO each
 * get an exact mapping; any channel connected later goes through a
 * tolerant reader that tries the field names these feeds commonly use and
 * then, failing that, scans the payload for a rating-shaped number and a
 * review-shaped string. sync-guesty stores the raw payload alongside the
 * parsed columns, so a channel the tolerant reader mis-reads can be given
 * an exact mapping here without waiting for the next review to arrive.
 * VRBO's mapping below was written from those stored payloads: its shape
 * is Expedia's, and nothing about it resembles the others.
 */

export type NormalizedGuestyReview = {
  overall_rating: number | null;
  public_review: string | null;
  private_feedback: string | null;
  category_cleanliness: number | null;
  category_accuracy: number | null;
  category_checkin: number | null;
  category_communication: number | null;
  category_location: number | null;
  category_value: number | null;
};

type Raw = Record<string, unknown>;

const EMPTY: NormalizedGuestyReview = {
  overall_rating: null,
  public_review: null,
  private_feedback: null,
  category_cleanliness: null,
  category_accuracy: null,
  category_checkin: null,
  category_communication: null,
  category_location: null,
  category_value: null,
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

/** Dot-path read that tolerates missing intermediates. */
function at(raw: Raw, path: string): unknown {
  let cur: unknown = raw;
  for (const key of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Raw)[key];
  }
  return cur;
}

/**
 * Ratings arrive on whatever scale the channel uses: Airbnb and VRBO in
 * stars (1-5), Booking.com out of 10, and a few feeds out of 100. Infer
 * the scale from the magnitude and express everything in stars, which is
 * what the reviews table and every Helm surface assume.
 */
function toStars(v: number | null): number | null {
  if (v === null || v <= 0) return null;
  if (v <= 5) return round2(v);
  if (v <= 10) return round2(v / 2);
  if (v <= 100) return round2(v / 20);
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function joinParts(parts: Array<string | null>): string | null {
  const kept = parts.filter((p): p is string => !!p);
  return kept.length ? kept.join('\n\n') : null;
}

// ---- Airbnb (channelId "airbnb2") ----

function fromAirbnb(rw: Raw): NormalizedGuestyReview {
  return {
    overall_rating: toStars(num(rw.overall_rating)),
    public_review: str(rw.public_review),
    private_feedback: str(rw.private_feedback),
    category_cleanliness: toStars(num(rw.category_ratings_cleanliness)),
    category_accuracy: toStars(num(rw.category_ratings_accuracy)),
    category_checkin: toStars(num(rw.category_ratings_checkin)),
    category_communication: toStars(num(rw.category_ratings_communication)),
    category_location: toStars(num(rw.category_ratings_location)),
    category_value: toStars(num(rw.category_ratings_value)),
  };
}

// ---- Booking.com (channelId "bookingCom") ----

/**
 * Booking.com splits the guest's words into a `positive` and a `negative`
 * half plus a `headline`, and scores out of 10 under `scoring`.
 *
 * The negative half goes in private_feedback, which on this table means
 * "what the guest said beyond the headline review" rather than literally
 * "unpublished" (Booking shows both halves publicly). That is the column
 * reviews-to-slips watches, and Booking's negative half is the exact
 * analogue of Airbnb's private feedback: a five-star guest naming one
 * thing to fix. Folding it into public_review instead left 5 of the 7
 * Booking reviews carrying a real complaint unable to open a slip,
 * because the slip engine's candidate test is below-five OR private
 * feedback and those reviews are all five stars. Surfaces label the line
 * per channel, see feedbackLabel.
 */
/**
 * Booking.com sends its review text HTML-escaped, so "clean & comfortable"
 * arrives as "clean &amp; comfortable" and renders that way on the card.
 * Only the handful of entities their feed actually uses.
 */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
};

function unescapeEntities(v: string | null): string | null {
  if (!v) return v;
  return v.replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

/**
 * Booking.com asks for a positive and a negative half and requires an
 * answer, so guests who have nothing to say for one of them type a
 * non-answer. "Not applicable." then reads as part of their review on the
 * card, and "nothing" reads as a complaint the slip classifier has to
 * throw away. Exact matches only, after normalizing case and trailing
 * punctuation: a real half that merely starts with one of these words
 * ("nothing to complain about, we loved it") keeps every word.
 */
const NON_ANSWERS = new Set([
  'n/a', 'na', 'nil', 'no', 'none', 'nothing', 'not applicable', 'nothing really',
  'nothing at all', 'nothing much', 'everything was great', 'all good', '-', '.',
]);

function dropNonAnswer(v: string | null): string | null {
  if (!v) return v;
  const normalized = v.toLowerCase().replace(/[.!\s]+$/, '').trim();
  return NON_ANSWERS.has(normalized) ? null : v;
}

function fromBookingCom(rw: Raw): NormalizedGuestyReview {
  const headline = dropNonAnswer(unescapeEntities(str(at(rw, 'content.headline'))));
  const positive = dropNonAnswer(unescapeEntities(str(at(rw, 'content.positive'))));
  const negative = dropNonAnswer(unescapeEntities(str(at(rw, 'content.negative'))));
  return {
    overall_rating: toStars(num(at(rw, 'scoring.review_score'))),
    // Guests routinely retype the headline as the first words of the
    // positive half ("amazing" / "amazing cottage in a quiet location"),
    // which reads as a stutter once the two are joined.
    public_review: joinParts([
      headline && (!positive || !positive.toLowerCase().startsWith(headline.toLowerCase())) ? headline : null,
      positive,
    ]),
    private_feedback: negative,
    category_cleanliness: toStars(num(at(rw, 'scoring.clean'))),
    category_accuracy: toStars(num(at(rw, 'scoring.comfort'))),
    category_checkin: null,
    category_communication: toStars(num(at(rw, 'scoring.staff'))),
    category_location: toStars(num(at(rw, 'scoring.location'))),
    category_value: toStars(num(at(rw, 'scoring.value'))),
  };
}

// ---- VRBO (channelId "homeaway2") ----

/**
 * VRBO comes through Guesty as Expedia's review object, which shares no
 * field names with Airbnb's or Booking.com's. The text is `body.value`
 * (with an optional `title.value` headline, usually blank), the overall
 * score is the string `starRatingOverall`, and the sub-scores are an
 * array of `{ category, value }` pairs rather than named keys. There is
 * no private-feedback equivalent, so private_feedback stays null.
 *
 * Status is deliberately not filtered. Most rows are APPROVED; a review
 * still inside VRBO's owner-response window reads OWNER_GRACE_PERIOD, and
 * that is exactly when seeing it is worth something.
 */
const VRBO_CATEGORIES = {
  cleanliness: 'roomCleanliness',
  // Expedia's "onlineListing" asks whether the listing matched the home,
  // which is the same question Airbnb files under accuracy.
  accuracy: 'onlineListing',
  checkin: 'checkIn',
  communication: 'communication',
  location: 'location',
  value: 'valueForMoney',
} as const;

function starRating(rw: Raw, category: string): number | null {
  const arr = rw.starRatings;
  if (!Array.isArray(arr)) return null;
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Raw;
    if (String(e.category) === category) return num(e.value);
  }
  return null;
}

function fromVrbo(rw: Raw): NormalizedGuestyReview {
  const body = str(at(rw, 'body.value'));
  const title = str(at(rw, 'title.value'));
  return {
    overall_rating: toStars(num(rw.starRatingOverall) ?? starRating(rw, 'overall')),
    public_review: joinParts([
      title && (!body || !body.startsWith(title)) ? title : null,
      body,
    ]),
    private_feedback: null,
    category_cleanliness: toStars(starRating(rw, VRBO_CATEGORIES.cleanliness)),
    category_accuracy: toStars(starRating(rw, VRBO_CATEGORIES.accuracy)),
    category_checkin: toStars(starRating(rw, VRBO_CATEGORIES.checkin)),
    category_communication: toStars(starRating(rw, VRBO_CATEGORIES.communication)),
    category_location: toStars(starRating(rw, VRBO_CATEGORIES.location)),
    category_value: toStars(starRating(rw, VRBO_CATEGORIES.value)),
  };
}

// ---- Everything else ----

const RATING_PATHS = [
  'overall_rating',
  'starRatingOverall',
  'ratingOverall',
  'overallRating',
  'rating.overall',
  'ratings.overall',
  'review.rating',
  'review.overall_rating',
  'scoring.review_score',
  'review_score',
  'reviewScore',
  'overall',
  'rating',
  'score',
  'stars',
];

const TEXT_PATHS = [
  'public_review',
  'body.value',
  'publicReview',
  'reviewerComments',
  'review.text',
  'review.body',
  'review.public_review',
  'content.text',
  'text',
  'body',
  'reviewText',
  'comments',
  'comment',
  'description',
  'review',
];

const HEADLINE_PATHS = ['headline', 'title.value', 'title', 'review.headline', 'review.title', 'summary'];

const PRIVATE_PATHS = [
  'private_feedback',
  'privateFeedback',
  'privateReview',
  'review.private_feedback',
  'hostFeedback',
  'feedbackToHost',
];

const CATEGORY_PATHS: Record<keyof Omit<NormalizedGuestyReview, 'overall_rating' | 'public_review' | 'private_feedback'>, string[]> = {
  category_cleanliness: ['category_ratings_cleanliness', 'cleanliness', 'clean', 'ratings.cleanliness', 'scoring.clean'],
  category_accuracy: ['category_ratings_accuracy', 'accuracy', 'ratings.accuracy', 'scoring.comfort'],
  category_checkin: ['category_ratings_checkin', 'checkin', 'check_in', 'ratings.checkin', 'arrival'],
  category_communication: ['category_ratings_communication', 'communication', 'ratings.communication', 'scoring.staff'],
  category_location: ['category_ratings_location', 'location', 'ratings.location', 'scoring.location'],
  category_value: ['category_ratings_value', 'value', 'ratings.value', 'scoring.value'],
};

function firstNumber(rw: Raw, paths: string[]): number | null {
  for (const p of paths) {
    const n = num(at(rw, p));
    if (n !== null) return n;
  }
  return null;
}

function firstString(rw: Raw, paths: string[]): string | null {
  for (const p of paths) {
    const s = str(at(rw, p));
    if (s) return s;
  }
  return null;
}

/**
 * Last resort when none of the known field names hit: walk the payload
 * looking for a number under a rating-ish key and the longest string
 * under a review-ish key. Bounded to three levels so a deeply nested
 * channel payload can't turn one review into a tree walk, and the string
 * needs some length so a status code or a language tag can't pass itself
 * off as the guest's words.
 */
const RATING_KEY_RE = /(rating|score|stars)$/i;
const TEXT_KEY_RE = /(review|text|body|comment|headline|description|feedback)/i;
const MIN_TEXT_LEN = 15;

function scan(rw: Raw): { rating: number | null; text: string | null } {
  let rating: number | null = null;
  let text: string | null = null;

  const visit = (node: unknown, depth: number) => {
    if (depth > 3 || !node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node as Raw)) {
      if (value && typeof value === 'object') {
        visit(value, depth + 1);
        continue;
      }
      if (rating === null && RATING_KEY_RE.test(key)) {
        const n = num(value);
        if (n !== null && n > 0) rating = n;
      }
      if (TEXT_KEY_RE.test(key)) {
        const s = str(value);
        if (s && s.length >= MIN_TEXT_LEN && (!text || s.length > text.length)) text = s;
      }
    }
  };

  visit(rw, 0);
  return { rating, text };
}

function fromUnknownChannel(rw: Raw): NormalizedGuestyReview {
  let rating = firstNumber(rw, RATING_PATHS);
  const headline = firstString(rw, HEADLINE_PATHS);
  let body = firstString(rw, TEXT_PATHS);

  if (rating === null || !body) {
    const scanned = scan(rw);
    if (rating === null) rating = scanned.rating;
    if (!body) body = scanned.text;
  }

  const out: NormalizedGuestyReview = {
    ...EMPTY,
    overall_rating: toStars(rating),
    // Keep the headline only when it adds something: VRBO repeats the
    // first line of the body as the headline often enough that gluing
    // them together reads as a stutter on the card.
    public_review: joinParts([
      headline && (!body || !body.startsWith(headline)) ? headline : null,
      body,
    ]),
    private_feedback: firstString(rw, PRIVATE_PATHS),
  };

  out.category_cleanliness = toStars(firstNumber(rw, CATEGORY_PATHS.category_cleanliness));
  out.category_accuracy = toStars(firstNumber(rw, CATEGORY_PATHS.category_accuracy));
  out.category_checkin = toStars(firstNumber(rw, CATEGORY_PATHS.category_checkin));
  out.category_communication = toStars(firstNumber(rw, CATEGORY_PATHS.category_communication));
  out.category_location = toStars(firstNumber(rw, CATEGORY_PATHS.category_location));
  out.category_value = toStars(firstNumber(rw, CATEGORY_PATHS.category_value));

  return out;
}

/**
 * Parse one Guesty review's `rawReview` into the columns Helm stores.
 * Returns all-nulls for a missing or unreadable payload, which is what a
 * genuinely empty review (Guesty opens a row when a stay completes,
 * before the guest writes anything) should look like.
 */
export function normalizeGuestyReview(
  channelId: string | undefined | null,
  rawReview: unknown,
): NormalizedGuestyReview {
  if (!rawReview || typeof rawReview !== 'object' || Array.isArray(rawReview)) return { ...EMPTY };
  const rw = rawReview as Raw;
  const channel = (channelId || '').toLowerCase();

  let parsed: NormalizedGuestyReview | null = null;
  if (channel.startsWith('airbnb')) parsed = fromAirbnb(rw);
  else if (channel.startsWith('booking')) parsed = fromBookingCom(rw);
  else if (channel.startsWith('homeaway') || channel === 'vrbo') parsed = fromVrbo(rw);

  // A known channel that suddenly reads as empty is either a genuinely
  // blank review or a payload whose shape moved under us. Cheap insurance
  // against the second: fall through to the tolerant reader rather than
  // write another null row and wait for someone to notice. A truly empty
  // payload has nothing for the tolerant reader to find either, so it
  // still comes back empty.
  if (parsed && hasReviewContent(parsed)) return parsed;
  const scanned = fromUnknownChannel(rw);
  return hasReviewContent(scanned) ? scanned : (parsed ?? scanned);
}

/** True when a parsed review carries something worth showing an owner. */
export function hasReviewContent(n: NormalizedGuestyReview): boolean {
  return n.overall_rating !== null || !!n.public_review || !!n.private_feedback;
}

/**
 * The guest's name as the channel spells it, for the 42 VRBO reviews
 * whose Guesty guest lookup comes back empty (no guestId on the review,
 * so /v1/guests has nothing to resolve). The Reviews card leads with the
 * guest's name, and a nameless row reads like a bug. Only ever used as a
 * fallback: Guesty's own guest record wins when it exists.
 */
export function guestNameFromRawReview(
  channelId: string | undefined | null,
  rawReview: unknown,
): string | null {
  if (!rawReview || typeof rawReview !== 'object' || Array.isArray(rawReview)) return null;
  const rw = rawReview as Raw;

  // VRBO / Expedia.
  const first = str(at(rw, 'reservation.primaryGuest.firstName'));
  const last = str(at(rw, 'reservation.primaryGuest.lastName'));
  if (first || last) return [first, last].filter(Boolean).join(' ');

  for (const p of ['reviewer.name', 'reviewerName', 'guest.fullName', 'guestName', 'primaryGuest.fullName']) {
    const s = str(at(rw, p));
    if (s) return s;
  }
  return null;
}

/**
 * What to call the private_feedback line for a given channel. Airbnb's is
 * genuinely private, host-only. Booking.com's is the negative half of a
 * publicly visible review, so calling it private would tell the team the
 * guest kept it to themselves when the whole world can read it on
 * Booking.com. VRBO never populates the column: Expedia's review model,
 * which is what Guesty passes through for VRBO, has no host-only field
 * at all, so a VRBO review can only reach the work queue on its rating.
 */
export function feedbackLabel(channel: string | null | undefined): string {
  return /booking/i.test(channel || '') ? 'What could be better' : 'Private feedback';
}
