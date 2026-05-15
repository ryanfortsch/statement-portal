/**
 * Hero photo URL map for AI-generated email cards.
 *
 * The staycapeann.com routes use Guesty listing IDs (long hex strings)
 * as the URL slug, NOT human-readable names. So /stays/21-horton 404s.
 * The correct page URL is /stays/<guesty_listing_id>, looked up at
 * runtime from Helm DB's guesty_listings table. That lookup happens
 * in campaign-context.ts.
 *
 * What lives here is the static map of HERO IMAGE URLs only, since
 * those depend on the public folder layout in the staycapeann.com repo
 * (slug-based) not on Guesty IDs. The 4 properties missing entries
 * here (30-woodward, 20-hammond, 53-rocky-neck, 20-enon) render their
 * heroes from Guesty's photo array at runtime on staycapeann.com; we
 * can't safely embed those URLs in email. When their hero files land
 * in public/photos/<slug>/hero.{jpg,png}, add them below.
 *
 * SECURITY: Street addresses are NOT included anywhere. The Stay Cape
 * Ann brand rule is "no address until they book."
 */

const STAYCAPEANN_BASE = 'https://staycapeann.com';

/** Helm property id -> staycapeann.com hero image URL. */
const HERO_BY_PROPERTY: Record<string, string | null> = {
  '3_south_st':     `${STAYCAPEANN_BASE}/photos/3-south/hero.png`,
  '21_horton':      `${STAYCAPEANN_BASE}/photos/21-horton/hero.jpg`,
  '53_rocky_neck':  null,
  '4_brier_neck':   `${STAYCAPEANN_BASE}/photos/4-brier-neck/hero.jpg`,
  '30_woodward':    null,
  '20_hammond':     null,
  '20_enon':        null,
  '73_rocky_neck':  `${STAYCAPEANN_BASE}/photos/73-rocky-neck/hero.jpg`,
  '17_beach_rd':    `${STAYCAPEANN_BASE}/photos/17-beach/hero.png`,
  '3_locust':       `${STAYCAPEANN_BASE}/photos/3-locust/hero.jpg`,
};

export function heroUrlForProperty(id: string): string | null {
  return HERO_BY_PROPERTY[id] ?? null;
}

/** Build the staycapeann.com listing page URL from a Guesty listing id. */
export function pageUrlForGuestyListing(guestyListingId: string | null | undefined): string | null {
  if (!guestyListingId) return null;
  return `${STAYCAPEANN_BASE}/stays/${guestyListingId}`;
}
