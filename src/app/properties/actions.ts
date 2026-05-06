'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';

/**
 * Server actions for the Properties module.
 *
 * Right now this only covers the operational/safety fields surfaced on the
 * /properties/[id]/edit form — the editable subset of HelmPropertyRow that
 * staff actually need to fill in or correct mid-cycle (Wi-Fi, parking,
 * trash, safety equipment, emergency contact, etc.). Identity fields
 * (id, name, address, owner_*, management_fee_pct) are intentionally NOT
 * here — those need a different code path with stronger guardrails.
 */

function strOrNull(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? '').trim();
  return v ? v : null;
}

function intOrNull(formData: FormData, key: string): number | null {
  const v = String(formData.get(key) ?? '').trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function numOrNull(formData: FormData, key: string): number | null {
  const v = String(formData.get(key) ?? '').trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Update an existing property's operational + safety fields. No-ops on
 * identity columns. Auth-gated by the same Google SSO that protects the
 * rest of Helm.
 */
export async function updateProperty(id: string, formData: FormData) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const payload = {
    // Owner contact extras
    owner_phone: strOrNull(formData, 'owner_phone'),
    owner_mailing_address: strOrNull(formData, 'owner_mailing_address'),
    owner_preferred_contact: strOrNull(formData, 'owner_preferred_contact'),

    // Property specs
    bedrooms: intOrNull(formData, 'bedrooms'),
    bathrooms: numOrNull(formData, 'bathrooms'),
    square_feet: intOrNull(formData, 'square_feet'),
    livable_floors: intOrNull(formData, 'livable_floors'),
    basement: strOrNull(formData, 'basement'),
    parking: strOrNull(formData, 'parking'),
    hoa: strOrNull(formData, 'hoa'),

    // Utilities
    electricity_provider: strOrNull(formData, 'electricity_provider'),
    heating: strOrNull(formData, 'heating'),
    cooling: strOrNull(formData, 'cooling'),
    internet_provider: strOrNull(formData, 'internet_provider'),
    cable_provider: strOrNull(formData, 'cable_provider'),
    wifi_name: strOrNull(formData, 'wifi_name'),
    wifi_password: strOrNull(formData, 'wifi_password'),
    num_tvs: intOrNull(formData, 'num_tvs'),
    smart_tv: strOrNull(formData, 'smart_tv'),

    // STR setup
    currently_listed: strOrNull(formData, 'currently_listed'),
    existing_listing_urls: strOrNull(formData, 'existing_listing_urls'),
    str_registration_id: strOrNull(formData, 'str_registration_id'),
    str_insurance_carrier: strOrNull(formData, 'str_insurance_carrier'),
    guest_access_method: strOrNull(formData, 'guest_access_method'),
    smart_lock_brand: strOrNull(formData, 'smart_lock_brand'),
    smart_lock_code: strOrNull(formData, 'smart_lock_code'),
    security_cameras: strOrNull(formData, 'security_cameras'),

    // Property access & notes
    key_code_location: strOrNull(formData, 'key_code_location'),
    alarm_system: strOrNull(formData, 'alarm_system'),
    known_issues: strOrNull(formData, 'known_issues'),
    upcoming_maintenance: strOrNull(formData, 'upcoming_maintenance'),
    property_notes: strOrNull(formData, 'property_notes'),

    // Emergency contact
    emergency_contact_name: strOrNull(formData, 'emergency_contact_name'),
    emergency_contact_relationship: strOrNull(formData, 'emergency_contact_relationship'),
    emergency_contact_phone: strOrNull(formData, 'emergency_contact_phone'),
    emergency_contact_email: strOrNull(formData, 'emergency_contact_email'),

    // Inspection & safety
    trash_day: strOrNull(formData, 'trash_day'),
    recycling_day: strOrNull(formData, 'recycling_day'),
    trash_notes: strOrNull(formData, 'trash_notes'),
    parking_regulations: strOrNull(formData, 'parking_regulations'),
    gas_shutoff_location: strOrNull(formData, 'gas_shutoff_location'),
    water_shutoff_location: strOrNull(formData, 'water_shutoff_location'),
    electrical_panel_location: strOrNull(formData, 'electrical_panel_location'),
    fire_extinguisher_locations: strOrNull(formData, 'fire_extinguisher_locations'),
    smoke_detector_locations: strOrNull(formData, 'smoke_detector_locations'),
    fire_exit_locations: strOrNull(formData, 'fire_exit_locations'),
    str_permit_expires: strOrNull(formData, 'str_permit_expires'),
  };

  const { error } = await supabase.from('properties').update(payload).eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/properties');
  revalidatePath(`/properties/${id}`);
  revalidatePath(`/properties/${id}/info-note`);
  revalidatePath(`/properties/${id}/home-guide`);
  revalidatePath(`/properties/${id}/wifi-placard`);
  redirect(`/properties/${id}`);
}

export type OwnerContactChannel = 'email' | 'phone' | 'sms' | 'in_person' | 'other';

const VALID_CHANNELS: OwnerContactChannel[] = ['email', 'phone', 'sms', 'in_person', 'other'];

/**
 * Stamp the property's owner_last_contacted_* trio. Used by the
 * MarkContactedButton on /properties/[id] for off-thread touches that
 * aren't tied to a specific owner-action work slip (the slip-driven path
 * still writes to work_slips.owner_last_contacted_at).
 *
 * The Owner section's "Last contacted" line takes the MAX of both columns
 * so this composes cleanly with #136 / #147.
 */
export async function markOwnerContacted(args: {
  property_id: string;
  channel: OwnerContactChannel;
}): Promise<{ ok: true; at: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!args.property_id) return { ok: false, error: 'Missing property_id' };
  if (!VALID_CHANNELS.includes(args.channel)) return { ok: false, error: 'Invalid channel' };

  const at = new Date().toISOString();
  const { error } = await supabase
    .from('properties')
    .update({
      owner_last_contacted_at: at,
      owner_last_contacted_via: args.channel,
      owner_last_contacted_by_email: session.user.email,
    })
    .eq('id', args.property_id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/properties');
  revalidatePath(`/properties/${args.property_id}`);
  return { ok: true, at };
}
