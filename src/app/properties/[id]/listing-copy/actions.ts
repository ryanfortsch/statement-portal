'use server';

import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import type { HelmPropertyRow } from '@/lib/properties';
import { generateListingCopy, type ListingCopy, type ListingCopyFormat } from '@/lib/ai/listing-copy';

export type GenerateListingCopyResult =
  | { ok: true; copy: ListingCopy }
  | { ok: false; error: string };

/**
 * Server action backing the /properties/[id]/listing-copy form.
 *
 * Receives the operator's brief + 0-6 photo files via FormData, pulls
 * the property row from public.properties, and calls the AI generator.
 *
 * Photos are read as ArrayBuffer here and converted to base64 data URLs
 * before forwarding to the AI lib (so the lib stays transport-agnostic
 * and can be reused from non-form code paths later). Per-photo size is
 * capped at 4MB to keep the server-action request body within Vercel's
 * default 4.5MB limit even with 6 photos attached.
 */
export async function generateListingCopyAction(
  propertyId: string,
  formData: FormData,
): Promise<GenerateListingCopyResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', propertyId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Property not found' };
  const property = data as HelmPropertyRow;

  const operatorBrief = String(formData.get('brief') ?? '').trim();
  const formatRaw = String(formData.get('format') ?? 'airbnb');
  const format: ListingCopyFormat = formatRaw === 'editorial' ? 'editorial' : 'airbnb';

  const photoFiles = formData.getAll('photos').filter((v): v is File => v instanceof File);
  const photoDataUrls: string[] = [];
  for (const f of photoFiles.slice(0, 6)) {
    if (f.size === 0) continue;
    if (f.size > 4 * 1024 * 1024) {
      return { ok: false, error: `Photo "${f.name}" is over 4 MB. Compress or shrink before uploading.` };
    }
    const mime = f.type && f.type.startsWith('image/') ? f.type : 'image/jpeg';
    const buf = Buffer.from(await f.arrayBuffer()).toString('base64');
    photoDataUrls.push(`data:${mime};base64,${buf}`);
  }

  try {
    const copy = await generateListingCopy({ property, operatorBrief, photoDataUrls, format });
    return { ok: true, copy };
  } catch (err) {
    console.error('[generateListingCopyAction] generator threw', {
      propertyId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
