/**
 * Guesty listing tags, as the launch checklist reads them.
 *
 * Every Cape Ann listing Rosa's crew cleans carries the tag
 * "Cleaning - Rosa" in Guesty (Properties > Listed listings, Tags column).
 * /api/sync-guesty already pulls the full listing objects for the listing
 * map, so it stores each listing's tags on guesty_listings.tags and the
 * launch step `guesty_rosa_tag` ticks itself once the tag is there.
 *
 * Pure: node:test loads this file through launch-checklist.ts.
 */

export const ROSA_CLEANING_TAG = 'Cleaning - Rosa';

/** The tags array off a raw Guesty listing object: strings only, trimmed,
 *  blanks dropped. Anything that is not an array reads as no tags. */
export function listingTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const s = t.trim();
    if (s) out.push(s);
  }
  return out;
}

/** Case, spacing and the dash style do not matter: "cleaning-rosa",
 *  "Cleaning – Rosa" and "Cleaning - Rosa" are the same tag. */
function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/[\s\-\u2013\u2014_]+/g, ' ').trim();
}

/** True when the listing carries the Rosa cleaning tag. Null (tags never
 *  read) is false: the step then asks, it never ticks on no evidence. */
export function hasRosaCleaningTag(tags: ReadonlyArray<string> | null | undefined): boolean {
  if (!tags || tags.length === 0) return false;
  const want = normalizeTag(ROSA_CLEANING_TAG);
  return tags.some((t) => normalizeTag(t) === want);
}
