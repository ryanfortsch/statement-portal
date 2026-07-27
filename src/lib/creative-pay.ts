/**
 * The single source of truth for what a creative SHOOT is worth.
 *
 * The office board, the shoot detail page, the contributor's portal, and the
 * finalize action's default + clamp all call computeShootPay. Nothing hand-sums
 * a shoot, so those surfaces can never drift apart.
 *
 * The shape of the problem: an inspector's pay is known when the work is done;
 * a contributor's is not. A reel earns base until its views land ~countDays
 * after it posts, then jumps to whichever rung it reached. So a shoot moves
 * through three money states:
 *   floor   - every counting asset at base (what it's worth at minimum)
 *   range   - floor..ceiling while any asset is still counting
 *   locked  - every counting asset read + locked; a single number
 * Callers must show the RANGE (and the settle date) while unsettled, never a
 * single number someone might act on.
 */
import { payForViews, type RateCard, STANDARD_CARD } from './creative-rates';

export type ShootAsset = {
  id: string;
  kind: 'reel' | 'carousel';
  title: string | null;
  post_url: string | null;
  posted_at: string | null;
  duration_seconds: number | null;
  views: number | null;
  views_read_at: string | null;
  views_locked_at: string | null;
  qualifies: boolean;
  disqualified_reason: string | null;
  // Whether this post's base has been paid — a paid reel is pinned into the cap
  // so committed money can never be displaced by a later, higher-earning reel.
  base_paid_at?: string | null;
};

export type AssetPay = {
  assetId: string;
  kind: 'reel' | 'carousel';
  /** Counts toward the shoot's pay (qualified AND inside the cap). */
  counts: boolean;
  excludedReason: string | null;
  /** Pay if the views stopped here. Base for an unread reel. */
  currentCents: number;
  /** The floor pay for this post — reel base or carousel flat. Paid on posting. */
  baseCents: number;
  /** View bonus beyond the base once counted (currentCents - baseCents); 0 for a carousel or an unread reel. */
  topupCents: number;
  /** The most this asset can still reach (top rung) while unlocked. */
  ceilingCents: number;
  locked: boolean;
  /** The rung its views reached, null = base. */
  rungViews: number | null;
  /** Date its count closes (posted_at + countDays). Null if not posted yet. */
  locksOn: string | null;
  /** Posted, past its lock date, still unread — money is sitting unclaimed. */
  overdue: boolean;
  /** Live but no posted_at, so the day-N sweep can't even see it. */
  stalled: boolean;
};

export type ShootPay = {
  /** locked = every counting asset is read+locked, so totalCents is real. */
  state: 'empty' | 'counting' | 'locked';
  assets: AssetPay[];
  floorCents: number;
  ceilingCents: number;
  /** Current best total. Only trustworthy as a FINAL number when state==='locked'. */
  totalCents: number;
  /** Latest lock date across counting assets — when the shoot settles. */
  settlesOn: string | null;
  /** Any counting asset overdue or stalled: the office needs to act. */
  needsAttention: boolean;
};

const DAY_MS = 86_400_000;

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

/**
 * Revive a card_snapshot jsonb blob into a RateCard. payForViews walks tiers in
 * order and takes the LAST match, so a snapshot with unsorted or malformed
 * tiers would mis-price. Never let raw jsonb reach it: re-validate here, and
 * fall back to the live card if the blob is unusable.
 */
export function cardFromSnapshot(snapshot: unknown, live: RateCard): RateCard {
  if (!snapshot || typeof snapshot !== 'object') return live;
  const s = snapshot as Partial<RateCard>;
  const tiers = Array.isArray(s.tiers)
    ? s.tiers
        .map((t) => ({ views: Number(t?.views), cents: Number(t?.cents) }))
        .filter((t) => Number.isFinite(t.views) && t.views > 0 && Number.isFinite(t.cents) && t.cents >= 0)
        .sort((a, b) => a.views - b.views)
    : [];
  const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  if (!Number.isFinite(Number(s.baseCents))) return live;
  return {
    ...live,
    baseCents: num(s.baseCents, live.baseCents),
    tiers: tiers.length ? tiers : live.tiers,
    carouselCents: num(s.carouselCents, live.carouselCents),
    minSeconds: num(s.minSeconds, live.minSeconds),
    countDays: num(s.countDays, live.countDays),
    maxPerShoot: num(s.maxPerShoot, live.maxPerShoot),
    maxCarouselsPerShoot: num(s.maxCarouselsPerShoot, live.maxCarouselsPerShoot),
  };
}

/** Highest rung this view count reached, or null if it only earned base. */
function rungFor(card: RateCard, views: number): number | null {
  let rung: number | null = null;
  for (const t of card.tiers) if (views >= t.views) rung = t.views;
  return rung;
}

/**
 * Price a shoot's assets against its card.
 *
 * Cap: reels and carousels have SEPARATE limits (maxPerShoot counts paid reels;
 * maxCarouselsPerShoot counts carousels) because a carousel is flat-rate and
 * can't compete in a ranking ordered by pay. Within reels, the best-earning
 * ones win the slots, ranked by current pay so a locked high rung can't be
 * displaced by an unread reel that merely might beat it.
 */
export function computeShootPay(card: RateCard, assets: ShootAsset[], asOf: string = todayET()): ShootPay {
  const priced = assets.map((a) => {
    const locked = !!a.views_locked_at;
    const short = a.kind === 'reel' && a.duration_seconds != null && a.duration_seconds < card.minSeconds;
    const disqualified = !a.qualifies || short;
    const locksOn = a.posted_at ? addDays(a.posted_at, card.countDays) : null;

    let currentCents: number;
    let ceilingCents: number;
    let rungViews: number | null = null;
    if (a.kind === 'carousel') {
      currentCents = card.carouselCents;
      ceilingCents = card.carouselCents;
    } else if (a.views != null) {
      currentCents = payForViews(card, a.views);
      rungViews = rungFor(card, a.views);
      // Once locked it can't climb; otherwise the top rung is still reachable.
      ceilingCents = locked ? currentCents : Math.max(currentCents, topRung(card));
    } else {
      currentCents = card.baseCents;
      ceilingCents = locked ? card.baseCents : topRung(card);
    }

    return {
      raw: a,
      assetId: a.id,
      kind: a.kind,
      counts: !disqualified, // cap applied below
      excludedReason: disqualified
        ? a.disqualified_reason || (short ? `Under ${card.minSeconds}s` : 'Not counted')
        : null,
      currentCents,
      // The floor pay for THIS post: reel base or carousel flat. Paid on posting.
      baseCents: baseFor(card, a.kind),
      ceilingCents,
      locked,
      rungViews,
      locksOn,
      overdue: !!(locksOn && !locked && locksOn < asOf),
      stalled: !a.posted_at,
    };
  });

  // Apply the per-kind caps: best-earning first, the rest excluded. A post whose
  // base is ALREADY PAID is pinned ahead of unpaid ones, so committed money can
  // never be displaced from the cap by a later, higher-earning post (posts arrive
  // weeks apart, so a strong third reel after two paid bases is a real path).
  for (const kind of ['reel', 'carousel'] as const) {
    const cap = kind === 'reel' ? card.maxPerShoot : card.maxCarouselsPerShoot;
    const eligible = priced
      .filter((p) => p.kind === kind && p.counts)
      .sort((a, b) => {
        const aPaid = a.raw.base_paid_at ? 1 : 0;
        const bPaid = b.raw.base_paid_at ? 1 : 0;
        if (aPaid !== bPaid) return bPaid - aPaid; // paid posts keep their slot
        return b.currentCents - a.currentCents; // then best-earning wins the rest
      });
    eligible.forEach((p, i) => {
      if (i >= cap) {
        p.counts = false;
        p.excludedReason = `Over the ${cap} ${kind}${cap === 1 ? '' : 's'} per shoot`;
      }
    });
  }

  const counting = priced.filter((p) => p.counts);
  const floorCents = counting.reduce((s, p) => s + (p.locked ? p.currentCents : baseFor(card, p.kind)), 0);
  const ceilingCents = counting.reduce((s, p) => s + p.ceilingCents, 0);
  const totalCents = counting.reduce((s, p) => s + p.currentCents, 0);
  const unsettled = counting.filter((p) => !p.locked);
  const settlesOn = counting.map((p) => p.locksOn).filter((d): d is string => !!d).sort().at(-1) ?? null;

  return {
    state: counting.length === 0 ? 'empty' : unsettled.length === 0 ? 'locked' : 'counting',
    // topupCents = the view bonus beyond the base, once this post counts (0 for a
    // carousel, or a reel that hasn't beaten its base yet).
    assets: priced.map(({ raw: _raw, ...rest }) => ({ ...rest, topupCents: rest.counts ? Math.max(0, rest.currentCents - rest.baseCents) : 0 })),
    floorCents,
    ceilingCents,
    totalCents,
    settlesOn,
    needsAttention: counting.some((p) => p.overdue || p.stalled),
  };
}

function topRung(card: RateCard): number {
  return card.tiers.reduce((max, t) => Math.max(max, t.cents), card.baseCents);
}
function baseFor(card: RateCard, kind: 'reel' | 'carousel'): number {
  return kind === 'carousel' ? card.carouselCents : card.baseCents;
}

/** Convenience for callers with no card loaded yet (pre-migration safety). */
export const FALLBACK_CARD = STANDARD_CARD;
