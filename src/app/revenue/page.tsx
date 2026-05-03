import { HelmMasthead } from '@/components/HelmMasthead';
import { TimeRangePicker } from './TimeRangePicker';
import { AutoRefresh } from './AutoRefresh';
import {
  computeDateRange,
  formatRangeLabel,
  presetLabel,
  type RangePreset,
} from '@/lib/revenue-date-range';
import {
  computeRevenueSnapshot,
  type PropertySnapshot,
  type PortfolioTotals,
} from '@/lib/revenue-snapshot';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const STALE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Look up sync_status without triggering a sync. The actual refresh is
 * dispatched client-side (see AutoRefresh) so the page can paint immediately
 * even when the data is stale.
 */
async function readSyncStatus(): Promise<{ lastSyncedAt: Date | null; isStale: boolean }> {
  const { data } = await supabase
    .from('sync_status')
    .select('last_synced_at')
    .eq('source', 'guesty-reservations')
    .maybeSingle();
  const lastSyncedAt = data?.last_synced_at ? new Date(data.last_synced_at) : null;
  const isStale = !lastSyncedAt || (Date.now() - lastSyncedAt.getTime()) >= STALE_MS;
  return { lastSyncedAt, isStale };
}

function formatRelative(date: Date | null): string {
  if (!date) return 'never';
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)} hr ago`;
  return `${Math.round(diffSec / 86400)} d ago`;
}

const VALID_PRESETS: RangePreset[] = [
  'mtd', 'last_30', 'last_90', 'this_month', 'last_month',
  'next_month', 'next_90', 'ytd', 'full_year', 'custom_month', 'custom_range',
];

type PageProps = {
  searchParams: Promise<{ range?: string }>;
};

export default async function RevenuePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const presetParam = params?.range;
  const preset: RangePreset =
    presetParam && (VALID_PRESETS as string[]).includes(presetParam)
      ? (presetParam as RangePreset)
      : 'this_month';

  const { rangeStart, rangeEnd } = computeDateRange(preset);
  const rangeLabel = formatRangeLabel(rangeStart, rangeEnd);
  const presetTitle = presetLabel(preset);

  if (!isHelmConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead current="revenue" />
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56 }}>
          <div className="eyebrow">Revenue</div>
          <p style={{ marginTop: 14, color: 'var(--ink-3)' }}>Configure Supabase env vars to load revenue data.</p>
        </section>
      </div>
    );
  }

  const { lastSyncedAt, isStale } = await readSyncStatus();
  const { snapshots, portfolio } = await computeRevenueSnapshot(rangeStart, rangeEnd);

  const sorted = [...snapshots].sort((a, b) => {
    const av = a.metrics.projectedOwnerPayout ?? -Infinity;
    const bv = b.metrics.projectedOwnerPayout ?? -Infinity;
    return bv - av;
  });

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="revenue" rightContent={<TimeRangePicker value={preset} />} />

      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 48, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Helm &middot; Revenue</div>
        <h1
          className="font-serif"
          style={{
            fontSize: 44,
            lineHeight: 1.05,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            maxWidth: 720,
          }}
        >
          {presetTitle} <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>at a glance.</em>
        </h1>
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--ink-3)' }}>{rangeLabel}</p>
      </section>

      {/* PORTFOLIO SUMMARY */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 48 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Portfolio</div>
        <PortfolioStrip totals={portfolio} />
      </section>

      {/* PROPERTY CARDS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <div className="eyebrow">By Property</div>
          <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
            {snapshots.length} active
          </span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 0,
            borderTop: '1px solid var(--ink)',
            borderLeft: '1px solid var(--rule)',
          }}
        >
          {sorted.map((s) => (
            <PropertyCard key={s.propertyId} snapshot={s} />
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid var(--ink)' }}>
        <div className="max-w-[1100px] mx-auto px-10 flex items-center justify-between" style={{
          padding: '14px 40px',
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
        }}>
          <AutoRefresh
            shouldRefresh={isStale}
            initialLabel={`Synced ${formatRelative(lastSyncedAt)}`}
          />
          <span className="font-serif" style={{ textTransform: 'none', letterSpacing: 0, fontStyle: 'italic', color: 'var(--ink-3)', fontSize: 11 }}>
            {rangeLabel}
          </span>
        </div>
      </footer>
    </div>
  );
}

function PortfolioStrip({ totals }: { totals: PortfolioTotals }) {
  return (
    <div
      style={{
        borderTop: '1px solid var(--ink)',
        borderBottom: '1px solid var(--ink)',
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
      }}
    >
      <Stat label="Stays" value={String(totals.totalStays)} />
      <Stat label="Avg Occupancy" value={fmtPercent(totals.avgOccupancy)} />
      <Stat label="Avg ADR" value={fmtCurrency(totals.avgADR)} accent />
      <Stat label="Owner Revenue" value={fmtCurrency(totals.totalRevenue)} />
      <Stat label="Owner Payout" value={fmtCurrency(totals.totalPayout)} accent />
      <Stat label="Rising Tide" value={fmtCurrency(totals.totalManagementFee)} />
      <Stat label="Portfolio Rev" value={fmtCurrency(totals.totalPortfolioRevenue)} last />
    </div>
  );
}

function Stat({
  label,
  value,
  last = false,
  accent = false,
}: {
  label: string;
  value: string;
  last?: boolean;
  accent?: boolean;
}) {
  return (
    <div style={{ padding: '20px 16px', borderRight: last ? 'none' : '1px solid var(--rule)' }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div
        className="font-serif tabular-nums"
        style={{
          fontSize: 22,
          fontWeight: 400,
          color: accent ? 'var(--signal)' : 'var(--ink)',
          lineHeight: 1.05,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function PropertyCard({ snapshot }: { snapshot: PropertySnapshot }) {
  const m = snapshot.metrics;
  const noData = m.staysCount === 0;

  return (
    <article
      style={{
        padding: '20px 22px 22px',
        borderRight: '1px solid var(--rule)',
        borderBottom: '1px solid var(--rule)',
        background: 'var(--paper)',
      }}
    >
      <header style={{ marginBottom: 14 }}>
        <div className="flex items-baseline justify-between" style={{ gap: 8 }}>
          <h3
            className="font-serif"
            style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}
          >
            {snapshot.propertyName}
          </h3>
        </div>
        {snapshot.turnoversNext30 > 0 && (
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-3)' }}>
            {snapshot.turnoversNext30} turnover{snapshot.turnoversNext30 === 1 ? '' : 's'} in next 30
          </div>
        )}
      </header>

      {noData ? (
        <div style={{ padding: '12px 0', fontSize: 12, color: 'var(--ink-4)' }}>
          No bookings in range.
        </div>
      ) : (
        <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', margin: 0 }}>
          <Metric label="Stays" value={String(m.staysCount)} />
          <Metric label="Occupancy" value={fmtPercent(m.occupancyPct)} />
          <Metric label="ADR" value={fmtCurrency(m.ADR)} accent />
          <Metric label="Owner Revenue" value={fmtCurrency(m.totalRevenue)} />
          <Metric
            label={snapshot.isRisingTideOwned ? 'Mgmt Fee' : 'Rising Tide'}
            value={snapshot.isRisingTideOwned ? '—' : fmtCurrency(m.managementFee)}
          />
          <Metric label="Owner Payout" value={fmtCurrency(m.projectedOwnerPayout)} accent />
        </dl>
      )}
    </article>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <dt className="eyebrow" style={{ marginBottom: 3 }}>{label}</dt>
      <dd
        className="font-serif tabular-nums"
        style={{
          margin: 0,
          fontSize: 16,
          fontWeight: 500,
          color: accent ? 'var(--signal)' : 'var(--ink)',
        }}
      >
        {value}
      </dd>
    </div>
  );
}

function fmtCurrency(value: number | null): string {
  if (value == null) return '—';
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  return `$${Math.round(value)}`;
}

function fmtPercent(value: number | null): string {
  if (value == null) return '—';
  return `${value.toFixed(0)}%`;
}
