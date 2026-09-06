/**
 * The cost roster for /forecast, built from Helm's own registry.
 *
 * The revenue line has read every active managed home in Helm since the
 * smart forecast existed. The cost lines (the card, the bench) scaled on a
 * hardcoded list reracked from property_statements, so a home earned in the
 * forecast from the day it was activated and cost nothing until its first
 * statement closed. 4 Middle Road is the case in point: on the revenue row
 * at the portfolio average, absent from every cost line.
 *
 * This builds the roster calcYear scales costs on from the same properties
 * the smart forecast carries, so onboarding a home in Helm moves both lines
 * at once. The hardcoded CURRENT_2026 survives as the fallback when smart is
 * unavailable, and as the source of 2026 start months: activated_at is null
 * for every home that predates the registry, and for those the month a home
 * first filed a statement is the best record of when it came on.
 *
 * Deliberately dependency-free (type imports only) so the rerack harness can
 * load it under plain Node.
 */

import type { ManagedProperty, SeasonType } from './forecast-model';

export type RosterSource = {
  id: string;
  name: string;
  isRtOwned: boolean;
  /** ISO timestamp or date, or null for homes that predate the registry. */
  activatedAt: string | null;
  /** The smart forecast's projected annual management fee for the year. */
  projectedMgmtFee: number;
};

/** What the hardcoded roster already knows about a home, keyed by id. */
export type KnownHome = { start: number; fee: number; type: SeasonType };

/**
 * Seasonality curve per home where it is not Cape Ann. 20 Enon sits in
 * Beverly and runs on the less-seasonal curve, as the hardcoded roster
 * always had it.
 */
export const SEASON_TYPE_BY_ID: Record<string, SeasonType> = {
  '20_enon': 'LS',
};

function activationYearMonth(iso: string | null): { year: number; month: number } | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (!year || month < 1 || month > 12) return null;
  return { year, month };
}

/**
 * The homes that cost money in `year`, each with the month it starts.
 *
 *   RT-owned            excluded (its own P&L, out of the model's scope)
 *   activated after     excluded (not on the books yet)
 *   activated in year   starts that month
 *   activated before    starts in January
 *   no activated_at     the known start for that year if there is one, else
 *                       January
 *
 * The fee is the year's projected management fee where the smart forecast
 * has one, the known fee where the hardcoded roster does, and the first-
 * season figure otherwise. It only matters when smart cannot supply a month
 * and the model falls back to seasonality.
 */
export function rosterFromRegistry(
  homes: readonly RosterSource[],
  year: number,
  known: Record<string, KnownHome>,
  fallbackFee: number,
): ManagedProperty[] {
  const out: ManagedProperty[] = [];
  for (const h of homes) {
    if (h.isRtOwned) continue;
    const act = activationYearMonth(h.activatedAt);
    if (act && act.year > year) continue;
    const k = known[h.id];
    let start = 1;
    if (act && act.year === year) start = act.month;
    else if (!act && k) start = k.start;
    const fee =
      h.projectedMgmtFee > 0 ? h.projectedMgmtFee : k && k.fee > 0 ? k.fee : fallbackFee;
    const type = SEASON_TYPE_BY_ID[h.id] ?? k?.type ?? 'CA';
    out.push({ id: h.id, name: h.name, fee, type, start });
  }
  return out.sort((a, b) => b.fee - a.fee || a.id!.localeCompare(b.id!));
}

/** CURRENT_2026 as a lookup, for the 2026 starts and fallback fees. */
export function knownFromRoster(roster: readonly ManagedProperty[]): Record<string, KnownHome> {
  const out: Record<string, KnownHome> = {};
  for (const p of roster) {
    if (p.id) out[p.id] = { start: p.start, fee: p.fee, type: p.type };
  }
  return out;
}
