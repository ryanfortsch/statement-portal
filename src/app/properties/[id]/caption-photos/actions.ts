'use server';

import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
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

export async function saveCaptionAction(
  propertyId: string,
  photoId: string,
  caption: string,
): Promise<SaveCaptionResult> {
  const guard = await requireLinkedProperty(propertyId);
  if (!guard.ok) return { ok: false, error: guard.error };

  // Same hygiene the AI drafts get, applied to operator edits too: strips
  // em dashes (the hard brand rule), trailing punctuation, and stray glyphs
  // before anything reaches the live listing.
  const clean = cleanCaption(caption);
  if (clean.length > 250) {
    return { ok: false, error: 'Caption is too long (over 250 characters). Trim it before saving.' };
  }

  try {
    await updatePhotoCaption(guard.listingId, photoId, clean);
    return { ok: true, caption: clean };
  } catch (err) {
    return { ok: false, error: `Guesty rejected the caption update: ${errMsg(err)}` };
  }
}
