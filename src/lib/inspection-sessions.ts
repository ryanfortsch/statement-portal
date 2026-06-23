/**
 * Inspection sessions engine: the lock-driven "an inspection is underway"
 * signal, the parallel of cleaning-sessions.ts for the cleaner code.
 *
 *   started_at: an inspector physically arrived. A Seam lock.unlocked whose
 *                access_code_id matches the lock's MASTER / inspection code
 *                (SEAM_INSPECTION_CODE, the top-secret Rising Tide code, never
 *                hardcoded). High confidence, zero action required.
 *
 * Completion is NOT recorded here. An inspection is marked complete in the app
 * (or via a manual "mark done"); this table only ever lights the in-progress
 * "Inspecting" state on the rail, ORed with the app "Start Inspection" signal
 * in operations.ts.
 *
 * Keyed (property_id, checkout_date), the same join the turnover row uses, so
 * the signal lands on the right turnover. Earliest entry wins. Server-only
 * (service-role writes).
 *
 * Wired from: /api/webhooks/seam (lock.unlocked) and /api/sync-seam
 * (resolveInspectorCodeId per lock).
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listUnmanagedAccessCodes } from '@/lib/seam';
import {
  lockProperty,
  isKeypadEntry,
  mostRecentCheckoutForProperty,
  CLEANER_CODE,
  type LockEventInput,
} from '@/lib/cleaning-sessions';

/** The master / inspection keypad code. TOP SECRET, so it lives only in the
 *  environment, never in the repo. Empty (the default) keeps the whole lock
 *  inspection signal dark until it is set in Vercel. */
export const INSPECTION_CODE = process.env.SEAM_INSPECTION_CODE || '';

type Outcome = { ok: boolean; reason?: string; propertyId?: string; checkoutDate?: string };

/**
 * lock.unlocked → record an inspector's arrival, but ONLY on an exact match to
 * the lock's resolved inspector code. Unlike the cleaner path there is no
 * any-keypad fallback: the inspector code is rarer than the cleaner code, and a
 * false positive would wrongly show "Inspecting". So a missing access_code_id
 * or an unresolved inspector code is a no-op (the signal stays dark).
 */
export async function recordInspectorEntry(sb: SupabaseClient, ev: LockEventInput): Promise<Outcome> {
  const lock = await lockProperty(sb, ev.deviceId);
  if (!lock) return { ok: false, reason: 'unmapped or inactive lock' };

  if (!isKeypadEntry(ev.method)) return { ok: false, reason: `non-keypad method (${ev.method})` };
  if (!lock.inspectorCodeId || !ev.accessCodeId || ev.accessCodeId !== lock.inspectorCodeId) {
    return { ok: false, reason: 'not the inspector code' };
  }

  const checkoutDate = await mostRecentCheckoutForProperty(sb, lock.propertyId, ev.occurredAt);
  if (!checkoutDate) return { ok: false, reason: 'no recent checkout to attribute' };

  // Keep the EARLIEST entry as the start (inspector may punch in more than once).
  const { data: existing } = await sb
    .from('inspection_sessions')
    .select('started_at')
    .eq('property_id', lock.propertyId)
    .eq('checkout_date', checkoutDate)
    .maybeSingle();
  const prior = (existing?.started_at as string | undefined) ?? null;
  const startedAt = prior && prior <= ev.occurredAt ? prior : ev.occurredAt;

  const { error } = await sb.from('inspection_sessions').upsert(
    {
      property_id: lock.propertyId,
      checkout_date: checkoutDate,
      started_at: startedAt,
      started_source: 'seam_lock',
      started_device_id: ev.deviceId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'property_id,checkout_date' },
  );
  if (error) return { ok: false, reason: error.message };
  return { ok: true, propertyId: lock.propertyId, checkoutDate };
}

/** Resolve + store the master/inspection code's access_code_id for a lock (from
 *  the unmanaged-code list), mirroring resolveCleanerCodeId. Dark (returns null)
 *  until SEAM_INSPECTION_CODE is set, so the secret code never has to live in
 *  the repo. Run per device on the daily Seam sync; the id can drift, so
 *  re-resolving keeps the inspector match working. */
export async function resolveInspectorCodeId(sb: SupabaseClient, deviceId: string): Promise<string | null> {
  // Dark until configured. Refuse to resolve if the inspector code is
  // misconfigured equal to the cleaner code: it would resolve to the same
  // access_code_id and make recordCleanerEntry reject every cleaner unlock as
  // "inspector code", silently killing cleaning detection fleet-wide.
  if (!INSPECTION_CODE || INSPECTION_CODE === CLEANER_CODE) return null;
  try {
    const codes = await listUnmanagedAccessCodes(deviceId);
    const match = codes.find((c) => (c.code ?? '').trim() === INSPECTION_CODE);
    const id = match?.access_code_id ?? null;
    if (id) {
      await sb
        .from('lock_devices')
        .update({ inspector_access_code_id: id, updated_at: new Date().toISOString() })
        .eq('device_id', deviceId);
    }
    return id;
  } catch {
    return null;
  }
}
