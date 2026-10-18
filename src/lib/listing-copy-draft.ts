import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { HelmPropertyRow } from '@/lib/properties';
import { getListingPhotos } from '@/lib/listing-content';
import { generateListingCopy, type ListingCopy, type ListingCopyFormat } from '@/lib/ai/listing-copy';

/**
 * "Draft with AI", the one door to the listing copy generator.
 *
 * It used to be its own page (/properties/[id]/listing-copy) that saved
 * nothing: the operator drafted there, copied, and pasted into the Stay Cape
 * Ann launcher or Guesty (UI/UX audit 2026-10-17, appendix 05). The draft now
 * lands in the form that saves it: the launcher's Step 1 (the `sca` format:
 * tagline, About, highlights) and the property page's Listing section (the
 * `airbnb` format: one block per Guesty description field).
 *
 * Photos come from the home's own Listing gallery (hero first, up to six)
 * instead of an upload, so the model still describes what is visible. A photo
 * the model cannot fetch fails the whole call, so a failed attempt with
 * photos is retried once without them.
 */
export type ListingDraftResult = { ok: true; copy: ListingCopy; photos: number } | { ok: false; error: string };

const MAX_PHOTOS = 6;

export async function draftListingCopy(
  propertyId: string,
  format: Extract<ListingCopyFormat, 'sca' | 'airbnb'>,
  operatorBrief: string,
): Promise<ListingDraftResult> {
  const { data, error } = await supabase.from('properties').select('*').eq('id', propertyId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Property not found' };
  const property = data as HelmPropertyRow;

  let photoUrls: string[] = [];
  try {
    const photos = await getListingPhotos(propertyId);
    photoUrls = [...photos]
      .sort((a, b) => Number(b.is_hero) - Number(a.is_hero) || a.sort_order - b.sort_order)
      .map((p) => p.url)
      .filter((u) => /^https:\/\//.test(u))
      .slice(0, MAX_PHOTOS);
  } catch {
    photoUrls = [];
  }

  const brief = operatorBrief.trim().slice(0, 2000);
  try {
    const copy = await generateListingCopy({ property, operatorBrief: brief, photoDataUrls: photoUrls, format });
    return { ok: true, copy, photos: photoUrls.length };
  } catch (first) {
    if (photoUrls.length === 0) return { ok: false, error: (first as Error).message };
    try {
      const copy = await generateListingCopy({ property, operatorBrief: brief, photoDataUrls: [], format });
      return { ok: true, copy, photos: 0 };
    } catch (second) {
      console.error('[draftListingCopy] generator threw', { propertyId, format, err: (second as Error).message });
      return { ok: false, error: (second as Error).message };
    }
  }
}
