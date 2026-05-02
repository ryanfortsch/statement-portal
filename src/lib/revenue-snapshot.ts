/**
 * Revenue snapshot computation. Reads from `guesty_reservations` (already
 * synced via /api/sync-guesty) and `properties`, runs nights-pro-rated
 * revenue math, and returns one row per active property.
 *
 * This mirrors Perfection's `fetchOwnerSnapshots` Edge Function but without
 * the live Guesty pull: Helm syncs reservations into Supabase ahead of time
 * so any range query can be answered from the local table.
 *
 * Key calculation: a stay that straddles the period boundary is pro-rated by
 * nights, so a 6-night stay where 2 nights fall inside the range contributes
 * (host_payout * 2 / 6) to that range's revenue.
 */
import { supabase } from './supabase';
import { dayAfter, nightsBetween } from './revenue-date-range';

const ALLOWED_STATUSES = new Set([
  'confirmed',
  'reserved',
  'checked_in',
  'checked-in',
  'checkedin',
  'checked_out',
  'checked-out',
  'checkedout',
  'closed',
]);

const FORWARD_EXCLUDED = new Set(['cancelled', 'canceled', 'inquiry', 'declined', 'expired']);

export type PropertyRevenueMetrics = {
  staysCount: number;
  nightsSold: number;
  totalRevenue: number | null;
  ADR: number | null;
  occupancyPct: number | null;
  managementFee: number | null;
  cleaningCost: number | null;
  projectedOwnerPayout: number | null;
};

export type PropertySnapshot = {
  propertyId: string;
  propertyName: string;
  propertyCode: string | null;
  guestyListingId: string | null;
  isRisingTideOwned: boolean;
  metrics: PropertyRevenueMetrics;
  turnoversNext30: number;
};

export type SnapshotsResponse = {
  rangeStart: string;
  rangeEnd: string;
  snapshots: PropertySnapshot[];
  portfolio: PortfolioTotals;
};

export type PortfolioTotals = {
  propertyCount: number;
  totalStays: number;
  totalNights: number;
  totalRevenue: number;
  totalPayout: number;
  totalManagementFee: number;
  totalPortfolioRevenue: number; // owner payout from RT-owned properties
  avgADR: number | null;
  avgOccupancy: number | null;
};

type PropertyRow = {
  id: string;
  name: string;
  nickname: string | null;
  code: string | null;
  guesty_listing_id: string | null;
  activated_at: string | null;
  cleaning_cost_estimate: number | null;
  management_fee_pct: number;
  is_rising_tide_owned: boolean;
  is_active: boolean;
};

type ReservationRow = {
  property_id: string | null;
  listing_id: string | null;
  check_in: string | null;
  check_out: string | null;
  status: string | null;
  host_payout: number | null;
  owner_net_revenue_guesty: number | null;
};

/**
 * Resolve the per-stay payout. `host_payout` is what Guesty's live API
 * populates, but most rows in Helm came in via the CSV ingest path which
 * fills `owner_net_revenue_guesty` instead. Use whichever is non-zero.
 */
function resolvePayout(r: ReservationRow): number {
  const hp = Number(r.host_payout ?? 0);
  if (hp > 0) return hp;
  const own = Number(r.owner_net_revenue_guesty ?? 0);
  if (own > 0) return own;
  return 0;
}

function effectiveStart(rangeStart: string, activatedAt: string | null): string {
  if (!activatedAt) return rangeStart;
  const d = new Date(activatedAt).toISOString().split('T')[0];
  return d > rangeStart ? d : rangeStart;
}

function normalizeStatus(s: string | null): string {
  return (s || '').toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
}

function isAllowed(status: string | null): boolean {
  const n = normalizeStatus(status);
  return (
    ALLOWED_STATUSES.has(n) ||
    n.includes('confirmed') ||
    n.includes('checked') ||
    n.includes('closed')
  );
}

export async function computeRevenueSnapshot(
  rangeStart: string,
  rangeEnd: string,
): Promise<SnapshotsResponse> {
  // 1. Properties (active only, with the fields we need for the math).
  const { data: propsData, error: propsErr } = await supabase
    .from('properties')
    .select('id, name, nickname, code, guesty_listing_id, activated_at, cleaning_cost_estimate, management_fee_pct, is_rising_tide_owned, is_active')
    .eq('is_active', true)
    .order('name');

  if (propsErr) {
    throw new Error(`Failed to load properties: ${propsErr.message}`);
  }

  const properties = (propsData ?? []) as PropertyRow[];

  // 2. Reservations overlapping the period:
  //    overlap iff (check_in < periodEndExclusive) AND (check_out > periodStart).
  const periodEndExclusive = dayAfter(rangeEnd);

  const { data: resData, error: resErr } = await supabase
    .from('guesty_reservations')
    .select('property_id, listing_id, check_in, check_out, status, host_payout, owner_net_revenue_guesty')
    .lt('check_in', periodEndExclusive)
    .gt('check_out', rangeStart);

  if (resErr) {
    throw new Error(`Failed to load reservations: ${resErr.message}`);
  }

  const reservations = ((resData ?? []) as ReservationRow[]).filter(
    (r) => r.check_in && r.check_out && isAllowed(r.status),
  );

  // 3. Forward reservations: today through +30d, count turnovers per property.
  const today = new Date().toISOString().split('T')[0];
  const thirty = new Date();
  thirty.setDate(thirty.getDate() + 30);
  const thirtyEnd = thirty.toISOString().split('T')[0];

  const { data: fwdData } = await supabase
    .from('guesty_reservations')
    .select('property_id, listing_id, check_in, check_out, status')
    .lt('check_in', dayAfter(thirtyEnd))
    .gt('check_out', today);

  const forwardCountByProperty = new Map<string, number>();
  for (const r of (fwdData ?? []) as ReservationRow[]) {
    if (!r.property_id || !r.check_in || !r.check_out) continue;
    if (FORWARD_EXCLUDED.has(normalizeStatus(r.status))) continue;
    forwardCountByProperty.set(r.property_id, (forwardCountByProperty.get(r.property_id) ?? 0) + 1);
  }

  // 4. Bucket reservations by property.
  const resByProperty = new Map<string, ReservationRow[]>();
  for (const r of reservations) {
    if (!r.property_id) continue;
    const arr = resByProperty.get(r.property_id) ?? [];
    arr.push(r);
    resByProperty.set(r.property_id, arr);
  }

  // 5. Per-property pro-rated math.
  const totalNightsInPeriod = nightsBetween(rangeStart, periodEndExclusive);

  const snapshots: PropertySnapshot[] = properties.map((prop) => {
    const propStart = effectiveStart(rangeStart, prop.activated_at);
    const skipped = propStart >= periodEndExclusive;

    const empty: PropertyRevenueMetrics = {
      staysCount: 0,
      nightsSold: 0,
      totalRevenue: null,
      ADR: null,
      occupancyPct: skipped ? null : 0,
      managementFee: null,
      cleaningCost: null,
      projectedOwnerPayout: null,
    };

    if (skipped) {
      return {
        propertyId: prop.id,
        propertyName: prop.nickname || prop.name,
        propertyCode: prop.code,
        guestyListingId: prop.guesty_listing_id,
        isRisingTideOwned: prop.is_rising_tide_owned,
        metrics: empty,
        turnoversNext30: forwardCountByProperty.get(prop.id) ?? 0,
      };
    }

    const propReservations = resByProperty.get(prop.id) ?? [];

    let nightsSold = 0;
    let totalRevenue = 0;
    let staysCount = 0;
    let cleaningCost = 0;
    const cleaningPerStay = Number(prop.cleaning_cost_estimate ?? 0);
    // properties.management_fee_pct stored as percent (e.g. 25 = 25%).
    const mgmtFeeFraction = prop.is_rising_tide_owned ? 0 : Number(prop.management_fee_pct) / 100;

    for (const r of propReservations) {
      const checkIn = r.check_in!;
      const checkOut = r.check_out!;
      const totalNights = nightsBetween(checkIn, checkOut);
      if (totalNights <= 0) continue;

      const overlapStart = checkIn > propStart ? checkIn : propStart;
      const overlapEnd = checkOut < periodEndExclusive ? checkOut : periodEndExclusive;
      const nightsInPeriod = nightsBetween(overlapStart, overlapEnd);
      if (nightsInPeriod <= 0) continue;

      nightsSold += nightsInPeriod;

      const fullPayout = resolvePayout(r);
      if (fullPayout > 0) {
        totalRevenue += fullPayout * (nightsInPeriod / totalNights);
      }

      // Cleaning attributed at checkout (so it doesn't double-count for stays
      // that overlap multiple periods).
      if (checkOut > rangeStart && checkOut <= periodEndExclusive) {
        staysCount += 1;
        cleaningCost += cleaningPerStay;
      }
    }

    const managementFee = totalRevenue * mgmtFeeFraction;
    const ownerPayout = totalRevenue - cleaningCost - managementFee;
    const ADR = nightsSold > 0 && totalRevenue > 0 ? totalRevenue / nightsSold : null;
    const propTotalNights = nightsBetween(propStart, periodEndExclusive);
    const occupancyPct = propTotalNights > 0 ? (nightsSold / propTotalNights) * 100 : null;

    return {
      propertyId: prop.id,
      propertyName: prop.nickname || prop.name,
      propertyCode: prop.code,
      guestyListingId: prop.guesty_listing_id,
      isRisingTideOwned: prop.is_rising_tide_owned,
      metrics: {
        staysCount,
        nightsSold,
        totalRevenue: totalRevenue > 0 ? round2(totalRevenue) : null,
        ADR: ADR !== null ? round2(ADR) : null,
        occupancyPct: occupancyPct !== null ? round1(occupancyPct) : null,
        managementFee: managementFee > 0 ? round2(managementFee) : (totalRevenue > 0 ? 0 : null),
        cleaningCost: cleaningCost > 0 ? round2(cleaningCost) : null,
        projectedOwnerPayout: ownerPayout > 0 ? round2(ownerPayout) : null,
      },
      turnoversNext30: forwardCountByProperty.get(prop.id) ?? 0,
    };
  });

  // 6. Portfolio totals.
  let totalStays = 0;
  let totalNights = 0;
  let totalRevenueP = 0;
  let totalPayout = 0;
  let totalMgmtFee = 0;
  let totalPortfolioRevenue = 0;
  let propertiesWithData = 0;

  for (const s of snapshots) {
    if (s.metrics.totalRevenue == null) continue;
    propertiesWithData += 1;
    totalStays += s.metrics.staysCount;
    totalNights += s.metrics.nightsSold;
    totalRevenueP += s.metrics.totalRevenue;
    if (s.metrics.projectedOwnerPayout) totalPayout += s.metrics.projectedOwnerPayout;
    if (s.isRisingTideOwned) {
      if (s.metrics.projectedOwnerPayout) totalPortfolioRevenue += s.metrics.projectedOwnerPayout;
    } else if (s.metrics.managementFee) {
      totalMgmtFee += s.metrics.managementFee;
    }
  }

  const avgADR = totalNights > 0 ? totalRevenueP / totalNights : null;
  const totalPossibleNights = propertiesWithData * totalNightsInPeriod;
  const avgOccupancy = totalPossibleNights > 0 ? (totalNights / totalPossibleNights) * 100 : null;

  return {
    rangeStart,
    rangeEnd,
    snapshots,
    portfolio: {
      propertyCount: snapshots.length,
      totalStays,
      totalNights,
      totalRevenue: round2(totalRevenueP),
      totalPayout: round2(totalPayout),
      totalManagementFee: round2(totalMgmtFee),
      totalPortfolioRevenue: round2(totalPortfolioRevenue),
      avgADR: avgADR !== null ? round2(avgADR) : null,
      avgOccupancy: avgOccupancy !== null ? round1(avgOccupancy) : null,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
