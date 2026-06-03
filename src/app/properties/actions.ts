'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';

/**
 * Service-role Supabase client for writes that must bypass anon RLS
 * and column-level grants. Server-action code only — the service key
 * must never reach the browser.
 *
 * Background: a 2026-06-02 incident showed that updateProperty was
 * silently dropping writes to columns added in recent migrations
 * (thermostat_brand, thermostat_code, garage_code, gate_code, even
 * wifi_name on newly-promoted properties). The anon-key path hit a
 * PostgREST schema cache / per-column-grants edge case that wouldn't
 * resolve via NOTIFY pgrst, 'reload schema'. Switching to service-role
 * sidesteps the entire RLS + grants + schema-cache surface for writes.
 *
 * Reads still use the module-level anon client because /properties
 * pages need to render server-side from cached anon results.
 */
function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }
  return createClient(url, key);
}

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

    // Smart thermostat (Utilities subsection on the edit page).
    thermostat_brand: strOrNull(formData, 'thermostat_brand'),
    thermostat_code: strOrNull(formData, 'thermostat_code'),

    // Property access & notes
    key_code_location: strOrNull(formData, 'key_code_location'),
    alarm_system: strOrNull(formData, 'alarm_system'),
    gate_code: strOrNull(formData, 'gate_code'),
    garage_code: strOrNull(formData, 'garage_code'),
    known_issues: strOrNull(formData, 'known_issues'),
    upcoming_maintenance: strOrNull(formData, 'upcoming_maintenance'),
    // property_notes is no longer a column — it lives in
    // public.property_notes as one row per discrete note. See the
    // createPropertyNote / updatePropertyNote actions below.

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

  // Use the service-role client for the write so the update can't be
  // silently no-op'd by anon RLS or column-level grants (see the
  // getServiceClient() comment at the top of this file for the
  // 2026-06-02 incident this defends against). Also surface the
  // PostgREST result body on error + use .select() so a 200-with-zero-
  // rows-updated case is visible instead of silently swallowed.
  const sb = getServiceClient();
  const { data: updated, error } = await sb
    .from('properties')
    .update(payload)
    .eq('id', id)
    .select('id');
  if (error) {
    console.error('[updateProperty] supabase error', {
      id,
      payloadKeys: Object.keys(payload),
      error,
    });
    throw new Error(error.message);
  }
  if (!updated || updated.length === 0) {
    console.error('[updateProperty] 0 rows updated', { id, payloadKeys: Object.keys(payload) });
    throw new Error(`Property ${id} not updated (0 rows affected). Check the property id.`);
  }

  revalidatePath('/properties');
  revalidatePath(`/properties/${id}`);
  revalidatePath(`/properties/${id}/info-note`);
  revalidatePath(`/properties/${id}/home-guide`);
  revalidatePath(`/properties/${id}/wifi-placard`);
  revalidatePath(`/properties/${id}/welcome-card`);
  redirect(`/properties/${id}`);
}

/**
 * Save free-form per-cell overrides for the Stay Cape Ann home guide.
 * Each cell (wifi/climate/bathrooms/parking/kitchen/trash) has an optional
 * plain-text override that REPLACES the auto-populated default in the
 * rendered guide. Empty / whitespace-only fields are stored as missing
 * (so the auto-populated default kicks back in).
 */
export async function updateHomeGuideOverrides(id: string, formData: FormData) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const keys = ['wifi', 'climate', 'bathrooms', 'parking', 'kitchen', 'trash'] as const;
  const overrides: Record<string, string> = {};
  for (const k of keys) {
    const v = String(formData.get(`override_${k}`) ?? '').trim();
    if (v) overrides[k] = v;
  }

  // Store `null` (not `{}`) when every cell is back to the default — keeps
  // the column tidy and the renderer's `?? {}` fallback fires uniformly.
  const payload = Object.keys(overrides).length > 0 ? overrides : null;

  const { error } = await supabase
    .from('properties')
    .update({ home_guide_overrides: payload })
    .eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath(`/properties/${id}`);
  revalidatePath(`/properties/${id}/home-guide`);
  redirect(`/properties/${id}#home-guide-customize`);
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

/**
 * Bespoke per-property notices — 4 × 6 Stay Cape Ann placards for
 * property-specific quirks. Persisted in `public.property_notices`. The
 * three actions below cover the full lifecycle (create / update /
 * delete); the renderer that prints each notice lives at
 * `/properties/<id>/notice/<noticeId>` and is auth-public so puppeteer
 * can hit it.
 */
function noticePayload(formData: FormData): { eyebrow: string | null; title: string; body: string } | null {
  const eyebrow = strOrNull(formData, 'eyebrow');
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  if (!title || !body) return null;
  return { eyebrow, title, body };
}

/** Create a new bespoke notice for a property. Redirects back to the property page. */
export async function createPropertyNotice(propertyId: string, formData: FormData) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const payload = noticePayload(formData);
  if (!payload) throw new Error('Title and body are required.');

  const { error } = await supabase
    .from('property_notices')
    .insert({ property_id: propertyId, ...payload });
  if (error) throw new Error(error.message);

  revalidatePath(`/properties/${propertyId}`);
  redirect(`/properties/${propertyId}`);
}

/**
 * Update an existing notice in place. Bumps updated_at so the renderer
 * knows it's been changed (useful later for showing a "last reprinted"
 * hint). Redirects back to the property page.
 */
export async function updatePropertyNotice(propertyId: string, noticeId: string, formData: FormData) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const payload = noticePayload(formData);
  if (!payload) throw new Error('Title and body are required.');

  const { error } = await supabase
    .from('property_notices')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', noticeId)
    .eq('property_id', propertyId);
  if (error) throw new Error(error.message);

  revalidatePath(`/properties/${propertyId}`);
  revalidatePath(`/properties/${propertyId}/notice/${noticeId}`);
  redirect(`/properties/${propertyId}`);
}

/**
 * Hard-delete a notice. Cascade isn't strictly needed here (notices have
 * no children), but we re-validate the property page so the tile vanishes
 * immediately. Redirects back to the property page.
 */
export async function deletePropertyNotice(propertyId: string, noticeId: string) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const { error } = await supabase
    .from('property_notices')
    .delete()
    .eq('id', noticeId)
    .eq('property_id', propertyId);
  if (error) throw new Error(error.message);

  revalidatePath(`/properties/${propertyId}`);
  redirect(`/properties/${propertyId}`);
}

/**
 * Internal per-property notes (the structured replacement for the
 * old freeform property_notes text blob). Persisted in
 * public.property_notes. Three actions cover the lifecycle (create /
 * update / delete); a one-shot toggleResolved flips resolved_at without
 * needing the full edit form.
 *
 * NOT to be confused with property_notices (one-i) above, which are
 * guest-facing printed placards.
 */
function notePayload(formData: FormData): { title: string; body: string; tag: string | null } | null {
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const tag = strOrNull(formData, 'tag');
  if (!title) return null;
  return { title, body, tag };
}

export async function createPropertyNote(propertyId: string, formData: FormData) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const payload = notePayload(formData);
  if (!payload) throw new Error('Title is required.');

  const { error } = await supabase
    .from('property_notes')
    .insert({
      property_id: propertyId,
      ...payload,
      author_email: session.user.email,
    });
  if (error) throw new Error(error.message);

  revalidatePath(`/properties/${propertyId}`);
  redirect(`/properties/${propertyId}`);
}

export async function updatePropertyNote(propertyId: string, noteId: string, formData: FormData) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const payload = notePayload(formData);
  if (!payload) throw new Error('Title is required.');

  const { error } = await supabase
    .from('property_notes')
    .update(payload)
    .eq('id', noteId)
    .eq('property_id', propertyId);
  if (error) throw new Error(error.message);

  revalidatePath(`/properties/${propertyId}`);
  redirect(`/properties/${propertyId}`);
}

export async function deletePropertyNote(propertyId: string, noteId: string) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const { error } = await supabase
    .from('property_notes')
    .delete()
    .eq('id', noteId)
    .eq('property_id', propertyId);
  if (error) throw new Error(error.message);

  revalidatePath(`/properties/${propertyId}`);
  redirect(`/properties/${propertyId}`);
}

/**
 * Flip a note's resolved state. Lets the operator close out a
 * one-shot quirk ("garage door spring replaced") without opening the
 * full edit form. Re-running on an already-resolved note un-resolves
 * it (toggle semantics).
 */
export async function togglePropertyNoteResolved(propertyId: string, noteId: string) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const { data: current, error: readErr } = await supabase
    .from('property_notes')
    .select('resolved_at')
    .eq('id', noteId)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!current) throw new Error('Note not found');

  const nextResolvedAt = current.resolved_at ? null : new Date().toISOString();
  const nextResolvedBy = nextResolvedAt ? session.user.email : null;

  const { error } = await supabase
    .from('property_notes')
    .update({ resolved_at: nextResolvedAt, resolved_by_email: nextResolvedBy })
    .eq('id', noteId)
    .eq('property_id', propertyId);
  if (error) throw new Error(error.message);

  revalidatePath(`/properties/${propertyId}`);
}
