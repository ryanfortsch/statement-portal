'use server';

import crypto from 'node:crypto';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import type { OnboardingData, CustomClause } from '@/lib/projections-types';

/** 32-hex-char random token for the public onboarding link. */
function newOnboardingToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Server actions for the Projections module.
 *
 * The form on /projections/new and /projections/[id] uses these to persist
 * inputs. All numeric form fields come in as strings; this layer parses and
 * coerces them. Percentages are entered as whole numbers in the UI (25 = 25%)
 * and stored as decimals in the DB (0.25).
 */

// ─── Form parsing ───────────────────────────────────────────────────────────
function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}
function num(formData: FormData, key: string): number {
  const raw = str(formData, key);
  const n = Number(raw.replace(/[$,]/g, ''));
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${key}: ${raw}`);
  return n;
}
function numOrNull(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const n = Number(raw.replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function pctToDecimal(formData: FormData, key: string): number {
  const raw = num(formData, key);
  return raw > 1 ? raw / 100 : raw;
}

function buildPayload(formData: FormData) {
  return {
    prospect_name: str(formData, 'prospect_name'),
    prospect_first_name: strOrNull(formData, 'prospect_first_name'),
    prospect_first_names: strOrNull(formData, 'prospect_first_names'),
    prospect_full_legal: strOrNull(formData, 'prospect_full_legal'),
    prospect_phone: strOrNull(formData, 'prospect_phone'),
    property_address: str(formData, 'property_address'),
    property_city: strOrNull(formData, 'property_city'),
    property_type: str(formData, 'property_type') || 'House',
    market: str(formData, 'market') as 'Rockport' | 'Gloucester',
    bedrooms: num(formData, 'bedrooms'),
    home_value: num(formData, 'home_value'),
    neighborhood: strOrNull(formData, 'neighborhood'),
    interior_grade: strOrNull(formData, 'interior_grade'),

    mgmt_fee_pct: pctToDecimal(formData, 'mgmt_fee_pct'),
    base_cleaning: num(formData, 'base_cleaning'),
    addl_cleaning_per_br: num(formData, 'addl_cleaning_per_br'),
    turnovers_per_year: num(formData, 'turnovers_per_year'),
    year2_growth_pct: pctToDecimal(formData, 'year2_growth_pct'),

    revenue_override_low: numOrNull(formData, 'revenue_override_low'),
    revenue_override_high: numOrNull(formData, 'revenue_override_high'),
    hero_low_override: numOrNull(formData, 'hero_low_override'),
    hero_high_override: numOrNull(formData, 'hero_high_override'),

    start_month: num(formData, 'start_month'),
    apply_ramp: str(formData, 'apply_ramp') === 'on',
    presentation_month: str(formData, 'presentation_month'),

    // Contract terms
    term_start: strOrNull(formData, 'term_start'),
    term_end: strOrNull(formData, 'term_end'),
    initial_deposit: num(formData, 'initial_deposit'),
    min_account_balance: num(formData, 'min_account_balance'),
    min_availability_days: num(formData, 'min_availability_days'),
    sale_notification_days: num(formData, 'sale_notification_days'),
    reputation_fee: num(formData, 'reputation_fee'),

    // Custom clauses (per-deal addenda). The form submits parallel arrays:
    // `custom_clause_title[]` + `custom_clause_body[]`. Zip them into the
    // jsonb shape and drop any rows where both fields are empty.
    custom_clauses: parseCustomClauses(formData),
  };
}

function parseCustomClauses(formData: FormData): CustomClause[] | null {
  const titles = formData.getAll('custom_clause_title').map((v) => String(v).trim());
  const bodies = formData.getAll('custom_clause_body').map((v) => String(v).trim());
  const len = Math.max(titles.length, bodies.length);
  const out: CustomClause[] = [];
  for (let i = 0; i < len; i++) {
    const title = titles[i] || '';
    const body = bodies[i] || '';
    if (title || body) out.push({ title, body });
  }
  return out.length ? out : null;
}

// ─── Actions ────────────────────────────────────────────────────────────────
export async function createProjection(formData: FormData) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const localPart = session.user.email.split('@')[0];
  const payload = {
    ...buildPayload(formData),
    created_by_email: session.user.email,
    created_by_name:
      session.user.name?.trim() ||
      (localPart ? localPart.charAt(0).toUpperCase() + localPart.slice(1) : 'User'),
    onboarding_token: newOnboardingToken(),
  };

  const { data, error } = await supabase
    .from('projections')
    .insert(payload)
    .select('id')
    .single();

  if (error || !data) throw new Error(error?.message || 'Failed to create projection');

  revalidatePath('/projections');
  redirect(`/projections/${data.id}`);
}

export async function updateProjection(id: string, formData: FormData) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const { error } = await supabase
    .from('projections')
    .update(buildPayload(formData))
    .eq('id', id);

  if (error) throw new Error(error.message);

  revalidatePath('/projections');
  revalidatePath(`/projections/${id}`);
  redirect(`/projections/${id}`);
}

export async function deleteProjection(id: string) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const { error } = await supabase.from('projections').delete().eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/projections');
  redirect('/projections');
}

export async function markSent(id: string) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const { error } = await supabase
    .from('projections')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(error.message);

  revalidatePath('/projections');
  revalidatePath(`/projections/${id}`);
}

/**
 * Promote a prospect into a managed property record. Copies prospect inputs
 * and onboarding answers onto a new public.properties row, links the two
 * records, and sends Dotti to the new property's detail page.
 *
 * Idempotent: if this prospect already has a property_id, redirects to it
 * rather than creating a duplicate.
 */
export async function promoteToProperty(projectionId: string) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  // Pull the prospect record
  const { data: projRow, error: projErr } = await supabase
    .from('projections')
    .select('*')
    .eq('id', projectionId)
    .maybeSingle();
  if (projErr || !projRow) throw new Error(projErr?.message || 'Prospect not found');

  // Already promoted? Just go there.
  const existing = projRow.property_id as string | null;
  if (existing) {
    redirect(`/properties/${existing}`);
  }

  const ob = (projRow.onboarding_data ?? {}) as OnboardingData;
  const propertyId = await pickPropertyId(projRow.property_address as string);

  const ownerFull = projRow.prospect_full_legal || projRow.prospect_name;
  const ownerGreeting = projRow.prospect_first_names || projRow.prospect_first_name || ownerFull;
  // Last name = last whitespace-separated token of full name. Falls back to
  // the whole name for single-token owners.
  const ownerLast = (() => {
    const parts = String(ownerFull).trim().split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : ownerFull;
  })();

  // properties.management_fee_pct is stored as a whole number (25), while
  // projections.mgmt_fee_pct is decimal (0.25). Convert.
  const feePct = Math.round(Number(projRow.mgmt_fee_pct) * 100);

  const ownerEmails = ob.email ? [ob.email] : [];

  const propertyPayload = {
    id: propertyId,
    name: String(projRow.property_address),
    address: String(projRow.property_address),
    city: projRow.property_city || '',
    type_of_unit: projRow.property_type || null,
    is_active: true,
    is_rising_tide_owned: false,

    owner_last: ownerLast,
    owner_full: ownerFull,
    owner_greeting: ownerGreeting,
    owner_emails: ownerEmails,
    owner_phone: ob.phone || projRow.prospect_phone || null,
    owner_mailing_address: ob.mailing_address || null,
    owner_preferred_contact: ob.preferred_contact || null,

    management_fee_pct: feePct,

    // Property characteristics (prefer onboarding answers; fall back to
    // projection inputs where they overlap)
    bedrooms: numOr(ob.bedrooms, projRow.bedrooms as number),
    bathrooms: numOr(ob.bathrooms, null),
    square_feet: numOr(ob.square_feet, null),
    livable_floors: numOr(ob.livable_floors, null),
    basement: ob.basement || null,
    parking: ob.parking || null,
    hoa: ob.hoa || null,

    electricity_provider: ob.electricity_provider || null,
    heating: ob.heating || null,
    cooling: ob.cooling || null,
    internet_provider: ob.internet_provider || null,
    cable_provider: ob.cable_provider || null,
    wifi_name: ob.wifi_name || null,
    wifi_password: ob.wifi_password || null,
    num_tvs: numOr(ob.num_tvs, null),
    smart_tv: ob.smart_tv || null,

    currently_listed: ob.currently_listed || null,
    existing_listing_urls: ob.listing_urls || null,
    str_registration_id: ob.str_registration || null,
    str_insurance_carrier: ob.str_insurance || null,
    guest_access_method: ob.guest_access_method || null,
    smart_lock_brand: ob.smart_lock_brand || null,
    smart_lock_code: ob.smart_lock_code || null,
    security_cameras: ob.security_cameras || null,

    key_code_location: ob.key_code_location || null,
    alarm_system: ob.alarm_system || null,
    known_issues: ob.known_issues || null,
    upcoming_maintenance: ob.upcoming_maintenance || null,
    property_notes: ob.notes || null,

    emergency_contact_name: ob.emergency_name || null,
    emergency_contact_relationship: ob.emergency_relationship || null,
    emergency_contact_phone: ob.emergency_phone || null,
    emergency_contact_email: ob.emergency_email || null,

    projection_id: projectionId,
  };

  const { error: insertErr } = await supabase.from('properties').insert(propertyPayload);
  if (insertErr) throw new Error(insertErr.message);

  // Wire the back-reference on the prospect side so the link is bidirectional.
  const { error: linkErr } = await supabase
    .from('projections')
    .update({ property_id: propertyId })
    .eq('id', projectionId);
  if (linkErr) throw new Error(linkErr.message);

  revalidatePath(`/projections/${projectionId}`);
  revalidatePath('/properties');
  revalidatePath(`/properties/${propertyId}`);
  redirect(`/properties/${propertyId}`);
}

/**
 * Slugify the property address into a stable, human-readable id. Mirrors the
 * existing convention (e.g. "21 Horton St" → "21_horton"). Drops common
 * street suffixes; if the slug collides, suffixes _2, _3, etc.
 */
async function pickPropertyId(address: string): Promise<string> {
  const base = slugifyAddress(address);
  if (!base) throw new Error('Could not derive a property id from the address');

  // Probe for collisions; cheap because the table is small.
  const { data: existing } = await supabase
    .from('properties')
    .select('id')
    .ilike('id', `${base}%`);
  const taken = new Set((existing ?? []).map((r: { id: string }) => r.id));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Couldn't find a free property id for ${base}`);
}

function slugifyAddress(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/,.*$/, '')                                     // drop city/state suffix
    .replace(/[.'']/g, '')                                   // strip punctuation
    .replace(/\b(st|rd|ave|lane|ln|way|road|street|avenue|drive|dr|circle|cir|court|ct|place|pl|terrace|ter|boulevard|blvd)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join('_');
}

function numOr<T>(maybe: string | undefined | null, fallback: T): number | T {
  if (maybe == null || maybe === '') return fallback;
  const n = Number(String(maybe).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Public-facing: an owner signs the management contract. No auth — gated by
 * knowledge of the token. Captures a typed name + audit fields (timestamp,
 * IP, user agent) sufficient for ESIGN/UETA compliance on residential STR
 * contracts in MA.
 *
 * Idempotent: if already signed, redirects to the thanks page rather than
 * overwriting the prior signature.
 */
export async function submitContractSignature(formData: FormData) {
  const token = String(formData.get('token') || '').trim();
  if (!token || !/^[a-f0-9]{32}$/.test(token)) throw new Error('Invalid contract link');

  const agreed = formData.get('agree') === 'on';
  const name = String(formData.get('signed_name') || '').trim();
  if (!agreed) throw new Error('You must check "I agree" to sign.');
  if (name.length < 3) throw new Error('Type your full legal name to sign.');

  // Pull the projection. Skip if already signed (idempotent).
  const { data: existing, error: lookupErr } = await supabase
    .from('projections')
    .select('id, contract_signed_at')
    .eq('onboarding_token', token)
    .maybeSingle();
  if (lookupErr || !existing) throw new Error(lookupErr?.message || 'Contract not found');
  if (existing.contract_signed_at) {
    redirect(`/contract/${token}/signed`);
  }

  // Audit fields. Forwarded-for first hop is the originating client IP on
  // Vercel; fall back to x-real-ip if a different proxy chain is in use.
  const h = await headers();
  const xff = h.get('x-forwarded-for') || '';
  const ip = xff.split(',')[0].trim() || h.get('x-real-ip') || '';
  const ua = h.get('user-agent') || '';

  const { error } = await supabase
    .from('projections')
    .update({
      contract_signed_at: new Date().toISOString(),
      contract_signed_name: name,
      contract_signed_ip: ip || null,
      contract_signed_user_agent: ua || null,
    })
    .eq('onboarding_token', token);

  if (error) throw new Error(error.message);

  revalidatePath(`/contract/${token}`);
  revalidatePath(`/projections/${existing.id}`);
  redirect(`/contract/${token}/signed`);
}

/**
 * Public-facing: an owner submits the onboarding form. No auth — gated by
 * knowledge of the token. The token comes in as a hidden field.
 */
export async function submitOnboarding(formData: FormData) {
  const token = String(formData.get('token') || '').trim();
  if (!token || !/^[a-f0-9]{32}$/.test(token)) throw new Error('Invalid onboarding link');

  // Pull every field from the form into the JSONB payload. Empty strings
  // become undefined so we don't bloat the record with junk.
  const ALL_FIELDS: (keyof OnboardingData)[] = [
    'full_name', 'phone', 'email', 'mailing_address', 'preferred_contact',
    'property_address', 'property_type', 'hoa', 'bedrooms', 'bathrooms',
    'square_feet', 'livable_floors', 'basement', 'parking',
    'electricity_provider', 'heating', 'cooling', 'internet_provider',
    'cable_provider', 'wifi_name', 'wifi_password', 'num_tvs', 'smart_tv',
    'currently_listed', 'listing_urls', 'str_registration', 'str_insurance',
    'guest_access_method', 'smart_lock_brand', 'smart_lock_code', 'security_cameras',
    'key_code_location', 'alarm_system', 'known_issues', 'upcoming_maintenance', 'notes',
    'emergency_name', 'emergency_relationship', 'emergency_phone', 'emergency_email',
  ];

  const data: OnboardingData = {};
  for (const f of ALL_FIELDS) {
    const v = String(formData.get(f) ?? '').trim();
    if (v) data[f] = v;
  }

  const { error } = await supabase
    .from('projections')
    .update({
      onboarding_data: data,
      onboarding_submitted_at: new Date().toISOString(),
    })
    .eq('onboarding_token', token);

  if (error) throw new Error(error.message);

  // Revalidate the public form (so it shows the thank-you state on refresh)
  revalidatePath(`/onboarding/${token}`);
  redirect(`/onboarding/${token}/thanks`);
}
