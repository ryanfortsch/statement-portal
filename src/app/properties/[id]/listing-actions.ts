'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { isServiceConfigured } from '@/lib/supabase-admin';
import {
  deletePhoto,
  getListingPhotos,
  reorderPhotos,
  setHero,
  upsertListingContent,
  upsertPhoto,
  type ListingContentPatch,
} from '@/lib/listing-content';

/**
 * Server actions for the property Listing tab (ListingPanel.tsx): the
 * guest-facing content record, the amenities list and the Blob-backed photo
 * gallery. Rooms and beds keep using onboarding-actions.ts through the
 * shared RoomsEditor.
 *
 * Nothing here reads property_access: door codes never enter the listing
 * record, whatever the operator pastes into a description is their call.
 */

export type ListingFormState = { error: string | null; ok?: boolean; message?: string | null };
export type ListingActionResult = { ok: true; message?: string } | { ok: false; error: string };

// Public Vercel Blob URLs read <store>.public.blob.vercel-storage.com/<path>.
const BLOB_HOST_SUFFIX = '.blob.vercel-storage.com';
const PROPERTY_ID = /^[a-z0-9_]{1,60}$/;

const str = (fd: FormData, key: string): string => (fd.get(key) ?? '').toString().replace(/\r\n/g, '\n').trim();
const textOrNull = (fd: FormData, key: string): string | null => str(fd, key) || null;

function numOrNull(fd: FormData, key: string, min = 0, max = 1000): number | null {
  const raw = str(fd, key);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key.replace(/_/g, ' ')} must be a number`);
  return Math.max(min, Math.min(max, n));
}

async function actor(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** A public Vercel Blob URL inside this property's listings/ folder, or null.
 *  The token route pins uploads to that folder; this is the same rule read
 *  back, so the record action cannot file an arbitrary link as an upload. */
function listingBlobUrl(raw: string, propertyId: string): string | null {
  if (!PROPERTY_ID.test(propertyId)) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:') return null;
    if (!u.hostname.endsWith(BLOB_HOST_SUFFIX)) return null;
    if (!u.pathname.startsWith(`/listings/${propertyId}/`)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** A positive whole pixel count, or null when the browser could not decode. */
function dimension(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n > 0 && n <= 50000 ? n : null;
}

// ── Content ─────────────────────────────────────────────────────────────────

export async function saveListingContentAction(propertyId: string, _prev: ListingFormState, fd: FormData): Promise<ListingFormState> {
  const by = await actor();
  if (!by) return { error: 'Not signed in' };
  if (!isServiceConfigured) return { error: 'Service role not configured' };
  try {
    // Checked catalog items plus anything typed into the extras box, deduped
    // on a folded key so 'Pack ’n Play' and "Pack 'n play" stay one item.
    const seen = new Set<string>();
    const amenities: string[] = [];
    const push = (s: string) => {
      const t = s.trim();
      if (!t) return;
      const k = t.toLowerCase().replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ');
      if (seen.has(k)) return;
      seen.add(k);
      amenities.push(t);
    };
    for (const v of fd.getAll('amenities')) push(String(v));
    for (const v of str(fd, 'amenities_extra').split(/[\n,]/)) push(v);
    const notIncluded = str(fd, 'amenities_not_included')
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const patch: ListingContentPatch = {
      property_id: propertyId,
      title: textOrNull(fd, 'title'),
      summary: textOrNull(fd, 'summary'),
      space: textOrNull(fd, 'space'),
      access: textOrNull(fd, 'access'),
      interaction: textOrNull(fd, 'interaction'),
      neighborhood: textOrNull(fd, 'neighborhood'),
      house_rules: textOrNull(fd, 'house_rules'),
      notes: textOrNull(fd, 'notes'),
      property_type: textOrNull(fd, 'property_type'),
      room_type: textOrNull(fd, 'room_type'),
      accommodates: numOrNull(fd, 'accommodates', 1, 100),
      bedrooms: numOrNull(fd, 'bedrooms', 0, 50),
      bathrooms: numOrNull(fd, 'bathrooms', 0, 50),
      beds: numOrNull(fd, 'beds', 0, 100),
      amenities,
      amenities_not_included: notIncluded,
      source: 'helm',
    };
    await upsertListingContent(patch, by);
    revalidatePath(`/properties/${propertyId}`);
    return { error: null, ok: true, message: 'Listing saved.' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Save failed' };
  }
}

// ── Photos ──────────────────────────────────────────────────────────────────

/** Add a photo by URL (already hosted somewhere Helm can serve from). */
export async function addPhotoUrlAction(propertyId: string, input: { url: string; caption?: string | null }): Promise<ListingActionResult> {
  const by = await actor();
  if (!by) return { ok: false, error: 'Not signed in' };
  if (!isServiceConfigured) return { ok: false, error: 'Service role not configured' };
  const url = safeUrl(String(input.url ?? ''));
  if (!url) return { ok: false, error: 'That is not an http(s) URL.' };
  try {
    const existing = await getListingPhotos(propertyId);
    await upsertPhoto({
      property_id: propertyId,
      url,
      caption: input.caption?.trim() || null,
      source: 'helm',
      is_hero: existing.length === 0,
    });
    revalidatePath(`/properties/${propertyId}`);
    return { ok: true, message: 'Photo added.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Add failed' };
  }
}

/**
 * Record a photo the browser has already put on Vercel Blob. The bytes never
 * come through here: ListingPanel.tsx uploads client-direct on a token from
 * /api/blob/listing-photo (which pins the path to listings/<property>/,
 * image types and 12 MB), then calls this with the URL Blob returned. A
 * server action's body is capped at 4 MB (next.config.ts), so a file in the
 * body was refused before any size message could run; only the URL, the
 * caption and the pixel size travel this way.
 */
export async function recordUploadedPhotoAction(
  propertyId: string,
  input: { url: string; caption?: string | null; width?: number | null; height?: number | null },
): Promise<ListingActionResult> {
  const by = await actor();
  if (!by) return { ok: false, error: 'Not signed in' };
  if (!isServiceConfigured) return { ok: false, error: 'Service role not configured' };
  const url = listingBlobUrl(String(input.url ?? ''), propertyId);
  if (!url) return { ok: false, error: 'That URL is not a Blob upload for this property.' };
  const caption = input.caption?.trim() || null;
  try {
    const existing = await getListingPhotos(propertyId);
    await upsertPhoto({
      property_id: propertyId,
      url,
      caption,
      source: 'helm',
      is_hero: existing.length === 0,
      width: dimension(input.width),
      height: dimension(input.height),
    });
    revalidatePath(`/properties/${propertyId}`);
    return { ok: true, message: 'Photo uploaded.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Upload failed' };
  }
}

export async function updatePhotoAction(
  propertyId: string,
  photoId: string,
  input: { caption?: string | null; room_hint?: string | null },
): Promise<ListingActionResult> {
  const by = await actor();
  if (!by) return { ok: false, error: 'Not signed in' };
  if (!isServiceConfigured) return { ok: false, error: 'Service role not configured' };
  try {
    const current = (await getListingPhotos(propertyId)).find((p) => p.id === photoId);
    if (!current) return { ok: false, error: 'Photo not found' };
    await upsertPhoto({
      id: photoId,
      property_id: propertyId,
      url: current.url,
      source_url: current.source_url,
      thumbnail_url: current.thumbnail_url,
      caption: input.caption === undefined ? current.caption : input.caption?.trim() || null,
      room_hint: input.room_hint === undefined ? current.room_hint : input.room_hint?.trim() || null,
      source: current.source,
      external_id: current.external_id,
      width: current.width,
      height: current.height,
    });
    revalidatePath(`/properties/${propertyId}`);
    return { ok: true, message: 'Photo updated.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

export async function deletePhotoAction(propertyId: string, photoId: string): Promise<ListingActionResult> {
  const by = await actor();
  if (!by) return { ok: false, error: 'Not signed in' };
  if (!isServiceConfigured) return { ok: false, error: 'Service role not configured' };
  try {
    await deletePhoto(propertyId, photoId);
    revalidatePath(`/properties/${propertyId}`);
    return { ok: true, message: 'Photo removed.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Delete failed' };
  }
}

/** Move one photo up (-1) or down (+1) in the gallery order. */
export async function movePhotoAction(propertyId: string, photoId: string, direction: -1 | 1): Promise<ListingActionResult> {
  const by = await actor();
  if (!by) return { ok: false, error: 'Not signed in' };
  if (!isServiceConfigured) return { ok: false, error: 'Service role not configured' };
  try {
    const ids = (await getListingPhotos(propertyId)).map((p) => p.id);
    const i = ids.indexOf(photoId);
    if (i < 0) return { ok: false, error: 'Photo not found' };
    const j = i + direction;
    if (j < 0 || j >= ids.length) return { ok: true };
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await reorderPhotos(propertyId, ids);
    revalidatePath(`/properties/${propertyId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Reorder failed' };
  }
}

/** Apply a full order (drag-and-drop clients send the whole list). */
export async function reorderPhotosAction(propertyId: string, orderedIds: string[]): Promise<ListingActionResult> {
  const by = await actor();
  if (!by) return { ok: false, error: 'Not signed in' };
  if (!isServiceConfigured) return { ok: false, error: 'Service role not configured' };
  try {
    await reorderPhotos(propertyId, orderedIds.map(String));
    revalidatePath(`/properties/${propertyId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Reorder failed' };
  }
}

export async function setHeroAction(propertyId: string, photoId: string): Promise<ListingActionResult> {
  const by = await actor();
  if (!by) return { ok: false, error: 'Not signed in' };
  if (!isServiceConfigured) return { ok: false, error: 'Service role not configured' };
  try {
    const row = await setHero(propertyId, photoId);
    if (!row) return { ok: false, error: 'Photo not found' };
    revalidatePath(`/properties/${propertyId}`);
    return { ok: true, message: 'Hero set.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Hero failed' };
  }
}
