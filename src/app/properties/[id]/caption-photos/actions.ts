'use server';

import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { getListingPhotos, updatePhotoCaption } from '@/lib/guesty';
import { generatePhotoCaptions, cleanCaption, type PhotoCaptionDraft } from '@/lib/ai/photo-captions';

/**
 * Server actions backing /properties/[id]/caption-photos.
 *
 * Three operations:
 *   loadListingPhotosAction   — pull the property's Guesty gallery
 *   generateCaptionsAction    — AI-draft captions for chosen photos
 *   saveCaptionAction         — push ONE edited caption to Guesty
 *
 * Every write to Guesty (saveCaptionAction) is one explicit operator
 * click. There is deliberately no "auto-push" path: the AI only fills
 * the draft fields; the human commits each caption to the live listing.
 */

/** A photo flattened for the client (no Guesty-internal fields). */
export type ListingPhoto = {
  id: string;
  original: string | null;
  thumbnail: string | null;
  caption: string;
  index: number | null;
};

export type LoadPhotosResult =
  | { ok: true; listingId: string; propertyName: string; photos: ListingPhoto[] }
  | { ok: false; error: string; needsListing?: boolean };

export type GenerateCaptionsResult =
  | { ok: true; drafts: PhotoCaptionDraft[] }
  | { ok: false; error: string };

export type SaveCaptionResult = { ok: true; caption: string } | { ok: false; error: string };

const PROPERTY_FIELDS =
  'id, name, title, city, type_of_unit, bedrooms, bathrooms, guesty_listing_id';

type PropertyRow = {
  id: string;
  name: string;
  title: string | null;
  city: string | null;
  type_of_unit: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  guesty_listing_id: string | null;
};

/** Shared guard: require a signed-in user and a property linked to Guesty. */
async function requireLinkedProperty(
  propertyId: string,
): Promise<{ ok: true; property: PropertyRow; listingId: string } | { ok: false; error: string; needsListing?: boolean }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const { data, error } = await supabase
    .from('properties')
    .select(PROPERTY_FIELDS)
    .eq('id', propertyId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Property not found' };

  const property = data as PropertyRow;
  const listingId = await resolveListingId(propertyId, property.guesty_listing_id);
  if (!listingId) {
    return {
      ok: false,
      needsListing: true,
      error:
        'This property is not linked to a Guesty listing yet. Add its Guesty listing ID on the Stay Cape Ann launch page (or run Sync Guesty), then come back.',
    };
  }
  return { ok: true, property, listingId };
}

/**
 * The Guesty listing id for a property. `properties.guesty_listing_id` is the
 * intended home but nothing populates it today, so we fall back to the two
 * places the id actually lives:
 *   1. guesty_listings.listing_id — the sync-verified live Guesty id
 *      (sync-guesty maps each listing to a property).
 *   2. sca_launches.guesty_listing_id — what the operator typed when
 *      launching the property onto staycapeann.com.
 * Both tables are anon-readable (the SCA page + campaign context read them
 * the same way). First non-empty wins.
 */
async function resolveListingId(propertyId: string, fromProperty: string | null): Promise<string> {
  const direct = fromProperty?.trim();
  if (direct) return direct;

  const { data: gl } = await supabase
    .from('guesty_listings')
    .select('listing_id')
    .eq('property_id', propertyId)
    .not('listing_id', 'is', null)
    .limit(1);
  const synced = (gl?.[0] as { listing_id: string | null } | undefined)?.listing_id?.trim();
  if (synced) return synced;

  const { data: sca } = await supabase
    .from('sca_launches')
    .select('guesty_listing_id')
    .eq('property_id', propertyId)
    .maybeSingle();
  const launched = (sca as { guesty_listing_id: string | null } | null)?.guesty_listing_id?.trim();
  if (launched) return launched;

  return '';
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function loadListingPhotosAction(propertyId: string): Promise<LoadPhotosResult> {
  const guard = await requireLinkedProperty(propertyId);
  if (!guard.ok) return { ok: false, error: guard.error, needsListing: guard.needsListing };

  try {
    const photos = await getListingPhotos(guard.listingId);
    const flattened: ListingPhoto[] = photos
      .map((p) => ({
        id: p._id,
        original: p.original ?? null,
        thumbnail: p.thumbnail ?? null,
        caption: (p.caption ?? '').trim(),
        index: typeof p.index === 'number' ? p.index : null,
      }))
      // Order by Guesty's `index` when present; when either side lacks one,
      // return 0 so the stable sort preserves Guesty's array order (the
      // gallery order) rather than collapsing missing indices to 0.
      .sort((a, b) => (a.index == null || b.index == null ? 0 : a.index - b.index));
    return { ok: true, listingId: guard.listingId, propertyName: guard.property.name, photos: flattened };
  } catch (err) {
    return { ok: false, error: `Could not load photos from Guesty: ${errMsg(err)}` };
  }
}

export async function generateCaptionsAction(
  propertyId: string,
  photoIds: string[],
  brief: string,
): Promise<GenerateCaptionsResult> {
  const guard = await requireLinkedProperty(propertyId);
  if (!guard.ok) return { ok: false, error: guard.error };

  const wanted = new Set(photoIds);
  if (wanted.size === 0) return { ok: false, error: 'No photos selected to caption.' };

  try {
    // Re-fetch server-side rather than trusting client-supplied URLs.
    const all = await getListingPhotos(guard.listingId);
    const subset = all.filter((p) => wanted.has(p._id));
    if (subset.length === 0) return { ok: false, error: 'None of the selected photos were found on the listing.' };

    const drafts = await generatePhotoCaptions({
      listingId: guard.listingId,
      property: {
        name: guard.property.name,
        title: guard.property.title,
        city: guard.property.city,
        type_of_unit: guard.property.type_of_unit,
        bedrooms: guard.property.bedrooms,
        bathrooms: guard.property.bathrooms,
      },
      photos: subset.map((p) => ({
        _id: p._id,
        original: p.original,
        thumbnail: p.thumbnail,
        caption: p.caption,
      })),
      operatorBrief: brief,
    });
    if (drafts.length === 0) {
      return { ok: false, error: 'The model did not return any captions. The photos may be unreadable. Try again.' };
    }
    return { ok: true, drafts };
  } catch (err) {
    console.error('[generateCaptionsAction] generator threw', { propertyId, err: errMsg(err) });
    return { ok: false, error: `Caption generation failed: ${errMsg(err)}` };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Save one caption to Guesty, SELF-VERIFIED.
 *
 * History: the earlier version called updatePhotoCaption and trusted the
 * 2xx. That write goes through Guesty's property-photos endpoint, which on
 * these listings does not reflect into the `pictures` array we (and
 * staycapeann.com) read from — and a save once appeared to blank a
 * listing's other captions. So this version never trusts the write:
 *
 *   1. snapshot every caption on the listing (BEFORE)
 *   2. perform the write
 *   3. re-read the listing (AFTER), with a short retry for async propagation
 *   4. ABORT if any OTHER photo's caption changed (collateral damage) —
 *      report exactly what changed so it can be restored by hand
 *   5. FAIL if our own caption didn't actually land (write was a no-op)
 *   6. only then report success
 *
 * Net effect: a save can no longer silently fail or wipe captions. The
 * worst case is an honest "it didn't take / it touched other photos" with
 * the before-values, instead of false success + data loss.
 */
const SAVE_TO_GUESTY_ENABLED: boolean = true;

/** A real Guesty photo id is a 24-char hex ObjectId. getListingPhotos
 *  falls back to a synthetic String(index) when a picture has no _id; we
 *  must never write against those (the POST would target the wrong photo,
 *  and the id isn't stable across reorders). */
function isRealPhotoId(id: string): boolean {
  return /^[a-f0-9]{24}$/i.test(id);
}

export async function saveCaptionAction(
  propertyId: string,
  photoId: string,
  caption: string,
): Promise<SaveCaptionResult> {
  const guard = await requireLinkedProperty(propertyId);
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!SAVE_TO_GUESTY_ENABLED) {
    return {
      ok: false,
      error:
        'Saving to Guesty is paused. Your drafts are safe and nothing is sent to Guesty. For now, paste captions into Guesty’s own photo editor.',
    };
  }

  // Same hygiene the AI drafts get, applied to operator edits too: strips
  // em dashes (the hard brand rule), trailing punctuation, and stray glyphs
  // before anything reaches the live listing.
  const clean = cleanCaption(caption);
  if (!clean) {
    // Never send an empty caption: Guesty may silently ignore it, which the
    // verify step below couldn't distinguish from a real no-op clear.
    return { ok: false, error: 'Add some caption text before saving. To remove a caption, clear it in Guesty directly.' };
  }
  if (clean.length > 250) {
    return { ok: false, error: 'Caption is too long (over 250 characters). Trim it before saving.' };
  }
  if (!isRealPhotoId(photoId)) {
    return { ok: false, error: 'This photo has no stable Guesty id, so it can’t be captioned from here. Add the caption in Guesty directly.' };
  }

  const listingId = guard.listingId;
  // Compare captions through the SAME normalization we send, so a Guesty
  // echo with different whitespace/punctuation doesn't read as a change.
  const norm = (s: string | null | undefined) => cleanCaption(s ?? '');
  // Identity that survives id synthesis AND array reordering: the photo's
  // immutable CDN URL (fall back to the id only if a URL is somehow absent).
  type Pic = Awaited<ReturnType<typeof getListingPhotos>>[number];
  const keyOf = (p: Pic): string => p.original || p.thumbnail || p._id;

  // 1. BEFORE snapshot — keyed by stable URL identity.
  let before: Pic[];
  try {
    before = await getListingPhotos(listingId);
  } catch (err) {
    return { ok: false, error: `Could not read the listing from Guesty before saving: ${errMsg(err)}. Nothing changed.` };
  }
  const target = before.find((p) => p._id === photoId);
  if (!target) {
    return { ok: false, error: 'That photo is no longer on the Guesty listing. Reload and try again.' };
  }
  const targetKey = keyOf(target);
  const targetCaptionAt = (list: Pic[]) =>
    norm(list.find((p) => keyOf(p) === targetKey)?.caption);
  const beforeByKey = new Map(before.map((p) => [keyOf(p), norm(p.caption)]));

  // 2. write (isolated so a write failure reads as "nothing changed").
  try {
    await updatePhotoCaption(listingId, photoId, clean);
  } catch (err) {
    return { ok: false, error: `Guesty rejected the caption write: ${errMsg(err)}. Nothing changed.` };
  }

  // 3. AFTER — re-read to verify, retrying briefly for async propagation. A
  //    read failure here is NOT a write failure: the caption may have saved.
  let after: Pic[];
  try {
    after = await getListingPhotos(listingId);
    for (let i = 0; i < 2 && targetCaptionAt(after) !== clean; i++) {
      await sleep(1500);
      after = await getListingPhotos(listingId);
    }
  } catch (err) {
    return {
      ok: false,
      error: `Wrote the caption, but Helm couldn’t read the listing back to verify it (${errMsg(err)}). It may have saved — check this photo in Guesty before re-saving.`,
    };
  }
  const afterByKey = new Map(after.map((p) => [keyOf(p), norm(p.caption)]));

  // 4. collateral check — did any OTHER photo's caption change or vanish?
  const collateral: Array<{ before: string; after: string }> = [];
  for (const [key, was] of beforeByKey) {
    if (key === targetKey) continue;
    if (!afterByKey.has(key)) {
      collateral.push({ before: was, after: '(photo removed)' });
      continue;
    }
    const now = afterByKey.get(key) ?? '';
    if (now !== was) collateral.push({ before: was, after: now });
  }
  if (collateral.length > 0) {
    console.error('[saveCaptionAction] collateral change', { listingId, photoId, collateral });
    const changes = collateral
      .map((c) => `"${c.before || '(empty)'}" -> "${c.after || '(empty)'}"`)
      .join('; ');
    return {
      ok: false,
      error: `Aborted: that save also changed ${collateral.length} other photo(s) on this Guesty listing, so the write is not safe here. Nothing else was sent. What changed: ${changes}. Restore those in Guesty directly and caption there for now.`,
    };
  }

  // 5. did OUR caption actually land?
  if (targetCaptionAt(after) !== clean) {
    return {
      ok: false,
      error:
        'Guesty accepted the update but the caption did not appear on the listing, so the API write is not effective for this listing. Nothing was harmed — caption it in Guesty directly.',
    };
  }

  // 6. verified
  return { ok: true, caption: clean };
}
