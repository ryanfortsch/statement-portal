'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { getServiceClient } from '@/lib/supabase-admin';
import { runClimateAutomation } from '@/lib/climate';

/**
 * Server actions for the per-property Climate panel
 * (/properties/[id], Operations tab).
 *
 * Writes go through the service-role client because
 * property_climate_profiles has RLS on with no anon policy (service-role
 * only — keeps thermostat config off the anon surface).
 */

export type SaveClimateState = { error: string | null; ok?: boolean };

function clampInt(fd: FormData, key: string, fallback: number, min: number, max: number): number {
  const raw = (fd.get(key) ?? '').toString().trim();
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function pickSeason(fd: FormData): 'auto' | 'summer' | 'winter' {
  const v = (fd.get('season_mode') ?? 'auto').toString();
  return v === 'summer' || v === 'winter' ? v : 'auto';
}

export async function saveClimateProfile(
  propertyId: string,
  _prev: SaveClimateState,
  fd: FormData,
): Promise<SaveClimateState> {
  const session = await auth();
  if (!session?.user?.email) return { error: 'Not signed in' };

  const seam_device_id = (fd.get('seam_device_id') ?? '').toString().trim() || null;
  const enabled = fd.get('enabled') === 'on' || fd.get('enabled') === 'true';

  if (enabled && !seam_device_id) {
    return { error: 'Map a thermostat before turning the automation on.' };
  }

  const payload = {
    property_id: propertyId,
    seam_device_id,
    enabled,
    season_mode: pickSeason(fd),
    summer_eco_f: clampInt(fd, 'summer_eco_f', 77, 40, 90),
    summer_comfort_f: clampInt(fd, 'summer_comfort_f', 70, 40, 90),
    winter_eco_f: clampInt(fd, 'winter_eco_f', 60, 40, 90),
    winter_comfort_f: clampInt(fd, 'winter_comfort_f', 68, 40, 90),
    precool_lead_hours: clampInt(fd, 'precool_lead_hours', 4, 0, 24),
    checkin_hour: clampInt(fd, 'checkin_hour', 16, 0, 23),
    checkout_hour: clampInt(fd, 'checkout_hour', 11, 0, 23),
    timezone: (fd.get('timezone') ?? 'America/New_York').toString().trim() || 'America/New_York',
    updated_at: new Date().toISOString(),
  };

  const sb = getServiceClient();
  const { error } = await sb
    .from('property_climate_profiles')
    .upsert(payload, { onConflict: 'property_id' });
  if (error) return { error: `Save failed: ${error.message}` };

  revalidatePath(`/properties/${propertyId}`);
  return { error: null, ok: true };
}

/**
 * Run the automation for this one property right now and report what it did.
 * Lets the operator see the engine act without waiting for the cron tick.
 */
export async function runClimateNow(
  propertyId: string,
): Promise<{ ok: boolean; message: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, message: 'Not signed in' };

  try {
    const results = await runClimateAutomation({ onlyPropertyId: propertyId });
    if (results.length === 0) {
      return { ok: false, message: 'Nothing to do — enable the automation and map a thermostat first.' };
    }
    const r = results[0];
    if (r.skipped === 'seam_unconfigured') {
      return { ok: false, message: 'SEAM_API_KEY is not set in this environment yet.' };
    }
    if (!r.ok) return { ok: false, message: r.error ?? 'Run failed.' };
    const d = r.desired;
    const summary = d ? `${d.mode} to ${d.setpoint}°F (${d.state}, ${d.reason})` : '';
    if (r.skipped === 'unchanged') return { ok: true, message: `Already correct: ${summary}.` };
    if (r.applied) return { ok: true, message: `Set ${summary}.` };
    return { ok: true, message: 'No change.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    revalidatePath(`/properties/${propertyId}`);
  }
}
