'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { BOOKING_CHANNELS, type BookingChannel } from '@/lib/channels-types';

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

  const { error } = await supabaseAdmin.from('channel_listings').upsert(row, { onConflict: 'property_id,channel' });
  if (error) throw new Error(`save listing: ${error.message}`);

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
