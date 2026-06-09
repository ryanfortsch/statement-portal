/**
 * Hero photo URL map for AI-generated email cards (LEGACY FALLBACK).
 *
 * Source of truth for hero URLs is now `guesty_listings.hero_url`,
 * refreshed by /api/sync-guesty from each Guesty listing's
 * `pictures[0].original`. That keeps Helm in lockstep with whatever
 * cover photo the SCA team picks in Guesty -- swap the photo there,
 * within ~24h Helm renders the new one in campaigns and anywhere
 * else heroes are shown.
 *
 * This file's static map is now a FALLBACK ONLY, used when:
 *   - A property hasn't yet been synced into guesty_listings.hero_url,
 *   - Or sync-guesty failed transiently and the column is still null.
 *
 * The four properties without entries (30-woodward, 20-hammond,
 * 53-rocky-neck, 20-enon) used to render heroes from Guesty's photo
 * array at runtime on staycapeann.com; once their guesty_listings rows
 * have hero_url populated, those will render correctly in Helm too.
 *
 * The page-URL helper below is still the one consumers should use --
 * page URLs are deterministic from the Guesty listing id, no syncing
 * needed.
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
