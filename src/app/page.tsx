import Link from 'next/link';
import { HELM_MODULES, type HelmModule } from '@/lib/helm-modules';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import { auth } from '@/auth';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { Stat } from '@/components/Stat';
import { TeamActivity } from '@/components/TeamActivity';

export const dynamic = 'force-dynamic';
// Personal count needs the live session, so we can't precompute. Drop the
// 60s revalidate so the home re-renders per-request (auth check is cheap).
export const revalidate = 0;

type DashboardStats = {
  activeProperties: number | null;
  totalProperties: number | null;
  latestMonth: string | null;
  latestStatus: string | null;
  totalPayout: number;
  statementsCount: number;
  // Operational signals
  activeSlips: number | null;
  highPrioritySlips: number | null;
  ownerActionSlips: number | null;
  activeTasks: number | null;
  inspectionsThisWeek: number | null;
};

async function getDashboardStats(): Promise<DashboardStats> {
  const [propertyStats, helmStats, opsStats] = await Promise.all([
    getPropertyStats(),
    getHelmStats(),
    getOperationalStats(),
  ]);
  return { ...propertyStats, ...helmStats, ...opsStats };
}

const ACTIVE_SLIP_STATUSES = ['open', 'in_progress', 'scheduled'];
const ACTIVE_TASK_STATUSES = ['open', 'in_progress', 'blocked'];

async function getOperationalStats() {
  if (!isHelmConfigured) {
    return {
      activeSlips: null,
      highPrioritySlips: null,
      ownerActionSlips: null,
      activeTasks: null,
      inspectionsThisWeek: null,
    };
  }
  try {
    const today = new Date().toISOString().slice(0, 10);
    const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const [
      { count: activeSlips },
      { count: highSlips },
      { count: ownerSlips },
      { count: activeTasks },
      { count: planned },
    ] = await Promise.all([
      supabase
        .from('work_slips')
        .select('*', { count: 'exact', head: true })
        .in('status', ACTIVE_SLIP_STATUSES)
        .or(`snoozed_until.is.null,snoozed_until.lte.${today}`),
      supabase
        .from('work_slips')
        .select('*', { count: 'exact', head: true })
        .in('status', ACTIVE_SLIP_STATUSES)
        .or(`snoozed_until.is.null,snoozed_until.lte.${today}`)
        .eq('priority', 'high'),
      supabase
        .from('work_slips')
        .select('*', { count: 'exact', head: true })
        .in('status', ACTIVE_SLIP_STATUSES)
        .or(`snoozed_until.is.null,snoozed_until.lte.${today}`)
        .eq('owner_action_required', true),
      supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .in('status', ACTIVE_TASK_STATUSES),
      supabase
        .from('inspection_plans')
        .select('*', { count: 'exact', head: true })
        .gte('planned_for_date', today)
        .lte('planned_for_date', weekFromNow),
    ]);

    return {
      activeSlips: activeSlips ?? 0,
      highPrioritySlips: highSlips ?? 0,
      ownerActionSlips: ownerSlips ?? 0,
      activeTasks: activeTasks ?? 0,
      inspectionsThisWeek: planned ?? 0,
    };
  } catch {
    return {
      activeSlips: null,
      highPrioritySlips: null,
      ownerActionSlips: null,
      activeTasks: null,
      inspectionsThisWeek: null,
    };
  }
}

async function getPropertyStats() {
  if (!isHelmConfigured) return { activeProperties: null, totalProperties: null };
  try {
    const [{ count: total }, { count: active }] = await Promise.all([
      supabase.from('properties').select('*', { count: 'exact', head: true }),
      supabase.from('properties').select('*', { count: 'exact', head: true }).eq('is_active', true),
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

async function getYourCount(myEmail: string): Promise<number | null> {
  if (!isHelmConfigured || !myEmail) return null;
  try {
    const todayIso = new Date().toISOString().slice(0, 10);
    const [{ count: slips }, { count: tasks }, { count: plans }] = await Promise.all([
      supabase
        .from('work_slips')
        .select('*', { count: 'exact', head: true })
        .eq('assigned_to_email', myEmail)
        .in('status', ACTIVE_SLIP_STATUSES)
        .or(`snoozed_until.is.null,snoozed_until.lte.${todayIso}`),
      supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('assigned_to_email', myEmail)
        .in('status', ACTIVE_TASK_STATUSES),
      supabase
        .from('inspection_plans')
        .select('*', { count: 'exact', head: true })
        .eq('assigned_to_email', myEmail)
        .gte('planned_for_date', todayIso),
    ]);
    return (slips ?? 0) + (tasks ?? 0) + (plans ?? 0);
  } catch {
    return null;
  }
}

export default async function HelmHome() {
  const session = await auth();
  const myEmail = session?.user?.email ?? '';
  const [stats, yourCount] = await Promise.all([
    getDashboardStats(),
    getYourCount(myEmail),
  ]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <HelmHero
        eyebrow="The Bridge"
        title="Run Rising Tide from"
        emphasis="one place."
        paddingBottom={20}
      />

      {/* PERSONAL JUMP-OFF + SEARCH */}
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ width: '100%', paddingBottom: 28, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <Link
          href="/me"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
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
          What&rsquo;s on for you
          {yourCount != null && yourCount > 0 && (
            <span
              style={{
                background: 'var(--signal)',
                color: 'var(--paper)',
                padding: '2px 8px',
                fontSize: 11,
                letterSpacing: '.06em',
                fontWeight: 700,
              }}
            >
              {yourCount}
            </span>
          )}
          <span>→</span>
        </Link>

        <form action="/search" method="get" style={{ flex: 1, minWidth: 240 }}>
          <input
            type="search"
            name="q"
            placeholder="Search properties, owners, slips, tasks…"
            style={{
              width: '100%',
              padding: '8px 14px',
              border: '1px solid var(--rule)',
              background: 'var(--paper)',
              fontSize: 13,
              color: 'var(--ink)',
              fontFamily: 'inherit',
            }}
          />
        </form>
      </section>

      {/* OPERATIONAL SIGNALS STRIP */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 28 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Today&rsquo;s signals</div>
        <div
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
          }}
        >
          <Stat
            label="Open Work Slips"
            value={stats.activeSlips != null ? String(stats.activeSlips) : '—'}
            sub={
              stats.highPrioritySlips != null && stats.highPrioritySlips > 0
                ? `${stats.highPrioritySlips} high priority`
                : 'no high-priority slips'
            }
            href={
              stats.highPrioritySlips != null && stats.highPrioritySlips > 0
                ? '/work?filter=high'
                : '/work'
            }
            size="hero"
            accent={stats.highPrioritySlips != null && stats.highPrioritySlips > 0}
          />
          <Stat
            label="Owner Action Backlog"
            value={stats.ownerActionSlips != null ? String(stats.ownerActionSlips) : '—'}
            sub={
              stats.ownerActionSlips != null && stats.ownerActionSlips > 0
                ? 'awaiting owner input'
                : 'all caught up'
            }
            href="/work?filter=owner-action"
            size="hero"
          />
          <Stat
            label="Active Tasks"
            value={stats.activeTasks != null ? String(stats.activeTasks) : '—'}
            sub="team backlog"
            href="/work?tab=tasks"
            size="hero"
          />
          <Stat
            label="Inspections This Week"
            value={stats.inspectionsThisWeek != null ? String(stats.inspectionsThisWeek) : '—'}
            sub="planned walks, next 7 days"
            href="/operations"
            size="hero"
            last
          />
        </div>
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
            size="hero"
          />
          <Stat
            label="Latest Period"
            value={stats.latestMonth ? formatMonth(stats.latestMonth) : '—'}
            sub={stats.latestStatus ? statusLabel(stats.latestStatus) : 'no statements yet'}
            href="/statements"
            size="hero"
          />
          <Stat
            label="Statements"
            value={stats.statementsCount > 0 ? String(stats.statementsCount) : '—'}
            sub={stats.latestMonth ? 'in latest period' : ''}
            href="/statements"
            size="hero"
          />
          <Stat
            label="Owner Payouts"
            value={stats.totalPayout > 0 ? formatCurrency(stats.totalPayout) : '—'}
            sub={stats.latestMonth ? 'latest period total' : ''}
            href="/statements"
            size="hero"
            last
            accent
          />
        </div>
      </section>

      {/* MODULES */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Modules</div>
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {HELM_MODULES.map((m) => (
            <ModuleRow key={m.id} module={m} />
          ))}
        </div>
      </section>

      {/* TEAM ACTIVITY */}
      <div style={{ flex: 1 }}>
        <TeamActivity limit={20} />
      </div>

      <HelmFooter
        left="Rising Tide · 85 Eastern Ave · Gloucester, MA 01930"
      />
    </div>
  );
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
