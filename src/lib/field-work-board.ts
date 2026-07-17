/**
 * The contractor-facing property-work board: every ACTIVE work slip, grouped
 * by home, for contractors the office has explicitly granted `work_board_access`
 * (it reveals the whole portfolio, so it's opt-in per contractor).
 *
 * Slips already riding a live packet (as a stop or an attachment) are held
 * back — they're spoken for on a scheduled trip, and closing one out from
 * under an assigned contractor would cross wires. They surface only as a
 * count so the list never silently lies about what's outstanding.
 */
import { fieldDb } from '@/lib/field-db';

export type BoardSlip = {
  id: string;
  property_id: string;
  title: string;
  description: string | null;
  location: string | null;
  priority: string;
  status: string;
  photo_urls: string[];
  created_at: string;
};

export type BoardGroup = {
  propertyId: string;
  propertyName: string;
  slips: BoardSlip[];
};

export type PropertyWorkBoard = {
  groups: BoardGroup[];
  /** Active slips held back because a live packet already carries them. */
  onTripCount: number;
  /** All properties (id + name) for the file-a-slip picker. */
  properties: Array<{ id: string; name: string }>;
};

const ACTIVE = ['open', 'in_progress'];
const LIVE_PACKET = ['draft', 'published', 'claimed', 'in_progress', 'submitted'];

/** Slip ids currently carried by a live packet (stop or attachment). */
export async function slipIdsOnLivePackets(): Promise<Set<string>> {
  const [{ data: stops }, { data: attach }] = await Promise.all([
    fieldDb()
      .from('packet_stops')
      .select('work_slip_id, inspection_packets!inner(status)')
      .not('work_slip_id', 'is', null)
      .in('inspection_packets.status', LIVE_PACKET),
    fieldDb()
      .from('packet_stop_work_slips')
      .select('work_slip_id, packet_stops!inner(inspection_packets!inner(status))')
      .in('packet_stops.inspection_packets.status', LIVE_PACKET),
  ]);
  const taken = new Set<string>();
  for (const r of (stops ?? []) as unknown as Array<{ work_slip_id: string }>) taken.add(r.work_slip_id);
  for (const r of (attach ?? []) as unknown as Array<{ work_slip_id: string }>) taken.add(r.work_slip_id);
  return taken;
}

export async function loadPropertyWorkBoard(): Promise<PropertyWorkBoard> {
  const [{ data: slipData }, { data: propData }, taken] = await Promise.all([
    fieldDb()
      .from('work_slips')
      .select('id, property_id, title, description, location, priority, status, photo_urls, created_at')
      .in('status', ACTIVE)
      .not('property_id', 'is', null)
      .order('created_at', { ascending: true })
      .limit(400),
    fieldDb().from('properties').select('id, name').order('name'),
    slipIdsOnLivePackets(),
  ]);

  const nameById = new Map(
    ((propData ?? []) as Array<{ id: string; name: string | null }>).map((p) => [p.id, p.name || p.id]),
  );

  const byProp = new Map<string, BoardSlip[]>();
  let onTripCount = 0;
  for (const raw of (slipData ?? []) as BoardSlip[]) {
    if (taken.has(raw.id)) {
      onTripCount++;
      continue;
    }
    const list = byProp.get(raw.property_id) ?? [];
    list.push({ ...raw, photo_urls: raw.photo_urls ?? [] });
    byProp.set(raw.property_id, list);
  }

  // High-priority slips float within a home; homes sort by name.
  const rank: Record<string, number> = { high: 0, normal: 1, low: 2 };
  const groups: BoardGroup[] = [...byProp.entries()]
    .map(([propertyId, slips]) => ({
      propertyId,
      propertyName: nameById.get(propertyId) ?? propertyId,
      slips: slips.sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) || a.created_at.localeCompare(b.created_at)),
    }))
    .sort((a, b) => a.propertyName.localeCompare(b.propertyName));

  return {
    groups,
    onTripCount,
    properties: [...nameById.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
