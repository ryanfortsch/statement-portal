'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { BOOKING_CHANNELS, type BookingChannel } from '@/lib/channels-types';

function getSb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !key) throw new Error('Supabase env vars not configured');
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function saveListing(formData: FormData) {
  const propertyId = String(formData.get('property_id') || '').trim();
  const channelRaw = String(formData.get('channel') || '').trim();
  const icalUrl = String(formData.get('ical_import_url') || '').trim();
  const externalUrl = String(formData.get('external_listing_url') || '').trim();
  const displayName = String(formData.get('display_name') || '').trim();

  if (!propertyId || !channelRaw) throw new Error('Missing property_id or channel');
  if (!BOOKING_CHANNELS.includes(channelRaw as BookingChannel)) throw new Error('Invalid channel');
  const channel = channelRaw as BookingChannel;

  const sb = getSb();

  // Upsert by (property_id, channel)
  const { error } = await sb.from('channel_listings').upsert(
    {
      property_id: propertyId,
      channel,
      ical_import_url: icalUrl || null,
      external_listing_url: externalUrl || null,
      display_name: displayName || null,
      ical_import_enabled: !!icalUrl,
      is_active: true,
    },
    { onConflict: 'property_id,channel' },
  );
  if (error) throw new Error(`save listing: ${error.message}`);

  revalidatePath('/channels');
  revalidatePath('/channels/listings');
}

export async function toggleListingActive(formData: FormData) {
  const id = String(formData.get('id') || '').trim();
  const isActiveRaw = String(formData.get('is_active') || 'true');
  if (!id) throw new Error('Missing listing id');
  const sb = getSb();
  const { error } = await sb
    .from('channel_listings')
    .update({ is_active: isActiveRaw === 'true' })
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/channels');
  revalidatePath('/channels/listings');
}

export async function deleteListing(formData: FormData) {
  const id = String(formData.get('id') || '').trim();
  if (!id) throw new Error('Missing listing id');
  const sb = getSb();
  const { error } = await sb.from('channel_listings').delete().eq('id', id);
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
