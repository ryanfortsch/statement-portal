/**
 * Field packet grouping + loaders.
 *
 * Turns the existing turnover obligations (the Helm-native `bookings` table)
 * into "packets": geographically-tight clusters of properties that are all
 * inspectable on a shared day, priced for one contractor visit.
 *
 * The grouping is a thin function over existing data:
 *   1. Derive each property's inspectable days in the window from bookings
 *      (the upcoming check-in that needs prepping) minus occupied nights and
 *      property_calendar_blocks.
 *   2. For each candidate day, cluster the inspectable properties by
 *      straight-line proximity (haversine over the populated lat/lng) with a
 *      complete-linkage max-pairwise gate so a far property never chains in.
 *   3. Price each cluster (per-property base + small travel-spread adder).
 *
 * Server-only: reads through the service-role client.
 */
import 'server-only';
import { fieldDb } from '@/lib/field-db';
import { getPropertyAccessMap, type PropertyAccess } from '@/lib/property-access';
import { centroid, maxPairwiseMiles, nearestNeighborOrder } from '@/lib/proximity';
import {
  accessBundle,
  cityShort,
  type FieldProperty,
  type PacketDetail,
  type PacketRow,
  type PacketStopRow,
  type PacketStopDetail,
  type PacketSuggestion,
  type WindowBasis,
  type ContractorRow,
} from '@/lib/field-types';

// Same exclusions the Operations turnover pipeline uses: out-of-region
// properties Rising Tide doesn't physically inspect.
const NON_OPERATIONS_PROPERTY_IDS = new Set(['65_calderwood', '3246_ne_27th']);
const TURNOVER_STATUSES = ['confirmed', 'completed'];

// Clustering knobs.
const PROXIMITY_MILES = 3; // max straight-line spread within one packet
const MAX_STOPS = 5;
const TRAVEL_PER_MILE_CENTS = 300; // small spread premium so dispersed clusters pay a bit more

// The sensitive access codes (smart_lock_code, key_code_location, gate_code,
// garage_code, alarm_system) moved to the RLS-locked property_access table;
// they're merged in via getPropertyAccessMap, not selected here.
const PROPERTY_COLS =
  'id, name, title, address, city, latitude, longitude, inspection_base_price_cents, ' +
  'guest_access_method, smart_lock_brand, parking';

/** Layer a property's access codes (from property_access) onto the row read
 *  from properties, producing the full FieldProperty the access bundle needs. */
function mergeAccess(p: FieldProperty, access: PropertyAccess | undefined): FieldProperty {
  return {
    ...p,
    smart_lock_code: access?.smart_lock_code ?? null,
    key_code_location: access?.key_code_location ?? null,
    gate_code: access?.gate_code ?? null,
    garage_code: access?.garage_code ?? null,
    alarm_system: access?.alarm_system ?? null,
  };
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}
function addDays(base: string, n: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}
function daysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  let cur = a;
  let guard = 0;
  while (cur <= b && guard < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

export async function loadFieldProperties(): Promise<FieldProperty[]> {
  const { data } = await fieldDb()
    .from('properties')
    .select(PROPERTY_COLS)
    .eq('is_active', true);
  const rows = ((data ?? []) as unknown as FieldProperty[]).filter(
    (p) => !NON_OPERATIONS_PROPERTY_IDS.has(p.id),
  );
  const accessMap = await getPropertyAccessMap(rows.map((p) => p.id));
  return rows.map((p) => mergeAccess(p, accessMap.get(p.id)));
}

type BookingRaw = {
  id: string;
  property_id: string;
  check_in: string;
  check_out: string;
  status: string | null;
};

/** A single inspectable opportunity: property P can be inspected on `day`
 *  ahead of the upcoming stay `nextCheckin`. */
type DayCandidate = {
  propertyId: string;
  day: string;
  basis: WindowBasis;
  bookingId: string | null;
  priorCheckout: string | null;
  nextCheckin: string | null;
};

/**
 * For every active property, enumerate the days in [windowStart, windowEnd]
 * on which it can be inspected ahead of an upcoming check-in. A day qualifies
 * if the property is not occupied overnight and not calendar-blocked.
 */
async function deriveDayCandidates(
  properties: FieldProperty[],
  windowStart: string,
  windowEnd: string,
): Promise<DayCandidate[]> {
  const propIds = new Set(properties.map((p) => p.id));
  // Pull bookings around the window (30d back to resolve prior checkouts).
  const fetchStart = addDays(windowStart, -30);
  const fetchEnd = addDays(windowEnd, 1);
  const { data: bData } = await fieldDb()
    .from('bookings')
    .select('id, property_id, check_in, check_out, status')
    .in('status', TURNOVER_STATUSES)
    .is('duplicate_of', null)
    .lte('check_in', fetchEnd)
    .gte('check_out', fetchStart)
    .order('check_in', { ascending: true });
  const bookings = ((bData ?? []) as BookingRaw[]).filter(
    (b) => propIds.has(b.property_id) && b.check_in && b.check_out,
  );

  const { data: blkData } = await fieldDb()
    .from('property_calendar_blocks')
    .select('property_id, date')
    .gte('date', windowStart)
    .lte('date', windowEnd);
  const blocked = new Set(
    ((blkData ?? []) as { property_id: string; date: string }[]).map((b) => `${b.property_id}:${b.date}`),
  );

  const byProp = new Map<string, BookingRaw[]>();
  for (const b of bookings) {
    const arr = byProp.get(b.property_id) ?? [];
    arr.push(b);
    byProp.set(b.property_id, arr);
  }

  const today = todayStr();
  const out: DayCandidate[] = [];

  for (const prop of properties) {
    const propBookings = (byProp.get(prop.id) ?? []).slice().sort((a, b) => a.check_in.localeCompare(b.check_in));
    // Occupied night test: night D is covered iff a booking has
    // check_in <= D < check_out.
    const occupiedOn = (d: string) =>
      propBookings.some((b) => b.check_in <= d && d < b.check_out);

    // Each upcoming check-in within the window is a reason to inspect.
    const upcoming = propBookings.filter((b) => b.check_in >= windowStart && b.check_in <= windowEnd);
    for (const stay of upcoming) {
      const checkIn = stay.check_in;
      // Most recent checkout on/before this check-in (the turnover this preps).
      const priorCheckout =
        propBookings
          .filter((b) => b.check_out <= checkIn && b.id !== stay.id)
          .map((b) => b.check_out)
          .sort()
          .at(-1) ?? null;

      const lo = [today, windowStart, priorCheckout ?? windowStart]
        .filter(Boolean)
        .sort()
        .at(-1) as string;
      const hi = checkIn < windowEnd ? checkIn : windowEnd;
      for (const day of daysBetween(lo, hi)) {
        if (blocked.has(`${prop.id}:${day}`)) continue;
        // The night before check-in must be free (don't inspect into an
        // occupied night), except the check-in day itself which is a
        // tight pre-arrival window.
        if (day < checkIn && occupiedOn(day)) continue;
        let basis: WindowBasis = 'vacant';
        if (priorCheckout && day === priorCheckout) basis = 'checkout_day';
        else if (day === checkIn) basis = 'pre_checkin';
        out.push({
          propertyId: prop.id,
          day,
          basis,
          bookingId: stay.id,
          priorCheckout,
          nextCheckin: checkIn,
        });
      }
    }
  }
  return out;
}

function priceCents(basePrices: number[], spreadMiles: number): number {
  const base = basePrices.reduce((a, b) => a + b, 0);
  const travel = Math.round(spreadMiles * TRAVEL_PER_MILE_CENTS);
  return base + travel;
}

function clusterName(props: FieldProperty[]): string {
  // A tight place label: the dominant shared street/neighborhood, else the
  // town (no "cluster", no state suffix). The stored title appends the stop
  // count, e.g. "Rocky Neck · 3 stops" / "Gloucester · 3 stops".
  if (props.length === 1) return props[0].name;
  const streets = props.map((p) => {
    const m = (p.name || '').match(/[A-Za-z][A-Za-z\s]+$/);
    return (m ? m[0] : p.name).trim();
  });
  const counts = new Map<string, number>();
  for (const s of streets) counts.set(s, (counts.get(s) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (dominant && (counts.get(dominant) ?? 0) > 1) return dominant;
  return cityShort(props[0].city) || props[0].name;
}

/**
 * Suggest packets across a date window. Greedy: each property is assigned to
 * its EARLIEST feasible day, then properties inspectable that day are
 * clustered by proximity. Excludes properties already in an active packet.
 */
export async function suggestPackets(
  windowStart: string = todayStr(),
  windowEnd: string = addDays(todayStr(), 14),
): Promise<PacketSuggestion[]> {
  const properties = await loadFieldProperties();
  const propById = new Map(properties.map((p) => [p.id, p]));
  const withCoords = properties.filter((p) => p.latitude != null && p.longitude != null);

  // Exclude properties already committed to a live packet.
  const { data: activeStops } = await fieldDb()
    .from('packet_stops')
    .select('property_id, inspection_packets!inner(status)')
    .in('inspection_packets.status', ['published', 'claimed', 'in_progress', 'submitted']);
  const committed = new Set(((activeStops ?? []) as { property_id: string }[]).map((s) => s.property_id));

  const candidates = (await deriveDayCandidates(withCoords, windowStart, windowEnd)).filter(
    (c) => !committed.has(c.propertyId),
  );

  // Group candidates by day. For each property keep only its earliest day so
  // it isn't packeted twice.
  const earliestDay = new Map<string, string>();
  for (const c of candidates) {
    const cur = earliestDay.get(c.propertyId);
    if (!cur || c.day < cur) earliestDay.set(c.propertyId, c.day);
  }
  const byDay = new Map<string, DayCandidate[]>();
  for (const c of candidates) {
    if (earliestDay.get(c.propertyId) !== c.day) continue;
    const arr = byDay.get(c.day) ?? [];
    arr.push(c);
    byDay.set(c.day, arr);
  }

  const assigned = new Set<string>();
  const suggestions: PacketSuggestion[] = [];

  for (const day of [...byDay.keys()].sort()) {
    const dayCands = (byDay.get(day) ?? []).filter((c) => !assigned.has(c.propertyId));
    // Greedy proximity clustering with a complete-linkage gate.
    const remaining = dayCands.slice();
    while (remaining.length > 0) {
      const seed = remaining.shift()!;
      const cluster = [seed];
      const clusterProps = [propById.get(seed.propertyId)!];
      let changed = true;
      while (changed && cluster.length < MAX_STOPS) {
        changed = false;
        for (let i = 0; i < remaining.length; i++) {
          const cand = remaining[i];
          const p = propById.get(cand.propertyId)!;
          const trial = [...clusterProps, p].map((q) => ({ lat: q.latitude!, lng: q.longitude! }));
          if (maxPairwiseMiles(trial) <= PROXIMITY_MILES) {
            cluster.push(cand);
            clusterProps.push(p);
            remaining.splice(i, 1);
            changed = true;
            break;
          }
        }
      }
      for (const c of cluster) assigned.add(c.propertyId);

      const pts = clusterProps.map((p) => ({ lat: p.latitude!, lng: p.longitude! }));
      const order = nearestNeighborOrder(pts);
      const spread = maxPairwiseMiles(pts);
      const cen = centroid(pts);
      const stops = order.map((idx, walk) => {
        const c = cluster[idx];
        const p = clusterProps[idx];
        return {
          propertyId: p.id,
          propertyName: p.name,
          bookingId: c.bookingId,
          windowBasis: c.basis,
          priorCheckout: c.priorCheckout,
          nextCheckin: c.nextCheckin,
          basePriceCents: p.inspection_base_price_cents ?? 7500,
          walkOrder: walk,
        };
      });
      const sortedIds = stops.map((s) => s.propertyId).slice().sort();
      suggestions.push({
        title: `${clusterName(clusterProps)} · ${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}`,
        visitDate: day,
        windowStart: day,
        windowEnd: day,
        centroidLat: cen?.lat ?? null,
        centroidLng: cen?.lng ?? null,
        maxPairwiseMiles: spread,
        postedPriceCents: priceCents(stops.map((s) => s.basePriceCents), spread),
        suggestionKey: `${day}:${sortedIds.join(',')}`,
        stops,
      });
    }
  }

  return suggestions;
}

/** Persist suggestions as draft packets, idempotent on suggestion_key. */
export async function persistSuggestions(
  suggestions: PacketSuggestion[],
  createdByEmail: string,
): Promise<number> {
  let created = 0;
  for (const s of suggestions) {
    const { data: existing } = await fieldDb()
      .from('inspection_packets')
      .select('id')
      .eq('suggestion_key', s.suggestionKey)
      .maybeSingle();
    if (existing) continue;
    const { data: packet, error } = await fieldDb()
      .from('inspection_packets')
      .insert({
        title: s.title,
        status: 'draft',
        visit_date: s.visitDate,
        window_start: s.windowStart,
        window_end: s.windowEnd,
        centroid_lat: s.centroidLat,
        centroid_lng: s.centroidLng,
        max_pairwise_miles: s.maxPairwiseMiles,
        stop_count: s.stops.length,
        posted_price_cents: s.postedPriceCents,
        auto_generated: true,
        suggestion_key: s.suggestionKey,
        created_by_email: createdByEmail,
      })
      .select('id')
      .single();
    if (error || !packet) continue;
    const packetId = (packet as { id: string }).id;
    await fieldDb().from('packet_stops').insert(
      s.stops.map((st) => ({
        packet_id: packetId,
        property_id: st.propertyId,
        booking_id: st.bookingId,
        window_basis: st.windowBasis,
        prior_checkout: st.priorCheckout,
        next_checkin: st.nextCheckin,
        base_price_cents: st.basePriceCents,
        walk_order: st.walkOrder,
      })),
    );
    created++;
  }
  return created;
}

export async function loadPackets(statuses?: string[]): Promise<PacketRow[]> {
  let q = fieldDb().from('inspection_packets').select('*').order('visit_date', { ascending: true });
  if (statuses && statuses.length) q = q.in('status', statuses);
  const { data } = await q;
  return (data ?? []) as PacketRow[];
}

async function stopsWithProperties(
  stops: PacketStopRow[],
  revealAccess: boolean,
): Promise<PacketStopDetail[]> {
  if (stops.length === 0) return [];
  const ids = [...new Set(stops.map((s) => s.property_id))];
  const { data } = await fieldDb().from('properties').select(PROPERTY_COLS).in('id', ids);
  const accessMap = await getPropertyAccessMap(ids);
  const propById = new Map(
    ((data ?? []) as unknown as FieldProperty[]).map((p) => [p.id, mergeAccess(p, accessMap.get(p.id))]),
  );
  return stops
    .slice()
    .sort((a, b) => a.walk_order - b.walk_order)
    .map((s) => {
      const property = propById.get(s.property_id)!;
      return {
        ...s,
        property,
        access: revealAccess && property ? accessBundle(property) : null,
      };
    });
}

export async function loadPacketDetail(
  packetId: string,
  opts: { revealAccess?: boolean } = {},
): Promise<PacketDetail | null> {
  const { data: pData } = await fieldDb()
    .from('inspection_packets')
    .select('*')
    .eq('id', packetId)
    .maybeSingle();
  const packet = (pData as PacketRow | null) ?? null;
  if (!packet) return null;
  const { data: sData } = await fieldDb().from('packet_stops').select('*').eq('packet_id', packetId);
  const stops = await stopsWithProperties((sData ?? []) as PacketStopRow[], !!opts.revealAccess);
  let contractor: ContractorRow | null = null;
  if (packet.awarded_contractor_id) {
    const { data: cData } = await fieldDb()
      .from('contractors')
      .select('*')
      .eq('id', packet.awarded_contractor_id)
      .maybeSingle();
    contractor = (cData as ContractorRow | null) ?? null;
  }
  return { ...packet, stops, contractor };
}

/**
 * What a contractor sees: published packets they can claim (if onboarded) +
 * any packet already awarded to them. Access details are only revealed for
 * packets awarded to this contractor.
 */
export async function loadContractorMarketplace(contractorId: string): Promise<{
  available: PacketDetail[];
  mine: PacketDetail[];
}> {
  const { data: pubData } = await fieldDb()
    .from('inspection_packets')
    .select('id')
    .eq('status', 'published')
    .order('visit_date', { ascending: true });
  const { data: mineData } = await fieldDb()
    .from('inspection_packets')
    .select('id')
    .eq('awarded_contractor_id', contractorId)
    .in('status', ['claimed', 'in_progress', 'submitted', 'approved'])
    .order('visit_date', { ascending: true });

  const available = (
    await Promise.all(((pubData ?? []) as { id: string }[]).map((p) => loadPacketDetail(p.id)))
  ).filter(Boolean) as PacketDetail[];
  const mine = (
    await Promise.all(
      ((mineData ?? []) as { id: string }[]).map((p) => loadPacketDetail(p.id, { revealAccess: true })),
    )
  ).filter(Boolean) as PacketDetail[];

  return { available, mine };
}

// ── Window re-validation ──────────────────────────────────────────────
// A stop is STALE for its packet's visit_date if a guest is now mid-stay
// that day (a booking strictly spans it: check_in < day < check_out) or the
// day was calendar-blocked since the packet was built. A turnover day
// (check_in == day or check_out == day) is NOT stale — that's the whole
// point of the visit window.
async function staleStopIds(
  visitDate: string,
  stops: Array<{ id: string; property_id: string }>,
): Promise<Set<string>> {
  if (stops.length === 0) return new Set();
  const ids = [...new Set(stops.map((s) => s.property_id))];
  const { data: bData } = await fieldDb()
    .from('bookings')
    .select('property_id')
    .in('status', TURNOVER_STATUSES)
    .is('duplicate_of', null)
    .in('property_id', ids)
    .lt('check_in', visitDate)
    .gt('check_out', visitDate);
  const occupied = new Set(((bData ?? []) as { property_id: string }[]).map((r) => r.property_id));
  const { data: blkData } = await fieldDb()
    .from('property_calendar_blocks')
    .select('property_id')
    .eq('date', visitDate)
    .in('property_id', ids);
  const blocked = new Set(((blkData ?? []) as { property_id: string }[]).map((r) => r.property_id));
  const stale = new Set<string>();
  for (const s of stops) {
    if (occupied.has(s.property_id) || blocked.has(s.property_id)) stale.add(s.id);
  }
  return stale;
}

/**
 * Re-check a packet against current bookings/blocks: drop any stop whose
 * property is no longer inspectable on the visit date, reprice from the
 * survivors, and cancel the packet if nothing valid remains. Returns what
 * changed so callers (publish, claim, cron) can react.
 */
export async function revalidatePacket(
  packetId: string,
): Promise<{ removed: number; remaining: number; emptied: boolean }> {
  const { data: pData } = await fieldDb()
    .from('inspection_packets')
    .select('id, status, visit_date')
    .eq('id', packetId)
    .maybeSingle();
  const packet = pData as { id: string; status: string; visit_date: string } | null;
  if (!packet) return { removed: 0, remaining: 0, emptied: true };

  const { data: sData } = await fieldDb()
    .from('packet_stops')
    .select('id, property_id, base_price_cents')
    .eq('packet_id', packetId);
  const stops = (sData ?? []) as Array<{ id: string; property_id: string; base_price_cents: number }>;
  const stale = await staleStopIds(packet.visit_date, stops);
  if (stale.size === 0) return { removed: 0, remaining: stops.length, emptied: false };

  await fieldDb().from('packet_stops').delete().in('id', [...stale]);
  const remaining = stops.filter((s) => !stale.has(s.id));
  const emptied = remaining.length === 0;
  await fieldDb()
    .from('inspection_packets')
    .update({
      stop_count: remaining.length,
      posted_price_cents: remaining.reduce((a, s) => a + s.base_price_cents, 0),
      status: emptied ? 'cancelled' : packet.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', packetId);
  return { removed: stale.size, remaining: remaining.length, emptied };
}

/** Cron helper: re-validate every published packet so the marketplace never
 *  shows a packet a guest has since moved into. */
export async function revalidatePublishedPackets(): Promise<{ checked: number; changed: number }> {
  const { data } = await fieldDb().from('inspection_packets').select('id').eq('status', 'published');
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  let changed = 0;
  for (const id of ids) {
    const r = await revalidatePacket(id);
    if (r.removed > 0 || r.emptied) changed++;
  }
  return { checked: ids.length, changed };
}

// ── Turnover integration ──────────────────────────────────────────────
export type PacketStatusForBooking = {
  packetId: string;
  status: string;
  contractorName: string | null;
  visitDate: string;
};

/** Map a set of booking ids to the live (non-cancelled) packet that preps
 *  them, so the Turnovers page can show a "Field" chip on each row. */
export async function loadPacketStatusByBooking(
  bookingIds: string[],
): Promise<Map<string, PacketStatusForBooking>> {
  const map = new Map<string, PacketStatusForBooking>();
  const ids = [...new Set(bookingIds.filter(Boolean))];
  if (ids.length === 0) return map;
  const { data } = await fieldDb()
    .from('packet_stops')
    .select('booking_id, inspection_packets!inner(id, status, awarded_contractor_id, visit_date)')
    .in('booking_id', ids);
  type Row = {
    booking_id: string | null;
    inspection_packets: { id: string; status: string; awarded_contractor_id: string | null; visit_date: string };
  };
  const rows = ((data ?? []) as unknown as Row[]).filter(
    (r) => r.inspection_packets && r.inspection_packets.status !== 'cancelled',
  );
  const cids = [
    ...new Set(rows.map((r) => r.inspection_packets.awarded_contractor_id).filter(Boolean) as string[]),
  ];
  const names = new Map<string, string>();
  if (cids.length) {
    const { data: c } = await fieldDb().from('contractors').select('id, full_name').in('id', cids);
    for (const row of (c ?? []) as { id: string; full_name: string }[]) names.set(row.id, row.full_name);
  }
  for (const r of rows) {
    if (!r.booking_id) continue;
    const ip = r.inspection_packets;
    map.set(r.booking_id, {
      packetId: ip.id,
      status: ip.status,
      contractorName: ip.awarded_contractor_id ? names.get(ip.awarded_contractor_id) ?? null : null,
      visitDate: ip.visit_date,
    });
  }
  return map;
}

// ── Field payout ledger ───────────────────────────────────────────────
export type ContractorPayStats = {
  approvedCount: number;
  paidCount: number;
  owedCents: number; // approved packets not yet marked paid
  paidCents: number; // approved packets marked paid
};

/** Per-contractor Field earnings: only APPROVED packets count toward pay, so
 *  unreviewed work never shows as owed. This is Field's own ledger, separate
 *  from the books/1099 rollup (which tracks the actual bank payment). */
export async function getContractorPayStats(): Promise<Map<string, ContractorPayStats>> {
  const { data } = await fieldDb()
    .from('inspection_packets')
    .select('awarded_contractor_id, posted_price_cents, paid_at')
    .eq('status', 'approved')
    .not('awarded_contractor_id', 'is', null);
  const map = new Map<string, ContractorPayStats>();
  for (const r of (data ?? []) as Array<{
    awarded_contractor_id: string;
    posted_price_cents: number;
    paid_at: string | null;
  }>) {
    const s = map.get(r.awarded_contractor_id) ?? { approvedCount: 0, paidCount: 0, owedCents: 0, paidCents: 0 };
    s.approvedCount++;
    if (r.paid_at) {
      s.paidCount++;
      s.paidCents += r.posted_price_cents;
    } else {
      s.owedCents += r.posted_price_cents;
    }
    map.set(r.awarded_contractor_id, s);
  }
  return map;
}
