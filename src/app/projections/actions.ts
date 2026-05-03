'use server';

import crypto from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import type { OnboardingData } from '@/lib/projections-types';

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
  };
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
