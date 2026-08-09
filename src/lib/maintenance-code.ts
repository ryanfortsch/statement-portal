/**
 * Fleet-wide maintenance keypad code: one permanent PIN programmed onto every
 * code-capable lock Seam can reach, so a vendor or handyman on a maintenance
 * run can get in without a per-visit code. Requested by the office 2026-08-09.
 *
 * The PIN is a deliberate operator-known constant (env-overridable), same
 * posture as SEAM_CLEANER_CODE's 2222: it rides in work-order emails, so it is
 * not a secret the way the master inspection code is. Convergence runs on the
 * daily Seam sync (/api/sync-seam), which means a newly connected lock picks
 * the code up within a day with no manual step.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  classifyCodeRole,
  createPermanentAccessCode,
  listAccessCodes,
  listUnmanagedAccessCodes,
  type SeamAccessCodeFull,
} from '@/lib/seam';
import { CLEANER_CODE } from '@/lib/cleaning-sessions';
import { INSPECTION_CODE } from '@/lib/inspection-sessions';

export const MAINTENANCE_CODE = process.env.SEAM_MAINTENANCE_CODE || '3333';
export const MAINTENANCE_CODE_NAME = 'Rising Tide Maintenance';

/** False when the code would collide with the cleaner or master inspection
 *  code: a shared PIN would make keypad unlock attribution ambiguous, so we
 *  refuse to program it rather than corrupt both signals. */
export function maintenanceCodeEnabled(): boolean {
  return !!MAINTENANCE_CODE && MAINTENANCE_CODE !== CLEANER_CODE && MAINTENANCE_CODE !== INSPECTION_CODE;
}

export type EnsureOutcome = 'present' | 'created' | 'disabled' | 'failed';

/**
 * Idempotently make sure this lock carries the maintenance PIN. Matches by
 * PIN digits across managed AND unmanaged codes (a hand-programmed 3333 in
 * the Schlage app counts as present; creating a duplicate PIN would be
 * refused by the lock anyway). On create, the code is registered in
 * lock_access_codes right away so a maintenance keypad entry never reads as
 * a guest in residence. Never throws.
 */
export async function ensureMaintenanceCode(sb: SupabaseClient, deviceId: string): Promise<EnsureOutcome> {
  if (!maintenanceCodeEnabled()) return 'disabled';
  try {
    const [unmanaged, managed] = await Promise.all([
      listUnmanagedAccessCodes(deviceId).catch(() => [] as SeamAccessCodeFull[]),
      listAccessCodes(deviceId).catch(() => [] as SeamAccessCodeFull[]),
    ]);
    const existing = [...unmanaged, ...managed].find((c) => (c.code ?? '').trim() === MAINTENANCE_CODE);
    if (existing) return 'present';

    const ac = await createPermanentAccessCode({
      deviceId,
      name: MAINTENANCE_CODE_NAME,
      code: MAINTENANCE_CODE,
    });
    if (ac?.access_code_id) {
      await sb.from('lock_access_codes').upsert(
        {
          device_id: deviceId,
          access_code_id: ac.access_code_id,
          name: MAINTENANCE_CODE_NAME,
          role: classifyCodeRole(MAINTENANCE_CODE_NAME),
          resolved_at: new Date().toISOString(),
        },
        { onConflict: 'device_id,access_code_id' },
      );
    }
    return 'created';
  } catch {
    return 'failed';
  }
}
