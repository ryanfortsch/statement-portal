'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { put, del } from '@vercel/blob';
import { auth } from '@/auth';
import { formatUsPhone } from '@/lib/phone';
import { supabase } from '@/lib/supabase';
import { upsertPropertyAccess } from '@/lib/property-access';
import type { DocumentCategory } from '@/lib/property-documents';

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

function phoneOrNull(formData: FormData, key: string): string | null {
  const v = strOrNull(formData, key);
  return v ? formatUsPhone(v) : null;
}

/** Owner name/greeting are stored NOT NULL (empty string default), so an
 *  empty form field clears to '' rather than null. */
function strOrEmpty(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

/** owner_emails is a text[] column. The form submits a comma / newline /
 *  semicolon-separated string; split, trim, drop empties, dedupe
 *  (case-insensitively) preserving first-seen casing. */
function emailList(formData: FormData, key: string): string[] {
  const raw = String(formData.get(key) ?? '');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]+/)) {
    const e = part.trim();
    if (!e) continue;
    const lower = e.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(e);
  }
  return out;
}

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

  const result = await performPropertyUpdate(id, formData);
  if (result.error) throw new Error(result.error);

  redirect(`/properties/${id}`);
}

/**
 * useActionState-compatible variant. Returns `{ error }` instead of
 * throwing, so the edit form can re-render WITH the user's typed
 * values intact and an inline error banner — rather than the dead
 * "server error occurred" page that ate Dotti's 30 Woodward data on
 * 2026-06-12 (and several edits before it). Redirects on success.
 */
export type UpdatePropertyState = { error: string | null };

export async function updatePropertyWithState(
  id: string,
  _prevState: UpdatePropertyState,
  formData: FormData,
): Promise<UpdatePropertyState> {
  const session = await auth();
  if (!session?.user?.email) return { error: 'Not signed in. Refresh and sign in again.' };

  const result = await performPropertyUpdate(id, formData);
  if (result.error) return { error: result.error };

  redirect(`/properties/${id}`);
}

/** Shared core: build payload, write via service role, revalidate.
 *  Returns { error } rather than throwing so both wrappers above can
 *  choose their own failure surface. Never throws on DB problems. */
async function performPropertyUpdate(
  id: string,
  formData: FormData,
): Promise<{ error: string | null }> {
  const payload = {
    // Owner identity + contact. owner_full / owner_greeting are NOT NULL
    // columns (empty-string default); owner_emails is a text[]. The
    // statement send list reads owner_emails, so editing it here is how
    // an operator wires up who receives the monthly statement.
    owner_full: strOrEmpty(formData, 'owner_full'),
    owner_greeting: strOrEmpty(formData, 'owner_greeting'),
    owner_emails: emailList(formData, 'owner_emails'),
    // Normalize to house format at save time -- "(781) 223-1091" --
    // so the DB converges to the pretty form no matter how the digits
    // were typed. Unparseable values pass through untouched.
    owner_phone: phoneOrNull(formData, 'owner_phone'),
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
    wifi_label: strOrNull(formData, 'wifi_label'),
    wifi_name_2: strOrNull(formData, 'wifi_name_2'),
    wifi_label_2: strOrNull(formData, 'wifi_label_2'),
    num_tvs: intOrNull(formData, 'num_tvs'),
    smart_tv: strOrNull(formData, 'smart_tv'),

    // STR setup
    currently_listed: strOrNull(formData, 'currently_listed'),
    existing_listing_urls: strOrNull(formData, 'existing_listing_urls'),
    str_registration_id: strOrNull(formData, 'str_registration_id'),
    str_insurance_carrier: strOrNull(formData, 'str_insurance_carrier'),
    guest_access_method: strOrNull(formData, 'guest_access_method'),
    smart_lock_brand: strOrNull(formData, 'smart_lock_brand'),
    security_cameras: strOrNull(formData, 'security_cameras'),

    // Smart thermostat (Utilities subsection on the edit page).
    thermostat_brand: strOrNull(formData, 'thermostat_brand'),

    // Property access & notes
    known_issues: strOrNull(formData, 'known_issues'),
    upcoming_maintenance: strOrNull(formData, 'upcoming_maintenance'),
    // property_notes is no longer a column — it lives in
    // public.property_notes as one row per discrete note. See the
    // createPropertyNote / updatePropertyNote actions below.

    // Emergency contact
    emergency_contact_name: strOrNull(formData, 'emergency_contact_name'),
    emergency_contact_relationship: strOrNull(formData, 'emergency_contact_relationship'),
    emergency_contact_phone: phoneOrNull(formData, 'emergency_contact_phone'),
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

  // Read the existing structured owners[] so we can merge the scalar
  // Owner block edits (owner_full / owner_phone / owner_emails) INTO
  // the primary owner card without wiping any additional cards (spouse,
  // accountant, alternate phone) the operator has added via the
  // OwnersEditor. This is what makes "enter the phone once at the top
  // and it flows into the messaging pipeline" work.
  const { data: currentRow, error: readErr } = await sb
    .from('properties')
    .select('owners')
    .eq('id', id)
    .maybeSingle();
  if (readErr) {
    console.error('[updateProperty] read-before-merge failed', { id, readErr });
  }
  const mergedOwners = mergePrimaryOwnerFromScalars(currentRow?.owners, {
    owner_full: payload.owner_full,
    owner_greeting: payload.owner_greeting,
    owner_emails: payload.owner_emails,
    owner_phone: payload.owner_phone,
  });
  const payloadWithOwners = { ...payload, owners: mergedOwners };

  const { data: updated, error } = await sb
    .from('properties')
    .update(payloadWithOwners)
    .eq('id', id)
    .select('id');
  if (error) {
    console.error('[updateProperty] supabase error', {
      id,
      payloadKeys: Object.keys(payload),
      error,
    });
    return { error: `Save failed: ${error.message}` };
  }
  if (!updated || updated.length === 0) {
    console.error('[updateProperty] 0 rows updated', { id, payloadKeys: Object.keys(payload) });
    return { error: `Property ${id} not updated (0 rows affected). Check the property id.` };
  }

  // Sensitive entry credentials live on the RLS-locked property_access table
  // (not the anon-readable properties table). Write them there. strOrNull
  // gives '' -> null so a cleared field clears the column.
  const { error: accessErr } = await upsertPropertyAccess(id, {
    wifi_password: strOrNull(formData, 'wifi_password'),
    wifi_password_2: strOrNull(formData, 'wifi_password_2'),
    smart_lock_code: strOrNull(formData, 'smart_lock_code'),
    thermostat_code: strOrNull(formData, 'thermostat_code'),
    key_code_location: strOrNull(formData, 'key_code_location'),
    alarm_system: strOrNull(formData, 'alarm_system'),
    gate_code: strOrNull(formData, 'gate_code'),
    garage_code: strOrNull(formData, 'garage_code'),
  });
  if (accessErr) {
    console.error('[updateProperty] property_access upsert failed', { id, accessErr });
    return { error: `Saved most fields, but the access codes didn't save: ${accessErr}` };
  }

  revalidatePath('/properties');
  revalidatePath(`/properties/${id}`);
  revalidatePath(`/properties/${id}/info-note`);
  revalidatePath(`/properties/${id}/home-guide`);
  revalidatePath(`/properties/${id}/wifi-placard`);
  revalidatePath(`/properties/${id}/welcome-card`);
  return { error: null };
}

/**
 * Save the home guide customization for one property. The guide has six
 * cells: slots 1-4 are fixed (Wi-Fi, Climate, Parking, Trash) with
 * optional free-form body overrides; slots 5-6 are picker-driven from
 * HOME_GUIDE_CATALOG with optional body / custom-title overrides.
 *
 * Empty fields are omitted from the persisted blob, and an all-empty
 * submission writes null so future loads use the auto-populated defaults.
 *
 * Uses the service-role client for the same reason updateProperty does
 * — anon writes silently dropped on this column in the 2026-06-02
 * incident.
 */
export async function updateHomeGuideOverrides(id: string, formData: FormData) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  type Slot = { key: string; body?: string; customTitle?: string };
  const overrides: {
    wifi?: string;
    climate?: string;
    parking?: string;
    trash?: string;
    slot5?: Slot;
    slot6?: Slot;
  } = {};

  // Fixed cells 1-4: free-form body overrides only.
  for (const k of ['wifi', 'climate', 'parking', 'trash'] as const) {
    const v = String(formData.get(`override_${k}`) ?? '').trim();
    if (v) overrides[k] = v;
  }

  // Picker slots 5-6: catalog key + optional body + optional custom title.
  for (const slotName of ['slot5', 'slot6'] as const) {
    const key = String(formData.get(`${slotName}_key`) ?? '').trim();
    if (!key) continue;
    const body = String(formData.get(`${slotName}_body`) ?? '').trim();
    const customTitle = String(formData.get(`${slotName}_custom_title`) ?? '').trim();
    const slot: Slot = { key };
    if (body) slot.body = body;
    if (key === 'custom' && customTitle) slot.customTitle = customTitle;
    overrides[slotName] = slot;
  }

  // Store null (not {}) when nothing was customized — keeps the column
  // tidy and the renderer's `?? {}` fallback fires uniformly.
  const payload = Object.keys(overrides).length > 0 ? overrides : null;

  const sb = getServiceClient();
  const { data: updated, error } = await sb
    .from('properties')
    .update({ home_guide_overrides: payload })
    .eq('id', id)
    .select('id');
  if (error) {
    console.error('[updateHomeGuideOverrides] supabase error', { id, error });
    throw new Error(error.message);
  }
  if (!updated || updated.length === 0) {
    throw new Error(`Property ${id} not updated (0 rows affected).`);
  }

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
 * Structured owner cards for a property. Backs the inline OwnersEditor on
 * the property detail page (and feeds the Owner Messaging pipeline via the
 * stay-concierge sync endpoint). The existing scalar columns (owner_full,
 * owner_emails, etc) stay as-is for statements + contracts; this is purely
 * additive data that lets us identify owners by phone/email on inbound
 * messages.
 *
 * Each owner card: { first_name, last_name, email, phone, is_primary,
 * role, notes }. Phone is normalized to E.164 client-side and re-checked
 * here. Empty cards are dropped.
 */
export type OwnerCard = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  is_primary: boolean;
  role: string;
  notes: string;
};

const PHONE_DIGITS_RE = /\D/g;

function normalizeOwnerCards(input: unknown): OwnerCard[] {
  if (!Array.isArray(input)) return [];
  const out: OwnerCard[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const first_name = String(r.first_name ?? '').trim();
    const last_name = String(r.last_name ?? '').trim();
    const email = String(r.email ?? '').trim().toLowerCase();
    let phone = String(r.phone ?? '').trim();
    if (phone) {
      const digits = phone.replace(PHONE_DIGITS_RE, '');
      if (digits.length === 10) phone = `+1${digits}`;
      else if (digits.length === 11 && digits.startsWith('1')) phone = `+${digits}`;
      else if (phone.startsWith('+')) phone = `+${digits}`;
      else phone = `+${digits}`;
    }
    const is_primary = Boolean(r.is_primary);
    const role = String(r.role ?? '').trim() || 'owner';
    const notes = String(r.notes ?? '').trim();
    // Drop fully empty cards
    if (!first_name && !last_name && !email && !phone) continue;
    out.push({ first_name, last_name, email, phone, is_primary, role, notes });
  }
  // Ensure at most one is_primary; if none flagged, mark the first one.
  let foundPrimary = false;
  for (const c of out) {
    if (c.is_primary && !foundPrimary) foundPrimary = true;
    else c.is_primary = false;
  }
  if (!foundPrimary && out.length > 0) out[0].is_primary = true;
  return out;
}

/**
 * Derive a primary owner card from the existing scalar Owner block
 * fields (owner_full / owner_greeting / owner_emails / owner_phone) and
 * merge it INTO the property's existing structured owners[], preserving
 * any additional non-primary cards the operator has added through the
 * OwnersEditor.
 *
 * Behavior:
 *  - If the scalars carry any identity data (any of name / phone /
 *    email), build / replace the primary card from them.
 *  - Always preserve non-primary cards untouched.
 *  - Preserve `notes` on the existing primary card so the operator
 *    doesn't lose context when they edit the Owner block.
 *  - If there is no scalar data AND no existing cards, return [].
 *  - If there is no scalar data but cards exist, just renormalize.
 *
 * Name parsing:
 *  - first_name: owner_greeting if set, else first word of owner_full's
 *    first comma-separated chunk (drops org names after the comma).
 *  - last_name: last word of that same chunk after stripping any
 *    "& Partner" / "and Partner" segments (so "Marci & Paul Bailey"
 *    yields first=Marci last=Bailey).
 */
function parseFirstLastFromOwnerFull(
  ownerFull: string,
  ownerGreeting: string,
): { first_name: string; last_name: string } {
  const beforeComma = ownerFull.split(',')[0].trim();
  // Strip "& Partner" / "and Partner" segments (couples).
  let chunk = beforeComma.replace(/\s+(?:&|and)\s+\S+/gi, '').trim();
  // Strip the templated "The X Family" / "X Family" wrapper so the
  // actual surname becomes the last word ("The McWethy Family" -> "McWethy").
  chunk = chunk.replace(/^the\s+/i, '').replace(/\s+family$/i, '').trim();
  const words = (chunk || beforeComma).split(/\s+/).filter(Boolean);
  // Trailing commas / trailing punctuation creep in via copy-paste
  // ("John Gavin," in owner_greeting). Strip them off the first name.
  const greeting = ownerGreeting.trim().replace(/[,;:.]+$/, '').trim();
  const first = greeting || words[0] || '';
  const last = words.length > 1
    ? words[words.length - 1]
    : (greeting && words[0] ? words[0] : '');
  return { first_name: first, last_name: last };
}

function mergePrimaryOwnerFromScalars(
  existing: unknown,
  scalars: {
    owner_full: string;
    owner_greeting: string;
    owner_emails: string[];
    owner_phone: string | null;
  },
): OwnerCard[] {
  const existingCards = Array.isArray(existing) ? (existing as unknown[]) : [];
  const { owner_full, owner_greeting, owner_emails, owner_phone } = scalars;
  const hasScalarData =
    !!owner_full.trim() ||
    !!(owner_phone && owner_phone.trim()) ||
    (Array.isArray(owner_emails) && owner_emails.length > 0);

  if (!hasScalarData) {
    // No scalar identity data — leave the existing array intact (just
    // renormalize for safety: phone E.164, single is_primary, etc).
    return normalizeOwnerCards(existingCards);
  }

  const { first_name, last_name } = parseFirstLastFromOwnerFull(owner_full, owner_greeting);
  const email = (owner_emails[0] || '').trim();

  // Find the existing primary (preserve its notes); fall back to first card.
  let primaryIdx = -1;
  for (let i = 0; i < existingCards.length; i++) {
    const c = existingCards[i] as Record<string, unknown> | null;
    if (c && c.is_primary === true) {
      primaryIdx = i;
      break;
    }
  }
  if (primaryIdx === -1 && existingCards.length > 0) primaryIdx = 0;
  const existingPrimary =
    primaryIdx >= 0 ? (existingCards[primaryIdx] as Record<string, unknown>) : null;
  const preservedNotes = String(existingPrimary?.notes ?? '').trim();

  const primaryCard = {
    first_name,
    last_name,
    email,
    phone: owner_phone || '',
    is_primary: true,
    role: 'owner',
    notes: preservedNotes,
  };

  const others = existingCards
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => i !== primaryIdx)
    .map(({ c }) => ({ ...(c as Record<string, unknown>), is_primary: false }));

  return normalizeOwnerCards([primaryCard, ...others]);
}

export async function saveOwnerCards(
  propertyId: string,
  rawOwners: unknown,
): Promise<{ ok: true; owners: OwnerCard[] } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!propertyId) return { ok: false, error: 'Missing property id' };

  const owners = normalizeOwnerCards(rawOwners);

  const { error } = await supabase
    .from('properties')
    .update({ owners })
    .eq('id', propertyId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/properties/${propertyId}`);
  revalidatePath('/properties');
  return { ok: true, owners };
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

// ─── Documents (Documents tab) ──────────────────────────────────────

const DOC_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const DOC_ALLOWED = new Set([
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/heif', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
]);
const VALID_DOC_CATEGORIES = new Set<DocumentCategory>([
  'contract', 'insurance', 'tax', 'inspection', 'financial', 'other',
]);

export type UploadDocumentState = { error: string | null };

/**
 * useActionState-compatible document upload. Validates type + size,
 * pushes the file to Vercel Blob (public access + random suffix, same
 * store as photos), and inserts a property_documents row. Returns
 * { error } rather than throwing so the panel shows an inline message
 * and keeps the form values — same failure-soft pattern as the property
 * edit form.
 */
export async function uploadPropertyDocument(
  propertyId: string,
  _prev: UploadDocumentState,
  formData: FormData,
): Promise<UploadDocumentState> {
  const session = await auth();
  if (!session?.user?.email) return { error: 'Not signed in.' };
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { error: 'Document storage not configured (no Blob store on this project).' };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a file to upload.' };
  if (!DOC_ALLOWED.has(file.type)) {
    return { error: `Unsupported file type (${file.type || 'unknown'}). PDF, image, Word, Excel, CSV, or text.` };
  }
  if (file.size > DOC_MAX_BYTES) {
    return { error: `File too large (${Math.round(file.size / 1024 / 1024)} MB). Max is 25 MB.` };
  }

  const rawCat = String(formData.get('category') ?? 'other') as DocumentCategory;
  const category: DocumentCategory = VALID_DOC_CATEGORIES.has(rawCat) ? rawCat : 'other';
  const label = String(formData.get('label') ?? '').trim() || file.name;

  let url: string;
  try {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) || 'document';
    const blob = await put(`property-docs/${propertyId}/${Date.now()}-${safeName}`, file, {
      access: 'public',
      addRandomSuffix: true,
      contentType: file.type || 'application/octet-stream',
    });
    url = blob.url;
  } catch (err) {
    return { error: `Upload failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const sb = getServiceClient();
  const { error } = await sb.from('property_documents').insert({
    property_id: propertyId,
    label,
    category,
    file_url: url,
    file_name: file.name,
    mime: file.type || null,
    size_bytes: file.size,
    source: 'upload',
    uploaded_by_email: session.user.email,
  });
  if (error) {
    console.error('[uploadPropertyDocument] insert failed', { propertyId, error });
    return { error: `Saved the file but couldn't record it: ${error.message}` };
  }

  revalidatePath(`/properties/${propertyId}`);
  return { error: null };
}

/** Delete a document: remove the blob (best-effort) then the row. */
export async function deletePropertyDocument(propertyId: string, documentId: string) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const sb = getServiceClient();
  const { data: doc } = await sb
    .from('property_documents')
    .select('file_url')
    .eq('id', documentId)
    .eq('property_id', propertyId)
    .maybeSingle();

  const fileUrl = (doc as { file_url: string } | null)?.file_url;
  if (fileUrl && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      await del(fileUrl);
    } catch {
      // Blob already gone / not ours — drop the row anyway.
    }
  }

  const { error } = await sb
    .from('property_documents')
    .delete()
    .eq('id', documentId)
    .eq('property_id', propertyId);
  if (error) throw new Error(error.message);

  revalidatePath(`/properties/${propertyId}`);
}
