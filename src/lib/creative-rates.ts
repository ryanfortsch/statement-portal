/**
 * Creative rate cards - the pay ladder + terms for the Creative trade
 * (Social Media Contributor). One DEFAULT card (contractor_id null) applies
 * to every contributor; a per-talent row is a full standalone copy the office
 * edits, so the effective card is simply the talent's row when present, else
 * the default. Reset = delete the talent row.
 *
 * Stored in `creative_rate_cards` (migration 20260722), RLS-locked with no
 * anon policy - read and written only through the service-role field client.
 */
import { fieldDb } from './field-db';

export type RateTier = { views: number; cents: number };

export type RateCard = {
  id: string | null; // null = in-code fallback (table missing or unseeded)
  contractorId: string | null; // null = the default card
  baseCents: number;
  tiers: RateTier[]; // sorted ascending by views
  carouselCents: number;
  minSeconds: number;
  countDays: number;
  maxPerShoot: number;
  extraTerms: string[];
  updatedByEmail: string | null;
  updatedAt: string | null;
};

/** The standard card, doubling as the pre-migration fallback so the roster
 *  and portal render sensibly before the table exists. Mirrors the seed row
 *  in 20260722_creative_rate_cards.sql. */
export const STANDARD_CARD: RateCard = {
  id: null,
  contractorId: null,
  baseCents: 12500,
  tiers: [
    { views: 1000, cents: 25000 },
    { views: 2000, cents: 35000 },
    { views: 5000, cents: 50000 },
  ],
  carouselCents: 10000,
  minSeconds: 25,
  countDays: 14,
  maxPerShoot: 2,
  extraTerms: ['A carousel must be its own fresh photos or clips, nothing pulled from the reel.'],
  updatedByEmail: null,
  updatedAt: null,
};

type Row = {
  id: string;
  contractor_id: string | null;
  base_cents: number;
  tiers: unknown;
  carousel_cents: number;
  min_seconds: number;
  count_days: number;
  max_per_shoot: number;
  extra_terms: string[] | null;
  updated_by_email: string | null;
  updated_at: string | null;
};

function parseTiers(v: unknown): RateTier[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((t) => ({ views: Number((t as RateTier)?.views), cents: Number((t as RateTier)?.cents) }))
    .filter((t) => Number.isFinite(t.views) && t.views > 0 && Number.isFinite(t.cents) && t.cents >= 0)
    .sort((a, b) => a.views - b.views);
}

function fromRow(r: Row): RateCard {
  return {
    id: r.id,
    contractorId: r.contractor_id,
    baseCents: r.base_cents,
    tiers: parseTiers(r.tiers),
    carouselCents: r.carousel_cents,
    minSeconds: r.min_seconds,
    countDays: r.count_days,
    maxPerShoot: r.max_per_shoot,
    extraTerms: (r.extra_terms ?? []).map((t) => (t ?? '').trim()).filter(Boolean),
    updatedByEmail: r.updated_by_email,
    updatedAt: r.updated_at,
  };
}

/** All cards: the default plus per-talent overrides. Falls back to the
 *  in-code standard card when the table is missing or unseeded. */
export async function loadRateCards(): Promise<{ def: RateCard; byContractor: Map<string, RateCard> }> {
  const byContractor = new Map<string, RateCard>();
  const { data, error } = await fieldDb().from('creative_rate_cards').select('*');
  if (error || !data) return { def: STANDARD_CARD, byContractor };
  let def: RateCard = STANDARD_CARD;
  for (const r of data as Row[]) {
    const card = fromRow(r);
    if (card.contractorId) byContractor.set(card.contractorId, card);
    else def = card;
  }
  return { def, byContractor };
}

/** The card in effect for one talent: their custom card, else the default. */
export async function loadEffectiveCard(contractorId: string | null): Promise<RateCard> {
  const { def, byContractor } = await loadRateCards();
  return (contractorId && byContractor.get(contractorId)) || def;
}

export type RateCardInput = {
  contractorId: string | null;
  baseCents: number;
  tiers: RateTier[];
  carouselCents: number;
  minSeconds: number;
  countDays: number;
  maxPerShoot: number;
  extraTerms: string[];
};

/** Create-or-update the default card (contractorId null) or a talent's card.
 *  Explicit find-then-write: the default row's null contractor_id sits under a
 *  partial unique index, which upsert's onConflict can't target. */
export async function saveRateCard(input: RateCardInput, byEmail: string): Promise<void> {
  const db = fieldDb();
  const payload = {
    base_cents: Math.round(input.baseCents),
    tiers: [...input.tiers]
      .map((t) => ({ views: Math.round(t.views), cents: Math.round(t.cents) }))
      .sort((a, b) => a.views - b.views),
    carousel_cents: Math.round(input.carouselCents),
    min_seconds: Math.round(input.minSeconds),
    count_days: Math.round(input.countDays),
    max_per_shoot: Math.round(input.maxPerShoot),
    extra_terms: input.extraTerms,
    updated_by_email: byEmail,
    updated_at: new Date().toISOString(),
  };
  let q = db.from('creative_rate_cards').select('id');
  q = input.contractorId ? q.eq('contractor_id', input.contractorId) : q.is('contractor_id', null);
  const { data: existing } = await q.maybeSingle();
  if (existing?.id) {
    const { error } = await db.from('creative_rate_cards').update(payload).eq('id', existing.id);
    if (error) throw new Error(`Could not save rate card: ${error.message}`);
  } else {
    const { error } = await db.from('creative_rate_cards').insert({ ...payload, contractor_id: input.contractorId });
    if (error) throw new Error(`Could not save rate card: ${error.message}`);
  }
}

/** Drop a talent's custom card so they fall back to the default. */
export async function resetRateCard(contractorId: string): Promise<void> {
  const { error } = await fieldDb().from('creative_rate_cards').delete().eq('contractor_id', contractorId);
  if (error) throw new Error(`Could not reset rate card: ${error.message}`);
}

/** "5,000+" style rung label. The top rung reads open-ended. */
export function rungLabel(tier: RateTier, isTop: boolean): string {
  return `${tier.views.toLocaleString('en-US')}${isTop ? '+' : ''}`;
}

/** The pay a view count has earned under a card: the highest rung reached,
 *  else the base. */
export function payForViews(card: RateCard, views: number): number {
  let pay = card.baseCents;
  for (const t of card.tiers) if (views >= t.views) pay = t.cents;
  return pay;
}
