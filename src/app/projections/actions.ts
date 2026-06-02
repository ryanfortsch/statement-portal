'use server';

import crypto from 'node:crypto';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import type {
  OnboardingData,
  CustomClause,
  Owner,
  ProjectionRow,
  ReadinessState,
} from '@/lib/projections-types';
import { deriveLegacyFromOwners } from '@/lib/projections-types';
import { getDriveTimeMinutes } from '@/lib/projections-distance';
import { geocodeAddress } from '@/lib/geocode';
import {
  interpretContractRedlines,
  applyEditsToProjection,
  type ContractRedlineEdits,
} from '@/lib/projection-redlines';
import { applyContractOverrides, describeOverrideFailure } from '@/lib/contract-overrides';
import {
  sendOwnerSignedEmail,
  sendExecutedEmail,
  sendCountersignNotification,
  fetchContractPdf,
} from '@/lib/contract-email';
import { archiveContractToDrive, isDriveArchiveConfigured } from '@/lib/drive-archive';
import { sendOnboardingSubmittedEmail } from '@/lib/onboarding-email';
import { sendReadinessReviewEmail } from '@/lib/readiness-email';
import { buildInitialLaunchSteps } from '@/lib/launch-checklist';

/**
 * Build an absolute origin URL for use by server-side Puppeteer renders.
 * Reads the request's forwarded host so the spawned PDF render hits the
 * same deployment that's serving the action (preview / prod / local).
 */
async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host') || '';
  const proto = h.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : '';
}

/**
 * Service-role Supabase client for writes to RLS-protected tables.
 *
 * The module-level `supabase` uses the public anon key — fine for the
 * `projections` table (permissive RLS), but `properties` has row-level
 * security that rejects anon inserts ("new row violates row-level
 * security policy"). promoteToProperty writes a new `properties` row, so
 * it needs the service role. Server-action code only — the service key
 * must never reach the browser.
 */
function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }
  return createClient(url, key);
}

/** Pull `owners[i][field]` keys out of FormData and assemble an Owner[]. */
function parseOwners(fd: FormData): Owner[] {
  const owners: Owner[] = [];
  for (let i = 0; i < 20; i++) {
    const fn = fd.get(`owners[${i}][first_name]`);
    const ln = fd.get(`owners[${i}][last_name]`);
    if (fn == null && ln == null) break;
    const first = String(fn ?? '').trim();
    const last = String(ln ?? '').trim();
    // Skip cards the user added but left totally blank.
    if (!first && !last) continue;
    owners.push({
      first_name: first,
      last_name: last,
      email: (String(fd.get(`owners[${i}][email]`) ?? '').trim() || null),
      phone: (String(fd.get(`owners[${i}][phone]`) ?? '').trim() || null),
      full_legal: (String(fd.get(`owners[${i}][full_legal]`) ?? '').trim() || null),
    });
  }
  return owners;
}

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
  // Owners are the source of truth now. Parse them, then re-derive the legacy
  // scalar fields so render code that reads prospect_name etc. keeps working.
  const owners = parseOwners(formData);
  const derived = deriveLegacyFromOwners(owners);

  return {
    owners: owners.length > 0 ? owners : null,
    ...derived,
    property_address: str(formData, 'property_address'),
    // City defaults to "<Market>, MA" when the form doesn't explicitly
    // submit one — Dotti dropped the duplicative "City, State, ZIP" field
    // from the form (Market already encodes the location for everything
    // operational + the AirDNA projection data). Existing rows that have
    // a manually-set city pass it through unchanged via the hidden field.
    property_city:
      strOrNull(formData, 'property_city') ||
      `${str(formData, 'market') || 'Rockport'}, MA`,
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
    drive_time_minutes: numOrNull(formData, 'drive_time_minutes'),

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

/**
 * Resolve the drive_time_minutes value for a save. If the form had an
 * explicit value, that wins (manual override). Otherwise auto-compute via
 * Nominatim + OSRM. Network/geocode failures return null and the slide
 * silently falls back to the generic "~10 min" positioning.
 *
 * Hard-capped at ~6s wall-clock via Promise.race regardless of what the
 * inner fetches do — AbortSignal.timeout doesn't reliably interrupt a
 * stuck DNS / TLS handshake, and a multi-minute hang here used to lock
 * the Save button on the prospect form. The cap is short enough to feel
 * snappy and long enough for both Nominatim + OSRM round-trips on a
 * healthy network.
 */
async function resolveDriveTime(payload: ReturnType<typeof buildPayload>): Promise<number | null> {
  if (payload.drive_time_minutes != null) return payload.drive_time_minutes;
  const addr = `${payload.property_address ?? ''}${payload.property_city ? `, ${payload.property_city}` : ''}`.trim();
  if (!addr) return null;
  return Promise.race<number | null>([
    getDriveTimeMinutes(addr),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 6_000)),
  ]);
}

// ─── Actions ────────────────────────────────────────────────────────────────
export async function createProjection(formData: FormData) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const localPart = session.user.email.split('@')[0];
  const basePayload = buildPayload(formData);
  const payload = {
    ...basePayload,
    created_by_email: session.user.email,
    created_by_name:
      session.user.name?.trim() ||
      (localPart ? localPart.charAt(0).toUpperCase() + localPart.slice(1) : 'User'),
    onboarding_token: newOnboardingToken(),
    drive_time_minutes: await resolveDriveTime(basePayload),
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

  const basePayload = buildPayload(formData);

  // Drive-time resolution: avoid the Nominatim+OSRM round-trip on every
  // minor edit. The form's `drive_time_minutes` field defaults to '' when
  // the column was never populated, so a routine save would otherwise
  // trigger a full re-geocode + re-route. Only re-resolve when:
  //   - the user typed an explicit value (always honor manual overrides), or
  //   - the address changed (the stored value is no longer relevant), or
  //   - we have nothing stored AND the address changed from "nothing typed
  //     before" to something useful.
  // Otherwise reuse the stored value (or null if there isn't one) and
  // skip the network entirely. resolveDriveTime is also hard-capped at
  // 6s so the worst case is a single slow round-trip, not a multi-minute
  // hang on a stuck fetch.
  let driveTime: number | null = basePayload.drive_time_minutes;
  if (driveTime == null) {
    const { data: prior } = await supabase
      .from('projections')
      .select('drive_time_minutes, property_address, property_city')
      .eq('id', id)
      .maybeSingle();
    const addressChanged =
      (prior?.property_address ?? null) !== (basePayload.property_address ?? null) ||
      (prior?.property_city ?? null) !== (basePayload.property_city ?? null);
    if (!addressChanged && prior?.drive_time_minutes != null) {
      driveTime = prior.drive_time_minutes as number;
    } else {
      driveTime = await resolveDriveTime(basePayload);
    }
  }

  const payload = {
    ...basePayload,
    drive_time_minutes: driveTime,
    // Bump updated_at on every save so the page-level ProjectionForm key
    // (key={projection.updated_at}) actually changes — forces a remount
    // and picks up the fresh defaults instead of holding stale ones from
    // the form's first render.
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('projections')
    .update(payload)
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

/**
 * Clear all contract edits applied via the Redlines tool (action-aware
 * overrides) plus the legacy custom_clauses Rider. Reverts the contract
 * to the standard template without touching the prospect record itself
 * — projection inputs (term dates, fees, owner info, etc.) stay intact.
 *
 * Use this when a negotiation needs to restart from a clean slate. The
 * prospect, the projection model, the signing token, and any onboarding
 * intake all survive; only the Rider/override state is wiped.
 */
export async function resetContractOverrides(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const { error } = await supabase
    .from('projections')
    .update({
      contract_overrides: null,
      custom_clauses: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/projections');
  revalidatePath(`/projections/${id}`);
  revalidatePath(`/projections/${id}/contract`);
  return { ok: true };
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
 * Manually complete the Onboarding pipeline stage. Used when the owner's
 * operational info was collected outside the public intake form (a phone
 * call, an in-person walkthrough), so the pipeline can advance to Promote
 * without waiting on a form submission. `unmarkOnboardingDone` reverts it.
 *
 * Stamps onboarding_marked_done_at rather than onboarding_submitted_at so
 * the activity log + stage status can still distinguish "owner submitted
 * the form" from "staff marked it complete".
 */
export async function markOnboardingDone(id: string) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const { error } = await supabase
    .from('projections')
    .update({ onboarding_marked_done_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(error.message);

  revalidatePath('/projections');
  revalidatePath(`/projections/${id}`);
}

export async function unmarkOnboardingDone(id: string) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const { error } = await supabase
    .from('projections')
    .update({ onboarding_marked_done_at: null })
    .eq('id', id);

  if (error) throw new Error(error.message);

  revalidatePath('/projections');
  revalidatePath(`/projections/${id}`);
}

/**
 * Manually complete the Partnership Guide & Contract pipeline stage.
 * Mirrors markOnboardingDone: used when the contract was closed out
 * outside the in-Helm signing flow (signed in person, executed elsewhere,
 * one-off deal). The stage flips to done, the hero pipeline bar advances,
 * and Promote unlocks (paired with onboarding being done).
 *
 * Stamps contract_marked_done_at rather than contract_countersigned_at so
 * the status line + activity log can still distinguish "Fully executed"
 * (real countersign chain) from "Marked complete by staff".
 */
export async function markContractDone(id: string) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const { error } = await supabase
    .from('projections')
    .update({ contract_marked_done_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(error.message);

  revalidatePath('/projections');
  revalidatePath(`/projections/${id}`);
}

export async function unmarkContractDone(id: string) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const { error } = await supabase
    .from('projections')
    .update({ contract_marked_done_at: null })
    .eq('id', id);

  if (error) throw new Error(error.message);

  revalidatePath('/projections');
  revalidatePath(`/projections/${id}`);
}

/**
 * Set the analyst's confidence that this prospect will close, 0–100.
 *
 * Called from the inline widget on the identity strip and from the prospect
 * list row's quick-set dropdown. Pass null to clear ("haven't decided yet").
 */
export async function setCloseLikelihood(id: string, pct: number | null): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  // Validate: integer 0–100, or null.
  let value: number | null = null;
  if (pct !== null && pct !== undefined) {
    const n = Math.round(Number(pct));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new Error(`Invalid likelihood: ${pct} (must be 0–100)`);
    }
    value = n;
  }

  const { error } = await supabase
    .from('projections')
    .update({ close_likelihood_pct: value })
    .eq('id', id);

  if (error) throw new Error(error.message);

  revalidatePath('/projections');
  revalidatePath(`/projections/${id}`);
}

// ─── Readiness checklist mutations ─────────────────────────────────────────
// Each call does a read-merge-write on the single jsonb column. Critically,
// these actions do NOT revalidatePath — the analyst is *on* the readiness
// page during a walkthrough, and revalidating the current route triggers
// the parent /projections/loading.tsx, which feels like the page froze.
// Readiness state is purely client-managed in-memory while the page is
// mounted; the next navigation re-fetches because the route is
// dynamic = 'force-dynamic'.

async function readReadinessState(projectionId: string): Promise<ReadinessState> {
  const { data, error } = await supabase
    .from('projections')
    .select('readiness_state')
    .eq('id', projectionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const raw = (data?.readiness_state ?? null) as ReadinessState | null;
  return {
    have: raw?.have && typeof raw.have === 'object' ? raw.have : {},
    checked: Array.isArray(raw?.checked) ? raw.checked : [],
    notes: raw?.notes && typeof raw.notes === 'object' ? raw.notes : {},
    updated_at: raw?.updated_at,
  };
}

async function writeReadinessState(projectionId: string, next: ReadinessState): Promise<void> {
  const stamped: ReadinessState = { ...next, updated_at: new Date().toISOString() };
  const { error } = await supabase
    .from('projections')
    .update({ readiness_state: stamped })
    .eq('id', projectionId);
  if (error) throw new Error(error.message);
  // Intentionally NO revalidatePath — see header comment.
}

/**
 * Set how many units of an item the owner has. Pass 0 for "they have
 * none"; pass need-count (or higher) for "complete". `itemLabel` matches
 * READINESS_GROUPS in lib/projections-readiness.ts.
 *
 * Writes to the canonical `have` dict and strips the legacy `checked`
 * entry for this label so the two stay consistent.
 */
export async function setReadinessHave(
  projectionId: string,
  itemLabel: string,
  count: number,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const safeCount = Math.max(0, Math.round(Number(count) || 0));
  const state = await readReadinessState(projectionId);
  const have = { ...(state.have ?? {}) };
  have[itemLabel] = safeCount;
  // Drop the legacy `checked` entry for this label so the two views can't
  // disagree. Future reads derive presence purely from `have`.
  const checked = (state.checked ?? []).filter((c) => c !== itemLabel);
  await writeReadinessState(projectionId, { ...state, have, checked });
}

/**
 * Write/overwrite a single walkthrough note. Pass empty string to clear.
 * `noteKey` is a stable identifier (supply_closet, smart_lock, etc.) —
 * see the NOTE_FIELDS array in lib/projections-readiness.ts.
 */
export async function setReadinessNote(
  projectionId: string,
  noteKey: string,
  value: string,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const state = await readReadinessState(projectionId);
  const notes = { ...state.notes };
  const trimmed = value.trim();
  if (trimmed === '') delete notes[noteKey];
  else notes[noteKey] = value;
  await writeReadinessState(projectionId, { ...state, notes });
}

/**
 * Email the current readiness state to the Rising Tide team (Allie + Ryan
 * + Dotti) for internal review. Not sent to the owner directly — the team
 * polishes the list and forwards it. Returns { ok, reason? } so the UI
 * can show a sent / failed confirmation without throwing.
 */
export async function requestReadinessReview(
  projectionId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, reason: 'not signed in' };

  const { data, error } = await supabase
    .from('projections')
    .select('*')
    .eq('id', projectionId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, reason: error?.message || 'projection not found' };
  }
  const projection = data as ProjectionRow;

  const origin = await getRequestOrigin();
  const readinessUrl = `${origin}/projections/${projectionId}/readiness`;
  const triggeredBy = session.user.name || session.user.email || null;

  return await sendReadinessReviewEmail({ projection, triggeredBy, readinessUrl });
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

  // Service-role client: this action inserts a new `properties` row, and
  // that table's row-level security rejects the public anon key.
  const sb = getServiceClient();

  // Pull the prospect record
  const { data: projRow, error: projErr } = await sb
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
  const propertyId = await pickPropertyId(projRow.property_address as string, sb);

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

  // Geocode the property address up-front so it lands on the
  // /properties map the moment the promotion finishes — without this
  // the new row has null lat/lng and the map silently skips its pin
  // until someone backfills the coords manually. Best-effort: a
  // Nominatim failure returns null and the property still gets
  // created; can be backfilled later.
  const fullAddr = [projRow.property_address, projRow.property_city].filter(Boolean).join(', ');
  const coords = await geocodeAddress(fullAddr);

  const propertyPayload = {
    id: propertyId,
    name: String(projRow.property_address),
    address: String(projRow.property_address),
    city: projRow.property_city || '',
    type_of_unit: projRow.property_type || null,
    is_active: true,
    is_rising_tide_owned: false,
    latitude: coords?.lat ?? null,
    longitude: coords?.lng ?? null,

    owner_last: ownerLast,
    owner_full: ownerFull,
    owner_greeting: ownerGreeting,
    owner_emails: ownerEmails,
    owner_phone: ob.phone || projRow.prospect_phone || null,
    owner_mailing_address: ob.mailing_address || null,
    owner_preferred_contact: ob.preferred_contact || null,

    management_fee_pct: feePct,

    // Operational columns from the owner's onboarding answers (utilities,
    // STR setup, access, emergency contact, inspection/safety). Same
    // mapping the property-only re-submit path uses.
    ...propertyColumnsFromOnboarding(ob),

    // Promote-only override: if the prospect originally typed a bedroom
    // count and the owner left the field blank in onboarding, prefer the
    // prospect's input over null.
    bedrooms: numOr(ob.bedrooms, projRow.bedrooms as number),

    projection_id: projectionId,
  };

  const { error: insertErr } = await sb.from('properties').insert(propertyPayload);
  if (insertErr) throw new Error(insertErr.message);

  // If the owner's onboarding included freeform notes, seed them as the
  // first row of the new structured property_notes table so the data
  // isn't dropped on the floor when the legacy column went away.
  const obNotes = (ob.notes || '').trim();
  if (obNotes) {
    try {
      await sb.from('property_notes').insert({
        property_id: propertyId,
        title: 'From owner onboarding intake',
        body: obNotes,
        tag: 'onboarding',
        author_email: session.user.email,
      });
    } catch (err) {
      console.warn('[promoteToProperty] property_notes seed skipped:', err);
    }
  }

  // Wire the back-reference on the prospect side so the link is bidirectional.
  const { error: linkErr } = await sb
    .from('projections')
    .update({ property_id: propertyId })
    .eq('id', projectionId);
  if (linkErr) throw new Error(linkErr.message);

  // Seed the post-promotion launch checklist. One row per canonical step in
  // lib/launch-checklist.ts; the property_created step is pre-completed since
  // the row above just landed. Best-effort: if the seed fails (e.g. the
  // migration hasn't run yet on a preview env) we still let the promote
  // succeed so we don't strand the operator.
  try {
    const seedRows = buildInitialLaunchSteps(propertyId, session.user.email);
    const { error: seedErr } = await sb.from('property_launch_steps').insert(seedRows);
    if (seedErr) console.warn('[promoteToProperty] launch-checklist seed skipped:', seedErr.message);
  } catch (err) {
    console.warn('[promoteToProperty] launch-checklist seed threw:', err);
  }

  revalidatePath(`/projections/${projectionId}`);
  revalidatePath('/properties');
  revalidatePath(`/properties/${propertyId}`);
  // First stop after promotion is the launch checklist — there's a stack of
  // integrations to wire (Quo cleaner, Seam lock, Guesty match, bank last4,
  // listing copy, Airbnb live) before the property is truly operational.
  redirect(`/properties/${propertyId}/launch`);
}

/**
 * Slugify the property address into a stable, human-readable id. Mirrors the
 * existing convention (e.g. "21 Horton St" → "21_horton"). Drops common
 * street suffixes; if the slug collides, suffixes _2, _3, etc.
 */
async function pickPropertyId(address: string, sb: SupabaseClient): Promise<string> {
  const base = slugifyAddress(address);
  if (!base) throw new Error('Could not derive a property id from the address');

  // Probe for collisions; cheap because the table is small. Uses the
  // passed-in service client so the read isn't filtered by RLS.
  const { data: existing } = await sb
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
 * Public-facing: an owner signs the management contract. No auth, gated by
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

  // Send the "thanks, here's your signed copy" email with the
  // owner-signed PDF attached. Failures are logged but non-fatal —
  // the signature is already persisted; a transient Resend outage
  // shouldn't prevent the redirect to the confirmation page or lose
  // the audit record. Stamp contract_owner_email_sent_at on success
  // for idempotency (and so Allie can see the email did go out).
  const { data: fullProjection } = await supabase
    .from('projections')
    .select('*')
    .eq('onboarding_token', token)
    .maybeSingle();
  if (fullProjection) {
    const origin = await getRequestOrigin();
    if (origin) {
      // Two parallel sends: the owner gets their signed copy, and
      // staff (allie@ + dotti@) get a separate "you have a
      // countersign to do" alert. The staff alert is what closes
      // the loop on the workflow - the owner-confirmation CC'd
      // Allie on a message addressed to the client, which doesn't
      // read as "you have work to do" and let countersigns sit.
      const [ownerResult, staffResult] = await Promise.all([
        sendOwnerSignedEmail({
          projection: fullProjection as ProjectionRow,
          origin,
        }),
        sendCountersignNotification({
          projection: fullProjection as ProjectionRow,
          origin,
        }),
      ]);
      if (ownerResult.ok) {
        await supabase
          .from('projections')
          .update({ contract_owner_email_sent_at: new Date().toISOString() })
          .eq('onboarding_token', token);
      } else {
        console.warn('[submitContractSignature] owner-signed email skipped:', ownerResult.reason);
      }
      if (!staffResult.ok) {
        console.warn('[submitContractSignature] staff countersign alert skipped:', staffResult.reason);
      }
    }
  }

  revalidatePath(`/contract/${token}`);
  revalidatePath(`/projections/${existing.id}`);
  redirect(`/contract/${token}/signed`);
}

/**
 * Staff-only: Allie countersigns a contract that the owner has already
 * signed. Fully executes the contract and sends the doubly-signed PDF
 * to the owner with a welcome note. CC's allie@ for record-keeping.
 *
 * Idempotent: re-invocations after countersign return without
 * overwriting. The owner-signed prerequisite is enforced — you can't
 * countersign a contract whose owner hasn't signed yet.
 */
export async function countersignContract(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const id = String(formData.get('id') || '').trim();
  if (!id) throw new Error('Missing projection id');

  const { data: existing, error: lookupErr } = await supabase
    .from('projections')
    .select('id, contract_signed_at, contract_countersigned_at, onboarding_token')
    .eq('id', id)
    .maybeSingle();
  if (lookupErr || !existing) throw new Error(lookupErr?.message || 'Projection not found');
  if (!existing.contract_signed_at) throw new Error('Owner has not signed yet');
  if (existing.contract_countersigned_at) {
    // Already countersigned — nothing to do, just revalidate the page.
    revalidatePath(`/projections/${id}`);
    return;
  }

  const { error: updateErr } = await supabase
    .from('projections')
    .update({ contract_countersigned_at: new Date().toISOString() })
    .eq('id', id);
  if (updateErr) throw new Error(updateErr.message);

  // Post-countersign side effects: email the executed PDF to the owner
  // AND archive it to the Rising Tide Drive. Both are best-effort —
  // failures are logged, never thrown; the countersign timestamp is
  // already persisted so a Resend / Drive outage doesn't lose the
  // execution. The PDF is rendered ONCE here and the same buffer feeds
  // both the email attachment and the Drive upload (the render is the
  // slow ~10s step — doing it twice would double the countersign wait).
  const { data: fullProjection } = await supabase
    .from('projections')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fullProjection) {
    const projectionRow = fullProjection as ProjectionRow;
    const origin = await getRequestOrigin();
    if (origin) {
      let pdf: Buffer | null = null;
      try {
        pdf = await fetchContractPdf({ projectionId: id, origin, token: projectionRow.onboarding_token });
      } catch (err) {
        console.error(
          '[countersignContract] executed PDF render failed:',
          err instanceof Error ? err.message : String(err),
        );
      }

      // 1. Email the executed contract to the owner (CC Allie).
      const emailResult = await sendExecutedEmail({
        projection: projectionRow,
        origin,
        pdf: pdf ?? undefined,
      });
      if (emailResult.ok) {
        await supabase
          .from('projections')
          .update({ contract_executed_email_sent_at: new Date().toISOString() })
          .eq('id', id);
      } else {
        console.warn('[countersignContract] executed email skipped:', emailResult.reason);
      }

      // 2. Archive the executed PDF to the Rising Tide shared Drive
      //    (Helm Records / Contracts / <year>/). Stamp the resulting
      //    Drive link on the projection so the page links straight to it.
      if (pdf && isDriveArchiveConfigured()) {
        const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const year = dateStr.slice(0, 4);
        const archiveName = `${projectionRow.property_address} - ${projectionRow.prospect_name} - Executed ${dateStr}.pdf`
          .replace(/[\\/:*?"<>|]/g, '')
          .trim();
        const archive = await archiveContractToDrive({ pdf, filename: archiveName, year });
        if (archive.ok && archive.url) {
          await supabase
            .from('projections')
            .update({ contract_drive_url: archive.url })
            .eq('id', id);
        } else {
          console.warn('[countersignContract] Drive archive skipped:', archive.reason);
        }
      }
    }
  }

  if (existing.onboarding_token) {
    revalidatePath(`/contract/${existing.onboarding_token}`);
  }
  revalidatePath(`/projections/${id}`);
}

/**
 * Public-facing: an owner submits the onboarding form. No auth, gated by
 * knowledge of the token.
 *
 * Polymorphic by token: the same `/onboarding/<token>` URL can belong to a
 * prospect (stored as a JSONB blob on `projections.onboarding_data`) or to
 * an existing managed property (written straight into the property's
 * first-class operational columns). We probe `projections` first so the
 * prospect path is byte-identical to the prior implementation; fall back
 * to `properties` for the new managed-property re-submit flow.
 */
/**
 * Public-facing draft autosave: same token gate as submitOnboarding, but
 * persists the partial answers without flipping onboarding_submitted_at
 * and without firing the staff notification or any redirect. The form
 * (which is long) calls this debounced after each input so the owner
 * can pause / lose their connection / forget to scroll to the bottom
 * Submit button, and their answers are still safely on file.
 *
 * Returns `{ ok, savedAt? }` to the client so it can render a "Saved
 * 2 min ago" indicator. Errors are returned, not thrown, so a flaky
 * network on the owner's side never crashes the page mid-typing.
 */
export async function saveOnboardingDraft(
  formData: FormData,
): Promise<{ ok: true; savedAt: string } | { ok: false; reason: string }> {
  const token = String(formData.get('token') || '').trim();
  if (!token || !/^[a-f0-9]{32}$/.test(token)) {
    return { ok: false, reason: 'Invalid onboarding link' };
  }

  const data = parseOnboardingFormData(formData);

  // Prospect path first (mirrors submitOnboarding's probe order).
  const { data: projHit, error: projLookupErr } = await supabase
    .from('projections')
    .select('id')
    .eq('onboarding_token', token)
    .maybeSingle();
  if (projLookupErr) return { ok: false, reason: projLookupErr.message };

  if (projHit) {
    const { error } = await supabase
      .from('projections')
      .update({ onboarding_data: data })
      .eq('onboarding_token', token);
    if (error) return { ok: false, reason: error.message };
    return { ok: true, savedAt: new Date().toISOString() };
  }

  // Property path: same column-by-column write the full submit uses, but
  // without the onboarding_submitted_at stamp or notification email.
  // Service-role client because properties RLS rejects anon writes.
  const sb = getServiceClient();
  const { data: propHit, error: propLookupErr } = await sb
    .from('properties')
    .select('id, owner_emails')
    .eq('onboarding_token', token)
    .maybeSingle();
  if (propLookupErr) return { ok: false, reason: propLookupErr.message };
  if (!propHit) return { ok: false, reason: 'Invalid onboarding link' };

  const updatePayload: Record<string, unknown> = {
    ...propertyColumnsFromOnboarding(data),
  };
  if (data.phone) updatePayload.owner_phone = data.phone;
  if (data.mailing_address) updatePayload.owner_mailing_address = data.mailing_address;
  if (data.preferred_contact) updatePayload.owner_preferred_contact = data.preferred_contact;
  if (data.email) {
    const current = (propHit as { owner_emails: string[] | null }).owner_emails ?? [];
    if (!current.includes(data.email)) {
      updatePayload.owner_emails = [...current, data.email];
    }
  }

  const { error } = await sb
    .from('properties')
    .update(updatePayload)
    .eq('onboarding_token', token);
  if (error) return { ok: false, reason: error.message };

  return { ok: true, savedAt: new Date().toISOString() };
}

export async function submitOnboarding(formData: FormData) {
  const token = String(formData.get('token') || '').trim();
  if (!token || !/^[a-f0-9]{32}$/.test(token)) throw new Error('Invalid onboarding link');

  const data = parseOnboardingFormData(formData);

  // Try the prospect path first (zero behavior change for projection
  // tokens). If no row matches, try the property path.
  const { data: projHit } = await supabase
    .from('projections')
    .select('id')
    .eq('onboarding_token', token)
    .maybeSingle();

  if (projHit) {
    const { error } = await supabase
      .from('projections')
      .update({
        onboarding_data: data,
        onboarding_submitted_at: new Date().toISOString(),
      })
      .eq('onboarding_token', token);

    if (error) throw new Error(error.message);

    // Fire a staff notification on the first submission only (idempotency
    // via onboarding_notification_sent_at). Non-fatal if Resend errors —
    // the form data is already persisted; the redirect below still
    // confirms submission to the owner.
    const { data: full } = await supabase
      .from('projections')
      .select('id, prospect_name, property_address, onboarding_notification_sent_at')
      .eq('onboarding_token', token)
      .maybeSingle();
    if (full && !full.onboarding_notification_sent_at) {
      const origin = await getRequestOrigin();
      if (origin) {
        const result = await sendOnboardingSubmittedEmail({
          propertyAddress: (full as { property_address: string }).property_address,
          ownerName: (full as { prospect_name: string | null }).prospect_name,
          data,
          helmUrl: `${origin}/projections/${(full as { id: string }).id}`,
        });
        if (result.ok) {
          await supabase
            .from('projections')
            .update({ onboarding_notification_sent_at: new Date().toISOString() })
            .eq('onboarding_token', token);
        } else {
          console.warn('[submitOnboarding] notification email skipped:', result.reason);
        }
      }
    }

    revalidatePath(`/onboarding/${token}`);
    redirect(`/onboarding/${token}/thanks`);
  }

  // Property path: the onboarding form was opened for an already-managed
  // property. `properties` is RLS-protected (no anon INSERT/UPDATE
  // policy), so writes here must go through the service-role client —
  // an anon UPDATE silently affects zero rows and the owner's answers
  // would vanish without an error.
  const sb = getServiceClient();

  const { data: propHit } = await sb
    .from('properties')
    .select('id, owner_emails')
    .eq('onboarding_token', token)
    .maybeSingle();

  if (!propHit) throw new Error('Invalid onboarding link');

  // Build the property update payload. Operational columns come straight
  // from the owner's answers; owner-identity fields (phone / mailing /
  // preferred contact) update if the owner provided them; owner_emails
  // gets the new email appended only if it isn't already on the record
  // (Dotti curates that array, so we don't clobber it).
  const updatePayload: Record<string, unknown> = {
    ...propertyColumnsFromOnboarding(data),
    onboarding_submitted_at: new Date().toISOString(),
  };
  if (data.phone) updatePayload.owner_phone = data.phone;
  if (data.mailing_address) updatePayload.owner_mailing_address = data.mailing_address;
  if (data.preferred_contact) updatePayload.owner_preferred_contact = data.preferred_contact;
  if (data.email) {
    const current = (propHit as { owner_emails: string[] | null }).owner_emails ?? [];
    if (!current.includes(data.email)) {
      updatePayload.owner_emails = [...current, data.email];
    }
  }

  const { error } = await sb
    .from('properties')
    .update(updatePayload)
    .eq('onboarding_token', token);

  if (error) throw new Error(error.message);

  // Staff notification — same idempotent pattern as the projection
  // branch above. Looks up the property to get address + notification
  // flag, sends the email if not already sent, then stamps.
  const { data: fullProp } = await sb
    .from('properties')
    .select('id, address, name, onboarding_notification_sent_at')
    .eq('onboarding_token', token)
    .maybeSingle();
  if (fullProp && !(fullProp as { onboarding_notification_sent_at: string | null }).onboarding_notification_sent_at) {
    const origin = await getRequestOrigin();
    if (origin) {
      const result = await sendOnboardingSubmittedEmail({
        propertyAddress: (fullProp as { address: string; name: string }).address || (fullProp as { name: string }).name,
        ownerName: data.full_name || null,
        data,
        helmUrl: `${origin}/properties/${(fullProp as { id: string }).id}`,
      });
      if (result.ok) {
        await sb
          .from('properties')
          .update({ onboarding_notification_sent_at: new Date().toISOString() })
          .eq('onboarding_token', token);
      } else {
        console.warn('[submitOnboarding] property-path notification email skipped:', result.reason);
      }
    }
  }

  revalidatePath(`/onboarding/${token}`);
  revalidatePath(`/properties/${propHit.id}`);
  redirect(`/onboarding/${token}/thanks`);
}

/**
 * Generate (or return the existing) onboarding token for a managed property.
 * Called from the property page when an operator wants to send the public
 * onboarding form to the owner. Idempotent: the token is generated once,
 * lazily, and reused on subsequent calls.
 */
export async function ensurePropertyOnboardingToken(propertyId: string): Promise<string> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  // `properties` is RLS-protected — an anon UPDATE silently no-ops, which
  // would persist no token and hand back a dead onboarding link. Use the
  // service-role client for the write.
  const sb = getServiceClient();

  const { data: existing, error: lookupErr } = await sb
    .from('properties')
    .select('onboarding_token')
    .eq('id', propertyId)
    .maybeSingle();
  if (lookupErr) throw new Error(lookupErr.message);
  if (!existing) throw new Error('Property not found');

  if ((existing as { onboarding_token: string | null }).onboarding_token) {
    return (existing as { onboarding_token: string }).onboarding_token;
  }

  const token = newOnboardingToken();
  const { error: updateErr } = await sb
    .from('properties')
    .update({ onboarding_token: token })
    .eq('id', propertyId);
  if (updateErr) throw new Error(updateErr.message);

  revalidatePath(`/properties/${propertyId}`);
  return token;
}

/** Parse the public form's flat field set into the OnboardingData shape.
 *  Empty strings drop out so we never bloat records with junk. */
function parseOnboardingFormData(formData: FormData): OnboardingData {
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
    'trash_day', 'recycling_day', 'trash_notes', 'parking_regulations',
    'gas_shutoff_location', 'water_shutoff_location', 'electrical_panel_location',
    'fire_extinguisher_locations', 'smoke_detector_locations', 'fire_exit_locations',
    'str_permit_expires',
  ];

  const data: OnboardingData = {};
  for (const f of ALL_FIELDS) {
    const v = String(formData.get(f) ?? '').trim();
    if (v) data[f] = v;
  }
  return data;
}

/** Maps the owner's onboarding answers onto the matching `properties`
 *  columns. Used by both the prospect promotion path (INSERT) and the
 *  managed-property re-submit path (UPDATE). Owner-identity fields
 *  (owner_full / owner_greeting / owner_last / owner_emails) are NOT in
 *  here — those are set by the caller because the rules differ between
 *  the two paths. */
function propertyColumnsFromOnboarding(ob: OnboardingData) {
  return {
    bedrooms: numOr(ob.bedrooms, null),
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
    // ob.notes used to flow into properties.property_notes (a freeform
    // text blob). That column was removed in migration 20260528 in favor
    // of the structured public.property_notes table. The promote action
    // could write a seed row there, but the onboarding form has its own
    // structured fields for everything important; ob.notes is best left
    // as a free-form append the operator can copy into a new note from
    // the property page if it's worth keeping.

    emergency_contact_name: ob.emergency_name || null,
    emergency_contact_relationship: ob.emergency_relationship || null,
    emergency_contact_phone: ob.emergency_phone || null,
    emergency_contact_email: ob.emergency_email || null,

    // Inspection & safety (Gloucester STR permit Information Note)
    trash_day: ob.trash_day || null,
    recycling_day: ob.recycling_day || null,
    trash_notes: ob.trash_notes || null,
    parking_regulations: ob.parking_regulations || null,
    gas_shutoff_location: ob.gas_shutoff_location || null,
    water_shutoff_location: ob.water_shutoff_location || null,
    electrical_panel_location: ob.electrical_panel_location || null,
    fire_extinguisher_locations: ob.fire_extinguisher_locations || null,
    smoke_detector_locations: ob.smoke_detector_locations || null,
    fire_exit_locations: ob.fire_exit_locations || null,
    str_permit_expires: ob.str_permit_expires || null,
  };
}

// ─── Contract redlines ──────────────────────────────────────────────────────

/**
 * Step 1 of the redline flow: take the owner's freeform redline text, pull
 * the projection record, and ask Claude to map it to a structured edit set.
 * Read-only — does NOT mutate the projection. The client holds the result
 * in state and shows a preview before calling applyContractRedlines.
 */
export async function proposeContractRedlines(
  projectionId: string,
  requested: string,
): Promise<{ ok: true; edits: ContractRedlineEdits } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const trimmed = requested.trim();
  if (!trimmed) return { ok: false, error: 'Paste the owner’s redlines first.' };
  // Soft ceiling — Claude Sonnet 4.5 handles ~200K tokens (≈600K+ chars)
  // natively, but capping at 20K keeps the API spend bounded if someone
  // accidentally pastes an entire PDF. Should fit any realistic owner
  // email + forwarded thread + lawyer's negotiation list.
  if (trimmed.length > 20000) return { ok: false, error: 'Redline text is too long; trim it under 20,000 characters.' };

  const { data, error } = await supabase
    .from('projections')
    .select('*')
    .eq('id', projectionId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Prospect not found.' };

  try {
    const edits = await interpretContractRedlines({
      projection: data as ProjectionRow,
      requested: trimmed,
    });
    // Log the structured interpreter output so Vercel runtime logs
    // capture it. Crucial for diagnosing prompt regressions — the May
    // 2026 36 Granite incident had no recoverable JSON because we
    // hadn't logged the apply-step payload anywhere.
    console.log(
      JSON.stringify({
        event: 'contract_redlines_proposed',
        projection_id: projectionId,
        requested_chars: trimmed.length,
        field_change_count: edits.field_changes.length,
        override_count: edits.contract_overrides.length,
        overrides_by_action: edits.contract_overrides.reduce<Record<string, number>>(
          (acc, o) => ({ ...acc, [o.action]: (acc[o.action] ?? 0) + 1 }),
          {},
        ),
        // Full structured edit set — useful for reproducing or rolling
        // back. Bounded by the 20K input cap so this stays log-safe.
        edits,
      }),
    );
    return { ok: true, edits };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Step 2 of the redline flow: persist a previously-interpreted edit set
 * to the projection record. Re-validates the page so the contract preview
 * + downloads pick up the new values immediately.
 *
 * Re-fetches the projection inside the action rather than trusting the
 * client-passed copy, so the apply step always works against the freshest
 * server-side state (in case someone else edited the record in the
 * meantime).
 */
/**
 * Outcome of an apply call. `failures` is non-empty when one or more
 * overrides couldn't be applied at render time (e.g. a modify whose
 * find span no longer matches the current clause text). The panel
 * surfaces these inline on the applied-confirmation banner so staff
 * sees the mismatch immediately, not only when they open the contract.
 */
export type ApplyContractRedlinesResult =
  | {
      ok: true;
      failures: { summary: string }[];
      appliedCount: number;
    }
  | { ok: false; error: string };

export async function applyContractRedlines(
  projectionId: string,
  edits: ContractRedlineEdits,
): Promise<ApplyContractRedlinesResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const { data, error: fetchErr } = await supabase
    .from('projections')
    .select('*')
    .eq('id', projectionId)
    .maybeSingle();
  if (fetchErr) return { ok: false, error: fetchErr.message };
  if (!data) return { ok: false, error: 'Prospect not found.' };

  const { fieldUpdates, newContractOverrides } = applyEditsToProjection({
    projection: data as ProjectionRow,
    edits,
  });

  const payload: Record<string, unknown> = {
    ...fieldUpdates,
    contract_overrides: newContractOverrides,
    // Bump updated_at so the page's ProjectionForm key changes and the
    // form remounts with the redline-applied values. Without this, the
    // form's defaultValue inputs retain the values from initial page
    // load — the user's next Save would clobber the redline edits.
    updated_at: new Date().toISOString(),
  };

  // Log what's actually being persisted — the user-accepted subset of
  // the interpreter's proposal, plus the resulting overrides array.
  // Recoverable from Vercel logs if the row is later deleted or
  // overwritten.
  console.log(
    JSON.stringify({
      event: 'contract_redlines_applied',
      projection_id: projectionId,
      applied_by: session.user.email,
      field_change_count: edits.field_changes.length,
      override_count_in: edits.contract_overrides.length,
      override_count_persisted: newContractOverrides.length,
      field_updates: fieldUpdates,
      overrides: newContractOverrides,
    }),
  );

  const { error: updateErr } = await supabase
    .from('projections')
    .update(payload)
    .eq('id', projectionId);
  if (updateErr) return { ok: false, error: updateErr.message };

  revalidatePath(`/projections/${projectionId}`);
  revalidatePath(`/projections/${projectionId}/contract`);

  // Dry-run the persisted overrides through the renderer's apply engine
  // to detect any that won't actually land (typically: a modify whose
  // find span has already been changed by an earlier override, or a
  // targetId that doesn't exist in the base contract). Surface the
  // failures back to the panel so the user sees the mismatch on the
  // applied-confirmation banner, not only when they open the contract
  // preview.
  const { failures } = applyContractOverrides(newContractOverrides);
  if (failures.length > 0) {
    console.warn(
      `[applyContractRedlines] ${failures.length} of ${newContractOverrides.length} override(s) failed dry-run on projection ${projectionId}:`,
      failures.map((f) => describeOverrideFailure(f)),
    );
  }
  return {
    ok: true,
    appliedCount: newContractOverrides.length - failures.length,
    failures: failures.map((f) => ({ summary: describeOverrideFailure(f) })),
  };
}
