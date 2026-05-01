import Link from 'next/link';
import { HELM_MODULES, type HelmModule } from '@/lib/helm-modules';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import { supabasePerfection, isPerfectionConfigured } from '@/lib/supabase-perfection';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

type DashboardStats = {
  activeProperties: number | null;
  totalProperties: number | null;
  latestMonth: string | null;
  latestStatus: string | null;
  totalPayout: number;
  statementsCount: number;
};

async function getDashboardStats(): Promise<DashboardStats> {
  const [perfectionStats, helmStats] = await Promise.all([
    getPerfectionStats(),
    getHelmStats(),
  ]);
  return { ...perfectionStats, ...helmStats };
}

async function getPerfectionStats() {
  if (!isPerfectionConfigured) return { activeProperties: null, totalProperties: null };
  try {
    const [{ count: total }, { count: active }] = await Promise.all([
      supabasePerfection.from('properties').select('*', { count: 'exact', head: true }),
      supabasePerfection.from('properties').select('*', { count: 'exact', head: true }).eq('is_active', true),
    ]);
    return { activeProperties: active ?? null, totalProperties: total ?? null };
  } catch {
    return { activeProperties: null, totalProperties: null };
  }
}

async function getHelmStats() {
  if (!isHelmConfigured) {
    return { latestMonth: null, latestStatus: null, totalPayout: 0, statementsCount: 0 };
  }
  try {
    const { data: periods } = await supabase
      .from('statement_periods')
      .select('id, month, status')
      .order('month', { ascending: false })
      .limit(1);

    const period = periods?.[0];
    if (!period) return { latestMonth: null, latestStatus: null, totalPayout: 0, statementsCount: 0 };

    const { data: stmts } = await supabase
      .from('property_statements')
      .select('owner_payout')
      .eq('period_id', period.id as string);

    const totalPayout = (stmts || []).reduce(
      (s: number, x: { owner_payout: number | null }) => s + (Number(x.owner_payout) || 0),
      0
    );

    return {
      latestMonth: period.month as string,
      latestStatus: period.status as string,
      totalPayout,
      statementsCount: stmts?.length ?? 0,
    };
  } catch {
    return { latestMonth: null, latestStatus: null, totalPayout: 0, statementsCount: 0 };
  }
}

export default async function HelmHome() {
  const stats = await getDashboardStats();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      {/* MASTHEAD */}
      <header style={{ borderBottom: '1px solid var(--ink)' }}>
        <div className="max-w-[1100px] mx-auto px-10" style={{ padding: '20px 40px 18px' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/rising-tide-logo.png" alt="Rising Tide" style={{ width: 28, height: 28 }} />
              <span className="font-serif" style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ink)' }}>Helm</span>
            </div>
            <span style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 500 }}>
              Rising Tide &middot; Internal Operations
            </span>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 36, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>The Bridge</div>
        <h1 className="font-serif" style={{
          fontSize: 52,
          lineHeight: 1.05,
          fontWeight: 300,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          maxWidth: 720,
        }}>
          Run Rising Tide from <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>one place.</em>
        </h1>
      </section>

      {/* TODAY STRIP */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>The state of things</div>
        <div
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
          }}
        >
          <Stat
            label="Active Properties"
            value={stats.activeProperties != null ? String(stats.activeProperties) : '—'}
            sub={
              stats.activeProperties != null && stats.totalProperties != null
                ? `${stats.totalProperties} total`
                : 'configure env vars'
            }
            href="/properties"
          />
          <Stat
            label="Latest Period"
            value={stats.latestMonth ? formatMonth(stats.latestMonth) : '—'}
            sub={stats.latestStatus ? statusLabel(stats.latestStatus) : 'no statements yet'}
            href="/statements"
          />
          <Stat
            label="Statements"
            value={stats.statementsCount > 0 ? String(stats.statementsCount) : '—'}
            sub={stats.latestMonth ? 'in latest period' : ''}
            href="/statements"
          />
          <Stat
            label="Owner Payouts"
            value={stats.totalPayout > 0 ? formatCurrency(stats.totalPayout) : '—'}
            sub={stats.latestMonth ? 'latest period total' : ''}
            href="/statements"
            last
            accent
          />
        </div>
      </section>

      {/* MODULES */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Modules</div>
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {HELM_MODULES.map((m) => (
            <ModuleRow key={m.id} module={m} />
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
          <span>Rising Tide &middot; 85 Eastern Ave &middot; Gloucester, MA 01930</span>
          <span className="font-serif" style={{ textTransform: 'none', letterSpacing: 0, fontStyle: 'italic', color: 'var(--ink-3)', fontSize: 11 }}>
            &ldquo;We care for your home as if it were our own.&rdquo;
          </span>
        </div>
      </footer>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  href,
  last = false,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
  last?: boolean;
  accent?: boolean;
}) {
  const inner = (
    <div
      style={{
        padding: '20px 22px',
        borderRight: last ? 'none' : '1px solid var(--rule)',
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div
        className="font-serif tabular-nums"
        style={{
          fontSize: 28,
          fontWeight: 400,
          color: accent ? 'var(--signal)' : 'var(--ink)',
          lineHeight: 1.05,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)' }}>{sub}</div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
        {inner}
      </Link>
    );
  }
  return inner;
}

function ModuleRow({ module: m }: { module: HelmModule }) {
  const reachable = m.status === 'active' || m.status === 'external';

  const callToAction =
    m.status === 'active' ? 'Open →' :
    m.status === 'external' ? 'Open ↗' :
    'Soon';

  const content = (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '64px 1fr auto',
        gap: 24,
        alignItems: 'baseline',
        padding: '24px 0',
        borderBottom: '1px solid var(--rule)',
        opacity: reachable ? 1 : 0.5,
        transition: 'opacity 0.15s',
      }}
    >
      <span className="font-mono" style={{
        fontSize: 11,
        color: reachable ? 'var(--signal)' : 'var(--ink-4)',
        letterSpacing: '.08em',
      }}>
        {m.number}
      </span>
      <div>
        <h2 className="font-serif" style={{
          fontSize: 24,
          fontWeight: 400,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          margin: 0,
        }}>
          {m.title}
        </h2>
        <p style={{
          marginTop: 4,
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--ink-3)',
          maxWidth: 620,
        }}>
          {m.description}
        </p>
      </div>
      <span style={{
        fontSize: 10,
        letterSpacing: '.22em',
        textTransform: 'uppercase',
        fontWeight: 500,
        color: reachable ? 'var(--ink)' : 'var(--ink-4)',
        whiteSpace: 'nowrap',
      }}>
        {callToAction}
      </span>
    </div>
  );

  if (m.status === 'external') {
    return (
      <a
        href={m.href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
      >
        {content}
      </a>
    );
  }

  if (m.status === 'active') {
    return (
      <Link href={m.href} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
        {content}
      </Link>
    );
  }

  return <div>{content}</div>;
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

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

function formatCurrency(value: number): string {
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  return `$${Math.round(value)}`;
}
