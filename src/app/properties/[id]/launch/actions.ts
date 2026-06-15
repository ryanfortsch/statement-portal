'use server';

import { revalidatePath } from 'next/cache';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import {
  LAUNCH_STEPS,
  LAUNCH_STEP_FIELDS,
  buildInitialLaunchSteps,
  type LaunchStepStatus,
} from '@/lib/launch-checklist';

/** Service-role client — writes to `properties` (stricter RLS than
 *  property_launch_steps). Same rationale as src/app/properties/actions.ts. */
function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return createClient(url, key);
}

/**
 * Server actions for the per-property launch checklist
 * (/properties/[id]/launch). Status changes and notes save through here.
 *
 * The table's RLS is permissive (matches the rest of Helm's "anyone signed
 * in" model), so the public anon client is enough for these updates — no
 * service role needed.
 */

const VALID_STATUSES: ReadonlyArray<LaunchStepStatus> = [
  'todo',
  'in_progress',
  'done',
  'skipped',
  'n_a',
];

const VALID_STEP_KEYS = new Set(LAUNCH_STEPS.map((s) => s.key));

/**
 * Set the status of a single step. completed_at + completed_by are stamped
 * when the new status is "done"; cleared on any other status.
 */
export async function setLaunchStepStatus(
  propertyId: string,
  stepKey: string,
  status: LaunchStepStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  if (!VALID_STEP_KEYS.has(stepKey)) return { ok: false, error: 'Unknown step' };
  if (!VALID_STATUSES.includes(status)) return { ok: false, error: 'Invalid status' };

  const completedAt = status === 'done' ? new Date().toISOString() : null;
  const completedBy = status === 'done' ? session.user.email : null;

  const { error } = await supabase
    .from('property_launch_steps')
    .update({
      status,
      completed_at: completedAt,
      completed_by: completedBy,
    })
    .eq('property_id', propertyId)
    .eq('step_key', stepKey);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/properties/${propertyId}/launch`);
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath('/properties');
  return { ok: true };
}

/**
 * Write a field-backed step's value straight onto the property column it
 * represents (external_title → properties.title, bank_last4, tax_cert →
 * tax_cert_id, guesty_listing_match → guesty_listing_id). This is the
 * "feed through the piping" path: the value lands on the real record that
 * statements / deliverables / Guesty-match read, and deriveStepResolved
 * then auto-resolves the step from that same column — no separate
 * "mark done" click. Uses the service role because `properties` rejects
 * anon writes.
 */
export async function setLaunchStepField(
  propertyId: string,
  stepKey: string,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const field = LAUNCH_STEP_FIELDS[stepKey];
  if (!field) return { ok: false, error: 'This step has no inline field' };

  const v = value.trim();
  if (field.column === 'bank_last4' && v && !/^\d{4}$/.test(v)) {
    return { ok: false, error: 'Bank last 4 must be exactly 4 digits' };
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from('properties')
    .update({ [field.column]: v || null })
    .eq('id', propertyId)
    .select('id');
  if (error) return { ok: false, error: `Save failed: ${error.message}` };
  if (!data || data.length === 0) return { ok: false, error: `Property ${propertyId} not found` };

  revalidatePath(`/properties/${propertyId}/launch`);
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath('/properties');
  return { ok: true };
}

/**
 * Replace the notes on a single step. Empty string clears the field.
 */
export async function setLaunchStepNotes(
  propertyId: string,
  stepKey: string,
  notes: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  if (!VALID_STEP_KEYS.has(stepKey)) return { ok: false, error: 'Unknown step' };

  const trimmed = notes.trim();
  const { error } = await supabase
    .from('property_launch_steps')
    .update({ notes: trimmed.length === 0 ? null : trimmed })
    .eq('property_id', propertyId)
    .eq('step_key', stepKey);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/properties/${propertyId}/launch`);
  return { ok: true };
}

/**
 * Idempotent: seeds rows for any steps that don't have a row yet for this
 * property. Used by the launch page on load so a property whose checklist
 * was never seeded (or whose canonical step list grew after seeding) shows
 * every step. Existing rows are left alone — never overwrites operator-set
 * status.
 */
export async function ensureLaunchStepsSeeded(propertyId: string): Promise<void> {
  const session = await auth();
  // Unauthed reads (e.g. preflight from the masthead) are a no-op rather than
  // an error — the page itself enforces auth via the masthead's nav.
  if (!session?.user?.email) return;

  const { data: existing, error } = await supabase
    .from('property_launch_steps')
    .select('step_key')
    .eq('property_id', propertyId);
  if (error) return; // table might not exist yet on preview envs

  const haveKeys = new Set((existing ?? []).map((r: { step_key: string }) => r.step_key));
  const seed = buildInitialLaunchSteps(propertyId, session.user.email).filter(
    (row) => !haveKeys.has(row.step_key),
  );
  if (seed.length === 0) return;

  // NOTE: do NOT call revalidatePath here. This runs awaited during the
  // launch page's render (a backstop seed), and revalidatePath during
  // render THROWS in Next 16 — which crashed the launch page for every
  // newly-promoted property (16 Waterman, 36 Granite, 84 Thatcher) whose
  // missing rows hit this seed branch on first load. The page is
  // force-dynamic and reads the freshly-inserted rows later in the same
  // render via getLaunchSteps, so no revalidation is needed.
  try {
    await supabase.from('property_launch_steps').insert(seed);
  } catch {
    // Best-effort: a failed backstop seed shouldn't take the page down.
  }
}
