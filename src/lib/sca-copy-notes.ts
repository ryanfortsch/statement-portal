/**
 * What to look at in a Stay Cape Ann listing's copy (tagline, About,
 * highlights). Advisory only: nothing here blocks a save or a publish.
 *
 * It used to be the Listing Copy Studio's flag chips. The studio is retired
 * (2026-10-18); the same notes now print on the launcher index's "Needs
 * review" filter and live under the launcher's Step 1 while the operator
 * edits, so the copy is reviewed where it is published.
 *
 * Pure, so the server index and the client launcher share one rule.
 */

const OTA_CHECKMARK = /[✔✓✅☑]/;
const LONG_DASH = /[\u2014\u2013]/;

export type ListingCopyFields = { tagline?: unknown; description?: unknown; highlights?: unknown };

export function listingCopyNotes(copy: ListingCopyFields): string[] {
  const tagline = String(copy.tagline ?? '').trim();
  const description = String(copy.description ?? '').trim();
  const highlights = Array.isArray(copy.highlights)
    ? copy.highlights.map((h) => String(h ?? '').trim()).filter(Boolean)
    : [];
  const notes: string[] = [];
  if (!tagline && !description && highlights.length === 0) notes.push('no copy');
  if (OTA_CHECKMARK.test(tagline) || OTA_CHECKMARK.test(description) || highlights.some((h) => OTA_CHECKMARK.test(h))) {
    notes.push('OTA checkmarks');
  }
  if (/!/.test(tagline) || /!/.test(description)) notes.push('exclamation marks');
  if (LONG_DASH.test(tagline) || LONG_DASH.test(description) || highlights.some((h) => LONG_DASH.test(h))) {
    notes.push('em dashes');
  }
  if (tagline.length > 140) notes.push('tagline over 140 characters');
  if (description.length > 1600) notes.push('About over 1,600 characters');
  if (tagline && highlights.length > 0 && highlights.length < 3) notes.push('fewer than 3 highlights');
  return notes;
}
