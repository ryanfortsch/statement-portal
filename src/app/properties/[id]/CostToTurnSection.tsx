import { CollapsibleSection } from '@/components/properties/CollapsibleSection';
import { getCostAnalysis } from '@/lib/cost-analysis';

/**
 * What it cost to turn this home, one line per recent statement month:
 * cleaning, linens, laundry and repairs from the statement (the bank is the
 * source of truth for cleaning), divided by its stays. The same cells the
 * Cost Analysis grid printed for every home until that page retired on
 * 2026-10-18, read through the same loader and filtered to this home.
 *
 * Owner money: the property page renders it for owners only.
 */

const MONTHS_SHOWN = 6;

function fmtCents(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthLong(m: string): string {
  return new Date(m + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export async function CostToTurnSection({ propertyId }: { propertyId: string }) {
  let cells: Awaited<ReturnType<typeof getCostAnalysis>>['cells'] = [];
  try {
    cells = (await getCostAnalysis()).cells
      .filter((c) => c.propertyId === propertyId)
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, MONTHS_SHOWN);
  } catch {
    cells = [];
  }
  if (cells.length === 0) return null;
  const latest = cells[0];
  const summary = latest.operatingPerTurn != null
    ? `${fmtCents(latest.operatingPerTurn)} a turnover in ${monthLong(latest.month).split(' ')[0]}`
    : `${fmtCents(latest.operating)} in ${monthLong(latest.month).split(' ')[0]}`;

  return (
    <CollapsibleSection title="Cost to turn" summary={summary}>
      <div>
        {cells.map((c) => (
          <div
            key={c.month}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              gap: '4px 20px',
              padding: '12px 0',
              borderBottom: '1px solid var(--rule)',
            }}
          >
            <span className="font-serif" style={{ fontSize: 15, color: 'var(--ink)', minWidth: 150 }}>
              {monthLong(c.month)}
            </span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)', flex: '1 1 160px' }}>
              {c.turnovers} turnover{c.turnovers === 1 ? '' : 's'} · {fmtCents(c.operating)} cleaning, linens, repairs
            </span>
            <span className="font-mono tabular-nums" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
              {c.operatingPerTurn != null ? `${fmtCents(c.operatingPerTurn)} a turnover` : 'no turnovers'}
            </span>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}
