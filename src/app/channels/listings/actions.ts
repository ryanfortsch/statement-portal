'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { BOOKING_CHANNELS, type BookingChannel } from '@/lib/channels-types';
import { auth } from '@/auth';

/**
 * A feed that stops being read can no longer cancel what it imported: its
 * holds would stand forever, closing their nights on staycapeann.com and
 * (unstamped) on every other OTA's export. So when a listing is deleted,
 * deactivated or loses its import URL, its live OTA holds are retired here,
 * first. Stays are left alone: a reservation does not stop being real
 * because Helm stopped reading the calendar that carried it.
 */
async function retireFeedHolds(listingId: string, reason: string): Promise<number> {
  const session = await auth().catch(() => null);
  const actor = session?.user?.email ?? 'operator';
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: actor,
      cancel_reason: reason,
    })
    .eq('channel_listing_id', listingId)
    .eq('source', 'ical_import')
    .eq('status', 'block')
    .eq('hold_kind', 'ota')
    .select('id');
  if (error) throw new Error(`retire feed holds: ${error.message}`);
  return (data ?? []).length;
}

/**
 * channel_listings writes for /channels/listings. Service role only: the
 * table is RLS-locked and an anon fallback would silently see zero rows.
 *
 * saveListing writes only the fields the submitting form carried
 * (formData.has), so the iCal URL form on the grid cannot blank out a
 * display name or listing id saved from the fuller per-listing form.
 */

const RATES_MANAGED_BY = ['guesty', 'pricelabs', 'ota_ui', 'helm'] as const;
type RatesManagedBy = (typeof RATES_MANAGED_BY)[number];

function ensureConfigured() {
  if (!isServiceConfigured) throw new Error('Supabase service role is not configured.');
}

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export async function saveListing(formData: FormData) {
  ensureConfigured();
  const propertyId = String(formData.get('property_id') || '').trim();
  const channelRaw = String(formData.get('channel') || '').trim();
  if (!propertyId || !channelRaw) throw new Error('Missing property_id or channel');
  if (!BOOKING_CHANNELS.includes(channelRaw as BookingChannel)) throw new Error('Invalid channel');
  const channel = channelRaw as BookingChannel;

  const row: Record<string, unknown> = {
    property_id: propertyId,
    channel,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  if (formData.has('ical_import_url')) {
    const icalUrl = str(formData, 'ical_import_url');
    if (icalUrl && !/^https?:\/\//i.test(icalUrl)) throw new Error('The iCal URL must start with http(s)://');
    row.ical_import_url = icalUrl;
    row.ical_import_enabled = !!icalUrl;
  }
  if (formData.has('external_listing_id')) row.external_listing_id = str(formData, 'external_listing_id');
  if (formData.has('external_listing_url')) {
    const u = str(formData, 'external_listing_url');
    if (u && !/^https?:\/\//i.test(u)) throw new Error('The listing URL must start with http(s)://');
    row.external_listing_url = u;
  }
  if (formData.has('external_room_id')) row.external_room_id = str(formData, 'external_room_id');
  if (formData.has('display_name')) row.display_name = str(formData, 'display_name');
  if (formData.has('rates_managed_by')) {
    const r = str(formData, 'rates_managed_by');
    if (r && !(RATES_MANAGED_BY as readonly string[]).includes(r)) throw new Error('Invalid rates_managed_by');
    if (r) row.rates_managed_by = r as RatesManagedBy;
  }
  if (formData.has('notes')) row.notes = str(formData, 'notes');

  const { data: saved, error } = await supabaseAdmin
    .from('channel_listings')
    .upsert(row, { onConflict: 'property_id,channel' })
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`save listing: ${error.message}`);
  // The import URL was cleared: this feed is no longer read.
  if (formData.has('ical_import_url') && row.ical_import_url === null && saved?.id) {
    await retireFeedHolds(saved.id as string, 'feed_url_cleared');
  }

  revalidatePath('/channels');
  revalidatePath('/channels/listings');
  revalidatePath(`/channels/${propertyId}`);
}

/**
 * The operator's tick: "I pasted Helm's export URL into this OTA."
 * Stamps export_subscribed / export_subscribed_at; ical_export_pulls is the
 * proof that the OTA actually pulls. Fields: id, export_subscribed
 * ('true' default, 'false' to untick).
 */
export async function tickExportSubscribed(formData: FormData) {
  ensureConfigured();
  const id = String(formData.get('id') || '').trim();
  if (!id) throw new Error('Missing listing id');
  const on = String(formData.get('export_subscribed') ?? 'true') !== 'false';
  const { data, error } = await supabaseAdmin
    .from('channel_listings')
    .update({
      export_subscribed: on,
      export_subscribed_at: on ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('property_id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  revalidatePath('/channels');
  revalidatePath('/channels/listings');
  const propertyId = (data as { property_id?: string } | null)?.property_id;
  if (propertyId) revalidatePath(`/channels/${propertyId}`);
}

export async function toggleListingActive(formData: FormData) {
  ensureConfigured();
  const id = String(formData.get('id') || '').trim();
  const isActiveRaw = String(formData.get('is_active') || 'true');
  if (!id) throw new Error('Missing listing id');
  if (isActiveRaw !== 'true') await retireFeedHolds(id, 'feed_deactivated');
  const { error } = await supabaseAdmin
    .from('channel_listings')
    .update({ is_active: isActiveRaw === 'true', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/channels');
  revalidatePath('/channels/listings');
}

export async function deleteListing(formData: FormData) {
  ensureConfigured();
  const id = String(formData.get('id') || '').trim();
  if (!id) throw new Error('Missing listing id');
  // Before the delete: afterwards channel_listing_id is nulled and the
  // holds could not be found by listing any more.
  await retireFeedHolds(id, 'feed_removed');
  const { error } = await supabaseAdmin.from('channel_listings').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/channels');
  revalidatePath('/channels/listings');
}

export async function syncOneListing(formData: FormData) {
  const id = String(formData.get('id') || '').trim();
  if (!id) throw new Error('Missing listing id');
  // Lazy import so the action route stays light when only saving
  const { syncAllListings } = await import('@/lib/ical-sync');
  await syncAllListings({ onlyListingId: id });
  revalidatePath('/channels');
  revalidatePath('/channels/listings');
}

/**
 * The operator's release for the mass-cancel guard: "these cancellations
 * are real." Rule 4 of the cancel policy (src/lib/ical-cancel-policy.ts)
 * holds every upcoming stay when too many vanish from a feed at once, and
 * the same rows recount above the threshold on every later run, so nothing
 * but a human can let them go.
 *
 * Stamps channel_listings.mass_cancel_acknowledged_at, then syncs that one
 * listing at once so the held stays cancel now rather than on the next cron
 * beat. syncListing consumes the stamp (skips the guard for that single run)
 * and clears it, so a second click is a fresh decision, never a standing
 * exemption. If the sync cannot run right now the stamp stays and the next
 * sync of the listing applies it; the feed card says so.
 *
 * Two refusals keep the stamp an answer to a guard that is actually up:
 * a feed the sync will not visit (retired, or no iCal URL) would hold the
 * stamp forever, and a stale tab clicking after a later run already cleared
 * the guard would otherwise leave an exemption waiting for the next broken
 * feed. The stale case stamps nothing and just refreshes the page.
 *
 * Fields: id (channel_listings.id).
 */
export async function acknowledgeMassCancel(formData: FormData) {
  ensureConfigured();
  const id = String(formData.get('id') || '').trim();
  if (!id) throw new Error('Missing listing id');

  const { data: listing, error: listingErr } = await supabaseAdmin
    .from('channel_listings')
    .select('property_id, is_active, ical_import_enabled, ical_import_url')
    .eq('id', id)
    .maybeSingle();
  if (listingErr) throw new Error(`acknowledge mass cancel: ${listingErr.message}`);
  if (!listing) throw new Error('Listing not found');
  const l = listing as { property_id: string; is_active: boolean | null; ical_import_enabled: boolean | null; ical_import_url: string | null };

  const refresh = () => {
    revalidatePath('/channels');
    revalidatePath('/channels/listings');
    revalidatePath(`/channels/${l.property_id}`);
  };

  if (!l.is_active || !l.ical_import_enabled || !l.ical_import_url) {
    throw new Error('This feed is not syncing, so there is no held cancel to release.');
  }

  // select('*') so a database the plumbing migration has not reached (no
  // guard column) reads as "no guard" rather than failing the query.
  const { data: lastRun, error: runErr } = await supabaseAdmin
    .from('ical_sync_runs')
    .select('*')
    .eq('channel_listing_id', id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runErr) throw new Error(`read last sync run: ${runErr.message}`);
  if ((lastRun as { guard?: unknown } | null)?.guard !== 'mass_cancel') {
    refresh();
    return;
  }

  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('channel_listings')
    .update({ mass_cancel_acknowledged_at: nowIso, updated_at: nowIso })
    .eq('id', id);
  if (error) throw new Error(`acknowledge mass cancel: ${error.message}`);

  // Same lazy import as syncOneListing: the action route stays light when
  // only saving. A failure here leaves the stamp in place for the next cron
  // beat, and the feed card shows it as a release not yet applied, so the
  // operator is told rather than shown an error page for a saved decision.
  try {
    const { syncAllListings } = await import('@/lib/ical-sync');
    await syncAllListings({ onlyListingId: id });
  } catch (err) {
    console.error('[acknowledgeMassCancel] sync after release failed:', err);
  }

  refresh();
}
