/**
 * Hero photo + property page URL map for AI-generated email cards.
 *
 * The AI uses this to write property-card markdown like:
 *   ![Stay at Rocky Neck](https://staycapeann.com/photos/21-horton/hero.jpg)
 *   [See the home →](https://staycapeann.com/stays/21-horton)
 *
 * Only properties with a verified hero image in the staycapeann.com
 * repo are listed here. The 4 missing ones (30-woodward, 20-hammond,
 * 53-rocky-neck, 20-enon) currently render their hero from Guesty's
 * photo array at runtime on staycapeann.com; we don't have a stable
 * standalone URL we can embed in an email yet. When their hero photos
 * land in the public repo, add them here.
 *
 * SECURITY: Street addresses are NOT included. The Stay Cape Ann brand
 * rule is "no address until they book." Public hero + page URL only.
 */

const STAYCAPEANN_BASE = 'https://staycapeann.com';

type CardEntry = {
  /** Helm property id (e.g. '21_horton'). */
  id: string;
  /** URL-safe slug used in staycapeann.com routes (e.g. '21-horton'). */
  slug: string;
  /** Hero photo URL on staycapeann.com, or null if we don't have one yet. */
  heroUrl: string | null;
};

const CARDS: CardEntry[] = [
  { id: '3_south_st',     slug: '3-south',         heroUrl: `${STAYCAPEANN_BASE}/photos/3-south/hero.png` },
  { id: '21_horton',      slug: '21-horton',       heroUrl: `${STAYCAPEANN_BASE}/photos/21-horton/hero.jpg` },
  { id: '53_rocky_neck',  slug: '53-rocky-neck',   heroUrl: null },
  { id: '4_brier_neck',   slug: '4-brier-neck',    heroUrl: `${STAYCAPEANN_BASE}/photos/4-brier-neck/hero.jpg` },
  { id: '30_woodward',    slug: '30-woodward',     heroUrl: null },
  { id: '20_hammond',     slug: '20-hammond',      heroUrl: null },
  { id: '20_enon',        slug: '20-enon',         heroUrl: null },
  { id: '73_rocky_neck',  slug: '73-rocky-neck',   heroUrl: `${STAYCAPEANN_BASE}/photos/73-rocky-neck/hero.jpg` },
  { id: '17_beach_rd',    slug: '17-beach',        heroUrl: `${STAYCAPEANN_BASE}/photos/17-beach/hero.png` },
  { id: '3_locust',       slug: '3-locust',        heroUrl: `${STAYCAPEANN_BASE}/photos/3-locust/hero.jpg` },
];

const BY_ID: Map<string, CardEntry> = new Map(CARDS.map((c) => [c.id, c]));

export function pageUrlForProperty(id: string): string | null {
  const entry = BY_ID.get(id);
  return entry ? `${STAYCAPEANN_BASE}/stays/${entry.slug}` : null;
}

export function heroUrlForProperty(id: string): string | null {
  return BY_ID.get(id)?.heroUrl ?? null;
}

export function propertyCardData(id: string): { pageUrl: string; heroUrl: string | null } | null {
  const entry = BY_ID.get(id);
  if (!entry) return null;
  return {
    pageUrl: `${STAYCAPEANN_BASE}/stays/${entry.slug}`,
    heroUrl: entry.heroUrl,
  };
}
