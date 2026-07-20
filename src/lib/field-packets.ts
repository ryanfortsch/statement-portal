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
import { centroid, haversineMiles, maxPairwiseMiles, nearestNeighborOrder, osrmOptimalOrder } from '@/lib/proximity';
import {
  PROXIMITY_MILES,
  MAX_STOPS,
  DEFAULT_BASE_CENTS,
  MAINTENANCE_BASE_CENTS,
  baseForProperty,
  priceCents,
  isRushVisit,
  setupPriceCents,
} from '@/lib/field-pricing';
import {
  accessBundle,
  cityShort,
  townsLabel,
  type FieldProperty,
  type PacketDetail,
  type PacketRow,
  type PacketStopRow,
  type PacketStopDetail,
  type PacketSuggestion,
  type WindowBasis,
  type ContractorRow,
  type WorkSlipLite,
  type AttachedSlip,
  effectiveBaseCents,
} from '@/lib/field-types';

// Same exclusions the Operations turnover pipeline uses: out-of-region
// properties Rising Tide doesn't physically inspect.
const NON_OPERATIONS_PROPERTY_IDS = new Set(['65_calderwood', '3246_ne_27th']);
// A guest reservation is a turnover to PREP (inspect before the next arrival).
const TURNOVER_STATUSES = ['confirmed', 'completed'];
// An owner / manual "block" (Guesty owner-use, etc.) means the home is OCCUPIED
// but is NOT a turnover: it must count as occupancy (never send someone to
// inspect into it, and its end is a valid checkout boundary) yet must never
// generate inspection work or a deadline. Occupancy queries fetch this superset;
// turnover/candidate logic re-filters to guest stays via isGuestStay().
const BLOCK_STATUS = 'block';
const OCCUPANCY_STATUSES = [...TURNOVER_STATUSES, BLOCK_STATUS];
const isGuestStay = (b: { status: string | null }): boolean =>
  TURNOVER_STATUSES.includes(b.status ?? '');

// Clustering + pricing knobs now live in @/lib/field-pricing (shared with the
// operator's live preview so the two can't drift).

// The sensitive access codes (smart_lock_code, key_code_location, gate_code,
// garage_code, alarm_system) moved to the RLS-locked property_access table;
// they're merged in via getPropertyAccessMap, not selected here.
const PROPERTY_COLS =
  'id, name, title, address, city, kind, latitude, longitude, inspection_base_price_cents, bedrooms, ' +
  'guest_access_method, smart_lock_brand, parking, supply_closet_location';

/** Layer a property's access codes (from property_access) onto the row read
 *  from properties, producing the full FieldProperty the access bundle needs. */
function mergeAccess(p: FieldProperty, access: PropertyAccess | undefined): FieldProperty {
  return {
    ...p,
    smart_lock_code: access?.smart_lock_code ?? null,
    key_code_location: access?.key_code_location ?? null,
    arrival_brief: access?.arrival_brief ?? null,
    gate_code: access?.gate_code ?? null,
    garage_code: access?.garage_code ?? null,
    alarm_system: access?.alarm_system ?? null,
  };
}

function todayStr(): string {
  // America/New_York local date. Using UTC here rolled "today" to tomorrow
  // every evening (~7-8pm ET until midnight UTC) — exactly when the operator
  // plans the next day — dropping same-day windows and inventing phantom ones.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
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
  // Active managed rentals PLUS every non-managed work location (HQ, prospect
  // homes) — those are seeded is_active=false so revenue/ops surfaces skip
  // them, and the Field module is the one place that opts them in. Callers
  // that only make sense for rentals (routine-check suggestions, the office
  // inspection calendar) filter kind === 'managed' themselves.
  const { data } = await fieldDb()
    .from('properties')
    .select(PROPERTY_COLS)
    .or('is_active.eq.true,kind.neq.managed');
  const rows = ((data ?? []) as unknown as FieldProperty[]).filter(
    (p) => !NON_OPERATIONS_PROPERTY_IDS.has(p.id),
  );
  const accessMap = await getPropertyAccessMap(rows.map((p) => p.id));
  // Fold home size into the per-stop base once, here, so every downstream
  // consumer (suggest, bundle, preview) reads the same effective price.
  return rows.map((p) => ({
    ...mergeAccess(p, accessMap.get(p.id)),
    inspection_base_price_cents: baseForProperty(p.inspection_base_price_cents, p.bedrooms),
  }));
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
    .in('status', OCCUPANCY_STATUSES)
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

    // Each upcoming GUEST check-in within the window is a reason to inspect.
    // Owner/manual blocks are occupancy only (occupiedOn / priorCheckout below
    // see them), never a turnover to prep.
    const upcoming = propBookings.filter(
      (b) => isGuestStay(b) && b.check_in >= windowStart && b.check_in <= windowEnd,
    );
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
  // A property with two upcoming stays can produce the same (property, day)
  // candidate twice (e.g. two bookings both leaving the property inspectable
  // that day). Collapse to one per (property, day) — the earliest stay wins,
  // since candidates are emitted in check-in order — so a property never
  // appears twice in the work list or twice in one packet.
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = `${c.propertyId}:${c.day}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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
  // A street label claims every stop is on it; a single-town label claims every
  // stop is in it. Only make claims that are true — a "Gloucester · 3 stops"
  // packet with a Beverly leg misleads whoever claims it.
  if (dominant && (counts.get(dominant) ?? 0) === props.length) return dominant;
  return townsLabel(props.map((p) => p.city)) || cityShort(props[0].city) || props[0].name;
}

/** The right window for a stop, from the property's guest bookings on the visit
 *  day: a checkout that day means go after it; a check-in that day means go
 *  before it; otherwise the home is vacant. Used when a stop is added by hand or
 *  when re-syncing a trip's windows to current bookings. */
export async function deriveStopWindow(
  propertyId: string,
  visitDate: string,
): Promise<{ window_basis: WindowBasis; prior_checkout: string | null; next_checkin: string | null }> {
  const { data } = await fieldDb()
    .from('bookings')
    .select('check_in, check_out, status')
    .eq('property_id', propertyId)
    .is('duplicate_of', null)
    .or(`check_out.eq.${visitDate},check_in.eq.${visitDate}`);
  const rows = ((data ?? []) as { check_in: string; check_out: string; status: string | null }[]).filter(isGuestStay);
  const checkoutToday = rows.find((b) => b.check_out === visitDate);
  const checkinToday = rows.find((b) => b.check_in === visitDate);
  if (checkoutToday) return { window_basis: 'checkout_day', prior_checkout: visitDate, next_checkin: checkinToday?.check_in ?? null };
  if (checkinToday) return { window_basis: 'pre_checkin', prior_checkout: null, next_checkin: visitDate };
  return { window_basis: 'vacant', prior_checkout: null, next_checkin: null };
}

/** Rebuild the stored title after the stop set changes, so list views (which
 *  read the denormalized title, not the computed headline) show the right count
 *  and towns. Standard inspection packets only; setup/maintenance keep their own
 *  title shape. */
export async function regeneratePacketTitle(packetId: string): Promise<void> {
  const { data: pkt } = await fieldDb().from('inspection_packets').select('kind, trade').eq('id', packetId).maybeSingle();
  const meta = pkt as { kind: string; trade: string } | null;
  if (!meta || meta.kind !== 'standard' || meta.trade !== 'inspection') return;
  const { data: sData } = await fieldDb().from('packet_stops').select('property_id').eq('packet_id', packetId);
  const rows = (sData ?? []) as { property_id: string }[];
  if (rows.length === 0) return;
  const ids = [...new Set(rows.map((r) => r.property_id))];
  const { data: pData } = await fieldDb().from('properties').select('id, name, city').in('id', ids);
  const byId = new Map(((pData ?? []) as { id: string; name: string | null; city: string | null }[]).map((p) => [p.id, p]));
  const cities = rows.map((r) => byId.get(r.property_id)?.city ?? null);
  const first = byId.get(rows[0].property_id);
  const label = townsLabel(cities) || cityShort(first?.city ?? null) || first?.name || 'Trip';
  const title = `${label} · ${rows.length} ${rows.length === 1 ? 'stop' : 'stops'}`;
  await fieldDb().from('inspection_packets').update({ title, updated_at: new Date().toISOString() }).eq('id', packetId);
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
    .in('inspection_packets.status', ['published', 'claimed', 'in_progress', 'submitted', 'approved'])
    .not('booking_id', 'is', null);
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
        postedPriceCents: priceCents({
          basePrices: stops.map((s) => s.basePriceCents),
          spreadMiles: spread,
          center: cen,
          isRush: isRushVisit(day),
        }),
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

/** Strip a property's identifying fields for a pre-claim contractor payload:
 *  no name/address/title/coordinates ride along until the inspector claims the
 *  job. Town (city) is kept so the card can still say "in Gloucester". */
function maskIdentity(p: FieldProperty): FieldProperty {
  return { ...p, name: '', title: null, address: '', latitude: null, longitude: null, supply_closet_location: null };
}

async function stopsWithProperties(
  stops: PacketStopRow[],
  revealAccess: boolean,
  revealIdentity: boolean,
): Promise<PacketStopDetail[]> {
  if (stops.length === 0) return [];
  const ids = [...new Set(stops.map((s) => s.property_id))];
  const { data } = await fieldDb().from('properties').select(PROPERTY_COLS).in('id', ids);
  // Only fetch + merge the sensitive access codes when we're actually going to
  // reveal them (an awarded contractor's own packet). Otherwise leave them null
  // so codes never ride along in a marketplace/unclaimed payload at all.
  const accessMap = revealAccess ? await getPropertyAccessMap(ids) : null;
  const propById = new Map(
    ((data ?? []) as unknown as FieldProperty[]).map((p) => [p.id, mergeAccess(p, accessMap?.get(p.id))]),
  );
  // Maintenance stops carry the work slip the contractor is being sent to fix.
  const slipIds = stops.map((s) => s.work_slip_id).filter((v): v is string => !!v);
  const slipById = new Map<string, WorkSlipLite>();
  if (slipIds.length) {
    const { data: slips } = await fieldDb()
      .from('work_slips')
      .select('id, title, description, action_summary, bring_list, location, priority, photo_urls')
      .in('id', slipIds);
    for (const s of (slips ?? []) as WorkSlipLite[]) slipById.set(s.id, s);
  }

  // Extra work slips the office attached to any stop (inspection or maintenance),
  // each with its per-attachment note + independent completion. One batch query.
  const stopIds = stops.map((s) => s.id);
  const attachedByStop = new Map<string, AttachedSlip[]>();
  if (stopIds.length) {
    const { data: att } = await fieldDb()
      .from('packet_stop_work_slips')
      .select('id, stop_id, office_note, completed_at, ordering, created_at, work_slips(id, title, description, action_summary, bring_list, location, priority, category, photo_urls)')
      .in('stop_id', stopIds)
      .order('ordering', { ascending: true })
      .order('created_at', { ascending: true });
    // Supabase types the to-one embed as an array; at runtime it's one object.
    for (const row of (att ?? []) as unknown as AttachmentRow[]) {
      const slip = row.work_slips;
      if (!slip) continue;
      const list = attachedByStop.get(row.stop_id) ?? [];
      list.push({ ...slip, attachmentId: row.id, officeNote: row.office_note, completedAt: row.completed_at });
      attachedByStop.set(row.stop_id, list);
    }
  }

  return stops
    .slice()
    .sort((a, b) => a.walk_order - b.walk_order)
    .map((s) => {
      const property = propById.get(s.property_id)!;
      return {
        ...s,
        property: revealIdentity ? property : maskIdentity(property),
        access: revealAccess && property ? accessBundle(property) : null,
        workSlip: s.work_slip_id ? slipById.get(s.work_slip_id) ?? null : null,
        attachedSlips: attachedByStop.get(s.id) ?? [],
      };
    });
}

/** Raw shape of a packet_stop_work_slips row joined to its work slip. */
type AttachmentRow = {
  id: string;
  stop_id: string;
  office_note: string | null;
  completed_at: string | null;
  ordering: number;
  work_slips: WorkSlipLite | null;
};

export async function loadPacketDetail(
  packetId: string,
  opts: { revealAccess?: boolean; revealIdentity?: boolean } = {},
): Promise<PacketDetail | null> {
  // Both keyed on the id we already hold — one round trip, not two. This is
  // the hottest loader in Field (every packet view, and the re-render every
  // operator autosave waits on).
  const [{ data: pData }, { data: sData }] = await Promise.all([
    fieldDb().from('inspection_packets').select('*').eq('id', packetId).maybeSingle(),
    fieldDb().from('packet_stops').select('*').eq('packet_id', packetId).order('walk_order', { ascending: true }),
  ]);
  const packet = (pData as PacketRow | null) ?? null;
  if (!packet) return null;
  // Identity is revealed by default (office/internal views); contractor
  // marketplace + pre-claim views pass revealIdentity:false to mask addresses.
  const stops = await stopsWithProperties(
    (sData ?? []) as PacketStopRow[],
    !!opts.revealAccess,
    opts.revealIdentity !== false,
  );
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
export async function loadContractorMarketplace(contractor: ContractorRow): Promise<{
  available: PacketDetail[];
  mine: PacketDetail[];
}> {
  const { data: pubData } = await fieldDb()
    .from('inspection_packets')
    .select('id')
    .eq('status', 'published')
    .eq('trade', contractor.trade) // only show work this contractor's trade does
    .order('visit_date', { ascending: true });
  const { data: mineData } = await fieldDb()
    .from('inspection_packets')
    .select('id')
    .eq('awarded_contractor_id', contractor.id)
    .in('status', ['claimed', 'in_progress', 'submitted', 'approved'])
    .order('visit_date', { ascending: true });

  // Browsing, not-yet-claimed packets: mask property identity (no addresses /
  // names / coords) until the inspector actually claims the job.
  const availableRaw = (
    await Promise.all(((pubData ?? []) as { id: string }[]).map((p) => loadPacketDetail(p.id, { revealIdentity: false })))
  ).filter(Boolean) as PacketDetail[];
  // Access codes are never loaded into the marketplace payload — the cards
  // don't render them, and the detail page reveals them gated on active status.
  const mine = (
    await Promise.all(((mineData ?? []) as { id: string }[]).map((p) => loadPacketDetail(p.id)))
  ).filter(Boolean) as PacketDetail[];

  // "Near you" ranking: attach straight-line distance from the contractor's
  // home to each packet's centroid and sort closest-first. Falls back to the
  // existing date order when home location isn't known.
  const home =
    contractor.home_lat != null && contractor.home_lng != null
      ? { lat: contractor.home_lat, lng: contractor.home_lng }
      : null;
  const available = availableRaw.map((p) => ({
    ...p,
    distanceMiles:
      home && p.centroid_lat != null && p.centroid_lng != null
        ? haversineMiles(home, { lat: p.centroid_lat, lng: p.centroid_lng })
        : undefined,
  }));
  if (home) {
    available.sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));
  }

  return { available, mine };
}

// ── Window re-validation ──────────────────────────────────────────────
// A stop is STALE for its packet's visit_date if a guest is now mid-stay
// that day (a booking strictly spans it: check_in < day < check_out) or the
// day was calendar-blocked since the packet was built. A turnover day
// (check_in == day or check_out == day) is NOT stale — that's the whole
// point of the visit window.
export async function staleStopIds(
  visitDate: string,
  stops: Array<{ id: string; property_id: string | null; work_slip_id?: string | null }>,
): Promise<Set<string>> {
  if (stops.length === 0) return new Set();
  // A work_slip-backed stop is a TASK (setup / ad hoc / maintenance), routinely
  // done with a guest in-house, and a location-less errand has no property at
  // all — the vacancy test applies to neither, so never sweep them.
  const testable = stops.filter((s) => !s.work_slip_id && s.property_id);
  if (testable.length === 0) return new Set();
  const ids = [...new Set(testable.map((s) => s.property_id as string))];
  const { data: bData } = await fieldDb()
    .from('bookings')
    .select('property_id')
    .in('status', OCCUPANCY_STATUSES)
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
  for (const s of testable) {
    if (occupied.has(s.property_id as string) || blocked.has(s.property_id as string)) stale.add(s.id);
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
    .select('id, status, visit_date, trade, kind')
    .eq('id', packetId)
    .maybeSingle();
  const packet = pData as { id: string; status: string; visit_date: string; trade: string; kind: string } | null;
  if (!packet) return { removed: 0, remaining: 0, emptied: true };

  // Setup packets are scheduled by hand for a brand-new property (often with
  // owner comings-and-goings or calendar blocks while it's outfitted); the
  // vacancy staleness test doesn't apply.
  if (packet.kind === 'setup') {
    return { removed: 0, remaining: 0, emptied: false };
  }

  // The occupancy/vacancy staleness test only makes sense for inspections —
  // maintenance and cleaning are routinely done with a guest in-house, so never
  // drop their stops because someone is mid-stay on the visit date.
  if (packet.trade !== 'inspection') {
    return { removed: 0, remaining: 0, emptied: false };
  }

  // Only revalidate before anyone's pay is locked. Once a packet is claimed,
  // never silently reprice or delete a contractor's agreed work — a guest's
  // late booking must surface to the operator, not cut the inspector's pay.
  if (!['draft', 'published'].includes(packet.status)) {
    return { removed: 0, remaining: 0, emptied: false };
  }

  const { data: sData } = await fieldDb()
    .from('packet_stops')
    .select('id, property_id, base_price_cents, work_slip_id')
    .eq('packet_id', packetId);
  const stops = (sData ?? []) as Array<{ id: string; property_id: string | null; base_price_cents: number; work_slip_id: string | null }>;
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
  const { data } = await fieldDb()
    .from('inspection_packets')
    .select('id')
    .eq('status', 'published')
    .eq('trade', 'inspection');
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
  /** THIS booking's stop is actively being worked (started, not finished).
   *  Drives the turnover rail's "On site" kicker — packet-level in_progress
   *  means the contractor is somewhere on the route, not at this house. */
  stopActive: boolean;
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
    .select('booking_id, status, started_at, inspection_packets!inner(id, status, awarded_contractor_id, visit_date)')
    .in('booking_id', ids);
  type Row = {
    booking_id: string | null;
    status: string;
    started_at: string | null;
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
      stopActive: !!r.started_at && r.status === 'in_progress',
    });
  }
  return map;
}

/**
 * Re-point a packet's stop booking links to the CURRENT nearest upcoming guest
 * check-in. packet_stops.booking_id (+ next_checkin / prior_checkout) is a
 * snapshot frozen at packet creation; when a nearer guest is booked afterward,
 * the stop keeps pointing at the old, farther reservation, and the turnover
 * board can no longer see that the packet covers the imminent turnover (it
 * renders the row as an uncovered "START"). This heals that by re-deriving via
 * the EXACT creation rule (candidatesForDay) and updating in place.
 *
 * Deliberately conservative (from the coverage-logic review):
 *  - Inspection packets only; never setup / maintenance / cleaning / cancelled.
 *  - Never touches a TERMINAL stop (status complete | skipped) or one the
 *    inspector has already STARTED, so completed-inspection review attribution
 *    (field-ratings / field-profile) and the on-site deadline hint never shift.
 *  - Never CLEARS a link: if the property is occupied / blocked on the visit
 *    day or has no successor guest, candidatesForDay yields no usable booking
 *    and the stale-but-inert pointer is left as-is (a null write would make the
 *    work-first board double-count the turnover as uncovered).
 *  - Never re-points onto a booking another LIVE stop already holds (that would
 *    double-credit two contractors for one guest's review).
 * Price and stop membership never change, so it is pay-safe even past claim.
 */
export async function resyncPacketStopBookings(packetId: string): Promise<{ updated: number }> {
  const { data: pData } = await fieldDb()
    .from('inspection_packets')
    .select('id, status, visit_date, trade, kind')
    .eq('id', packetId)
    .maybeSingle();
  const packet = pData as { id: string; status: string; visit_date: string; trade: string; kind: string } | null;
  if (!packet || packet.status === 'cancelled' || packet.kind === 'setup' || packet.trade !== 'inspection') {
    return { updated: 0 };
  }

  const { data: sData } = await fieldDb()
    .from('packet_stops')
    .select('id, property_id, status, started_at, booking_id, next_checkin, prior_checkout, work_slip_id')
    .eq('packet_id', packetId);
  const stops = (sData ?? []) as Array<{
    id: string; property_id: string; status: string; started_at: string | null;
    booking_id: string | null; next_checkin: string | null; prior_checkout: string | null; work_slip_id: string | null;
  }>;
  // Only re-point genuinely untouched stops: not terminal, not started.
  const movable = stops.filter((s) => s.status !== 'complete' && s.status !== 'skipped' && !s.started_at && !s.work_slip_id);
  if (!movable.length) return { updated: 0 };

  // candidatesForDay only reads .id off each property.
  const propIds = [...new Set(movable.map((s) => s.property_id))];
  const candidates = await candidatesForDay(propIds.map((id) => ({ id }) as unknown as FieldProperty), packet.visit_date);

  // Collision guard: booking_ids already held by ANY OTHER live packet stop, so
  // resync can never converge two contractors onto the same guest's turnover.
  const { data: liveData } = await fieldDb()
    .from('packet_stops')
    .select('booking_id, inspection_packets!inner(status)')
    .neq('packet_id', packetId)
    .in('property_id', propIds)
    .not('booking_id', 'is', null);
  const taken = new Set(
    ((liveData ?? []) as unknown as Array<{ booking_id: string; inspection_packets: { status: string } }>)
      .filter((r) => ['published', 'claimed', 'in_progress'].includes(r.inspection_packets?.status))
      .map((r) => r.booking_id),
  );

  let updated = 0;
  for (const stop of movable) {
    const cand = candidates.get(stop.property_id);
    if (!cand || !cand.bookingId) continue;            // occupied / blocked / no successor -> leave inert, NEVER null
    if (cand.bookingId === stop.booking_id) continue;  // already correct
    if (taken.has(cand.bookingId)) continue;           // another live stop owns it
    await fieldDb()
      .from('packet_stops')
      // window_basis rides along with the booking: a stop re-pointed to a real
      // checkout must stop reading "vacant all day" and show "after checkout".
      .update({ booking_id: cand.bookingId, next_checkin: cand.nextCheckin, prior_checkout: cand.priorCheckout, window_basis: cand.basis })
      .eq('id', stop.id);
    taken.add(cand.bookingId); // guard against two movable stops converging this run
    updated++;
  }
  return { updated };
}

/** Sweep: re-point booking links for every non-cancelled LIVE inspection packet
 *  (past claim too, since re-pointing is pay-safe). Optionally scoped to packets
 *  touching a set of properties. Runs nightly from the field cron. */
export async function resyncLivePacketBookings(opts?: { propertyIds?: string[] }): Promise<{ checked: number; updated: number }> {
  let q = fieldDb()
    .from('inspection_packets')
    .select('id, packet_stops!inner(property_id)')
    .in('status', ['published', 'claimed', 'in_progress'])
    .eq('trade', 'inspection');
  if (opts?.propertyIds?.length) {
    q = q.in('packet_stops.property_id', opts.propertyIds);
  }
  const { data } = await q;
  const ids = [...new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id))];
  let updated = 0;
  for (const id of ids) {
    const r = await resyncPacketStopBookings(id).catch(() => ({ updated: 0 }));
    updated += r.updated;
  }
  return { checked: ids.length, updated };
}

// ── Work-first board: inspections needing coverage ───────────────────
export type WorkItem = {
  propertyId: string;
  propertyName: string;
  bookingId: string | null;
  basis: WindowBasis;
  priorCheckout: string | null;
  nextCheckin: string | null;
  basePriceCents: number;
  lat: number | null;
  lng: number | null;
  /** Index of the auto-cluster this item falls in on its day (for the
   *  "Suggest groupings" assist). */
  clusterId: number;
  /** Straight-line miles to the nearest other inspection that day, or null. */
  nearestMiles: number | null;
};
export type WorkDay = { date: string; items: WorkItem[] };

/**
 * The work-first board's primary data: upcoming inspections that need
 * covering, one row per property at its earliest feasible day, grouped by
 * day, with proximity hints + an auto-cluster id. Properties already out to
 * a contractor (live packet) are excluded — those have left the to-do list.
 */
export async function loadInspectionWorkItems(
  windowStart: string = todayStr(),
  windowEnd: string = addDays(todayStr(), 14),
): Promise<WorkDay[]> {
  const properties = await loadFieldProperties();
  const propById = new Map(properties.map((p) => [p.id, p]));
  const withCoords = properties.filter((p) => p.latitude != null && p.longitude != null);

  // Exclude only the SPECIFIC turnovers a live packet already covers (by
  // booking), NOT the whole property — a property can be in one packet and
  // still have other upcoming turnovers that need inspecting.
  const { data: activeStops } = await fieldDb()
    .from('packet_stops')
    .select('booking_id, inspection_packets!inner(status)')
    .in('inspection_packets.status', ['published', 'claimed', 'in_progress', 'submitted', 'approved']);
  const coveredBookings = new Set(
    ((activeStops ?? []) as { booking_id: string | null }[])
      .map((s) => s.booking_id)
      .filter((b): b is string => !!b),
  );

  // One row per UNCOVERED turnover (booking), on its earliest inspectable day.
  const candidates = (await deriveDayCandidates(withCoords, windowStart, windowEnd)).filter(
    (c) => c.bookingId && !coveredBookings.has(c.bookingId),
  );
  const earliestByBooking = new Map<string, DayCandidate>();
  for (const c of candidates) {
    const cur = earliestByBooking.get(c.bookingId!);
    if (!cur || c.day < cur.day) earliestByBooking.set(c.bookingId!, c);
  }
  // ...but never list the same property twice on the same day.
  const byDay = new Map<string, DayCandidate[]>();
  const seenPropDay = new Set<string>();
  for (const c of [...earliestByBooking.values()].sort((a, b) => a.day.localeCompare(b.day))) {
    const pd = `${c.propertyId}:${c.day}`;
    if (seenPropDay.has(pd)) continue;
    seenPropDay.add(pd);
    const arr = byDay.get(c.day) ?? [];
    arr.push(c);
    byDay.set(c.day, arr);
  }

  const days: WorkDay[] = [];
  for (const date of [...byDay.keys()].sort()) {
    const cands = byDay.get(date)!;
    // Greedy proximity clusters (same gate as the suggester) → clusterId.
    const clusterOf = new Map<string, number>();
    const remaining = cands.slice();
    let cid = 0;
    while (remaining.length) {
      const seed = remaining.shift()!;
      const cluster = [seed];
      const props = [propById.get(seed.propertyId)!];
      let changed = true;
      while (changed && cluster.length < MAX_STOPS) {
        changed = false;
        for (let i = 0; i < remaining.length; i++) {
          const p = propById.get(remaining[i].propertyId)!;
          const trial = [...props, p].map((q) => ({ lat: q.latitude!, lng: q.longitude! }));
          if (maxPairwiseMiles(trial) <= PROXIMITY_MILES) {
            cluster.push(remaining[i]);
            props.push(p);
            remaining.splice(i, 1);
            changed = true;
            break;
          }
        }
      }
      for (const c of cluster) clusterOf.set(c.propertyId, cid);
      cid++;
    }

    const items: WorkItem[] = cands
      .map((c) => {
        const p = propById.get(c.propertyId)!;
        let nearest: number | null = null;
        for (const o of cands) {
          if (o.propertyId === c.propertyId) continue;
          const op = propById.get(o.propertyId)!;
          if (p.latitude != null && p.longitude != null && op.latitude != null && op.longitude != null) {
            const d = haversineMiles({ lat: p.latitude, lng: p.longitude }, { lat: op.latitude, lng: op.longitude });
            if (nearest == null || d < nearest) nearest = d;
          }
        }
        return {
          propertyId: p.id,
          propertyName: p.name,
          bookingId: c.bookingId,
          basis: c.basis,
          priorCheckout: c.priorCheckout,
          nextCheckin: c.nextCheckin,
          basePriceCents: p.inspection_base_price_cents ?? 7500,
          lat: p.latitude,
          lng: p.longitude,
          clusterId: clusterOf.get(c.propertyId) ?? 0,
          nearestMiles: nearest,
        };
      })
      .sort((a, b) => a.clusterId - b.clusterId || a.propertyName.localeCompare(b.propertyName));
    days.push({ date, items });
  }
  return days;
}

/**
 * Build a packet from a hand-picked set of properties on a day (the
 * "bundle & send" action). Re-derives each stop's window from current
 * bookings server-side, so the client's selection is never trusted for
 * timing/price. Publishes immediately when publish=true.
 */
/**
 * Build the inspection candidate for a SPECIFIC day per property, mirroring the
 * calendar's own cell logic (open = not occupied overnight + not blocked), with
 * the basis/booking derived from the surrounding bookings. Unlike
 * deriveDayCandidates (which only emits days anchored to a check-in inside the
 * window), this emits a candidate for any open day the operator picked — so
 * bundling a normal open day ahead of a future stay works, not just check-in
 * days.
 */
async function candidatesForDay(
  properties: FieldProperty[],
  day: string,
): Promise<Map<string, DayCandidate>> {
  const propIds = new Set(properties.map((p) => p.id));
  const { data: bData } = await fieldDb()
    .from('bookings')
    .select('id, property_id, check_in, check_out, status')
    .in('status', OCCUPANCY_STATUSES)
    .is('duplicate_of', null)
    .lte('check_in', addDays(day, 365))
    .gte('check_out', addDays(day, -30));
  const bookings = ((bData ?? []) as BookingRaw[]).filter(
    (b) => propIds.has(b.property_id) && b.check_in && b.check_out,
  );
  const { data: blkData } = await fieldDb()
    .from('property_calendar_blocks')
    .select('property_id, date')
    .eq('date', day);
  const blocked = new Set(((blkData ?? []) as { property_id: string; date: string }[]).map((b) => b.property_id));

  const byProp = new Map<string, BookingRaw[]>();
  for (const b of bookings) {
    const arr = byProp.get(b.property_id) ?? [];
    arr.push(b);
    byProp.set(b.property_id, arr);
  }

  const out = new Map<string, DayCandidate>();
  for (const p of properties) {
    if (blocked.has(p.id)) continue;
    const pb = (byProp.get(p.id) ?? []).slice().sort((a, b) => a.check_in.localeCompare(b.check_in));
    // Next GUEST arrival to prep for — a 4 PM arrival TODAY counts (that's the
    // same-day turnover, the most urgent inspection there is).
    const next = pb.find((b) => isGuestStay(b) && b.check_in >= day) ?? null;
    // An occupied night kills the day, EXCEPT the prepped stay's own check-in
    // day (the tight pre-arrival window) — the same rule deriveDayCandidates
    // uses. The old unconditional `check_in <= day` test made every same-day
    // turnover invisible here: never bundleable, never booking-linked.
    if (pb.some((b) => b.check_in <= day && day < b.check_out) && !(next && next.check_in === day)) continue;
    const priorCheckout = pb.filter((b) => b.check_out <= day).map((b) => b.check_out).sort().at(-1) ?? null;
    let basis: WindowBasis = 'vacant';
    if (priorCheckout && day === priorCheckout) basis = 'checkout_day';
    else if (next && day === next.check_in) basis = 'pre_checkin';
    out.set(p.id, {
      propertyId: p.id,
      day,
      basis,
      bookingId: next?.id ?? null,
      priorCheckout,
      nextCheckin: next?.check_in ?? null,
    });
  }
  return out;
}

export async function createPacketFromProperties(args: {
  propertyIds: string[];
  visitDate: string;
  priceCentsOverride?: number;
  createdByEmail: string;
  publish: boolean;
}): Promise<string | null> {
  const properties = await loadFieldProperties();
  const propById = new Map(properties.map((p) => [p.id, p]));
  const sel = args.propertyIds
    .map((id) => propById.get(id))
    .filter((p): p is FieldProperty => !!p && p.latitude != null && p.longitude != null);
  if (sel.length === 0) return null;

  const candByProp = await candidatesForDay(sel, args.visitDate);

  // Guard against double-booking a turnover: drop any selected property whose
  // booking is already in a live packet (a bundle race / double-submit beyond
  // the client button guard). Bail if nothing valid remains.
  const { data: activeStops } = await fieldDb()
    .from('packet_stops')
    .select('booking_id, inspection_packets!inner(status)')
    .in('inspection_packets.status', ['published', 'claimed', 'in_progress', 'submitted', 'approved']);
  const coveredBookings = new Set(
    ((activeStops ?? []) as { booking_id: string | null }[]).map((s) => s.booking_id).filter((b): b is string => !!b),
  );
  const usable = sel.filter((p) => {
    const c = candByProp.get(p.id);
    return c && (!c.bookingId || !coveredBookings.has(c.bookingId));
  });
  if (usable.length === 0) return null;

  const pts = usable.map((p) => ({ lat: p.latitude!, lng: p.longitude! }));
  // Walk order = readiness first, drive time second. An already-cleaned home
  // is open from the 11 AM checkout; a same-day checkout belongs to the
  // cleaner until mid-afternoon (Delaney walked into a dirty 19 Rackliffe at
  // 10:40 because drive time alone ordered the route). Within each readiness
  // group, homes with a 4 PM check-in lead. Drive-time ordering (OSRM, with
  // nearest-neighbor fallback) applies inside each group.
  const rank = (p: FieldProperty): number => {
    const c = candByProp.get(p.id);
    const turnover = c?.basis === 'checkout_day';
    const deadline = !!c?.nextCheckin && c.nextCheckin === args.visitDate;
    return turnover ? (deadline ? 2 : 3) : deadline ? 0 : 1;
  };
  const buckets: Record<number, FieldProperty[]> = { 0: [], 1: [], 2: [], 3: [] };
  for (const p of usable) buckets[rank(p)].push(p);
  const orderedProps: FieldProperty[] = [];
  for (const r of [0, 1, 2, 3]) {
    const group = buckets[r];
    if (group.length <= 1) {
      orderedProps.push(...group);
      continue;
    }
    const gpts = group.map((p) => ({ lat: p.latitude!, lng: p.longitude! }));
    const gorder = await osrmOptimalOrder(gpts);
    orderedProps.push(...gorder.map((i) => group[i]));
  }
  const spread = maxPairwiseMiles(pts);
  const cen = centroid(pts);
  const basePrices = orderedProps.map((p) => p.inspection_base_price_cents ?? DEFAULT_BASE_CENTS);
  const computed = priceCents({
    basePrices,
    spreadMiles: spread,
    center: cen,
    isRush: isRushVisit(args.visitDate),
  });
  // Reject an obviously fat-fingered override (extra/missing zero) — fall back
  // to the computed price rather than publish a binding mistake to inspectors.
  let posted = args.priceCentsOverride ?? computed;
  if (args.priceCentsOverride != null && (args.priceCentsOverride > computed * 5 || args.priceCentsOverride < computed * 0.3)) {
    posted = computed;
  }

  const { data: packet, error } = await fieldDb()
    .from('inspection_packets')
    .insert({
      title: `${clusterName(orderedProps)} · ${orderedProps.length} ${orderedProps.length === 1 ? 'stop' : 'stops'}`,
      status: args.publish ? 'published' : 'draft',
      visit_date: args.visitDate,
      window_start: args.visitDate,
      window_end: args.visitDate,
      claim_deadline: args.visitDate,
      centroid_lat: cen?.lat ?? null,
      centroid_lng: cen?.lng ?? null,
      max_pairwise_miles: spread,
      stop_count: orderedProps.length,
      posted_price_cents: posted,
      auto_generated: false,
      suggestion_key: null,
      created_by_email: args.createdByEmail,
      published_at: args.publish ? new Date().toISOString() : null,
    })
    .select('id')
    .single();
  if (error || !packet) return null;
  const packetId = (packet as { id: string }).id;
  await fieldDb()
    .from('packet_stops')
    .insert(
      orderedProps.map((p, i) => {
        const c = candByProp.get(p.id);
        return {
          packet_id: packetId,
          property_id: p.id,
          booking_id: c?.bookingId ?? null,
          window_basis: c?.basis ?? 'vacant',
          prior_checkout: c?.priorCheckout ?? null,
          next_checkin: c?.nextCheckin ?? null,
          base_price_cents: p.inspection_base_price_cents ?? 7500,
          walk_order: i,
        };
      }),
    );
  // Restock slips ride along automatically — see autoAttachInventorySlips.
  await autoAttachInventorySlips(packetId);
  return packetId;
}

/**
 * Auto-assign restocking: attach every open inventory-category work slip
 * ("Restock toilet paper" etc.) to its property's stop on this packet, so the
 * inspector gets an explicit mark-done task (and the slip actually closes)
 * instead of the restock only riding along as supply-run text. Idempotent via
 * the unique (stop_id, work_slip_id) upsert; manual attach/detach still works
 * on top. Inspection packets only — a maintenance stop IS its slip.
 *
 * Called at packet creation and again at publish (catching slips created in
 * between). Never throws; a failure just means the office attaches by hand.
 */
export async function autoAttachInventorySlips(packetId: string): Promise<number> {
  const { data: pkt } = await fieldDb()
    .from('inspection_packets')
    .select('id, trade')
    .eq('id', packetId)
    .maybeSingle();
  const trade = (pkt as { id: string; trade?: string | null } | null)?.trade ?? 'inspection';
  if (!pkt || trade !== 'inspection') return 0;

  const { data: sData } = await fieldDb()
    .from('packet_stops')
    .select('id, property_id, work_slip_id')
    .eq('packet_id', packetId);
  const stops = (sData ?? []) as { id: string; property_id: string; work_slip_id: string | null }[];
  if (stops.length === 0) return 0;

  const { data: wData } = await fieldDb()
    .from('work_slips')
    .select('id, property_id')
    .in('property_id', [...new Set(stops.map((s) => s.property_id))])
    .eq('category', 'inventory')
    .in('status', ['open', 'in_progress', 'scheduled']);
  const slips = (wData ?? []) as { id: string; property_id: string }[];
  if (slips.length === 0) return 0;

  const byProp = new Map<string, string[]>();
  for (const w of slips) byProp.set(w.property_id, [...(byProp.get(w.property_id) ?? []), w.id]);

  const rows = stops.flatMap((s) =>
    (byProp.get(s.property_id) ?? [])
      .filter((slipId) => slipId !== s.work_slip_id)
      .map((slipId) => ({ stop_id: s.id, work_slip_id: slipId, created_by_email: 'helm-auto' })),
  );
  if (rows.length === 0) return 0;

  const { error } = await fieldDb()
    .from('packet_stop_work_slips')
    .upsert(rows, { onConflict: 'stop_id,work_slip_id', ignoreDuplicates: true });
  return error ? 0 : rows.length;
}

// ── Supply run (inspection prep) ──────────────────────────────────────
/** Where Rising Tide stages supplies + the per-property odds-and-ends bins. */
export const SUPPLY_CLOSET = '85 Eastern Ave';
/** Geocode of the supply closet, so it can be the literal first pin on a
 *  packet's route map. Matches the "85 Eastern Ave" coords annotated in
 *  projections-distance.ts (NOT the ~1mi-off value some pricing code uses). */
export const SUPPLY_CLOSET_COORDS = { lat: 42.6209, lng: -70.645 };
/** Entry code for the supply closet, shown ONLY to the assigned inspector on
 *  their claimed packet. Kept in an env var, never in source — this repo is
 *  public, and a real door code doesn't belong in git. Unset => the code line
 *  just doesn't render. Set SUPPLY_CLOSET_CODE in Vercel to light it up. */
export const SUPPLY_CLOSET_CODE: string | null = process.env.SUPPLY_CLOSET_CODE?.trim() || null;

export type SupplyRunStop = { propertyName: string; binLabel: string; lowItems: string[] };
export type SupplyRunJob = { title: string; propertyName: string; bring: string };
/** The full 85 Eastern pick list for a packet: the per-home bins to grab (with
 *  any consumables a prior visit flagged low), plus the materials each work slip
 *  on the packet needs to be completed. */
export type SupplyRun = { bins: SupplyRunStop[]; jobs: SupplyRunJob[] };

/** Supply-run prep for a packet, assembled for the supply-closet stop:
 *  - bins: one per property in the packet, labeled, with any open restock slips
 *    (category 'inventory') flagged as "bring extra".
 *  - jobs: the operator-authored bring_list for every work slip on the packet,
 *    so the inspector grabs the parts to finish each job in the same trip. */
/** Cleaner activity for a turnover, from the Seam lock-entry signal
 *  (cleaning_sessions). `enteredAt` is a confirmed door event; `finishedAt` is
 *  usually a system ESTIMATE (finishEstimated true) because the "done" ping is
 *  unreliable, so callers label it as estimated. */
export type CleaningStatus = {
  enteredAt: string;
  finishedAt: string | null;
  finishEstimated: boolean;
};

/** Cleaner status for a packet's turnover stops on the visit day, keyed by
 *  property_id. Reads the lock-driven cleaning_sessions (checkout_date = the
 *  turnover day) via the service-role client; latest entry wins per property.
 *  Empty map when nothing keyed in. */
/** Property ids with an ACTIVE Seam lock mapped — homes that CAN produce a
 *  cleaner lock-entry signal. A home on a physical lockbox is absent here, so
 *  callers know a blank cleaning signal is EXPECTED (not a warning worth
 *  showing). */
export async function loadLockEquippedPropertyIds(propertyIds: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  const ids = [...new Set((propertyIds ?? []).filter(Boolean))];
  if (ids.length === 0) return set;
  const { data } = await fieldDb()
    .from('lock_devices')
    .select('property_id')
    .in('property_id', ids)
    .eq('active', true);
  for (const r of (data ?? []) as Array<{ property_id: string | null }>) {
    if (r.property_id) set.add(r.property_id);
  }
  return set;
}

export async function loadCleaningStatusForStops(
  stops: Array<{ property_id: string; checkoutDate: string | null }>,
): Promise<Map<string, CleaningStatus>> {
  // Keyed by `${property_id}|${checkout_date}` so each stop looks up the
  // cleaning for ITS OWN turnover — a same-day checkout uses the visit day, a
  // recently-vacated home uses its prior checkout. A blank result for a recent
  // checkout is the real signal ("no cleaning recorded yet"), not an assumption.
  const map = new Map<string, CleaningStatus>();
  const rows = (stops ?? []).filter((r) => r.property_id && r.checkoutDate);
  if (rows.length === 0) return map;
  const ids = [...new Set(rows.map((r) => r.property_id))];
  const dates = [...new Set(rows.map((r) => r.checkoutDate as string))];
  const { data } = await fieldDb()
    .from('cleaning_sessions')
    .select('property_id, checkout_date, entered_at, finished_at, finish_estimated')
    .in('property_id', ids)
    .in('checkout_date', dates);
  for (const r of (data ?? []) as Array<{
    property_id: string;
    checkout_date: string;
    entered_at: string | null;
    finished_at: string | null;
    finish_estimated: boolean | null;
  }>) {
    if (!r.entered_at) continue;
    const key = `${r.property_id}|${r.checkout_date}`;
    const prev = map.get(key);
    if (!prev || r.entered_at > prev.enteredAt) {
      map.set(key, {
        enteredAt: r.entered_at,
        finishedAt: r.finished_at,
        finishEstimated: !!r.finish_estimated,
      });
    }
  }
  return map;
}

export async function loadPacketSupplyRun(packetId: string): Promise<SupplyRun> {
  const { data: sData } = await fieldDb()
    .from('packet_stops')
    .select('property_id, work_slip_id, walk_order')
    .eq('packet_id', packetId)
    .order('walk_order', { ascending: true });
  const stopRows = (sData ?? []) as { property_id: string; work_slip_id: string | null }[];
  const orderedIds = stopRows.map((s) => s.property_id);
  const propIds = [...new Set(orderedIds)];
  if (propIds.length === 0) return { bins: [], jobs: [] };

  const { data: pData } = await fieldDb().from('properties').select('id, name').in('id', propIds);
  const nameById = new Map(((pData ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));

  // Consumables a prior inspection already flagged low at these homes.
  const { data: wData } = await fieldDb()
    .from('work_slips')
    .select('property_id, title')
    .in('property_id', propIds)
    .eq('category', 'inventory')
    .in('status', ['open', 'in_progress', 'scheduled']);
  const lowByProp = new Map<string, string[]>();
  for (const w of (wData ?? []) as { property_id: string; title: string }[]) {
    const arr = lowByProp.get(w.property_id) ?? [];
    // Slip titles read "Restock <item>" — strip the prefix for a tidy list.
    arr.push(w.title.replace(/^restock\s+/i, '').trim());
    lowByProp.set(w.property_id, arr);
  }

  const bins = propIds.map((id) => {
    const name = nameById.get(id) ?? id;
    return { propertyName: name, binLabel: name, lowItems: lowByProp.get(id) ?? [] };
  });

  // Materials to complete the work slips on this packet (maintenance stops, plus
  // any slip attached to an inspection stop) — only those the office authored a
  // bring_list for.
  const slipIds = [...new Set(stopRows.map((s) => s.work_slip_id).filter((v): v is string => !!v))];
  const jobs: SupplyRunJob[] = [];
  if (slipIds.length) {
    const { data: jData } = await fieldDb()
      .from('work_slips')
      .select('property_id, title, bring_list')
      .in('id', slipIds)
      .not('bring_list', 'is', null);
    for (const j of (jData ?? []) as { property_id: string; title: string; bring_list: string | null }[]) {
      const bring = (j.bring_list ?? '').trim();
      if (!bring) continue;
      jobs.push({ title: j.title, propertyName: nameById.get(j.property_id) ?? j.property_id, bring });
    }
  }

  return { bins, jobs };
}

// ── Maintenance trade: work slips → claimable packets ─────────────────
export type MaintenanceSlip = {
  id: string;
  property_id: string;
  property_name: string;
  property_address: string;
  lat: number | null;
  lng: number | null;
  title: string;
  description: string | null;
  action_summary: string | null;
  location: string | null;
  priority: string;
  created_at: string;
};

/** Open, unassigned maintenance work slips that aren't already on a live packet
 *  — the pool the operator bundles into maintenance packets. Ops properties
 *  only (same exclusions as inspections). */
export async function loadOpenMaintenance(): Promise<MaintenanceSlip[]> {
  const { data: slips } = await fieldDb()
    .from('work_slips')
    .select('id, property_id, title, description, action_summary, location, priority, created_at')
    .eq('status', 'open')
    .eq('category', 'maintenance')
    .eq('assigned_to_type', 'unassigned')
    .order('created_at', { ascending: true });
  const rows = (slips ?? []) as Array<Omit<MaintenanceSlip, 'property_name' | 'property_address' | 'lat' | 'lng'>>;
  if (rows.length === 0) return [];

  // Drop slips already covered by a live packet stop.
  const { data: liveStops } = await fieldDb()
    .from('packet_stops')
    .select('work_slip_id, inspection_packets!inner(status)')
    .in('inspection_packets.status', ['draft', 'published', 'claimed', 'in_progress', 'submitted', 'approved'])
    .not('work_slip_id', 'is', null);
  const taken = new Set(
    ((liveStops ?? []) as { work_slip_id: string | null }[]).map((s) => s.work_slip_id).filter((v): v is string => !!v),
  );

  const props = await loadFieldProperties();
  const propById = new Map(props.map((p) => [p.id, p]));
  return rows
    .filter((r) => !taken.has(r.id) && propById.has(r.property_id))
    .map((r) => {
      const p = propById.get(r.property_id)!;
      return {
        ...r,
        property_name: p.name,
        property_address: p.address,
        lat: p.latitude,
        lng: p.longitude,
      };
    });
}

/** Every active (non-done) work slip on one property: the pool the office can
 *  ATTACH to a packet stop. Unlike loadOpenMaintenance this keeps all categories
 *  and assignments, since an inspector might also handle an inventory or owner
 *  item while they're in the home. The office UI filters out ones already
 *  attached to the stop. */
export async function loadAttachableSlips(propertyId: string): Promise<WorkSlipLite[]> {
  const { data } = await fieldDb()
    .from('work_slips')
    .select('id, title, description, action_summary, bring_list, location, priority, category, photo_urls, created_at')
    .eq('property_id', propertyId)
    .neq('status', 'done')
    .order('created_at', { ascending: false });
  return (data ?? []) as WorkSlipLite[];
}

/** Bundle selected work slips into a maintenance packet (trade='maintenance').
 *  Stops are ordered by drive time across the distinct properties; each stop
 *  points at its work slip. Price = per-job base + travel, operator-overridable
 *  with the same fat-finger clamp as inspections. */
export async function createMaintenancePacket(args: {
  workSlipIds: string[];
  visitDate: string;
  priceCentsOverride?: number;
  createdByEmail: string;
  publish: boolean;
}): Promise<string | null> {
  const pool = await loadOpenMaintenance();
  const byId = new Map(pool.map((s) => [s.id, s]));
  const sel = args.workSlipIds.map((id) => byId.get(id)).filter((s): s is MaintenanceSlip => !!s);
  if (sel.length === 0) return null;

  // Group slips by property, preserve a stable property order, then reorder the
  // properties by drive time (keeping each property's slips together).
  const slipsByProp = new Map<string, MaintenanceSlip[]>();
  const propOrder: string[] = [];
  for (const s of sel) {
    if (!slipsByProp.has(s.property_id)) {
      slipsByProp.set(s.property_id, []);
      propOrder.push(s.property_id);
    }
    slipsByProp.get(s.property_id)!.push(s);
  }
  const firstOf = (pid: string) => slipsByProp.get(pid)![0];
  const haveCoords = propOrder.every((pid) => firstOf(pid).lat != null && firstOf(pid).lng != null);
  const order =
    haveCoords && propOrder.length > 1
      ? await osrmOptimalOrder(propOrder.map((pid) => ({ lat: firstOf(pid).lat!, lng: firstOf(pid).lng! })))
      : propOrder.map((_, i) => i);
  const orderedProps = order.map((i) => propOrder[i]);
  const orderedSlips: MaintenanceSlip[] = [];
  for (const pid of orderedProps) orderedSlips.push(...slipsByProp.get(pid)!);

  const pts = orderedProps
    .filter((pid) => firstOf(pid).lat != null && firstOf(pid).lng != null)
    .map((pid) => ({ lat: firstOf(pid).lat!, lng: firstOf(pid).lng! }));
  const spread = pts.length > 1 ? maxPairwiseMiles(pts) : 0;
  const cen = pts.length ? centroid(pts) : null;
  const computed = priceCents({
    basePrices: orderedSlips.map(() => MAINTENANCE_BASE_CENTS),
    spreadMiles: spread,
    center: cen,
    isRush: isRushVisit(args.visitDate),
  });
  let posted = args.priceCentsOverride ?? computed;
  if (args.priceCentsOverride != null && (args.priceCentsOverride > computed * 6 || args.priceCentsOverride < computed * 0.2)) {
    posted = computed;
  }

  const title =
    orderedProps.length === 1
      ? `Maintenance · ${firstOf(orderedProps[0]).property_name}`
      : `Maintenance · ${orderedSlips.length} jobs · ${orderedProps.length} homes`;

  const { data: packet, error } = await fieldDb()
    .from('inspection_packets')
    .insert({
      title,
      status: args.publish ? 'published' : 'draft',
      trade: 'maintenance',
      visit_date: args.visitDate,
      window_start: args.visitDate,
      window_end: args.visitDate,
      claim_deadline: args.visitDate,
      centroid_lat: cen?.lat ?? null,
      centroid_lng: cen?.lng ?? null,
      max_pairwise_miles: spread,
      stop_count: orderedSlips.length,
      posted_price_cents: posted,
      auto_generated: false,
      suggestion_key: null,
      created_by_email: args.createdByEmail,
      published_at: args.publish ? new Date().toISOString() : null,
    })
    .select('id')
    .single();
  if (error || !packet) return null;
  const packetId = (packet as { id: string }).id;
  const { error: stopErr } = await fieldDb()
    .from('packet_stops')
    .insert(
      orderedSlips.map((s, i) => ({
        packet_id: packetId,
        property_id: s.property_id,
        booking_id: null,
        work_slip_id: s.id,
        window_basis: 'vacant' as WindowBasis,
        prior_checkout: null,
        next_checkin: null,
        base_price_cents: MAINTENANCE_BASE_CENTS,
        walk_order: i,
      })),
    );
  // Never leave a stop-less packet to be published + texted to contractors.
  if (stopErr) {
    await fieldDb().from('inspection_packets').delete().eq('id', packetId);
    return null;
  }
  return packetId;
}

// ── Property setup: a new home joins the program ──────────────────────
/** Create a SETUP packet: staging a brand-new property for photos and
 *  outfitting it for vacation-rental operations. 2 to 4 hours, one home, done
 *  by inspection-trade specialists (trade stays 'inspection'; kind='setup').
 *  The job itself is an auto-created work slip, so the entire existing
 *  completion rail (notes + photos on mark-done, the Approve review, redo,
 *  pay) works unchanged. */
export async function createSetupPacket(args: {
  propertyId: string;
  visitDate: string;
  /** Optional HH:MM start time; null/undefined = anytime that day. */
  visitTime?: string;
  priceCentsOverride?: number;
  scope: string;
  /** Include the stop-1 bag pickup at the supply closet (setups default to no). */
  supplyRun?: boolean;
  createdByEmail: string;
  publish: boolean;
}): Promise<string | null> {
  const properties = await loadFieldProperties();
  const prop = properties.find((p) => p.id === args.propertyId);
  if (!prop) return null;

  const computed = setupPriceCents(prop.bedrooms);
  let posted = args.priceCentsOverride ?? computed;
  if (args.priceCentsOverride != null && (args.priceCentsOverride > computed * 6 || args.priceCentsOverride < computed * 0.2)) {
    posted = computed;
  }

  // The setup job as a work slip: the stop points at it, the contractor's
  // mark-done writes the resolution + photos onto it, and the Approve screen
  // reads it back. category 'rising_tide' keeps it out of the open-maintenance
  // bundling pool.
  const { data: slip, error: slipErr } = await fieldDb()
    .from('work_slips')
    .insert({
      property_id: prop.id,
      title: `Set up ${prop.name} for launch`,
      description: args.scope.trim().slice(0, 4000) || 'Stage the home for photos and outfit it for guests.',
      category: 'rising_tide',
      priority: 'high',
      status: 'open',
      assigned_to_type: 'unassigned',
      created_by_email: args.createdByEmail,
    })
    .select('id')
    .single();
  if (slipErr || !slip) return null;
  const slipId = (slip as { id: string }).id;

  const { data: packet, error } = await fieldDb()
    .from('inspection_packets')
    .insert({
      title: `Set up ${prop.name}`,
      status: args.publish ? 'published' : 'draft',
      trade: 'inspection',
      kind: 'setup',
      supply_run: !!args.supplyRun,
      visit_date: args.visitDate,
      visit_time: args.visitTime || null,
      window_start: args.visitDate,
      window_end: args.visitDate,
      claim_deadline: args.visitDate,
      centroid_lat: prop.latitude,
      centroid_lng: prop.longitude,
      max_pairwise_miles: 0,
      stop_count: 1,
      posted_price_cents: posted,
      auto_generated: false,
      suggestion_key: null,
      created_by_email: args.createdByEmail,
      published_at: args.publish ? new Date().toISOString() : null,
    })
    .select('id')
    .single();
  if (error || !packet) {
    await fieldDb().from('work_slips').delete().eq('id', slipId);
    return null;
  }
  const packetId = (packet as { id: string }).id;
  const { error: stopErr } = await fieldDb().from('packet_stops').insert({
    packet_id: packetId,
    property_id: prop.id,
    booking_id: null,
    work_slip_id: slipId,
    window_basis: 'vacant' as WindowBasis,
    prior_checkout: null,
    next_checkin: null,
    base_price_cents: posted,
    walk_order: 0,
  });
  if (stopErr) {
    await fieldDb().from('inspection_packets').delete().eq('id', packetId);
    await fieldDb().from('work_slips').delete().eq('id', slipId);
    return null;
  }
  return packetId;
}

/**
 * Create a STANDALONE ad hoc one-off job — a single work_slip-backed stop on a
 * kind='adhoc' packet, riding the exact same rails as a setup packet (claim ->
 * MaintenanceComplete note+photo -> approve-closes-slip -> pay). The operator
 * sets the title, scope, and pay; category 'ad_hoc' keeps the slip out of the
 * maintenance bundling pool. v1 anchors every job to a property; location-less
 * errands land in a later slice. Rolls back the slip/packet on any insert error.
 */
export async function createAdHocPacket(args: {
  propertyId: string;
  visitDate: string;
  visitTime?: string;
  title: string;
  scope: string;
  bringList?: string;
  priceCents: number;
  supplyRun?: boolean;
  createdByEmail: string;
  publish: boolean;
}): Promise<string | null> {
  const properties = await loadFieldProperties();
  const prop = properties.find((p) => p.id === args.propertyId);
  if (!prop) return null;

  const title = args.title.trim().slice(0, 200) || 'One-off job';
  const posted = Math.max(0, Math.round(args.priceCents));

  const { data: slip, error: slipErr } = await fieldDb()
    .from('work_slips')
    .insert({
      property_id: prop.id,
      title,
      description: args.scope.trim().slice(0, 4000) || null,
      bring_list: args.bringList?.trim().slice(0, 2000) || null,
      category: 'ad_hoc',
      priority: 'normal',
      status: 'open',
      assigned_to_type: 'unassigned',
      created_by_email: args.createdByEmail,
    })
    .select('id')
    .single();
  if (slipErr || !slip) return null;
  const slipId = (slip as { id: string }).id;

  const { data: packet, error } = await fieldDb()
    .from('inspection_packets')
    .insert({
      title,
      status: args.publish ? 'published' : 'draft',
      trade: 'inspection',
      kind: 'adhoc',
      supply_run: !!args.supplyRun,
      visit_date: args.visitDate,
      visit_time: args.visitTime || null,
      window_start: args.visitDate,
      window_end: args.visitDate,
      claim_deadline: args.visitDate,
      centroid_lat: prop.latitude,
      centroid_lng: prop.longitude,
      max_pairwise_miles: 0,
      stop_count: 1,
      posted_price_cents: posted,
      auto_generated: false,
      suggestion_key: null,
      created_by_email: args.createdByEmail,
      published_at: args.publish ? new Date().toISOString() : null,
    })
    .select('id')
    .single();
  if (error || !packet) {
    await fieldDb().from('work_slips').delete().eq('id', slipId);
    return null;
  }
  const packetId = (packet as { id: string }).id;
  const { error: stopErr } = await fieldDb().from('packet_stops').insert({
    packet_id: packetId,
    property_id: prop.id,
    booking_id: null,
    work_slip_id: slipId,
    window_basis: 'vacant' as WindowBasis,
    prior_checkout: null,
    next_checkin: null,
    base_price_cents: posted,
    walk_order: 0,
  });
  if (stopErr) {
    await fieldDb().from('inspection_packets').delete().eq('id', packetId);
    await fieldDb().from('work_slips').delete().eq('id', slipId);
    return null;
  }
  return packetId;
}

// ── Recurring off-season inspections ──────────────────────────────────
// A home with no upcoming guest never triggers a turnover inspection, so it can
// go un-walked for months. This auto-DRAFTS a single-stop check for any idle
// property that's overdue, on its soonest open day. Draft-only: the operator
// reviews + publishes (or dismisses) from the board, so the system never sends
// work to a contractor on its own.
const RECURRING_CADENCE_DAYS = 21; // walk an idle home at least this often
const RECURRING_LEAD_DAYS = 3; // schedule the draft a few days out, not tomorrow
const RECURRING_HORIZON_DAYS = 10; // search this many days for an open slot

/** Whole days from a..b (both YYYY-MM-DD), b - a. */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export async function suggestRecurringInspections(): Promise<number> {
  const today = todayStr();
  const horizonEnd = addDays(today, RECURRING_LEAD_DAYS + RECURRING_HORIZON_DAYS);
  const cadenceEnd = addDays(today, RECURRING_CADENCE_DAYS);

  // Managed rentals only: HQ and prospect homes have no guests, so "idle too
  // long" means nothing there — routine checks would be pure noise.
  const properties = (await loadFieldProperties()).filter(
    (p) => p.kind === 'managed' && p.latitude != null && p.longitude != null,
  );
  if (properties.length === 0) return 0;
  const propIds = new Set(properties.map((p) => p.id));

  // Last completed inspection per property (recent history only).
  const { data: insp } = await fieldDb()
    .from('inspections')
    .select('property_id, completed_at')
    .not('completed_at', 'is', null)
    .gte('completed_at', `${addDays(today, -180)}T00:00:00Z`);
  const lastInspected = new Map<string, string>();
  for (const r of (insp ?? []) as { property_id: string; completed_at: string }[]) {
    const d = etDate(r.completed_at);
    const prev = lastInspected.get(r.property_id);
    if (!prev || d > prev) lastInspected.set(r.property_id, d);
  }

  // Bookings near the window — to find vacant days and to skip homes with an
  // upcoming turnover (the checkout-driven inspection will cover those).
  const { data: bData } = await fieldDb()
    .from('bookings')
    .select('id, property_id, check_in, check_out, status')
    .in('status', OCCUPANCY_STATUSES)
    .is('duplicate_of', null)
    .lte('check_in', horizonEnd)
    .gte('check_out', today);
  const byProp = new Map<string, BookingRaw[]>();
  for (const b of ((bData ?? []) as BookingRaw[]).filter((b) => propIds.has(b.property_id) && b.check_in && b.check_out)) {
    const arr = byProp.get(b.property_id) ?? [];
    arr.push(b);
    byProp.set(b.property_id, arr);
  }

  const { data: blkData } = await fieldDb()
    .from('property_calendar_blocks')
    .select('property_id, date')
    .gte('date', today)
    .lte('date', horizonEnd);
  const blocked = new Set(((blkData ?? []) as { property_id: string; date: string }[]).map((b) => `${b.property_id}:${b.date}`));

  // Properties already in an upcoming live packet (incl. drafts from a prior
  // run) — don't stack a second one. Approved/past packets don't count; their
  // inspection already lands in `inspections` above.
  const { data: livePkts } = await fieldDb()
    .from('inspection_packets')
    .select('id')
    .in('status', ['draft', 'published', 'claimed', 'in_progress', 'submitted'])
    .gte('visit_date', today);
  const liveIds = ((livePkts ?? []) as { id: string }[]).map((p) => p.id);
  const covered = new Set<string>();
  if (liveIds.length) {
    const { data: stops } = await fieldDb().from('packet_stops').select('property_id').in('packet_id', liveIds).not('booking_id', 'is', null);
    for (const s of (stops ?? []) as { property_id: string }[]) covered.add(s.property_id);
  }

  let created = 0;
  for (const p of properties) {
    if (covered.has(p.id)) continue;
    const bks = byProp.get(p.id) ?? [];
    // Skip homes with a guest arriving or leaving within the cadence window —
    // the normal turnover flow will surface those days on the board. (Owner
    // blocks aren't turnovers; occupiedOn below just avoids their days.)
    if (bks.some((b) => isGuestStay(b) && ((b.check_out >= today && b.check_out <= cadenceEnd) || (b.check_in >= today && b.check_in <= cadenceEnd)))) {
      continue;
    }
    const last = lastInspected.get(p.id);
    if (last && dayDiff(last, today) < RECURRING_CADENCE_DAYS) continue;

    const occupiedOn = (d: string) => bks.some((b) => b.check_in <= d && d < b.check_out);
    let day: string | null = null;
    for (let i = RECURRING_LEAD_DAYS; i <= RECURRING_LEAD_DAYS + RECURRING_HORIZON_DAYS; i++) {
      const d = addDays(today, i);
      if (blocked.has(`${p.id}:${d}`) || occupiedOn(d)) continue;
      day = d;
      break;
    }
    if (!day) continue;

    const center = { lat: p.latitude!, lng: p.longitude! };
    const price = priceCents({ basePrices: [p.inspection_base_price_cents], spreadMiles: 0, center, isRush: false });
    const { data: packet, error } = await fieldDb()
      .from('inspection_packets')
      .insert({
        title: `${p.name} · routine check`,
        status: 'draft',
        trade: 'inspection',
        visit_date: day,
        window_start: day,
        window_end: day,
        claim_deadline: day,
        centroid_lat: center.lat,
        centroid_lng: center.lng,
        max_pairwise_miles: 0,
        stop_count: 1,
        posted_price_cents: price,
        auto_generated: true,
        suggestion_key: `recurring:${p.id}:${day}`,
        created_by_email: 'cron@field',
      })
      .select('id')
      .single();
    if (error || !packet) continue; // unique suggestion_key clash = already drafted
    await fieldDb().from('packet_stops').insert({
      packet_id: (packet as { id: string }).id,
      property_id: p.id,
      booking_id: null,
      window_basis: 'vacant',
      prior_checkout: null,
      next_checkin: null,
      base_price_cents: p.inspection_base_price_cents,
      walk_order: 0,
    });
    created++;
  }
  return created;
}

// ── Packet review (the real Approve screen) ──────────────────────────
export type StopReview = {
  propertyName: string;
  pass: number;
  issue: number;
  na: number;
  photos: number;
  issues: string[];
  kind: 'inspection' | 'maintenance';
  title?: string | null; // maintenance: the job
  note?: string | null; // maintenance: the resolution
  photoUrls?: string[]; // maintenance: the actual photos
};

/** Per-stop inspection findings for the office's approve review — pass/issue/
 *  na counts, photo count, and the titles of flagged issues. */
export async function loadPacketReview(packetId: string): Promise<StopReview[]> {
  const { data: sData } = await fieldDb()
    .from('packet_stops')
    .select('property_id, inspection_id, work_slip_id, walk_order')
    .eq('packet_id', packetId)
    .order('walk_order', { ascending: true });
  const stops = ((sData ?? []) as { property_id: string; inspection_id: string | null; work_slip_id: string | null }[]).filter(
    (s) => s.inspection_id || s.work_slip_id,
  );
  if (stops.length === 0) return [];
  const { data: pData } = await fieldDb()
    .from('properties')
    .select('id, name')
    .in('id', stops.map((s) => s.property_id));
  const nameById = new Map(((pData ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));

  // Maintenance stops: surface the work-slip resolution + photos for review.
  const slipIds = stops.map((s) => s.work_slip_id).filter((v): v is string => !!v);
  const slipById = new Map<string, { title: string; resolution_notes: string | null; photo_urls: string[] | null }>();
  if (slipIds.length) {
    const { data: wData } = await fieldDb()
      .from('work_slips')
      .select('id, title, resolution_notes, photo_urls')
      .in('id', slipIds);
    for (const w of (wData ?? []) as Array<{ id: string; title: string; resolution_notes: string | null; photo_urls: string[] | null }>) {
      slipById.set(w.id, w);
    }
  }

  const out: StopReview[] = [];
  for (const s of stops) {
    if (s.work_slip_id) {
      const w = slipById.get(s.work_slip_id);
      out.push({
        propertyName: nameById.get(s.property_id) ?? s.property_id,
        pass: 0,
        issue: 0,
        na: 0,
        photos: w?.photo_urls?.length ?? 0,
        issues: [],
        kind: 'maintenance',
        title: w?.title ?? 'Maintenance job',
        note: w?.resolution_notes ?? null,
        photoUrls: w?.photo_urls ?? [],
      });
      continue;
    }
    const { data: rData } = await fieldDb()
      .from('inspection_results')
      .select('status, photo_urls, item_id')
      .eq('inspection_id', s.inspection_id!);
    const rs = (rData ?? []) as { status: string; photo_urls: string[] | null; item_id: string }[];
    const issueItemIds = rs.filter((r) => r.status === 'issue').map((r) => r.item_id);
    let issues: string[] = [];
    if (issueItemIds.length) {
      const { data: iData } = await fieldDb().from('inspection_items').select('id, title').in('id', issueItemIds);
      const titleById = new Map(((iData ?? []) as { id: string; title: string }[]).map((i) => [i.id, i.title]));
      issues = issueItemIds.map((id) => titleById.get(id) ?? 'Issue');
    }
    out.push({
      propertyName: nameById.get(s.property_id) ?? s.property_id,
      pass: rs.filter((r) => r.status === 'pass').length,
      issue: rs.filter((r) => r.status === 'issue').length,
      na: rs.filter((r) => r.status === 'na').length,
      photos: rs.reduce((a, r) => a + (r.photo_urls?.length ?? 0), 0),
      issues,
      kind: 'inspection',
    });
  }
  return out;
}

// ── Inspection calendar (open-window view) ───────────────────────────
export type CalCellState = 'open' | 'occupied' | 'blocked';
export type CalCell = {
  date: string;
  state: CalCellState;
  /** A guest checks in this day — the deadline marker. */
  checkIn: boolean;
  /** Open + a real upcoming uncovered guest after this day, so inspecting
   *  here covers a turnover. These are the clickable cells. */
  inspectable: boolean;
  /** Open, but the next guest is already out to a contractor in a live
   *  packet — so this day is handled, not actionable. */
  covered: boolean;
};
export type CalRow = {
  propertyId: string;
  propertyName: string;
  lat: number | null;
  lng: number | null;
  basePriceCents: number;
  cells: CalCell[];
  /** Soonest uncovered upcoming check-in (the tightest deadline this property
   *  still needs covered), for urgency sorting + at-risk flags. */
  nextDeadline: string | null;
};
export type InspectionCalendarData = {
  days: string[];
  rows: CalRow[];
  missingCoords: number;
  /** The homes hidden from the board (no lat/lng), by name with the id for a
   *  direct fix link. "1 property is hidden" alone sent the operator digging. */
  missingProps: Array<{ id: string; name: string }>;
};

/**
 * The calendar-of-open-windows board: each property that needs inspecting in
 * the window gets a row of day cells — occupied / blocked / open — with the
 * next check-in marked as the deadline. An open day is "inspectable" when the
 * next guest from that day on (including one arriving THAT day — the same-day
 * turnover) is real and not already covered, so the operator can inspect on
 * ANY open day up to and including the deadline, not just the checkout day.
 */
export async function loadInspectionCalendar(
  windowStart: string = todayStr(),
  windowEnd: string = addDays(todayStr(), 14),
): Promise<InspectionCalendarData> {
  // Managed rentals only: the calendar is turnover coverage, and HQ/prospect
  // rows (no bookings, ever) would just be permanent empty lanes.
  const properties = (await loadFieldProperties()).filter((p) => p.kind === 'managed');
  const withCoords = properties.filter((p) => p.latitude != null && p.longitude != null);
  const propIds = withCoords.map((p) => p.id);

  // Look 30 days past the window so we can see the next check-in even when it
  // falls just after the visible range.
  const fetchStart = addDays(windowStart, -30);
  const fetchEnd = addDays(windowEnd, 30);
  const { data: bData } = await fieldDb()
    .from('bookings')
    .select('id, property_id, check_in, check_out, status')
    .in('status', OCCUPANCY_STATUSES)
    .is('duplicate_of', null)
    .in('property_id', propIds)
    .lte('check_in', fetchEnd)
    .gte('check_out', fetchStart)
    .order('check_in', { ascending: true });
  const bookings = ((bData ?? []) as BookingRaw[]).filter((b) => b.check_in && b.check_out);

  const { data: blkData } = await fieldDb()
    .from('property_calendar_blocks')
    .select('property_id, date')
    .gte('date', windowStart)
    .lte('date', windowEnd);
  const blocked = new Set(
    ((blkData ?? []) as { property_id: string; date: string }[]).map((b) => `${b.property_id}:${b.date}`),
  );

  const { data: activeStops } = await fieldDb()
    .from('packet_stops')
    .select('booking_id, inspection_packets!inner(status)')
    .in('inspection_packets.status', ['published', 'claimed', 'in_progress', 'submitted', 'approved']);
  const coveredBookings = new Set(
    ((activeStops ?? []) as { booking_id: string | null }[]).map((s) => s.booking_id).filter((b): b is string => !!b),
  );

  const byProp = new Map<string, BookingRaw[]>();
  for (const b of bookings) {
    const a = byProp.get(b.property_id) ?? [];
    a.push(b);
    byProp.set(b.property_id, a);
  }

  const days = daysBetween(windowStart, windowEnd);
  const today = todayStr();
  const rows: CalRow[] = [];
  for (const p of withCoords) {
    const pb = (byProp.get(p.id) ?? []).slice().sort((a, b) => a.check_in.localeCompare(b.check_in));
    const uncovered = pb.filter(
      (b) => isGuestStay(b) && b.check_in >= windowStart && b.check_in <= windowEnd && !coveredBookings.has(b.id),
    );
    // A home whose next check-in falls just PAST the window still needs a row
    // when a guest checks out inside it: those open days are prime inspection
    // time (e.g. checkout Wed, next arrival a day after the window ends -- it
    // used to vanish from the board entirely). Bookings are fetched 30 days
    // past the window, so the later check-in is available as the deadline.
    const checkoutInWindow = pb.some(
      (b) => isGuestStay(b) && b.check_out >= windowStart && b.check_out <= windowEnd,
    );
    const uncoveredAfter = checkoutInWindow && uncovered.length === 0
      ? pb.filter((b) => isGuestStay(b) && b.check_in > windowEnd && !coveredBookings.has(b.id))
      : [];
    const anchor = uncovered.length > 0 ? uncovered : uncoveredAfter;
    if (anchor.length === 0) continue;
    const nextDeadline = anchor.map((b) => b.check_in).sort()[0];

    const cells: CalCell[] = days.map((D) => {
      // Next guest arrival to prep for — an arrival ON D counts (same-day
      // turnover: previous guest out in the morning, next in at 4 PM; the
      // tight midday window is the most urgent inspection there is).
      const next = pb.find((b) => isGuestStay(b) && b.check_in >= D);
      // An occupied night kills the day, EXCEPT the prepped stay's own
      // check-in day — the same rule candidatesForDay / deriveDayCandidates
      // use (#1049). The old unconditional `check_in <= D` test painted every
      // same-day turnover "guest in house", so its ONLY feasible inspection
      // day was unclickable here while the bundle path would happily take it.
      const guestOccupied =
        pb.some((b) => isGuestStay(b) && b.check_in <= D && D < b.check_out) &&
        !(next && next.check_in === D);
      const blockOccupied = pb.some((b) => !isGuestStay(b) && b.check_in <= D && D < b.check_out);
      const isBlocked = blocked.has(`${p.id}:${D}`) || blockOccupied;
      const checkIn = pb.some((b) => isGuestStay(b) && b.check_in === D);
      const state: CalCellState = isBlocked ? 'blocked' : guestOccupied ? 'occupied' : 'open';
      const nextCovered = !!next && coveredBookings.has(next.id);
      const inspectable = state === 'open' && D >= today && !!next && !nextCovered;
      const covered = state === 'open' && nextCovered;
      return { date: D, state, checkIn, inspectable, covered };
    });
    rows.push({
      propertyId: p.id,
      propertyName: p.name,
      lat: p.latitude,
      lng: p.longitude,
      basePriceCents: p.inspection_base_price_cents ?? 7500,
      cells,
      nextDeadline,
    });
  }
  // Urgency first: the tightest deadline floats to the top so the about-to-slip
  // turnover is never buried in an alphabetical list.
  rows.sort(
    (a, b) =>
      (a.nextDeadline ?? '9999-99-99').localeCompare(b.nextDeadline ?? '9999-99-99') ||
      a.propertyName.localeCompare(b.propertyName),
  );
  const missingProps = properties
    .filter((p) => p.latitude == null || p.longitude == null)
    .map((p) => ({ id: p.id, name: p.name }));
  return { days, rows, missingCoords: missingProps.length, missingProps };
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
    .select('awarded_contractor_id, posted_price_cents, final_payout_cents, bonus_cents, paid_at')
    .eq('status', 'approved')
    .not('awarded_contractor_id', 'is', null);
  const map = new Map<string, ContractorPayStats>();
  for (const r of (data ?? []) as Array<{
    awarded_contractor_id: string;
    posted_price_cents: number;
    final_payout_cents: number | null;
    bonus_cents: number;
    paid_at: string | null;
  }>) {
    const s = map.get(r.awarded_contractor_id) ?? { approvedCount: 0, paidCount: 0, owedCents: 0, paidCents: 0 };
    const total = effectiveBaseCents(r) + (r.bonus_cents || 0);
    s.approvedCount++;
    if (r.paid_at) {
      s.paidCount++;
      s.paidCents += total;
    } else {
      s.owedCents += total;
    }
    map.set(r.awarded_contractor_id, s);
  }
  return map;
}

// ── Reliability scores ────────────────────────────────────────────────
export type ReliabilityTier = 'new' | 'watch' | 'steady' | 'top';
export type ReliabilityStats = {
  completed: number; // approved packets
  onTime: number; // submitted on/before the visit date
  late: number; // submitted after the visit date
  reworked: number; // approved/in-flight packets that drew a "changes requested"
  flaked: number; // claims released before the contractor started
  score: number | null; // 0-100, null until there's history
  tier: ReliabilityTier;
};

function etDate(ts: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ts));
}

/**
 * Per-contractor reliability from the packet history we already record:
 * completion (approved vs released-after-claim), on-time submission (submitted
 * date vs the visit date), and rework (changes-requested bounces). The score is
 * a transparent weighted blend — completion 50%, on-time 30%, low-rework 20% —
 * surfaced on the roster and used to order who gets pinged first.
 */
export async function getContractorReliability(): Promise<Map<string, ReliabilityStats>> {
  const db = fieldDb();
  const [{ data: pkts }, { data: evts }] = await Promise.all([
    db
      .from('inspection_packets')
      .select('id, awarded_contractor_id, status, visit_date, submitted_at')
      .not('awarded_contractor_id', 'is', null),
    db
      .from('packet_events')
      .select('packet_id, contractor_id, event_type')
      .in('event_type', ['changes_requested', 'released']),
  ]);

  type Raw = { completed: number; onTime: number; late: number; reworkedSet: Set<string>; flaked: number };
  const raw = new Map<string, Raw>();
  const get = (cid: string): Raw => {
    let r = raw.get(cid);
    if (!r) {
      r = { completed: 0, onTime: 0, late: 0, reworkedSet: new Set(), flaked: 0 };
      raw.set(cid, r);
    }
    return r;
  };

  const packetCid = new Map<string, string>();
  for (const p of (pkts ?? []) as Array<{
    id: string;
    awarded_contractor_id: string;
    status: string;
    visit_date: string;
    submitted_at: string | null;
  }>) {
    packetCid.set(p.id, p.awarded_contractor_id);
    if (p.status === 'approved') {
      const r = get(p.awarded_contractor_id);
      r.completed++;
      if (p.submitted_at) {
        if (etDate(p.submitted_at) <= p.visit_date) r.onTime++;
        else r.late++;
      }
    }
  }
  for (const e of (evts ?? []) as Array<{ packet_id: string; contractor_id: string | null; event_type: string }>) {
    if (e.event_type === 'released') {
      if (e.contractor_id) get(e.contractor_id).flaked++;
    } else {
      // changes_requested — attribute to the recorded contractor, else the
      // packet's current owner (older events predate contractor stamping).
      const cid = e.contractor_id ?? packetCid.get(e.packet_id);
      if (cid) get(cid).reworkedSet.add(e.packet_id);
    }
  }

  const out = new Map<string, ReliabilityStats>();
  for (const [cid, r] of raw) {
    const reworked = r.reworkedSet.size;
    const hasHistory = r.completed > 0 || r.flaked > 0;
    const completionRate = r.completed + r.flaked > 0 ? r.completed / (r.completed + r.flaked) : 1;
    const onTimeRate = r.onTime + r.late > 0 ? r.onTime / (r.onTime + r.late) : 1;
    const reworkRate = r.completed > 0 ? Math.min(1, reworked / r.completed) : 0;
    const score = hasHistory
      ? Math.round(100 * (0.5 * completionRate + 0.3 * onTimeRate + 0.2 * (1 - reworkRate)))
      : null;
    const tier: ReliabilityTier =
      score == null ? 'new' : score >= 90 ? 'top' : score >= 75 ? 'steady' : 'watch';
    out.set(cid, { completed: r.completed, onTime: r.onTime, late: r.late, reworked, flaked: r.flaked, score, tier });
  }
  return out;
}

// ── Recruiting funnel: applications ───────────────────────────────────
export type ContractorApplication = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  area: string | null;
  trade: string;
  about: string | null;
  availability: string | null;
  has_transport: boolean | null;
  heard_about: string | null;
  video_url: string | null;
  source: string | null;
  status: string;
  contractor_id: string | null;
  created_at: string;
  ai_recommendation: 'reach_out' | 'maybe' | 'pass' | null;
  ai_score: number | null;
  ai_reason: string | null;
  ai_assessed_at: string | null;
};

export async function loadApplications(): Promise<ContractorApplication[]> {
  const { data } = await fieldDb()
    .from('contractor_applications')
    .select('*')
    .order('created_at', { ascending: false });
  return (data ?? []) as ContractorApplication[];
}
