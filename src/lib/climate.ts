/**
 * Property climate automation engine.
 *
 * Turns the canonical booking calendar into thermostat setpoints via Seam:
 *   - empty property                -> eco setpoint (save the owner's energy)
 *   - within precool_lead_hours of a check-in, or a guest in residence
 *                                    -> comfort setpoint
 * Summer cools, winter heats. The setpoints are per-property (each owner
 * wants different numbers), stored in property_climate_profiles.
 *
 * `computeDesiredClimate` is a pure function (no I/O) so the logic is
 * testable on its own. `runClimateAutomation` is the orchestration the cron
 * and the "Run now" button call: load enabled+mapped profiles, read each
 * property's confirmed bookings, compute the desired setpoint, and call Seam
 * ONLY when it differs from what was last applied (Seam's $5 tier caps
 * actions/device/day, so we never re-send an unchanged setpoint).
 *
 * Everything here is server-only (service-role Supabase + Seam API key).
 * Client components may `import type` the types below; the runtime functions
 * must never be imported into the browser bundle.
 */

import { getServiceClient } from '@/lib/supabase-admin';
import {
  seamConfigured,
  listThermostats,
  setThermostatCool,
  setThermostatHeat,
  type SeamThermostat,
} from '@/lib/seam';

export type Season = 'summer' | 'winter';
export type ClimateState = 'eco' | 'comfort';
export type HvacMode = 'cool' | 'heat';
export type SeasonMode = 'auto' | 'summer' | 'winter';

export type ClimateProfile = {
  property_id: string;
  seam_device_id: string | null;
  enabled: boolean;
  season_mode: SeasonMode;
  summer_eco_f: number;
  summer_comfort_f: number;
  winter_eco_f: number;
  winter_comfort_f: number;
  precool_lead_hours: number;
  checkin_hour: number;
  checkout_hour: number;
  timezone: string;
  last_applied_state: ClimateState | null;
  last_applied_mode: HvacMode | null;
  last_applied_setpoint: number | null;
  last_applied_at: string | null;
  last_run_at: string | null;
  last_error: string | null;
};

export type BookingWindow = { check_in: string; check_out: string; status: string };

export type DesiredClimate = {
  season: Season;
  state: ClimateState;
  mode: HvacMode;
  setpoint: number;
  reason: string;
};

export type ClimateRunResult = {
  property_id: string;
  ok: boolean;
  applied: boolean;
  skipped?: 'unchanged' | 'seam_unconfigured';
  desired?: DesiredClimate;
  error?: string;
};

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

/** Wall-clock parts for `nowMs` in the given IANA timezone. */
function nowPartsInTz(tz: string, nowMs: number): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(nowMs));
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  let hour = get('hour');
  if (hour === 24) hour = 0; // some platforms emit "24" at midnight
  return { year: get('year'), month: get('month'), day: get('day'), hour, minute: get('minute') };
}

/**
 * A comparable instant for a local wall-clock time, built as the UTC epoch of
 * those parts. "Now" and the check-in/out datetimes are all built the same
 * way (local parts -> Date.UTC), so comparisons between them are consistent
 * and DST-agnostic for a multi-hour pre-cool window.
 */
function localEpoch(year: number, month: number, day: number, hour: number, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute);
}

/** Epoch for a YYYY-MM-DD date string at a given local hour. */
function dateStrEpoch(dateStr: string, hour: number): number {
  const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
  return Date.UTC(y, (m || 1) - 1, d || 1, hour, 0);
}

function todayStrInTz(tz: string, nowMs: number): string {
  const np = nowPartsInTz(tz, nowMs);
  return `${np.year}-${String(np.month).padStart(2, '0')}-${String(np.day).padStart(2, '0')}`;
}

/**
 * Pure: given a profile, the property's confirmed bookings, and now, decide
 * what the thermostat should be doing. No I/O.
 */
export function computeDesiredClimate(
  profile: ClimateProfile,
  bookings: BookingWindow[],
  nowMs: number,
): DesiredClimate {
  const np = nowPartsInTz(profile.timezone, nowMs);
  const nowLocal = localEpoch(np.year, np.month, np.day, np.hour, np.minute);

  const season: Season =
    profile.season_mode === 'auto'
      ? np.month >= 5 && np.month <= 9
        ? 'summer'
        : 'winter'
      : profile.season_mode;

  const confirmed = bookings.filter((b) => b.status === 'confirmed');
  let occupied = false;
  let nextArrival: number | null = null;
  for (const b of confirmed) {
    const ci = dateStrEpoch(b.check_in, profile.checkin_hour);
    const co = dateStrEpoch(b.check_out, profile.checkout_hour);
    if (nowLocal >= ci && nowLocal < co) occupied = true;
    if (ci > nowLocal && (nextArrival === null || ci < nextArrival)) nextArrival = ci;
  }

  const leadMs = profile.precool_lead_hours * 3_600_000;
  const precooling = !occupied && nextArrival !== null && nextArrival - nowLocal <= leadMs;
  const state: ClimateState = occupied || precooling ? 'comfort' : 'eco';

  const mode: HvacMode = season === 'summer' ? 'cool' : 'heat';
  const setpoint =
    season === 'summer'
      ? state === 'comfort'
        ? profile.summer_comfort_f
        : profile.summer_eco_f
      : state === 'comfort'
        ? profile.winter_comfort_f
        : profile.winter_eco_f;

  const reason = occupied
    ? 'guest in residence'
    : precooling
      ? `arrival within ${profile.precool_lead_hours}h`
      : 'no upcoming arrival';

  return { season, state, mode, setpoint, reason };
}

/** Read one property's climate profile (server-side, service-role). */
export async function getClimateProfile(propertyId: string): Promise<ClimateProfile | null> {
  try {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from('property_climate_profiles')
      .select('*')
      .eq('property_id', propertyId)
      .maybeSingle();
    if (error) return null; // table not migrated yet, etc.
    return (data as ClimateProfile) ?? null;
  } catch {
    return null;
  }
}

/** Seam thermostats for the mapping dropdown; [] when Seam is unconfigured. */
export async function listSeamThermostatsSafe(): Promise<SeamThermostat[]> {
  if (!seamConfigured()) return [];
  try {
    return await listThermostats();
  } catch {
    return [];
  }
}

/**
 * Run the automation for every enabled+mapped profile (or just one, for the
 * "Run now" button). Applies a setpoint to Seam only when it differs from the
 * last-applied value. Records last_applied_* / last_error per property.
 */
export async function runClimateAutomation(
  opts: { onlyPropertyId?: string } = {},
): Promise<ClimateRunResult[]> {
  const sb = getServiceClient();

  let query = sb
    .from('property_climate_profiles')
    .select('*')
    .eq('enabled', true)
    .not('seam_device_id', 'is', null);
  if (opts.onlyPropertyId) query = query.eq('property_id', opts.onlyPropertyId);

  const { data, error } = await query;
  if (error) throw new Error(`load climate profiles: ${error.message}`);
  const profiles = (data ?? []) as ClimateProfile[];
  if (profiles.length === 0) return [];

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (!seamConfigured()) {
    return profiles.map((p) => ({
      property_id: p.property_id,
      ok: false,
      applied: false,
      skipped: 'seam_unconfigured' as const,
    }));
  }

  const results: ClimateRunResult[] = [];
  for (const profile of profiles) {
    try {
      const today = todayStrInTz(profile.timezone, nowMs);
      const { data: bks } = await sb
        .from('bookings')
        .select('check_in, check_out, status')
        .eq('property_id', profile.property_id)
        .eq('status', 'confirmed')
        .gte('check_out', today)
        .order('check_in', { ascending: true });

      const desired = computeDesiredClimate(profile, (bks ?? []) as BookingWindow[], nowMs);

      const unchanged =
        profile.last_applied_state === desired.state &&
        profile.last_applied_mode === desired.mode &&
        profile.last_applied_setpoint === desired.setpoint;

      if (unchanged) {
        await sb
          .from('property_climate_profiles')
          .update({ last_run_at: nowIso, last_error: null })
          .eq('property_id', profile.property_id);
        results.push({ property_id: profile.property_id, ok: true, applied: false, skipped: 'unchanged', desired });
        continue;
      }

      if (desired.mode === 'cool') {
        await setThermostatCool(profile.seam_device_id as string, desired.setpoint);
      } else {
        await setThermostatHeat(profile.seam_device_id as string, desired.setpoint);
      }

      await sb
        .from('property_climate_profiles')
        .update({
          last_applied_state: desired.state,
          last_applied_mode: desired.mode,
          last_applied_setpoint: desired.setpoint,
          last_applied_at: nowIso,
          last_run_at: nowIso,
          last_error: null,
        })
        .eq('property_id', profile.property_id);

      results.push({ property_id: profile.property_id, ok: true, applied: true, desired });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await sb
        .from('property_climate_profiles')
        .update({ last_run_at: nowIso, last_error: message })
        .eq('property_id', profile.property_id);
      results.push({ property_id: profile.property_id, ok: false, applied: false, error: message });
    }
  }

  return results;
}
