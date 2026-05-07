'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import type { HelmPropertyRow } from '@/lib/properties';
import { getGuestyListing, type GuestyListingDetail } from '@/lib/guesty';

export type BackfillResult = {
  /** Human-readable summary of what changed, one bullet per filled field. */
  filled: string[];
  /** Fields skipped because the property already had a value (we never clobber). */
  skipped: string[];
  /** Soft warnings (e.g. "no Guesty listing linked to this property"). */
  warnings: string[];
};

/**
 * Pulls property metadata from Guesty's /listings/{id} endpoint and from a
 * smart-defaults pass, and writes any *missing* fields onto the property
 * row. Existing operator-curated values are never overwritten — backfill
 * only fills blanks.
 *
 * Surfaced behind a "Backfill from integrations" button on the property
 * page. Idempotent: running it twice on a property with everything filled
 * is a no-op.
 */
export async function backfillPropertyFromIntegrations(propertyId: string): Promise<BackfillResult> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const { data: row, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', propertyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error('Property not found');
  const property = row as HelmPropertyRow;

  const filled: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const updates: Record<string, unknown> = {};

  // ── Guesty listing metadata ──────────────────────────────────────────
  // Guesty knows beds, baths, accommodates, property type, lat/lng. None
  // of our other integrations (Quo SMS, Gmail) carry property metadata,
  // so this is the only structured source today.
  if (property.guesty_listing_id) {
    let listing: GuestyListingDetail | null = null;
    try {
      listing = await getGuestyListing(property.guesty_listing_id);
    } catch (err) {
      warnings.push(`Guesty fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (listing) {
      tryFill(updates, filled, skipped, 'bedrooms', property.bedrooms, listing.bedrooms);
      tryFill(updates, filled, skipped, 'bathrooms', property.bathrooms, listing.bathrooms);
      tryFill(updates, filled, skipped, 'square_feet', property.square_feet, listing.area);
      tryFill(updates, filled, skipped, 'type_of_unit', property.type_of_unit, listing.propertyType);
      tryFill(updates, filled, skipped, 'latitude', property.latitude, listing.address?.lat);
      tryFill(updates, filled, skipped, 'longitude', property.longitude, listing.address?.lng);
    }
  } else {
    warnings.push('No Guesty listing linked to this property — sync /api/sync-guesty first.');
  }

  // ── Smart defaults from data already on the property ─────────────────
  // owner_preferred_contact: if there are owner emails on file but no
  // explicit channel preference, default to "email" (the channel Helm has
  // historically used for these owners).
  if (!property.owner_preferred_contact && property.owner_emails && property.owner_emails.length > 0) {
    updates.owner_preferred_contact = 'email';
    filled.push("owner_preferred_contact ← 'email' (inferred from owner_emails)");
  }

  // ── Apply updates ────────────────────────────────────────────────────
  if (Object.keys(updates).length > 0) {
    updates.last_synced_at = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from('properties')
      .update(updates)
      .eq('id', propertyId);
    if (updateErr) throw new Error(updateErr.message);

    revalidatePath(`/properties/${propertyId}`);
    revalidatePath(`/properties/${propertyId}/edit`);
  }

  return { filled, skipped, warnings };
}

/**
 * Fill `column` from `incoming` only when the property's `current` value
 * is null/empty and `incoming` has a usable value. Records the outcome on
 * the running tallies so the caller can show Dotti what happened.
 */
function tryFill(
  updates: Record<string, unknown>,
  filled: string[],
  skipped: string[],
  column: string,
  current: unknown,
  incoming: unknown,
) {
  const hasIncoming = incoming != null && incoming !== '';
  const hasCurrent = current != null && current !== '';
  if (!hasIncoming) return; // Source had nothing to offer — silent.
  if (hasCurrent) {
    skipped.push(`${column} (already set to ${displayValue(current)})`);
    return;
  }
  updates[column] = incoming;
  filled.push(`${column} ← ${displayValue(incoming)}`);
}

function displayValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 40)}…` : v;
  if (typeof v === 'number') return String(v);
  return JSON.stringify(v);
}
