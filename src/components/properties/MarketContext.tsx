/**
 * MarketContext: a quiet editorial tile that compares a property's most
 * recent owner payout against the implied payout for a comparable
 * property in the same market and bedroom count, using the trailing 3yr
 * AirDNA same-month average.
 *
 * Mounted on the Property page (above Recent Statements). Hidden when:
 *   - the property has no market or bedroom count
 *   - no statements exist yet
 *   - no AirDNA observations exist in the trailing window for that
 *     market/bedroom/month combo
 *
 * Style follows the rest of the Property page: editorial, paper/ink, thin
 * rules, font-serif headlines, tabular-nums money. Reference info, not a
 * brag-board, so the comparison color is subtle and the methodology is
 * visible right on the tile.
 */
import {
  bedroomLabel,
  getTrailingMonthlyBenchmark,
  impliedOwnerPayout,
  marketAndBedroomsForProperty,
  marketLabel,
  DEFAULT_MGMT_FEE_PCT,
  DEFAULT_CLEANING_RUN_RATE_PCT,
} from '@/lib/market-benchmarks';
import type { HelmPropertyRow } from '@/lib/properties';

type LatestStatement = {
  month: string;
  rental_revenue: number;
  owner_payout: number;
};

export async function MarketContext({
  property,
  latestStatement,
}: {
  property: Pick<HelmPropertyRow, 'market' | 'bedrooms' | 'management_fee_pct'>;
  latestStatement: LatestStatement | null;
}) {
  const comp = marketAndBedroomsForProperty(property);
  if (!comp) return null;
  if (!latestStatement) return null;

  // Use the property's actual mgmt fee for the comp so the implied payout
  // reflects what THIS owner would net at market revenue, not a generic
  // 25%-fee owner.
  const mgmtPct = property.management_fee_pct ?? DEFAULT_MGMT_FEE_PCT;

  const benchmark = await getTrailingMonthlyBenchmark({
    market: comp.market,
    bedrooms: comp.bedrooms,
    month: latestStatement.month,
  });
  if (!benchmark) return null;

  const implied = impliedOwnerPayout(benchmark.avg_revenue, {
    mgmt_fee_pct: mgmtPct,
    cleaning_pct: DEFAULT_CLEANING_RUN_RATE_PCT,
  });

  const delta = latestStatement.owner_payout - implied.payout;
  const ahead = delta >= 0;
  const deltaPct = implied.payout > 0
    ? Math.round((delta / implied.payout) * 100)
    : null;

  const monthLabel = formatMonth(latestStatement.month);
  const compLabel = `${bedroomLabel(comp.bedrooms)} ${marketLabel(comp.market)}`;
  const yearsLabel = `${benchmark.from_year}-${benchmark.to_year}`;

  return (
    <section
      className="max-w-[1100px] mx-auto px-10"
      style={{ paddingBottom: 36, width: '100%' }}
    >
      <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
        <h2
          className="font-serif"
          style={{
            fontSize: 22,
            fontWeight: 400,
            letterSpacing: '-0.01em',
            color: 'var(--ink)',
            margin: 0,
          }}
        >
          Market Context
        </h2>
        <span className="eyebrow">AirDNA · {compLabel}</span>
      </div>

      <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 22 }}>
        <p
          style={{
            margin: '0 0 22px',
            fontSize: 13,
            color: 'var(--ink-3)',
            lineHeight: 1.55,
            maxWidth: 720,
          }}
        >
          What a comparable {compLabel.toLowerCase()} property earned in {monthLabel.split(' ')[0]},
          averaged across the trailing three same-month observations
          ({yearsLabel}). The implied payout applies this property&rsquo;s
          {' '}{mgmtPct}% management fee plus a {DEFAULT_CLEANING_RUN_RATE_PCT}% cleaning run-rate so the
          number is comparable to what we actually sent the owner.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 0,
            border: '1px solid var(--rule)',
          }}
        >
          <Cell
            eyebrow="Comparable"
            value={formatCurrency(implied.payout)}
            sub={`${formatCurrency(benchmark.avg_revenue)} rev`}
            tone="muted"
          />
          <Cell
            eyebrow={monthLabel}
            value={formatCurrency(latestStatement.owner_payout)}
            sub={`${formatCurrency(latestStatement.rental_revenue)} rev`}
            tone="ink"
          />
          <Cell
            eyebrow={ahead ? 'Above market' : 'Below market'}
            value={`${ahead ? '+' : '−'}${formatCurrency(Math.abs(delta))}`}
            sub={deltaPct != null ? `${ahead ? '+' : ''}${deltaPct}% vs comp` : ''}
            tone={ahead ? 'positive' : 'signal'}
            last
          />
        </div>

        <p
          style={{
            margin: '14px 0 0',
            fontSize: 11,
            color: 'var(--ink-4)',
            letterSpacing: '.02em',
            lineHeight: 1.55,
          }}
        >
          Reference only. AirDNA reports averages, not medians, and the
          {' '}{compLabel.toLowerCase()} sample varies by month.
        </p>
      </div>
    </section>
  );
}

function Cell({
  eyebrow,
  value,
  sub,
  tone,
  last = false,
}: {
  eyebrow: string;
  value: string;
  sub: string;
  tone: 'muted' | 'ink' | 'positive' | 'signal';
  last?: boolean;
}) {
  const valueColor =
    tone === 'positive' ? 'var(--positive)' :
    tone === 'signal' ? 'var(--signal)' :
    tone === 'muted' ? 'var(--ink-3)' :
    'var(--ink)';
  return (
    <div
      style={{
        padding: '20px 22px',
        borderRight: last ? 'none' : '1px solid var(--rule)',
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 8 }}>{eyebrow}</div>
      <div
        className="font-serif tabular-nums"
        style={{ fontSize: 26, fontWeight: 400, color: valueColor, lineHeight: 1.1 }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="font-mono tabular-nums"
          style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-4)' }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function formatMonth(month: string): string {
  try {
    const [year, m] = month.split('-');
    const d = new Date(Number(year), Number(m) - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  } catch {
    return month;
  }
}

function formatCurrency(value: number): string {
  if (value == null) return '—';
  return `$${Math.round(value).toLocaleString('en-US')}`;
}
