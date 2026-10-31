/**
 * Testimonials from direct (staycapeann.com) guests: the pure parts.
 *
 * A direct guest has no OTA review page. The concierge's review ask (stellar
 * stays only, stay-concierge #148) links staycapeann.com/review/<token>; the
 * token names one row of `guest_testimonials`, minted by the concierge through
 * POST /api/testimonials/invite. The form reads and submits through
 * /api/testimonials/<token>, the operator approves or hides the testimonial on
 * the Reviews tab, and approved ones render ahead of the live Guesty reviews
 * on the home's listing page. The form's thank-you page then offers the Google
 * Business Profile link (GOOGLE_REVIEW_URL), which Helm never tracks.
 *
 * Import-free so `npm test` covers every rule here: what a submission must
 * look like, how a guest is named on the site, and the wire shapes the two
 * sides agree on. The database and env reads live in guest-testimonials-store.
 */

export const TESTIMONIAL_STATUSES = ['invited', 'submitted', 'approved', 'hidden'] as const;
export type TestimonialStatus = (typeof TESTIMONIAL_STATUSES)[number];

const TOKEN_RE = /^[a-f0-9]{32}$/;

export function isTestimonialToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

/** What the sweep sends when it mints a form link for a stay. */
export type TestimonialInvite = {
  reservation_id: string;
  property_id: string;
  guest_first: string;
  check_in: string | null;
  check_out: string | null;
  channel: string;
};

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseInvite(input: unknown): { ok: true; value: TestimonialInvite } | { ok: false; error: string } {
  const b = (input ?? {}) as Record<string, unknown>;
  const reservation_id = typeof b.reservation_id === 'string' ? b.reservation_id.trim() : '';
  const property_id = typeof b.property_id === 'string' ? b.property_id.trim() : '';
  if (!ID_RE.test(reservation_id)) return { ok: false, error: 'reservation_id' };
  if (!ID_RE.test(property_id)) return { ok: false, error: 'property_id' };
  const day = (v: unknown): string | null => (typeof v === 'string' && DAY_RE.test(v.slice(0, 10)) ? v.slice(0, 10) : null);
  return {
    ok: true,
    value: {
      reservation_id,
      property_id,
      guest_first: clean(b.guest_first, 40),
      check_in: day(b.check_in),
      check_out: day(b.check_out),
      channel: clean(b.channel, 20) || 'Direct',
    },
  };
}

/** What the guest fills in on the form. */
export type TestimonialSubmission = {
  rating: number;
  body: string;
  guest_name: string;
  show_name: boolean;
};

export const BODY_MIN = 20;
export const BODY_MAX = 1500;
export const NAME_MAX = 60;

/**
 * A submission as the form posts it. Rules the guest sees mirrored on the form:
 * a whole-star rating, at least a sentence (BODY_MIN) and at most BODY_MAX
 * characters, a short display name. Control characters are dropped and blank
 * runs collapsed so the site renders what the guest meant, not their keyboard.
 */
export function parseSubmission(input: unknown): { ok: true; value: TestimonialSubmission } | { ok: false; error: string } {
  const b = (input ?? {}) as Record<string, unknown>;
  const rating = typeof b.rating === 'number' ? b.rating : typeof b.rating === 'string' ? Number(b.rating) : NaN;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: 'rating' };
  const body = cleanBody(b.body);
  if (body.length < BODY_MIN) return { ok: false, error: 'body_short' };
  if (body.length > BODY_MAX) return { ok: false, error: 'body_long' };
  const guest_name = clean(b.guest_name, NAME_MAX + 1);
  if (guest_name.length > NAME_MAX) return { ok: false, error: 'name_long' };
  const show_name = b.show_name === undefined ? true : b.show_name === true || b.show_name === 'true' || b.show_name === 'on';
  return { ok: true, value: { rating, body, guest_name, show_name } };
}

function clean(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanBody(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** How the guest is named on the site. */
export function displayName(t: { guest_name: string; guest_first: string; show_name: boolean }): string {
  if (!t.show_name) return 'A Stay Cape Ann guest';
  return t.guest_name.trim() || t.guest_first.trim() || 'A Stay Cape Ann guest';
}

/** 'YYYY-MM' for the site's review card, the month of the stay. */
export function reviewMonth(t: { check_out: string | null; submitted_at: string | null }): string {
  const src = t.check_out || t.submitted_at || '';
  return /^\d{4}-\d{2}/.test(src) ? src.slice(0, 7) : '';
}

/** The row as staycapeann.com's ReviewsSection renders it (lib/types Review). */
export type PublicTestimonial = { name: string; date: string; rating: number; text: string };

export function toPublicTestimonial(t: {
  guest_name: string;
  guest_first: string;
  show_name: boolean;
  check_out: string | null;
  submitted_at: string | null;
  rating: number | null;
  body: string;
}): PublicTestimonial {
  return { name: displayName(t), date: reviewMonth(t), rating: t.rating ?? 5, text: t.body };
}

/** What the form page reads for one token. Never the reservation id. */
export type TestimonialView = {
  token: string;
  status: TestimonialStatus;
  guest_first: string;
  property_id: string;
  property_title: string;
  check_in: string | null;
  check_out: string | null;
  rating: number | null;
  body: string;
  guest_name: string;
  show_name: boolean;
  submitted_at: string | null;
};
