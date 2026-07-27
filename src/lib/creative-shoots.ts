import 'server-only';
import { fieldDb } from './field-db';
import { loadRateCards, type RateCard } from './creative-rates';
import { computeShootPay, cardFromSnapshot, type ShootAsset, type ShootPay } from './creative-pay';
import { effectiveBaseCents } from './field-types';

/**
 * Read + summarize the creative delivery ledger (creative_shoots / _assets).
 * Every pay figure comes from computeShootPay so the office board, the shoot
 * page, the roster, and the contributor portal can never drift.
 *
 * Card resolution for a shoot, in priority order:
 *   1. the card SNAPSHOT frozen on the shoot at approval (what she was quoted)
 *   2. the contributor's per-talent override card
 *   3. the default card
 * Never fall straight to the default — a per-talent rate would be silently
 * ignored on any unapproved shoot.
 */

export type ShootStatus = 'scheduled' | 'shot' | 'delivered' | 'approved' | 'settled' | 'cancelled';

export type ShootRow = {
  id: string;
  contractor_id: string;
  property_id: string | null;
  location_note: string | null;
  shoot_date: string;
  title: string;
  notes: string | null;
  status: ShootStatus;
  card_snapshot: unknown;
  card_snapshot_at: string | null;
  posted_price_cents: number;
  final_payout_cents: number | null;
  bonus_cents: number;
  bonus_reason: string | null;
  approved_at: string | null;
  paid_at: string | null;
  paid_method: string | null;
  paid_reference: string | null;
  created_at: string;
};

export type AssetRow = ShootAsset & {
  shoot_id: string;
  platform: string;
  submitted_by_contractor_at: string | null;
};

export type ShootSummary = {
  shoot: ShootRow;
  contractorName: string;
  propertyName: string | null;
  assets: AssetRow[];
  pay: ShootPay;
  card: RateCard;
};

const ASSET_COLS =
  'id, shoot_id, kind, title, platform, post_url, posted_at, duration_seconds, views, views_read_at, views_locked_at, qualifies, disqualified_reason, submitted_by_contractor_at';

/** The card in force for a shoot (snapshot > per-talent > default). */
function cardForShoot(shoot: ShootRow, cards: { def: RateCard; byContractor: Map<string, RateCard> }): RateCard {
  const live = cards.byContractor.get(shoot.contractor_id) ?? cards.def;
  return shoot.card_snapshot ? cardFromSnapshot(shoot.card_snapshot, live) : live;
}

function toSummary(
  shoot: ShootRow,
  assets: AssetRow[],
  cards: { def: RateCard; byContractor: Map<string, RateCard> },
  names: Map<string, string>,
  propNames: Map<string, string>,
): ShootSummary {
  const card = cardForShoot(shoot, cards);
  return {
    shoot,
    contractorName: names.get(shoot.contractor_id) ?? 'Contributor',
    propertyName: shoot.property_id ? propNames.get(shoot.property_id) ?? shoot.property_id : null,
    assets,
    pay: computeShootPay(card, assets),
    card,
  };
}

/** All non-cancelled shoots for the office board, needs-attention first. */
export async function loadShootBoard(): Promise<ShootSummary[]> {
  const { data: sData } = await fieldDb()
    .from('creative_shoots')
    .select('*')
    .neq('status', 'cancelled')
    .order('shoot_date', { ascending: false });
  const shoots = (sData ?? []) as ShootRow[];
  if (shoots.length === 0) return [];

  const [{ data: aData }, cards, names, propNames] = await Promise.all([
    fieldDb().from('creative_assets').select(ASSET_COLS).in('shoot_id', shoots.map((s) => s.id)),
    loadRateCards(),
    contractorNames(shoots.map((s) => s.contractor_id)),
    propertyNames(shoots.map((s) => s.property_id).filter((v): v is string => !!v)),
  ]);
  const assetsByShoot = new Map<string, AssetRow[]>();
  for (const a of (aData ?? []) as AssetRow[]) {
    const arr = assetsByShoot.get(a.shoot_id) ?? [];
    arr.push(a);
    assetsByShoot.set(a.shoot_id, arr);
  }
  const out = shoots.map((s) => toSummary(s, assetsByShoot.get(s.id) ?? [], cards, names, propNames));
  // Needs-attention first, then unsettled, then the rest by date (already sorted).
  return out.sort((a, b) => Number(b.pay.needsAttention) - Number(a.pay.needsAttention));
}

export async function loadShootDetail(shootId: string): Promise<ShootSummary | null> {
  const { data: sData } = await fieldDb().from('creative_shoots').select('*').eq('id', shootId).maybeSingle();
  const shoot = sData as ShootRow | null;
  if (!shoot) return null;
  const [{ data: aData }, cards, names, propNames] = await Promise.all([
    fieldDb().from('creative_assets').select(ASSET_COLS).eq('shoot_id', shootId).order('created_at'),
    loadRateCards(),
    contractorNames([shoot.contractor_id]),
    propertyNames(shoot.property_id ? [shoot.property_id] : []),
  ]);
  return toSummary(shoot, (aData ?? []) as AssetRow[], cards, names, propNames);
}

/** Shoots awarded to one contributor (their portal + profile history). */
export async function loadContractorShoots(contractorId: string): Promise<ShootSummary[]> {
  const { data: sData } = await fieldDb()
    .from('creative_shoots')
    .select('*')
    .eq('contractor_id', contractorId)
    .neq('status', 'cancelled')
    .order('shoot_date', { ascending: false });
  const shoots = (sData ?? []) as ShootRow[];
  if (shoots.length === 0) return [];
  const [{ data: aData }, cards, names, propNames] = await Promise.all([
    fieldDb().from('creative_assets').select(ASSET_COLS).in('shoot_id', shoots.map((s) => s.id)),
    loadRateCards(),
    contractorNames([contractorId]),
    propertyNames(shoots.map((s) => s.property_id).filter((v): v is string => !!v)),
  ]);
  const byShoot = new Map<string, AssetRow[]>();
  for (const a of (aData ?? []) as AssetRow[]) {
    const arr = byShoot.get(a.shoot_id) ?? [];
    arr.push(a);
    byShoot.set(a.shoot_id, arr);
  }
  return shoots.map((s) => toSummary(s, byShoot.get(s.id) ?? [], cards, names, propNames));
}

// ── Ledger union: creative pay folded into the contractor stats ─────────
export type ShootPayStats = { approvedCount: number; paidCount: number; owedCents: number; paidCents: number; pendingCents: number };

/**
 * Per-contributor creative earnings, in the SAME three buckets the packet
 * ledger uses plus one:
 *  - pendingCents: approved shoots still counting views (final not locked) —
 *    the money is real but the number isn't yet.
 *  - owedCents: finalized, unpaid.
 *  - paidCents: paid.
 * getContractorPayStats merges this into its map.
 */
export async function getContractorShootStats(): Promise<Map<string, ShootPayStats>> {
  const map = new Map<string, ShootPayStats>();
  const { data: sData } = await fieldDb()
    .from('creative_shoots')
    .select('*')
    .in('status', ['approved', 'settled']);
  const shoots = (sData ?? []) as ShootRow[];
  if (shoots.length === 0) return map;

  const [{ data: aData }, cards] = await Promise.all([
    fieldDb().from('creative_assets').select(ASSET_COLS).in('shoot_id', shoots.map((s) => s.id)),
    loadRateCards(),
  ]);
  const byShoot = new Map<string, AssetRow[]>();
  for (const a of (aData ?? []) as AssetRow[]) {
    const arr = byShoot.get(a.shoot_id) ?? [];
    arr.push(a);
    byShoot.set(a.shoot_id, arr);
  }

  for (const s of shoots) {
    const cur = map.get(s.contractor_id) ?? { approvedCount: 0, paidCount: 0, owedCents: 0, paidCents: 0, pendingCents: 0 };
    if (s.final_payout_cents == null) {
      // Still counting: show the current best total as PENDING, owe nothing yet.
      const pay = computeShootPay(cardForShoot(s, cards), byShoot.get(s.id) ?? []);
      cur.pendingCents += pay.totalCents + (s.bonus_cents || 0);
    } else {
      const total = effectiveBaseCents(s) + (s.bonus_cents || 0);
      if (s.paid_at) {
        cur.paidCount++;
        cur.paidCents += total;
      } else {
        cur.approvedCount++;
        cur.owedCents += total;
      }
    }
    map.set(s.contractor_id, cur);
  }
  return map;
}

/** Active creative-trade contributors, for the "log a shoot" picker. */
export async function loadCreativeContractors(): Promise<{ id: string; full_name: string }[]> {
  const { data } = await fieldDb()
    .from('contractors')
    .select('id, full_name')
    .eq('trade', 'creative')
    .eq('status', 'active')
    .order('full_name');
  return (data ?? []) as { id: string; full_name: string }[];
}

async function contractorNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(ids)];
  if (!uniq.length) return map;
  const { data } = await fieldDb().from('contractors').select('id, full_name').in('id', uniq);
  for (const c of (data ?? []) as { id: string; full_name: string }[]) map.set(c.id, c.full_name);
  return map;
}
async function propertyNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(ids)];
  if (!uniq.length) return map;
  const { data } = await fieldDb().from('properties').select('id, name').in('id', uniq);
  for (const p of (data ?? []) as { id: string; name: string }[]) map.set(p.id, p.name);
  return map;
}
