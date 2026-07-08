/**
 * Post-visit issue reporting for Field inspectors.
 *
 * An inspector can flag something they noticed for up to 72 hours after they
 * were at a property. "Was at a property" is grounded in the same arrival
 * timing that drives the live tracker: a stop's most recent activity
 * (departure, completion, verified door entry, or Start tap), falling back to
 * when the packet was submitted for a lockless visit with no stop timestamps.
 *
 * The window is enforced HERE (server-only, service-role reads) and re-checked
 * at submit time, so the dropdown is a convenience, not the security boundary.
 */
import 'server-only';
import { fieldDb } from '@/lib/field-db';

export const RECENT_VISIT_WINDOW_HOURS = 72;
const WINDOW_MS = RECENT_VISIT_WINDOW_HOURS * 60 * 60 * 1000;

export type RecentVisit = {
  propertyId: string;
  propertyName: string;
  propertyAddress: string;
  city: string | null;
  packetId: string;
  packetTitle: string;
  visitedAt: string; // ISO, the moment we count them as having been there
  expiresAt: string; // ISO, when the 72h window closes for this visit
};

type StopRow = {
  property_id: string;
  packet_id: string;
  status: string;
  arrived_verified_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  departed_at: string | null;
};

/** The last moment we can prove they were AT this stop. Own door/timing stamps
 *  are hard proof. The packet's submitted_at is only a fallback for a genuinely
 *  completed lockless visit (no stamps because there was no lock and no Start
 *  tap) -- never for a SKIPPED stop, which means they were dispatched there but
 *  never entered, so it must not count as a visit. */
function stopVisitedAt(s: StopRow, packetSubmittedAt: string | null): string | null {
  const fallback = s.status === 'complete' ? packetSubmittedAt : null;
  const stamps = [s.departed_at, s.completed_at, s.arrived_verified_at, s.started_at, fallback]
    .filter((v): v is string => !!v)
    .sort();
  return stamps.length ? stamps[stamps.length - 1] : null;
}

/**
 * Homes this contractor visited within the last 72 hours, newest first, one row
 * per property (their most recent visit wins). Empty when nothing is in window.
 * `nowMs` is injectable for deterministic tests; defaults to the real clock.
 */
export async function loadRecentVisits(contractorId: string, nowMs: number = Date.now()): Promise<RecentVisit[]> {
  const cutoff = new Date(nowMs - WINDOW_MS).toISOString();
  // Bound the packet scan to the last few days by visit_date (a plain date, so
  // pad it a day for timezones); the precise cutoff is applied per-stop below.
  const dateFloor = new Date(nowMs - WINDOW_MS - 36 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: pkts } = await fieldDb()
    .from('inspection_packets')
    .select('id, title, submitted_at')
    .eq('awarded_contractor_id', contractorId)
    .gte('visit_date', dateFloor);
  const packets = (pkts ?? []) as { id: string; title: string; submitted_at: string | null }[];
  if (packets.length === 0) return [];
  const packetById = new Map(packets.map((p) => [p.id, p]));

  const { data: stopData } = await fieldDb()
    .from('packet_stops')
    .select('property_id, packet_id, status, arrived_verified_at, started_at, completed_at, departed_at')
    .in('packet_id', packets.map((p) => p.id));
  const stops = (stopData ?? []) as StopRow[];

  // property_id -> most recent in-window visit
  const best = new Map<string, { visitedAt: string; packetId: string }>();
  for (const s of stops) {
    const pkt = packetById.get(s.packet_id);
    const visitedAt = stopVisitedAt(s, pkt?.submitted_at ?? null);
    if (!visitedAt || visitedAt < cutoff) continue;
    const prev = best.get(s.property_id);
    if (!prev || visitedAt > prev.visitedAt) best.set(s.property_id, { visitedAt, packetId: s.packet_id });
  }
  if (best.size === 0) return [];

  const { data: propData } = await fieldDb()
    .from('properties')
    .select('id, name, address, city')
    .in('id', [...best.keys()]);
  const propById = new Map(
    ((propData ?? []) as { id: string; name: string; address: string; city: string | null }[]).map((p) => [p.id, p]),
  );

  return [...best.entries()]
    .map(([propertyId, v]) => {
      const prop = propById.get(propertyId);
      const pkt = packetById.get(v.packetId);
      if (!prop) return null;
      return {
        propertyId,
        propertyName: prop.name,
        propertyAddress: prop.address,
        city: prop.city,
        packetId: v.packetId,
        packetTitle: pkt?.title ?? '',
        visitedAt: v.visitedAt,
        expiresAt: new Date(new Date(v.visitedAt).getTime() + WINDOW_MS).toISOString(),
      } as RecentVisit;
    })
    .filter((v): v is RecentVisit => v !== null)
    .sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));
}
