import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { getCompetitor, listCompetitors, summarizeCompetitor } from '@/lib/competitors';

export const dynamic = 'force-static';

export default function CompetitorsIndex() {
  const competitors = listCompetitors().map((meta) => {
    const c = getCompetitor(meta.id)!;
    return summarizeCompetitor(c.meta, c.listings);
  });

  const totalListings = competitors.reduce((s, c) => s + c.totalListings, 0);
  const totalSleeps = competitors.reduce((s, c) => s + c.totalSleeps, 0);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="competitors" />

      <HelmHero
        eyebrow="Helm · Competitors"
        title="Who else manages"
        emphasis="Cape Ann."
        description={`${competitors.length} competitor${competitors.length === 1 ? '' : 's'} tracked, ${totalListings} listings, ${totalSleeps.toLocaleString()} guest beds. Helm-native — refreshed by snapshot.`}
      />

      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 80, flex: 1, width: '100%' }}
      >
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {competitors.map((c, i) => (
            <CompetitorRow key={c.meta.id} summary={c} number={String(i + 1).padStart(2, '0')} />
          ))}
        </div>

        <p
          style={{
            marginTop: 40,
            fontSize: 12,
            color: 'var(--ink-4)',
            maxWidth: 640,
            lineHeight: 1.6,
          }}
        >
          Phase 1 is inventory only — bedroom counts, bathrooms, sleeps, towns, and pet policy. Phase 2 will add nightly availability and ADR sampling so we can benchmark pricing per market segment. Add a competitor by dropping a new file under <code className="font-mono" style={{ fontSize: 11 }}>src/lib/competitors/</code> and registering it in the index.
        </p>
      </section>

      <HelmFooter module="Competitors" right="Source: Helm" />
    </div>
  );
}

function CompetitorRow({
  summary,
  number,
}: {
  summary: ReturnType<typeof summarizeCompetitor>;
  number: string;
}) {
  const { meta, totalListings, totalBedrooms, totalSleeps, petFriendlyCount, cityBreakdown } = summary;
  const topCities = cityBreakdown.slice(0, 4);
  const avgBeds = totalListings > 0 ? totalBedrooms / totalListings : 0;
  const petPct = totalListings > 0 ? Math.round((petFriendlyCount / totalListings) * 100) : 0;

  return (
    <Link
      href={`/competitors/${meta.id}`}
      style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '64px 1fr auto',
          gap: 24,
          alignItems: 'baseline',
          padding: '32px 0',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <span
          className="font-mono"
          style={{ fontSize: 11, color: 'var(--signal)', letterSpacing: '.08em' }}
        >
          {number}
        </span>

        <div>
          <h2
            className="font-serif"
            style={{
              fontSize: 28,
              fontWeight: 400,
              letterSpacing: '-0.02em',
              color: 'var(--ink)',
              margin: 0,
            }}
          >
            {meta.name}
          </h2>
          <p style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-3)' }}>{meta.tagline}</p>

          <div
            style={{
              marginTop: 16,
              display: 'grid',
              gridTemplateColumns: 'repeat(4, max-content)',
              columnGap: 36,
              rowGap: 4,
              fontSize: 12,
            }}
          >
            <Cell label="Listings" value={String(totalListings)} />
            <Cell label="Avg beds" value={avgBeds.toFixed(1)} />
            <Cell label="Total sleeps" value={String(totalSleeps)} />
            <Cell label="Pet OK" value={`${petPct}%`} />
          </div>

          <div style={{ marginTop: 14, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
            {topCities.map((c, idx) => (
              <span key={c.city}>
                {c.city} <span style={{ color: 'var(--ink-3)' }}>{c.count}</span>
                {idx < topCities.length - 1 ? <span style={{ margin: '0 10px' }}>·</span> : null}
              </span>
            ))}
            {cityBreakdown.length > topCities.length && (
              <span style={{ marginLeft: 10 }}>+{cityBreakdown.length - topCities.length} more</span>
            )}
          </div>
        </div>

        <span
          style={{
            fontSize: 10,
            letterSpacing: '.22em',
            textTransform: 'uppercase',
            fontWeight: 500,
            color: 'var(--ink)',
            whiteSpace: 'nowrap',
          }}
        >
          View inventory →
        </span>
      </div>
    </Link>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-4)' }}>
        {label}
      </div>
      <div className="font-serif tabular-nums" style={{ fontSize: 18, color: 'var(--ink)' }}>
        {value}
      </div>
    </div>
  );
}
