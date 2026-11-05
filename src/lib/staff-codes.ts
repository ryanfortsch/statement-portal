/**
 * Converge staff keypad codes (staff-code-rules.ts) onto one lock. Runs on the
 * daily Seam sync and the Sync Seam devices button, beside the maintenance and
 * creative PINs, so the decision of which codes belong where lives in the pure
 * rules and this file only talks to Seam.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  classifyCodeRole,
  createPermanentAccessCode,
  deleteAccessCode,
  listAccessCodes,
  listUnmanagedAccessCodes,
  type SeamAccessCodeFull,
} from '@/lib/seam';
import { CLEANER_CODE } from '@/lib/cleaning-sessions';
import { INSPECTION_CODE } from '@/lib/inspection-sessions';
import { MAINTENANCE_CODE } from '@/lib/maintenance-code';
import { CREATIVE_CODE } from '@/lib/creative-code';
import { TEAM_MEMBERS } from '@/lib/team';
import { STAFF_CODES, planLockStaffCodes, staffCodeIntents, type LockCodeLite } from '@/lib/staff-code-rules';

function fleetPins(): string[] {
  return [CLEANER_CODE, INSPECTION_CODE, MAINTENANCE_CODE, CREATIVE_CODE].filter(Boolean);
}

/** True for any PIN a random guest or Field code must never take: the fleet
 *  codes and every staff code, active or not (the lock refuses a duplicate,
 *  and a shared PIN misattributes keypad unlocks). */
export function isReservedPin(pin: string): boolean {
  return fleetPins().includes(pin) || STAFF_CODES.some((c) => c.code === pin);
}

export type StaffCodeTally = { present: number; created: number; revoked: number; failed: number };

const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/**
 * Idempotently put each wanted staff code on this lock and take off the ones
 * Helm made for someone who has left. On create, the code is registered in
 * lock_access_codes right away (role staff) so the teammate's first entry
 * never reads as a guest. Never throws: a Seam hiccup counts as failed and
 * the next sync tries again.
 */
export async function ensureStaffCodes(
  sb: SupabaseClient,
  deviceId: string,
  propertyId: string | null,
): Promise<StaffCodeTally> {
  const tally: StaffCodeTally = { present: 0, created: 0, revoked: 0, failed: 0 };
  const intents = staffCodeIntents(STAFF_CODES, TEAM_MEMBERS, fleetPins(), todayET());
  if (!intents.length) return tally;
  try {
    let homeActive: boolean | null = null;
    if (propertyId) {
      const { data } = await sb.from('properties').select('is_active').eq('id', propertyId).maybeSingle();
      homeActive = (data as { is_active: boolean | null } | null)?.is_active ?? null;
    }
    const [unmanaged, managed] = await Promise.all([
      listUnmanagedAccessCodes(deviceId),
      listAccessCodes(deviceId),
    ]);
    const lite = (codes: SeamAccessCodeFull[], isManaged: boolean): LockCodeLite[] =>
      codes.map((c) => ({ access_code_id: c.access_code_id, code: c.code, name: c.name, managed: isManaged }));
    const actions = planLockStaffCodes(intents, [...lite(unmanaged, false), ...lite(managed, true)], homeActive);

    for (const a of actions) {
      try {
        if (a.kind === 'present') {
          tally.present += 1;
        } else if (a.kind === 'create') {
          const ac = await createPermanentAccessCode({ deviceId, name: a.intent.name, code: a.intent.code });
          if (ac?.access_code_id) {
            await sb.from('lock_access_codes').upsert(
              {
                device_id: deviceId,
                access_code_id: ac.access_code_id,
                name: a.intent.name,
                role: classifyCodeRole(a.intent.name),
                resolved_at: new Date().toISOString(),
              },
              { onConflict: 'device_id,access_code_id' },
            );
          }
          tally.created += 1;
        } else {
          // The delete is asynchronous on the lock; the next sync re-lists and
          // retries if it did not take.
          await deleteAccessCode(a.accessCodeId);
          tally.revoked += 1;
        }
      } catch {
        tally.failed += 1;
      }
    }
  } catch {
    tally.failed += 1;
  }
  return tally;
}
