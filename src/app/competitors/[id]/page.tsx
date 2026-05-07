import { notFound } from 'next/navigation';
import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { getCompetitor, summarizeCompetitor, computeAddressCoverage, formatBedroomLabel, type CompetitorId } from '@/lib/competitors';
import { CompetitorInventory } from '@/components/competitors/CompetitorInventory';

export const dynamic = 'force-static';

const KNOWN_IDS: CompetitorId[] = ['atlantic-vacation-homes', 'shoreway-management'];

export function generateStaticParams() {
  return KNOWN_IDS.map((id) => ({ id }));
}

export default async function CompetitorDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const competitor = getCompetitor(id as CompetitorId);
  if (!competitor) notFound();

  const summary = summarizeCompetitor(competitor.meta, competitor.listings);
  const coverage = computeAddressCoverage(competitor.listings);
  const matchedPct = coverage.total > 0
    ? Math.round(((coverage.high + coverage.medium + coverage.low) / coverage.total) * 100)
    : 0;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="competitors" />

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 24 }}>
        <Link
          href="/competitors"
          style={{
            fontSize: 10,
            letterSpacing: '.22em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          ← All competitors
        </Link>
      </section>

      <HelmHero
        eyebrow={`Helm · Competitors · Snapshot ${competitor.meta.snapshotDate}`}
        title={competitor.meta.name}
        emphasis=""
        description={`${summary.totalListings} listings · ${summary.cityBreakdown.length} towns · ${summary.totalSleeps.toLocaleString()} guest beds. ${competitor.meta.tagline}.`}
        paddingTop={20}
      />

      {/* HEADLINE STATS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
        <div
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
          }}
        >
          <HeadStat label="Listings" value={String(summary.totalListings)} />
          <HeadStat label="Total bedrooms" value={String(summary.totalBedrooms)} />
          <HeadStat label="Avg beds / unit" value={(summary.totalBedrooms / summary.totalListings).toFixed(1)} />
          <HeadStat label="Total sleeps" value={summary.totalSleeps.toLocaleString()} />
          <HeadStat
            label="Pet friendly"
            value={`${Math.round((summary.petFriendlyCount / summary.totalListings) * 100)}%`}
            sub={`${summary.petFriendlyCount} of ${summary.totalListings}`}
            last
          />
        </div>
      </section>

      {/* ADDRESS COVERAGE */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 40 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Address research</div>
        <div
          style={{
            border: '1px solid var(--rule)',
            padding: '20px 22px',
            display: 'grid',
            gridTemplateColumns: '160px 1fr 220px',
            gap: 28,
            alignItems: 'center',
          }}
        >
          <div>
            <div className="font-serif tabular-nums" style={{ fontSize: 36, color: 'var(--ink)' }}>
              {matchedPct}%
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>matched to a place</div>
          </div>

          <CoverageBar coverage={coverage} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--ink-3)' }}>
            <span><b style={{ color: 'var(--positive)' }}>{coverage.high}</b> verified address</span>
            <span><b style={{ color: 'var(--ink)' }}>{coverage.medium}</b> street known</span>
            <span><b style={{ color: 'var(--ink-3)' }}>{coverage.low}</b> neighborhood guess</span>
            <span><b style={{ color: 'var(--ink-4)' }}>{coverage.unknown}</b> not yet researched</span>
          </div>
        </div>
      </section>

      {/* TWO-COLUMN BREAKDOWNS */}
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ width: '100%', paddingBottom: 56, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 56 }}
      >
        <Breakdown
          title="By town"
          rows={summary.cityBreakdown.map((c) => ({
            label: c.city,
            count: c.count,
            pct: (c.count / summary.totalListings) * 100,
          }))}
        />
        <Breakdown
          title="By bedroom count"
          rows={summary.bedroomBreakdown.map((b) => ({
            label: formatBedroomLabel(b.bedrooms),
            count: b.count,
            pct: (b.count / summary.totalListings) * 100,
          }))}
        />
      </section>

      {/* LINK OUT */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <ExternalChip href={competitor.meta.listingsUrl} label="Browse listings →" />
        <ExternalChip href={competitor.meta.homepage} label="Their homepage →" />
      </section>

      {/* INVENTORY (client, filterable) */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 80, flex: 1 }}>
        <CompetitorInventory
          listings={competitor.listings}
          cities={summary.cityBreakdown.map((c) => c.city)}
        />
      </section>

      <HelmFooter
        module="Competitors"
        right={`Source: ${competitor.meta.source}`}
      />
    </div>
  );
}

function HeadStat({
  label,
  value,
  sub,
  last,
}: {
  label: string;
  value: string;
  sub?: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        padding: '20px 18px',
        borderRight: last ? 'none' : '1px solid var(--rule)',
      }}
    >
      <div className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-4)', marginBottom: 8 }}>
        {label}
      </div>
      <div
        className="font-serif tabular-nums"
        style={{ fontSize: 30, fontWeight: 400, letterSpacing: '-0.02em', color: 'var(--ink)' }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; count: number; pct: number }>;
}) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 14 }}>{title}</div>
      <div style={{ borderTop: '1px solid var(--ink)' }}>
        {rows.map((r) => (
          <div
            key={r.label}
            style={{
              display: 'grid',
              gridTemplateColumns: '120px 1fr 56px',
              gap: 14,
              alignItems: 'center',
              padding: '10px 0',
              borderBottom: '1px solid var(--rule)',
              fontSize: 13,
            }}
          >
            <span style={{ color: 'var(--ink)' }}>{r.label}</span>
            <span style={{ position: 'relative', height: 8, background: 'var(--paper-2)' }}>
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: `${Math.max(2, r.pct)}%`,
                  background: 'var(--ink)',
                }}
              />
            </span>
            <span className="font-mono tabular-nums" style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'right' }}>
              {r.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CoverageBar({ coverage }: { coverage: { total: number; high: number; medium: number; low: number; unknown: number } }) {
  const pct = (n: number) => (coverage.total > 0 ? (n / coverage.total) * 100 : 0);
  return (
    <div
      style={{
        display: 'flex',
        height: 12,
        background: 'var(--paper-2)',
        border: '1px solid var(--rule)',
        overflow: 'hidden',
      }}
    >
      <span style={{ width: `${pct(coverage.high)}%`,    background: 'var(--positive)' }} title={`${coverage.high} verified`} />
      <span style={{ width: `${pct(coverage.medium)}%`,  background: 'var(--ink)' }}      title={`${coverage.medium} street`} />
      <span style={{ width: `${pct(coverage.low)}%`,     background: 'var(--ink-3)', opacity: 0.55 }} title={`${coverage.low} neighborhood`} />
    </div>
  );
}

function ExternalChip({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        fontSize: 12,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        fontWeight: 500,
        color: 'var(--ink)',
        textDecoration: 'none',
        border: '1px solid var(--ink)',
        padding: '8px 14px',
        background: 'var(--paper)',
      }}
    >
      {label}
    </a>
  );
}
