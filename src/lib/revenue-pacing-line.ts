import type { PacingInfo } from './revenue-snapshot';

/**
 * Revenue's pacing as one line of facts under the toggles, and whether the
 * Pacing toggle has anything to project.
 *
 * Replaces two paragraphs (up to nine sentences assembled from six
 * conditionals) with the same facts as labels: "October 2026: pacing 48% ·
 * Gloucester 61% · target 55% · booked so far". The numbers are the
 * snapshot's own fields, rounded as the paragraphs rounded them; nothing
 * here computes a figure.
 *
 * Pure, and its only import is a type, so the test runner loads it directly.
 */

export type PacingView = 'pacing' | 'actuals';
export type PacingBasis = 'checkout' | 'nights';

/** "2026-10" -> "October 2026". */
export function pacingMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map((s) => parseInt(s, 10));
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

const pct = (n: number) => `${n.toFixed(0)}%`;

/**
 * The facts line, or null when there is no month to describe. The target is
 * the one the old copy printed: the market benchmark when the fleet is at or
 * past it, the projection target otherwise, named "on pace for" when the
 * booking curve (not the market) set it.
 */
export function pacingFactsLine(
  pacing: PacingInfo | null,
  opts: { view: PacingView; basis: PacingBasis },
): string | null {
  const nights = opts.basis === 'nights' ? ' · by nights stayed, will not tie to a statement' : '';
  if (!pacing) return nights ? 'Counted by nights stayed, so these will not tie to a statement' : null;
  const month = pacingMonthLabel(pacing.month);
  if (pacing.multiplier <= 1 && pacing.pacingPct <= 0) {
    return `${month}: nothing booked yet · Gloucester ${pct(pacing.historicalAvgPct)} · no projection${nights}`;
  }
  const facts = [`${month}: pacing ${pct(pacing.pacingPct)}`, `Gloucester ${pct(pacing.historicalAvgPct)}`];
  if (pacing.multiplier <= 1) {
    facts.push(`target ${pct(pacing.benchmarkPct)}`, 'at target, booked so far');
    return facts.join(' · ') + nights;
  }
  const paceDriven = pacing.targetSource === 'pickup' && pacing.pickupShare != null;
  facts.push(
    paceDriven
      ? `on pace for ${pct(pacing.targetPct)} (${pct(pacing.pickupShare! * 100)} of nights usually booked by now)`
      : `target ${pct(pacing.targetPct)}`,
  );
  if (opts.view === 'pacing') {
    const rate = pacing.openNightMarketRate != null
      ? `open nights at about $${Math.round(pacing.openNightMarketRate)}${pacing.fleetRateIndex != null ? ` × ${pacing.fleetRateIndex.toFixed(2)}` : ''}`
      : null;
    facts.push(rate ? `projected, ${rate}` : 'projected');
  } else {
    facts.push('booked so far');
  }
  return facts.join(' · ') + nights;
}

/**
 * The Pacing toggle is always on the page. It is live when there is a
 * projection to show (or the link already asks for one, so the operator can
 * switch back); otherwise it is disabled and says why in a word or two.
 */
export function pacingToggleState(pacing: PacingInfo | null, view: PacingView): { enabled: boolean; note: string | null } {
  if (view === 'pacing' || (pacing && pacing.multiplier > 1)) return { enabled: true, note: null };
  if (!pacing) return { enabled: false, note: 'nothing to project' };
  if (pacing.pacingPct <= 0) return { enabled: false, note: 'nothing booked yet' };
  return { enabled: false, note: 'at target' };
}
