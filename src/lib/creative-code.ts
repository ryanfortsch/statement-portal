/**
 * Fleet-wide CREATIVE keypad code: one permanent PIN programmed onto every
 * code-capable lock Seam can reach, so a photographer or videographer on a
 * shoot can get in without a per-visit code. Requested by the office
 * 2026-08-26.
 *
 * Same posture and mechanism as the maintenance code (3333): a deliberate
 * operator-known constant, env-overridable, converged on the daily Seam sync
 * (/api/sync-seam) so a newly connected lock picks it up within a day with no
 * manual step. It rides in shoot briefs, so it is not a secret the way the
 * master inspection code is.
 *
 * Naming matters: `classifyCodeRole` maps /creativ/ to 'staff', so a shoot-day
 * keypad entry never lights the "guest in residence" indicator.
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
import { MAINTENANCE_CODE } from '@/lib/maintenance-code';

export const CREATIVE_CODE = process.env.SEAM_CREATIVE_CODE || '5555';
export const CREATIVE_CODE_NAME = 'Rising Tide Creative';

/** False when the code would collide with the cleaner, inspection, or
 *  maintenance PIN: a shared code makes keypad unlock attribution ambiguous,
 *  so we refuse to program it rather than corrupt both signals. */
export function creativeCodeEnabled(): boolean {
  return (
    !!CREATIVE_CODE &&
    CREATIVE_CODE !== CLEANER_CODE &&
    CREATIVE_CODE !== INSPECTION_CODE &&
    CREATIVE_CODE !== MAINTENANCE_CODE
  );
}

export type EnsureOutcome = 'present' | 'created' | 'disabled' | 'failed';

/**
 * Idempotently make sure this lock carries the creative PIN. Matches by PIN
 * digits across managed AND unmanaged codes (a hand-programmed 5555 in the
 * Schlage app counts as present; creating a duplicate PIN would be refused by
 * the lock anyway). On create, the code is registered in lock_access_codes
 * right away so a shoot-day keypad entry never reads as a guest in residence.
 * Never throws.
 */
export async function ensureCreativeCode(sb: SupabaseClient, deviceId: string): Promise<EnsureOutcome> {
  if (!creativeCodeEnabled()) return 'disabled';
  try {
    const [unmanaged, managed] = await Promise.all([
      listUnmanagedAccessCodes(deviceId).catch(() => [] as SeamAccessCodeFull[]),
      listAccessCodes(deviceId).catch(() => [] as SeamAccessCodeFull[]),
    ]);
    const existing = [...unmanaged, ...managed].find((c) => (c.code ?? '').trim() === CREATIVE_CODE);
    if (existing) return 'present';

    const ac = await createPermanentAccessCode({
      deviceId,
      name: CREATIVE_CODE_NAME,
      code: CREATIVE_CODE,
    });
    if (ac?.access_code_id) {
      await sb.from('lock_access_codes').upsert(
        {
          device_id: deviceId,
          access_code_id: ac.access_code_id,
          name: CREATIVE_CODE_NAME,
          role: classifyCodeRole(CREATIVE_CODE_NAME),
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
