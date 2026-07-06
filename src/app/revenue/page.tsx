import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { FinancialsTabs } from '@/components/FinancialsTabs';
import { Stat } from '@/components/Stat';
import { TimeRangePicker } from './TimeRangePicker';
import { ViewToggle, type RevenueView } from './ViewToggle';
import { AutoRefresh } from './AutoRefresh';
import {
  computeDateRange,
  formatRangeLabel,
  presetLabel,
  previousRange,
  deltaPct,
  type RangePreset,
  type CustomMonth,
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

/** "2026-05" -> "May 2026". For the pacing context line. */
function formatPacingMonth(ym: string): string {
  const [y, m] = ym.split('-').map((s) => parseInt(s, 10));
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
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
  searchParams: Promise<{ range?: string; view?: string }>;
};

export default async function RevenuePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params?.range;

  // The range param is either a preset keyword (this_month, last_30, ...) or
  // a YYYY-MM string for a specific calendar month picked from the dropdown.
  let preset: RangePreset = 'this_month';
  let customMonth: CustomMonth | undefined;
  if (rangeParam) {
    const monthMatch = /^(\d{4})-(\d{2})$/.exec(rangeParam);
    if (monthMatch) {
      preset = 'custom_month';
      customMonth = {
        year: parseInt(monthMatch[1], 10),
        month: parseInt(monthMatch[2], 10) - 1, // 0-indexed
      };
    } else if ((VALID_PRESETS as string[]).includes(rangeParam)) {
      preset = rangeParam as RangePreset;
    }
  }

  // Pacing is a projection; default to plain booked Actuals so the page
  // opens on what's actually committed. The toggle opts into projection.
  const view: RevenueView = params?.view === 'pacing' ? 'pacing' : 'actuals';

  const { rangeStart, rangeEnd } = computeDateRange(preset, customMonth);
  const rangeLabel = formatRangeLabel(rangeStart, rangeEnd);
  const presetTitle = presetLabel(preset, customMonth);

  if (!isHelmConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        {/* Match the happy-path masthead (current="financials") so the
            Financials nav highlight stays put when load fails. The hidden
            'revenue' module id used to be passed here, which the masthead
            does not recognise -- the "you are here" cue vanished on error. */}
        <HelmMasthead current="financials" />
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56 }}>
          <div className="eyebrow">Revenue</div>
          <p style={{ marginTop: 14, color: 'var(--ink-3)' }}>Configure Supabase env vars to load revenue data.</p>
        </section>
      </div>
    );
  }

  // Forward-looking presets compare vs the future, which has no actuals
  // yet. Skip the prior-period fetch (and deltas) for those. A custom month
  // set to a future month counts as forward-looking too.
  const todayYM = new Date().toISOString().slice(0, 7);
  const customMonthIsFuture =
    preset === 'custom_month' && rangeStart.slice(0, 7) > todayYM;
  const isForwardLooking =
    preset === 'next_month' || preset === 'next_90' || customMonthIsFuture;
  const prior = isForwardLooking ? null : previousRange({ rangeStart, rangeEnd });

  // Raw range value handed to the picker: a preset keyword, or YYYY-MM when
  // a specific month is selected.
  const rangeValue = customMonth
    ? `${customMonth.year}-${String(customMonth.month + 1).padStart(2, '0')}`
    : preset;

  const [{ lastSyncedAt, isStale }, current, priorFull] = await Promise.all([
    readSyncStatus(),
    computeRevenueSnapshot(rangeStart, rangeEnd, { applyPacing: view === 'pacing' }),
    prior
      ? computeRevenueSnapshot(prior.rangeStart, prior.rangeEnd)
      : Promise.resolve(null),
  ]);

  const { snapshots, portfolio, pacing } = current;
  const priorPortfolio = priorFull?.portfolio ?? null;

  // Build a per-property prior-payout lookup so each card can show its own
  // period-over-period delta on Owner Payout.
  const priorPayoutById = new Map<string, number | null>();
  for (const s of priorFull?.snapshots ?? []) {
    priorPayoutById.set(s.propertyId, s.metrics.projectedOwnerPayout);
  }

  const sorted = [...snapshots].sort((a, b) => {
    const av = a.metrics.projectedOwnerPayout ?? -Infinity;
    const bv = b.metrics.projectedOwnerPayout ?? -Infinity;
    return bv - av;
  });

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="financials" />
      <FinancialsTabs current="revenue" />

      <HelmHero
        eyebrow="Helm · Revenue"
        title={presetTitle}
        emphasis="at a glance."
        paddingTop={48}
        belowDescription={
          <>
            <div
              className="flex items-baseline"
              style={{
                marginTop: 22,
                gap: 20,
                flexWrap: 'wrap',
                justifyContent: 'space-between',
              }}
            >
              <div className="flex items-baseline" style={{ gap: 14, flexWrap: 'wrap' }}>
                <TimeRangePicker value={rangeValue} />
                {pacing && pacing.multiplier > 1 && <ViewToggle value={view} />}
              </div>
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{rangeLabel}</span>
            </div>
            {pacing && pacing.multiplier > 1 && (
              <p
                style={{
                  marginTop: 12,
                  fontSize: 12,
                  color: 'var(--ink-3)',
                  lineHeight: 1.5,
                }}
              >
                Pacing {pacing.pacingPct.toFixed(0)}% so far in {formatPacingMonth(pacing.month)}.
                Gloucester historical for {formatPacingMonth(pacing.month)} is{' '}
                {pacing.historicalAvgPct.toFixed(0)}%.
                {view === 'pacing'
                  ? ` Revenue projects booked × ${pacing.multiplier.toFixed(2)} on current/future full months in range.`
                  : ' Revenue shows booked-so-far actuals only.'}
              </p>
            )}
          </>
        }
      />

      {/* PORTFOLIO SUMMARY */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 48 }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <div className="eyebrow">Portfolio</div>
          {priorPortfolio && (
            <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
              vs prior {presetTitle.toLowerCase()}
            </span>
          )}
        </div>
        <PortfolioStrip totals={portfolio} prior={priorPortfolio} />
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
            <PropertyCard
              key={s.propertyId}
              snapshot={s}
              priorPayout={priorPayoutById.get(s.propertyId) ?? null}
              showDelta={!isForwardLooking}
            />
          ))}
        </div>
      </section>

      <HelmFooter
        left={
          <AutoRefresh
            shouldRefresh={isStale}
            initialLabel={`Synced ${formatRelative(lastSyncedAt)}`}
          />
        }
        right={rangeLabel}
      />
    </div>
  );
}

function PortfolioStrip({
  totals,
  prior,
}: {
  totals: PortfolioTotals;
  prior: PortfolioTotals | null;
}) {
  // Compute deltas vs prior period for each metric. null when there's no
  // prior to compare (forward-looking range, or zero baseline).
  const d = (a: keyof PortfolioTotals): number | null =>
    prior ? deltaPct(totals[a] as number, prior[a] as number) : null;

  return (
    <div
      className="rt-helm-stat-strip"
      style={{
        borderTop: '1px solid var(--ink)',
        borderBottom: '1px solid var(--ink)',
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
      }}
    >
      <Stat label="Stays" value={String(totals.totalStays)} delta={d('totalStays')} />
      <Stat label="Avg Occupancy" value={fmtPercent(totals.avgOccupancy)} delta={d('avgOccupancy')} />
      <Stat label="Avg ADR" value={fmtCurrency(totals.avgADR)} delta={d('avgADR')} accent />
      <Stat label="Owner Revenue" value={fmtCurrency(totals.totalRevenue)} delta={d('totalRevenue')} />
      <Stat label="Owner Payout" value={fmtCurrency(totals.totalPayout)} delta={d('totalPayout')} accent />
      <Stat label="Rising Tide" value={fmtCurrency(totals.totalManagementFee)} delta={d('totalManagementFee')} />
      <Stat label="Portfolio Rev" value={fmtCurrency(totals.totalPortfolioRevenue)} delta={d('totalPortfolioRevenue')} last />
    </div>
  );
}

function PropertyCard({
  snapshot,
  priorPayout,
  showDelta,
}: {
  snapshot: PropertySnapshot;
  priorPayout: number | null;
  showDelta: boolean;
}) {
  const m = snapshot.metrics;
  // A month can have revenue with zero stays: a cross-month installment
  // booking contributes its month slice every month it spans, but the STAY
  // is only counted once, in its final (checkout) month. Hancock's July on
  // 3 South is $20.9k of revenue with staysCount 0 -- that's data, not
  // "no bookings".
  const noData = m.staysCount === 0 && (m.totalRevenue ?? 0) <= 0;
  const delta = showDelta ? deltaPct(m.projectedOwnerPayout, priorPayout) : null;

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
          {snapshot.source !== 'computed' && (
            <span
              className="eyebrow"
              style={{
                color: SOURCE_COLOR[snapshot.source],
                whiteSpace: 'nowrap',
              }}
              title={SOURCE_TITLE[snapshot.source]}
            >
              {SOURCE_LABEL[snapshot.source]}
            </span>
          )}
        </div>
        {delta != null && delta !== 0 && (
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-3)' }}>
            <span
              className="font-mono tabular-nums"
              style={{
                color: delta > 0 ? 'var(--positive)' : 'var(--negative)',
                fontWeight: 500,
              }}
            >
              {delta > 0 ? '+' : ''}
              {delta.toFixed(0)}%
            </span>{' '}
            owner payout vs prior
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

const SOURCE_LABEL: Record<PropertySnapshot['source'], string> = {
  statement: 'Statement',
  pacing: 'Pacing',
  booked: 'Booked',
  computed: '',
};

const SOURCE_COLOR: Record<PropertySnapshot['source'], string> = {
  statement: 'var(--tide-deep)',
  pacing: 'var(--signal)',
  booked: 'var(--ink-3)',
  computed: 'var(--ink-3)',
};

const SOURCE_TITLE: Record<PropertySnapshot['source'], string> = {
  statement: 'From the monthly owner statement (canonical for closed months)',
  pacing: 'Booked-so-far × historical-occupancy multiplier (projected)',
  booked: 'Booked-so-far actuals only, no projection',
  computed: '',
};

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
