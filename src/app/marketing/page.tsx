import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import {
  getStatTotals,
  getTrafficSeries,
  getTopSources,
  getTopPages,
  getLatestSpeedInsights,
  getLastUpdated,
  getSites,
  rangeForDays,
  previousRange,
  deltaPct,
  type SiteFilter,
} from '@/lib/marketing/queries';
import { isConfigured as isHelmConfigured } from '@/lib/supabase';
import { FilterBar } from './FilterBar';
import { TrafficLineChart } from './Charts';
import { InfoTip } from './InfoTip';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

type SearchParams = Promise<{ site?: string; range?: string }>;

export default async function MarketingPage({ searchParams }: { searchParams: SearchParams }) {
  if (!isHelmConfigured) {
    return <ConfigError />;
  }

  const sp = await searchParams;
  const site: SiteFilter = sp.site ?? 'all';
  const days = clampDays(sp.range);

  const range = rangeForDays(days);
  const prevRange = previousRange(days);

  const [sites, current, previous, traffic, topSources, topPages, speed, lastUpdated] = await Promise.all([
    getSites(),
    getStatTotals(site, range),
    getStatTotals(site, prevRange),
    getTrafficSeries(site, range),
    getTopSources(site, range),
    getTopPages(site, range),
    getLatestSpeedInsights(site),
    getLastUpdated(),
  ]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="marketing" />

      <HelmHero
        eyebrow="Helm · Marketing"
        title="How the"
        emphasis="sites"
        titleSuffix="are doing."
        description="GA4 traffic, conversions, top sources, and Core Web Vitals for both Rising Tide sites. Refreshed nightly from Google Analytics and Vercel Speed Insights."
      />

      {/* CONTROLS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 28 }}>
        <FilterBar
          sites={sites}
          currentSite={site}
          currentRange={String(days)}
          lastUpdatedISO={lastUpdated}
        />
      </section>

      {/* HERO STATS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 32 }}>
        <div
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
          }}
        >
          <Stat
            label="Sessions"
            info="A visit to the site. One person visiting in the morning and again at night counts as two sessions. GA4's default session timeout is 30 min of inactivity."
            value={current.sessions}
            delta={deltaPct(current.sessions, previous.sessions)}
          />
          <Stat
            label="Users"
            info="Distinct visitors over the date range. A person returning multiple times counts once. Identified by an anonymous cookie, so a guest in private browsing or on a new device counts as a separate user."
            value={current.users}
            delta={deltaPct(current.users, previous.users)}
          />
          <Stat
            label="New users"
            info="Visitors GA4 hasn't seen before in the date range. First time landing on the site (no prior cookie). Subset of Users."
            value={current.new_users}
            delta={deltaPct(current.new_users, previous.new_users)}
          />
          <Stat
            label="Conversions"
            info="Sum of GA4 key events fired in the window. SCA tracks book_started, book_completed, email_clicked. Rising Tide tracks contact_form_submit, email_clicked, phone_clicked, income_estimator_used. Configure which events count as key in GA4 → Admin → Events."
            value={current.conversions}
            delta={deltaPct(current.conversions, previous.conversions)}
            accent
          />
          <Stat
            label="Avg LCP"
            info="Largest Contentful Paint, p75. Time until the largest visible piece of content paints in the viewport. Google's Core Web Vital thresholds: ≤2.5s good, ≤4s needs work, >4s poor. Pulled from Vercel Speed Insights (real-user measurements)."
            value={lcpDisplay(speed)}
            sub={lcpStatus(speed)}
            last
          />
        </div>
      </section>

      {/* TRAFFIC TREND */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Sessions, daily</div>
        <TrafficLineChart data={traffic} />
      </section>

      {/* TWO-UP: top sources + top pages */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Top sources</div>
            <Table
              empty="No source data in this window."
              rows={topSources.map((s, i) => [
                String(i + 1).padStart(2, '0'),
                s.source === '(direct)' ? 'Direct' : s.source,
                s.medium && s.medium !== '(none)' ? s.medium : '',
                num(s.sessions),
              ])}
              cols={['#', 'Source', 'Medium', 'Sessions']}
              align={['left', 'left', 'left', 'right']}
            />
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Top pages</div>
            <Table
              empty="No page data in this window."
              rows={topPages.map((p, i) => [String(i + 1).padStart(2, '0'), p.display, num(p.page_views)])}
              cols={['#', 'Page', 'Views']}
              align={['left', 'left', 'right']}
            />
          </div>
        </div>
      </section>

      {/* SPEED INSIGHTS PER SITE */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 80 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Core Web Vitals</div>
        {speed.length === 0 ? (
          <EmptyBox text="No Speed Insights data yet." />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            {speed.map((s) => {
              const siteName = sites.find((x) => x.id === s.site_id)?.name ?? s.site_id;
              return (
                <div key={s.site_id} style={{ border: '1px solid var(--rule)', padding: '18px 20px' }}>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>{siteName}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    <Vital label="LCP" value={s.lcp_p75_ms} unit="ms" thresholds={[2500, 4000]} />
                    <Vital label="INP" value={s.inp_p75_ms} unit="ms" thresholds={[200, 500]} />
                    <Vital label="CLS" value={s.cls_p75} unit="" thresholds={[0.1, 0.25]} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

function clampDays(raw: string | undefined): number {
  const n = Number(raw);
  if (n === 7 || n === 30 || n === 90) return n;
  return 30;
}

function num(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function lcpDisplay(speed: { lcp_p75_ms: number | null }[]): string {
  const vals = speed.map((s) => s.lcp_p75_ms).filter((v): v is number => v != null);
  if (vals.length === 0) return '—';
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return `${Math.round(avg)}ms`;
}

function lcpStatus(speed: { lcp_p75_ms: number | null }[]): string {
  const vals = speed.map((s) => s.lcp_p75_ms).filter((v): v is number => v != null);
  if (vals.length === 0) return 'awaiting data';
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (avg <= 2500) return 'good';
  if (avg <= 4000) return 'needs work';
  return 'poor';
}

// ── components ───────────────────────────────────────────────────────

function Stat({
  label,
  info,
  value,
  delta,
  sub,
  accent,
  last,
}: {
  label: string;
  info?: string;
  value: number | string;
  delta?: number | null;
  sub?: string;
  accent?: boolean;
  last?: boolean;
}) {
  const display = typeof value === 'number' ? num(value) : value;
  const deltaText = delta == null ? null : `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%`;
  const deltaColor =
    delta == null ? 'var(--ink-4)' : delta >= 0 ? 'var(--tide-deep)' : 'var(--signal)';

  return (
    <div style={{ padding: '20px 22px', borderRight: last ? 'none' : '1px solid var(--rule)' }}>
      <div className="eyebrow" style={{ marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        {info && <InfoTip tip={info} />}
      </div>
      <div
        className="font-serif tabular-nums"
        style={{
          fontSize: 28,
          fontWeight: 400,
          color: accent ? 'var(--signal)' : 'var(--ink)',
          lineHeight: 1.05,
        }}
      >
        {display}
      </div>
      {deltaText && (
        <div style={{ marginTop: 6, fontSize: 11, color: deltaColor, fontWeight: 500 }}>
          {deltaText} <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>vs prev period</span>
        </div>
      )}
      {sub && !deltaText && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)' }}>{sub}</div>
      )}
    </div>
  );
}

function Table({
  cols,
  rows,
  align,
  empty,
}: {
  cols: string[];
  rows: (string | number)[][];
  align: ('left' | 'right')[];
  empty: string;
}) {
  if (rows.length === 0) return <EmptyBox text={empty} />;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--rule)' }}>
          {cols.map((c, i) => (
            <th
              key={c}
              style={{
                textAlign: align[i] ?? 'left',
                padding: '10px 8px',
                fontSize: 10,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'var(--ink-4)',
                fontWeight: 500,
              }}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderBottom: '1px solid var(--rule)' }}>
            {r.map((cell, j) => (
              <td
                key={j}
                className={typeof cell === 'number' || align[j] === 'right' ? 'tabular-nums' : ''}
                style={{
                  textAlign: align[j] ?? 'left',
                  padding: '10px 8px',
                  color: j === 0 ? 'var(--ink-4)' : 'var(--ink)',
                  fontSize: j === 0 ? 11 : 13,
                  ...(j === 0 ? { fontFamily: 'var(--font-mono, monospace)' } : {}),
                  whiteSpace: align[j] === 'right' ? 'nowrap' : undefined,
                  maxWidth: 320,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '40px 20px',
        border: '1px dashed var(--rule)',
        textAlign: 'center',
        color: 'var(--ink-4)',
        fontSize: 12,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
      }}
    >
      {text}
    </div>
  );
}

function Vital({
  label,
  value,
  unit,
  thresholds,
}: {
  label: string;
  value: number | null;
  unit: string;
  thresholds: [number, number]; // [good_max, needs_work_max]
}) {
  const [goodMax, warnMax] = thresholds;
  const color =
    value == null
      ? 'var(--ink-4)'
      : value <= goodMax
      ? 'var(--tide-deep)'
      : value <= warnMax
      ? '#b88a2a'
      : 'var(--signal)';
  const display = value == null ? '—' : `${value < 1 ? value.toFixed(2) : Math.round(value)}${unit}`;
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div
        className="font-serif tabular-nums"
        style={{ fontSize: 22, color, lineHeight: 1.05 }}
      >
        {display}
      </div>
    </div>
  );
}

function ConfigError() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="marketing" />
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 80, width: '100%' }}>
        <div className="eyebrow">Helm &middot; Marketing</div>
        <h1 className="font-serif" style={{ fontSize: 36, fontWeight: 300, marginTop: 12 }}>Not configured.</h1>
        <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.55, color: 'var(--ink-3)', maxWidth: 580 }}>
          Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in
          Vercel env to populate this page.
        </p>
      </section>
    </div>
  );
}
