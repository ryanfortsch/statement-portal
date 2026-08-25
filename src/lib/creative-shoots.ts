import 'server-only';
import { fieldDb } from './field-db';
import { loadRateCards, type RateCard } from './creative-rates';
import { computeShootPay, cardFromSnapshot, type ShootAsset, type ShootPay } from './creative-pay';

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
  // Base advance: the floor (posted_price_cents), paid when the post goes live.
  // advance_cents defaults 0, so a shoot never advanced settles its full total.
  advance_cents: number;
  advance_paid_at: string | null;
  advance_method: string | null;
  advance_reference: string | null;
  // Office correction to paid-to-date (cents, delta vs the receipts total) with
  // its audit trail. 0 = the receipts stand as-is.
  paid_adjustment_cents: number;
  paid_adjustment_note: string | null;
  paid_adjustment_by_email: string | null;
  paid_adjustment_at: string | null;
  paid_at: string | null;
  paid_method: string | null;
  paid_reference: string | null;
  // Drive delivery watcher (20260803): the shoot's Drive subfolder, the dated
  // "Finals" deliver-to folder Helm creates inside it (the package gate), the
  // DRONE box inside finals where raw masters park uncounted, when the
  // completed package last landed, and when the folder was last scanned.
  drive_folder_id: string | null;
  drive_finals_folder_id: string | null;
  drive_drone_folder_id: string | null;
  drive_delivered_at: string | null;
  drive_synced_at: string | null;
  created_at: string;
};

export type AssetRow = ShootAsset & {
  shoot_id: string;
  platform: string;
  submitted_by_contractor_at: string | null;
  // Per-post pay: base is paid the day the post goes live; a reel's view bonus
  // (topup) is paid ~countDays later once its views lock. Carousels have no topup.
  base_cents: number | null;
  base_paid_at: string | null;
  base_method: string | null;
  base_reference: string | null;
  topup_cents: number | null;
  topup_paid_at: string | null;
  topup_method: string | null;
  topup_reference: string | null;
  // Office override on the view bonus (see creative-pay ShootAsset). The by/at
  // pair is the audit trail shown next to the decided number.
  topup_override_by_email: string | null;
  topup_override_at: string | null;
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
  'id, shoot_id, kind, title, platform, post_url, posted_at, duration_seconds, views, views_read_at, views_locked_at, qualifies, disqualified_reason, submitted_by_contractor_at, base_cents, base_paid_at, base_method, base_reference, topup_cents, topup_paid_at, topup_method, topup_reference, topup_override_cents, topup_override_by_email, topup_override_at';

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

export type ShootPaySummary = {
  paidCents: number; // money on the books: receipted bases + bonuses, plus any office adjustment
  receiptsPaidCents: number; // just the per-post receipts (what actually recorded as sent)
  owedCents: number; // delivered-unpaid bases + reel bonuses ready to pay (posted, views locked, >0)
  owedBaseCents: number; // just the delivered-unpaid base portion of owedCents
  pendingCents: number; // reel bonuses still counting (base paid, posted, views not locked)
  fullySettled: boolean; // >=1 counting post, every base paid, every counting REEL posted + count locked + bonus resolved (carousels settle at base)
  baseDue: number; // delivered posts awaiting their base payment
  topupDue: number; // posted reels whose view bonus is ready to pay
};

/**
 * Per-POST money rollup for a shoot — the single source of truth the board, the
 * shoot header, the roster ledger, and the contributor's portal all read from,
 * so no two surfaces can drift. The base is owed on DELIVERY (as soon as the
 * post is logged); a reel's view bonus only starts once we POST it — which can
 * be weeks later, or never.
 */
export function shootPaySummary(
  assets: AssetRow[],
  pay: ShootPay,
  // Required (not optional) so a new surface can't silently drop the office's
  // paid-to-date correction and drift from the books.
  shoot: Pick<ShootRow, 'paid_adjustment_cents'>,
): ShootPaySummary {
  const byId = new Map(pay.assets.map((p) => [p.assetId, p]));
  let paidCents = 0, owedCents = 0, owedBaseCents = 0, pendingCents = 0, baseDue = 0, topupDue = 0, counting = 0, settled = 0;
  for (const a of assets) {
    const ap = byId.get(a.id);
    // Money that actually moved stays on the books even if the post was later
    // un-counted (wrong-version upload, over-cap): earned-to-date must always
    // match the receipts. Only OWED/PENDING math is limited to counting posts.
    if (a.base_paid_at) paidCents += a.base_cents ?? ap?.baseCents ?? 0;
    if (a.kind === 'reel' && a.topup_paid_at) paidCents += a.topup_cents ?? 0;
    if (!ap || !ap.counts) continue; // excluded / disqualified / over-cap owe nothing
    counting++;
    let assetSettled = true;
    // Base — owed the moment it's delivered (logged), whether or not it's posted.
    if (!a.base_paid_at) {
      owedCents += ap.baseCents;
      owedBaseCents += ap.baseCents;
      baseDue++;
      assetSettled = false;
    }
    // View bonus — reels only, and only once the reel has been POSTED (its clock
    // running) AND its delivery base is paid. A posted reel whose base isn't
    // paid waits on the base first. ap.locked (not the raw views column) so an
    // office-decided bonus reads as settled money, not a climbing one.
    if (a.kind === 'reel' && !a.topup_paid_at) {
      if (!a.posted_at) {
        // Delivered but not posted yet: posting happens on RT's schedule,
        // weeks or months later, and only then does the count run — so the
        // shoot STAYS OPEN. It owes nothing and counts nothing, it just
        // isn't finished. (Dotti 2026-08-20: settled means every reel
        // posted AND its view count locked; supersedes #1153's
        // dormant-bonus-reads-settled call.)
        assetSettled = false;
      } else if (a.base_paid_at) {
        if (ap.locked) {
          if (ap.topupCents > 0) { owedCents += ap.topupCents; topupDue++; assetSettled = false; }
          // locked under the first rung → no bonus, nothing left to pay
        } else {
          pendingCents += ap.topupCents; // current best bonus, still climbing
          assetSettled = false;
        }
      }
    }
    if (assetSettled) settled++;
  }
  // The office's hand on paid-to-date: a delta against the receipts, so a later
  // real payment still adds on top. Settlement state stays receipt-driven.
  const receiptsPaidCents = paidCents;
  paidCents += shoot.paid_adjustment_cents ?? 0;
  return { paidCents, receiptsPaidCents, owedCents, owedBaseCents, pendingCents, baseDue, topupDue, fullySettled: counting > 0 && settled === counting };
}

/**
 * Per-contributor creative earnings, folded into the packet ledger's buckets:
 *  - paidCents: bases + bonuses already paid out.
 *  - owedCents: bases due now + reel bonuses whose views have locked.
 *  - pendingCents: reel bonuses still counting views.
 */
export async function getContractorShootStats(): Promise<Map<string, ShootPayStats>> {
  const map = new Map<string, ShootPayStats>();
  const { data: sData } = await fieldDb()
    .from('creative_shoots')
    .select('*')
    .neq('status', 'cancelled');
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
    const assets = byShoot.get(s.id) ?? [];
    if (assets.length === 0) continue;
    const sum = shootPaySummary(assets, computeShootPay(cardForShoot(s, cards), assets), s);
    const cur = map.get(s.contractor_id) ?? { approvedCount: 0, paidCount: 0, owedCents: 0, paidCents: 0, pendingCents: 0 };
    cur.paidCents += sum.paidCents;
    cur.owedCents += sum.owedCents;
    cur.pendingCents += sum.pendingCents;
    if (sum.fullySettled) cur.paidCount++;
    else if (sum.owedCents > 0) cur.approvedCount++; // shoots with money ready to send
    map.set(s.contractor_id, cur);
  }
  return map;
}

// ── Contributor profile rollup ──────────────────────────────────────────

export type CreativeProfileStats = {
  /** Shoots that actually happened: delivered assets, or a shoot date that has
   *  arrived. Scheduled future shoots live in upNext, not this count. */
  shootsDone: number;
  /** Booked shoots still ahead, soonest first. */
  upNext: ShootSummary[];
  paidCents: number;
  owedCents: number;
  pendingCents: number;
  /** Posted reels, and how many of those have a views reading yet. */
  reelsPosted: number;
  reelsRead: number;
  viewsTotal: number;
  /** The reputation number: average views per posted reel, over reels with a
   *  reading. Null until the first count lands. */
  avgViewsPerReel: number | null;
  /** When the earliest still-counting posted reel locks — "first count ~Aug 6". */
  firstCountOn: string | null;
};

function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

/** One pass over a contributor's shoots for their portal profile. The money
 *  buckets reuse shootPaySummary so they can never drift from the office board. */
export function creativeProfileStats(shoots: ShootSummary[], today: string = todayET()): CreativeProfileStats {
  let shootsDone = 0, paidCents = 0, owedCents = 0, pendingCents = 0;
  let reelsPosted = 0, reelsRead = 0, viewsTotal = 0;
  let firstCountOn: string | null = null;
  const upNext: ShootSummary[] = [];

  for (const sm of shoots) {
    const sum = shootPaySummary(sm.assets, sm.pay, sm.shoot);
    paidCents += sum.paidCents;
    owedCents += sum.owedCents;
    pendingCents += sum.pendingCents;

    const happened = sm.assets.length > 0 || sm.shoot.shoot_date <= today;
    if (happened) shootsDone++;
    else upNext.push(sm);

    const payById = new Map(sm.pay.assets.map((p) => [p.assetId, p]));
    for (const a of sm.assets) {
      if (a.kind !== 'reel' || !a.posted_at) continue;
      reelsPosted++;
      if (a.views != null && a.views_read_at) {
        reelsRead++;
        viewsTotal += a.views;
      } else {
        const locksOn = payById.get(a.id)?.locksOn ?? null;
        if (locksOn && (!firstCountOn || locksOn < firstCountOn)) firstCountOn = locksOn;
      }
    }
  }

  upNext.sort((a, b) => (a.shoot.shoot_date < b.shoot.shoot_date ? -1 : 1));
  return {
    shootsDone,
    upNext,
    paidCents,
    owedCents,
    pendingCents,
    reelsPosted,
    reelsRead,
    viewsTotal,
    avgViewsPerReel: reelsRead > 0 ? Math.round(viewsTotal / reelsRead) : null,
    firstCountOn,
  };
}

/** View counts render in full comma form everywhere ("28,100"), per Dotti —
 *  never the compact "28.1k", which hides the precision the pay rungs use. */
export function formatViews(n: number): string {
  return n.toLocaleString('en-US');
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
