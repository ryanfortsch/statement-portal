/**
 * Field × Seam door codes. When an inspector claims a packet, program their
 * rotating PIN onto every stop's Schlage lock for the claim→submit window;
 * revoke on submit/release/cancel. Stays dark (no-op) until Seam is configured
 * AND a stop's property has a mapped, active lock — same posture as the battery
 * integration, so it never blocks the flow when locks aren't connected.
 */
import 'server-only';
import { fieldDb } from '@/lib/field-db';
import { seamConfigured, createAccessCode, deleteAccessCode } from '@/lib/seam';

function randomPin(): string {
  return String(1000 + Math.floor(Math.random() * 9000)); // 4-digit, no leading zero
}

export async function programPacketCodes(packetId: string): Promise<string | null> {
  const db = fieldDb();

  const { data: pkt } = await db
    .from('inspection_packets')
    .select('id, visit_date, entry_code, awarded_contractor_id')
    .eq('id', packetId)
    .maybeSingle();
  const packet = pkt as
    | { id: string; visit_date: string; entry_code: string | null; awarded_contractor_id: string | null }
    | null;
  if (!packet) return null;

  // Always give the packet ONE trip code the moment it's claimed, even when Seam
  // is dark or no lock is mapped -- the inspector needs a code to show at every
  // stop regardless. Programming that PIN into real locks (below) is the only
  // part that needs Seam + a mapped device.
  const pin = packet.entry_code ?? randomPin();
  if (!packet.entry_code) {
    await db.from('inspection_packets').update({ entry_code: pin, updated_at: new Date().toISOString() }).eq('id', packetId);
  }

  if (!seamConfigured()) return pin;

  const { data: stops } = await db.from('packet_stops').select('property_id').eq('packet_id', packetId);
  const propIds = [...new Set(((stops ?? []) as { property_id: string }[]).map((s) => s.property_id))];
  if (propIds.length === 0) return pin;

  const { data: locks } = await db
    .from('lock_devices')
    .select('device_id, property_id')
    .in('property_id', propIds)
    .eq('active', true);
  const lockRows = ((locks ?? []) as { device_id: string; property_id: string | null }[]).filter(
    (l) => l.device_id && l.property_id,
  );
  if (lockRows.length === 0) return pin; // no mapped locks: the code still shows, it just isn't programmed into a door

  let label = 'Rising Tide inspector';
  if (packet.awarded_contractor_id) {
    const { data: c } = await db.from('contractors').select('full_name').eq('id', packet.awarded_contractor_id).maybeSingle();
    label = (c as { full_name: string } | null)?.full_name ?? label;
  }

  const startsAt = new Date().toISOString();
  // End-of-visit-day backstop so a code self-expires even if a revoke is missed.
  const endsAt = new Date(`${packet.visit_date}T23:59:59-04:00`).toISOString();

  const { data: existing } = await db
    .from('packet_access_codes')
    .select('device_id')
    .eq('packet_id', packetId)
    .is('removed_at', null);
  const alreadyCoded = new Set(((existing ?? []) as { device_id: string | null }[]).map((e) => e.device_id));

  for (const lock of lockRows) {
    if (alreadyCoded.has(lock.device_id)) continue;
    try {
      const ac = await createAccessCode({
        deviceId: lock.device_id,
        name: `Field · ${label}`,
        code: pin,
        startsAt,
        endsAt,
      });
      await db.from('packet_access_codes').insert({
        packet_id: packetId,
        property_id: lock.property_id,
        device_id: lock.device_id,
        seam_access_code_id: ac?.access_code_id ?? null,
        code: pin,
      });
    } catch {
      // One lock refusing the code shouldn't block the others.
    }
  }

  return pin;
}

/** Remove every live programmed code for a packet (submit / release / cancel). */
export async function revokePacketCodes(packetId: string): Promise<void> {
  if (!seamConfigured()) return;
  const db = fieldDb();
  const { data: codes } = await db
    .from('packet_access_codes')
    .select('id, seam_access_code_id')
    .eq('packet_id', packetId)
    .is('removed_at', null);
  for (const r of (codes ?? []) as { id: string; seam_access_code_id: string | null }[]) {
    if (r.seam_access_code_id) {
      try {
        await deleteAccessCode(r.seam_access_code_id);
      } catch {
        // Already removed or expired upstream — still mark it removed locally.
      }
    }
    await db.from('packet_access_codes').update({ removed_at: new Date().toISOString() }).eq('id', r.id);
  }
}
