'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { HelmPropertyRow } from '@/lib/properties';
import { getGuestyListing, type GuestyListingDetail } from '@/lib/guesty';
import {
  findScaListingByGuestyId,
  findScaListingByAddress,
  SCA_LISTINGS_REFRESHED_AT,
  type ScaListing,
} from '@/lib/sca-listings';

export type BackfillResult = {
  /** Human-readable summary of what changed, one bullet per filled field. */
  filled: string[];
  /** Fields skipped because the property already had a value (we never clobber). */
  skipped: string[];
  /** Soft warnings (e.g. "no Guesty listing linked to this property"). */
  warnings: string[];
  /** Which sources contributed data. Surfaced so Dotti can audit and so a
   *  stale Stay Cape Ann snapshot is visible at a glance. */
  sources: string[];
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
  const sources: string[] = [];
  const updates: Record<string, unknown> = {};

  // ── Stay Cape Ann snapshot (primary source) ──────────────────────────
  // SCA bundles a daily-refreshed Guesty cache for its public site. Every
  // Helm-managed property that's listed on staycapeann.com has its
  // metadata (beds, baths, accommodates, lat/lng, property type) here
  // already, no API call needed. We try SCA first because it's free,
  // offline-safe, and richer than the live listings endpoint for SCA-
  // listed homes. Match by guesty_listing_id; address fallback for
  // properties without one wired up yet.
  let scaListing: ScaListing | null = findScaListingByGuestyId(property.guesty_listing_id);
  if (!scaListing) scaListing = findScaListingByAddress(property.address);

  if (scaListing) {
    sources.push(
      `Stay Cape Ann snapshot — listing "${scaListing.title}" (refreshed ${formatDate(SCA_LISTINGS_REFRESHED_AT)})`,
    );
    tryFill(updates, filled, skipped, 'bedrooms', property.bedrooms, scaListing.bedrooms);
    tryFill(updates, filled, skipped, 'bathrooms', property.bathrooms, scaListing.bathrooms);
    tryFill(updates, filled, skipped, 'type_of_unit', property.type_of_unit, scaListing.propertyType);
    tryFill(updates, filled, skipped, 'latitude', property.latitude, scaListing.address?.lat);
    tryFill(updates, filled, skipped, 'longitude', property.longitude, scaListing.address?.lng);
  }

  // ── Guesty live listing metadata (fallback) ──────────────────────────
  // For properties not on Stay Cape Ann (e.g. Ryan's personal homes
  // pre-CIF) the SCA snapshot won't have them, so fall back to the live
  // Guesty API. Skip the network call entirely if SCA already had the
  // listing — saves an API hit for the common case.
  if (!scaListing && property.guesty_listing_id) {
    let listing: GuestyListingDetail | null = null;
    try {
      listing = await getGuestyListing(property.guesty_listing_id);
    } catch (err) {
      warnings.push(`Guesty fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (listing) {
      sources.push('Guesty live API (/v1/listings)');
      tryFill(updates, filled, skipped, 'bedrooms', property.bedrooms, listing.bedrooms);
      tryFill(updates, filled, skipped, 'bathrooms', property.bathrooms, listing.bathrooms);
      tryFill(updates, filled, skipped, 'square_feet', property.square_feet, listing.area);
      tryFill(updates, filled, skipped, 'type_of_unit', property.type_of_unit, listing.propertyType);
      tryFill(updates, filled, skipped, 'latitude', property.latitude, listing.address?.lat);
      tryFill(updates, filled, skipped, 'longitude', property.longitude, listing.address?.lng);
    }
  } else if (!scaListing && !property.guesty_listing_id) {
    warnings.push(
      'Not on Stay Cape Ann and no Guesty listing linked — manual entry only for this property.',
    );
  }

  // ── Smart defaults from data already on the property ─────────────────
  // owner_preferred_contact: if there are owner emails on file but no
  // explicit channel preference, default to "email" (the channel Helm has
  // historically used for these owners).
  if (!property.owner_preferred_contact && property.owner_emails && property.owner_emails.length > 0) {
    updates.owner_preferred_contact = 'email';
    filled.push("owner_preferred_contact ← 'email' (inferred from owner_emails)");
    sources.push('Smart defaults — inferred from existing data');
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

  return { filled, skipped, warnings, sources };
}

/** Format an ISO timestamp as a relative-or-absolute string for the
 *  source attribution. Same shape as the property page's
 *  formatRelativeOrAbsolute helper but inlined to avoid a cross-file
 *  import in a server action file. */
function formatDate(iso: string): string {
  try {
    const then = new Date(iso);
    const days = Math.floor((Date.now() - then.getTime()) / (24 * 60 * 60 * 1000));
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 14) return `${days} days ago`;
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
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

/**
 * Update a property's MassTaxConnect occupancy-tax certificate ID. The
 * accountant files VRBO / Manual / Booking stays' MA occupancy tax under
 * this cert on the *9928 tax account. Empty input clears the value (e.g.
 * for properties where Airbnb collects + remits its own stays AND there
 * are no other channels).
 */
export async function updateTaxCertId(
  propertyId: string,
  certIdRaw: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const certId = (certIdRaw || '').trim() || null;
  if (certId && !/^[A-Z0-9-]{4,32}$/i.test(certId)) {
    return { ok: false, error: 'Cert ID must be 4-32 letters/digits (e.g. C0585051070).' };
  }
  const { error } = await supabase
    .from('properties')
    .update({ tax_cert_id: certId, last_synced_at: new Date().toISOString() })
    .eq('id', propertyId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath('/statements');
  return { ok: true };
}

function displayValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 40)}…` : v;
  if (typeof v === 'number') return String(v);
  return JSON.stringify(v);
}
