'use server';

import { revalidatePath } from 'next/cache';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import {
  LAUNCH_STEPS,
  buildInitialLaunchSteps,
  type LaunchStepStatus,
} from '@/lib/launch-checklist';

/** Service-role client for writes to the RLS-protected `properties`
 *  table (same posture as src/app/properties/actions.ts — the anon
 *  path has repeatedly dropped property writes via the PostgREST
 *  schema-cache / column-grants edge cases). The launch_steps table
 *  itself is permissive, so its writes stay on the anon client. */
function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return createClient(url, key);
}

/**
 * Field-writethrough actions: the four launch steps whose action is a
 * `set_*` map 1:1 to a real property column. Typing the value on the
 * step writes the actual column here, and the launch page's existing
 * deriveStepResolved() then auto-ticks the step — so the checklist
 * becomes the data-entry surface instead of an inert note + a bounce
 * to another page.
 */
const FIELD_ACTION_COLUMN: Record<string, 'title' | 'tax_cert_id' | 'bank_last4' | 'listing_match'> = {
  set_external_title: 'title',
  set_tax_cert: 'tax_cert_id',
  set_bank_last4: 'bank_last4',
  set_listing_match: 'listing_match',
};

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
 * Write a launch step's value straight onto its property column. The
 * step auto-resolves on the next render via deriveStepResolved() once
 * the column is populated, so the caller doesn't set status here.
 *
 * `action` is the step's `set_*` action; only the four mapped in
 * FIELD_ACTION_COLUMN are accepted. Returns { ok, error } so the card
 * can show an inline error instead of throwing.
 */
export async function setLaunchStepField(
  propertyId: string,
  action: string,
  rawValue: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const column = FIELD_ACTION_COLUMN[action];
  if (!column) return { ok: false, error: 'This step has no editable field.' };

  let value = rawValue.trim();
  if (!value) return { ok: false, error: 'Enter a value first.' };

  // Per-field validation + normalization.
  if (column === 'bank_last4') {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 4) return { ok: false, error: 'Bank last 4 must be exactly 4 digits.' };
    value = digits;
  } else if (column === 'listing_match') {
    // Stored lowercase — it's matched as a case-insensitive substring
    // against incoming Guesty listing names in the statement ingest.
    value = value.toLowerCase();
  }

  const sb = getServiceClient();
  const { data: updated, error } = await sb
    .from('properties')
    .update({ [column]: value })
    .eq('id', propertyId)
    .select('id');
  if (error) {
    console.error('[setLaunchStepField] supabase error', { propertyId, column, error });
    return { ok: false, error: `Save failed: ${error.message}` };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, error: `Property ${propertyId} not found.` };
  }

  // The step's resolved state is derived from the column, so revalidate
  // the launch page (recomputes done/remaining) and the property page +
  // its deliverables, which also read these fields.
  revalidatePath(`/properties/${propertyId}/launch`);
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath(`/properties/${propertyId}/home-guide`);
  revalidatePath(`/properties/${propertyId}/wifi-placard`);
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
