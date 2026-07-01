/**
 * Verified arrival for a Field packet stop: a Seam lock.unlocked whose
 * access_code_id matches the contractor's per-packet PIN (packet_access_codes)
 * is physical proof they reached that door. Mirrors recordInspectorEntry, but
 * keyed to the packet code rather than the shared master code.
 *
 * Honesty rules (a false positive would wrongly claim someone was on site):
 *   - keypad entries only; a physical/mobile/auto unlock is not a code entry.
 *   - EXACT access_code_id match to a live packet_access_codes row. No
 *     any-keypad fallback (unlike the single cleaner code): a guest PIN on the
 *     same lock must never read as the contractor.
 *   - the packet PIN is unique per packet, and unique(packet_id, property_id)
 *     makes device -> property -> stop 1:1, so the arrival lands on one stop.
 *
 * Earliest verified entry wins. Also writes a `stop_arrived` packet_event that
 * the office timeline and the live poll read. Server-only (service-role writes).
 *
 * Wired from: /api/webhooks/seam (lock.unlocked) and /api/sync-seam backfill.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isKeypadEntry, type LockEventInput } from '@/lib/cleaning-sessions';

type Outcome = { ok: boolean; reason?: string; packetId?: string; stopId?: string };

export async function recordPacketArrival(sb: SupabaseClient, ev: LockEventInput): Promise<Outcome> {
  if (!isKeypadEntry(ev.method)) return { ok: false, reason: `non-keypad method (${ev.method})` };
  if (!ev.accessCodeId) return { ok: false, reason: 'no access_code_id (cannot attribute)' };

  // Match ALL live codes for this device: a programPacketCodes re-run can mint a
  // fresh seam_access_code_id on the same PIN, so we check every open row.
  const { data: codes } = await sb
    .from('packet_access_codes')
    .select('packet_id, property_id, device_id, seam_access_code_id')
    .eq('device_id', ev.deviceId)
    .is('removed_at', null);
  const match = ((codes ?? []) as {
    packet_id: string; property_id: string; device_id: string; seam_access_code_id: string | null;
  }[]).find((c) => c.seam_access_code_id && c.seam_access_code_id === ev.accessCodeId);
  if (!match) return { ok: false, reason: 'not a live packet code for this lock' };

  // device -> property -> stop is 1:1 via unique(packet_id, property_id).
  const { data: sData } = await sb
    .from('packet_stops')
    .select('id, arrived_verified_at, started_at, status')
    .eq('packet_id', match.packet_id)
    .eq('property_id', match.property_id)
    .maybeSingle();
  const stop = sData as { id: string; arrived_verified_at: string | null; started_at: string | null; status: string } | null;
  if (!stop) return { ok: false, reason: 'no stop for this packet + property' };

  // Earliest verified entry wins (they may punch in more than once).
  const prior = stop.arrived_verified_at;
  if (prior && prior <= ev.occurredAt) {
    return { ok: true, packetId: match.packet_id, stopId: stop.id };
  }

  // both = they also tapped Start; lock = door proof arrived first.
  const source = stop.started_at ? 'both' : 'lock';
  const { error } = await sb
    .from('packet_stops')
    .update({
      arrived_verified_at: ev.occurredAt,
      arrival_source: source,
      verified_device_id: ev.deviceId,
      verified_access_code_id: ev.accessCodeId,
    })
    .eq('id', stop.id);
  if (error) return { ok: false, reason: error.message };

  await sb.from('packet_events').insert({
    packet_id: match.packet_id,
    property_id: match.property_id,
    event_type: 'stop_arrived',
    payload: { source: 'lock', device_id: ev.deviceId },
  });

  return { ok: true, packetId: match.packet_id, stopId: stop.id };
}
