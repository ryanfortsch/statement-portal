import Link from 'next/link';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import { auth } from '@/auth';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { Stat } from '@/components/Stat';
import { computeDateRange, deltaPct } from '@/lib/revenue-date-range';
import { computeRevenueSnapshot } from '@/lib/revenue-snapshot';
import { loadOperationsData } from '@/lib/operations';
import { getReviewWindowStats } from '@/lib/reviews';
import { TeamActivity } from '@/components/TeamActivity';
import { CommandPaletteTrigger } from '@/components/CommandPaletteTrigger';

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
  /** Sum of owner_payout for the period BEFORE latestMonth. Used for the
   *  delta on the Today's Signals strip. null when there's no prior period. */
  priorPayout: number | null;
  statementsCount: number;
  /** Projected total owner payout for the CURRENT month, derived from
   *  Guesty bookings on the books (pro-rated by nights). The "what we're
   *  tracking to" complement to the closed-period payout. null when
   *  Guesty data isn't available. */
  projectedCurrentMonthPayout: number | null;
  // Operational signals
  activeSlips: number | null;
  highPrioritySlips: number | null;
  ownerActionSlips: number | null;
  activeTasks: number | null;
  /** Planned (next 7) + Completed (past 7) inspections, summed for the
   *  home tile so a walked inspection without a prior plan row still
   *  counts. null when Supabase isn't configured. */
  inspectionsThisWeek: number | null;
  inspectionsPlanned: number | null;
  inspectionsCompleted: number | null;
  // Reviews (rolling 30-day window from the reviews table). Trailing 30
  // days is more stable than a calendar week and matches how Dotti
  // thinks about review trend.
  //
  // belowFive is the actual count of rated < 5 reviews. The total/five
  // counts include NULL-rated rows (Guesty placeholders for reservations
  // that haven't been reviewed yet), so the home tile uses belowFive
  // directly rather than `total - fiveStar`, which would fold those
  // unrated rows into "below five."
  reviews30dTotal: number;
  reviews30dFiveStar: number;
  reviews30dBelowFive: number;
  reviews30dUnrated: number;
};

async function getDashboardStats(): Promise<DashboardStats> {
  const [propertyStats, helmStats, opsStats, projected, reviews] = await Promise.all([
    getPropertyStats(),
    getHelmStats(),
    getOperationalStats(),
    getProjectedCurrentMonthPayout(),
    getReviewWindowStats(30),
  ]);
  return {
    ...propertyStats,
    ...helmStats,
    ...opsStats,
    projectedCurrentMonthPayout: projected,
    reviews30dTotal: reviews.total,
    reviews30dFiveStar: reviews.fiveStar,
    reviews30dBelowFive: reviews.belowFive,
    reviews30dUnrated: reviews.total - reviews.fiveStar - reviews.belowFive,
  };
}

/**
 * Forecast for the *current calendar month* based on Guesty bookings
 * already on the books, pro-rated by nights. Reuses the same
 * computeRevenueSnapshot logic the /revenue page renders, just scoped
 * to "this month" so the home tile shows what we're tracking to.
 */
async function getProjectedCurrentMonthPayout(): Promise<number | null> {
  if (!isHelmConfigured) return null;
  try {
    const { rangeStart, rangeEnd } = computeDateRange('this_month');
    const { portfolio } = await computeRevenueSnapshot(rangeStart, rangeEnd);
    return portfolio.totalPayout;
  } catch {
    return null;
  }
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
      inspectionsPlanned: null,
      inspectionsCompleted: null,
    };
  }
  try {
    const today = new Date().toISOString().slice(0, 10);

    const [
      { count: activeSlips },
      { count: highSlips },
      { count: ownerSlips },
      { count: activeTasks },
      ops,
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
      // Use the same source /operations uses so the home tile and the
      // operations page agree. loadOperationsData filters out cancelled
      // reservations and non-operations properties; counting plan rows
      // directly under-counts because most check-ins don't have a plan
      // row yet (the plan is created when someone clicks Plan a walk).
      loadOperationsData('7d', '7d'),
    ]);

    const opsTotal = ops?.totalCount ?? 0;
    const opsDone = ops?.inspectionDoneCount ?? 0;
    const upcoming = Math.max(0, opsTotal - opsDone);

    return {
      activeSlips: activeSlips ?? 0,
      highPrioritySlips: highSlips ?? 0,
      ownerActionSlips: ownerSlips ?? 0,
      activeTasks: activeTasks ?? 0,
      inspectionsThisWeek: upcoming,
      inspectionsPlanned: upcoming,
      inspectionsCompleted: opsDone,
    };
  } catch {
    return {
      activeSlips: null,
      highPrioritySlips: null,
      ownerActionSlips: null,
      activeTasks: null,
      inspectionsThisWeek: null,
      inspectionsPlanned: null,
      inspectionsCompleted: null,
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
  const empty = {
    latestMonth: null as string | null,
    latestStatus: null as string | null,
    totalPayout: 0,
    priorPayout: null as number | null,
    statementsCount: 0,
  };
  if (!isHelmConfigured) return empty;
  try {
    // "Latest" here means "the most recent CLOSED-OUT month," i.e., the
    // baseline the home tile compares this-month tracking against. The
    // current month often has a partial statement_period row (a few
    // statements get drafted mid-month while the bank reconciliation is
    // still pending). Pairing tracking against that partial row produced
    // nonsense deltas like +4637% on the home page. Excluding the current
    // YYYY-MM keeps the baseline honest.
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Pull the two most recent non-current periods in one round trip so
    // the prior-period delta is free.
    const { data: periods } = await supabase
      .from('statement_periods')
      .select('id, month, status')
      .neq('month', currentYearMonth)
      .order('month', { ascending: false })
      .limit(2);

    const period = periods?.[0];
    if (!period) return empty;
    const priorPeriod = periods?.[1] ?? null;

    const sumPayout = (rows: { owner_payout: number | null }[] | null): number =>
      (rows ?? []).reduce((s, x) => s + (Number(x.owner_payout) || 0), 0);

    const [{ data: stmts }, priorRes] = await Promise.all([
      supabase
        .from('property_statements')
        .select('owner_payout')
        .eq('period_id', period.id as string),
      priorPeriod
        ? supabase
            .from('property_statements')
            .select('owner_payout')
            .eq('period_id', priorPeriod.id as string)
        : Promise.resolve({ data: null }),
    ]);

    return {
      latestMonth: period.month as string,
      latestStatus: period.status as string,
      totalPayout: sumPayout(stmts),
      priorPayout: priorPeriod ? sumPayout(priorRes.data) : null,
      statementsCount: stmts?.length ?? 0,
    };
  } catch {
    return empty;
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
        paddingTop={36}
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

        <CommandPaletteTrigger variant="prominent" />
      </section>

      {/* SIGNALS STRIP — what needs attention today, with the headline payout pinned right */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Today&rsquo;s signals</div>
        <div
          className="rt-helm-stat-strip"
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
            label="Upcoming Inspections"
            value={stats.inspectionsPlanned != null ? String(stats.inspectionsPlanned) : '—'}
            sub="next 7 days"
            href="/operations"
            size="hero"
          />
          <Stat
            label="Five-Star Reviews"
            value={
              // Denominator is total reservations in the window, not just
              // rated reviews. A stay that didn't yield a review is a
              // missed five-star, so it counts against the rate. Same
              // basis as the FIVE-STAR cell on /reviews.
              stats.reviews30dTotal > 0
                ? `${stats.reviews30dFiveStar}/${stats.reviews30dTotal}`
                : '—'
            }
            sub={(() => {
              if (stats.reviews30dTotal === 0) return 'no reviews in last 30 days';
              const rate = Math.round(
                (stats.reviews30dFiveStar / stats.reviews30dTotal) * 100,
              );
              return `${rate}% five-star · last 30 days`;
            })()}
            href="/guests?days=30"
            size="hero"
            accent={
              stats.reviews30dTotal > 0 &&
              stats.reviews30dFiveStar === stats.reviews30dTotal
            }
          />
          <Stat
            label={(() => {
              // When projection is available, headline the current month
              // (what we're tracking to). Falls back to the latest closed
              // period when there's no Guesty projection yet.
              if (stats.projectedCurrentMonthPayout != null) {
                return `${currentMonthShortName()} Tracking`;
              }
              return stats.latestMonth ? `${formatMonth(stats.latestMonth)} Payout` : 'Owner Payouts';
            })()}
            value={(() => {
              const tracking = stats.projectedCurrentMonthPayout;
              if (tracking != null) return formatCurrency(tracking);
              return stats.totalPayout > 0 ? formatCurrency(stats.totalPayout) : '—';
            })()}
            sub={(() => {
              const tracking = stats.projectedCurrentMonthPayout;
              if (tracking != null && stats.latestMonth && stats.totalPayout > 0) {
                return `${formatMonth(stats.latestMonth)} closed at ${formatCurrency(stats.totalPayout)}`;
              }
              if (tracking != null) return 'projected from bookings';
              return stats.latestMonth ? 'latest period total' : 'no statements yet';
            })()}
            delta={(() => {
              const tracking = stats.projectedCurrentMonthPayout;
              // When showing tracking: compare to last closed month (apples
              // to oranges in calendar terms but the right "trending up vs
              // last month" signal). Otherwise keep the closed-vs-prior
              // delta the tile used before.
              if (tracking != null && stats.totalPayout > 0) return deltaPct(tracking, stats.totalPayout);
              return deltaPct(stats.totalPayout, stats.priorPayout);
            })()}
            href={stats.projectedCurrentMonthPayout != null ? '/revenue?range=this_month' : '/statements'}
            size="hero"
            last
            accent
          />
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

function formatMonth(month: string): string {
  try {
    const [year, m] = month.split('-');
    const d = new Date(Number(year), Number(m) - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  } catch {
    return month;
  }
}

/** "May" — used in the headline of the current-month tracking tile. */
function currentMonthShortName(): string {
  return new Date().toLocaleDateString('en-US', { month: 'long' });
}

function formatCurrency(value: number): string {
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  return `$${Math.round(value)}`;
}
