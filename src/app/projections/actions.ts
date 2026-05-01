'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';

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
    property_address: str(formData, 'property_address'),
    property_city: strOrNull(formData, 'property_city'),
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
    presentation_month: str(formData, 'presentation_month'),
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
