import { availableCount } from '@/lib/recovery';
import { RetryDashboard } from '@/components/RetryDashboard';
import { HelmHero } from '@/components/HelmHero';
import { Suspense } from 'react';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { Stat } from '@/components/Stat';
import { computeDateRange } from '@/lib/revenue-date-range';
import { computeRevenueSnapshot } from '@/lib/revenue-snapshot';
import { loadOperationsData } from '@/lib/operations';
import { TeamActivity } from '@/components/TeamActivity';
import { HomeFeedTabs } from '@/components/HomeFeedTabs';
import { ForMeFeed } from '@/components/ForMeFeed';
import { AskHelm } from '@/components/AskHelm';
import { CleaningsStrip } from '@/components/CleaningsStrip';
import { AiStatusBanner } from '@/components/AiStatusBanner';
import { ConciergeAlertsLine } from '@/components/ConciergeAlerts';
import { isOwnerSession } from '@/lib/helm-access-server';
import { operatingDate } from '@/lib/operating-date';
import { workWeekEnd } from '@/lib/work-week';

export const dynamic = 'force-dynamic';
// Today's signals read live from Supabase per request, so don't cache.
export const revalidate = 0;

type DashboardStats = {
  latestMonth: string | null;
  latestStatus: string | null;
  totalPayout: number;
  statementsAvailable: boolean;
  /** Sum of owner_payout for the period BEFORE latestMonth. null when
   *  there's no prior period. */
  priorPayout: number | null;
  statementsCount: number;
  /** Actual booked-so-far owner payout for the CURRENT month, recognized
   *  at checkout from bookings already on the books. No pacing projection
   *  (matches the /revenue page's default "Actuals" view).
   *
   *  A discriminated result, not a bare number, because the three ways this
   *  can come back empty are not the same fact. A read that FAILED used to
   *  arrive as null alongside "not configured", and the tile answered both by
   *  quietly showing the last closed month's payout under a different label:
   *  a real, plausible number for the wrong month, with nothing saying the
   *  live figure never loaded. */
  currentMonthActualPayout: CurrentPayout;
  /** Open slips scheduled and open tasks due by the end of this week,
   *  overdue included (lib/work-week.ts). null when the read failed. */
  weekWork: number | null;
  /** The overdue part of weekWork. */
  overdueWork: number | null;
  /** Turnovers (check-ins) in the next seven days, the same rows /turnovers
   *  shows. null when the shared operations read failed. */
  turnovers: number | null;
};

/** Operations data for the home page: the turnover count behind the
 *  "Turnovers · next 7 days" signal. '7d' matches the /turnovers default. */
type HomeOps = Awaited<ReturnType<typeof loadOperationsData>> | null;

async function loadHomeOps(): Promise<HomeOps> {
  if (!isHelmConfigured) return null;
  try {
    return await loadOperationsData('7d', '7d');
  } catch {
    return null;
  }
}

/**
 * Why a union and not `number | null`: see the field docs on DashboardStats.
 * 'unconfigured' is a legitimate reason to fall back to the last closed
 * period; 'failed' is not, and must be visible.
 */
type CurrentPayout =
  | { status: 'ok'; payout: number }
  | { status: 'unconfigured' }
  | { status: 'failed' };

async function getDashboardStats(ops: HomeOps, owner: boolean): Promise<DashboardStats> {
  const [helmStats, work, actualPayout] = await Promise.all([
    // The payout tile is owner money: a staff page never reads it.
    owner ? getHelmStats() : Promise.resolve(EMPTY_HELM_STATS),
    getWeekWork(),
    owner ? getCurrentMonthActualPayout() : Promise.resolve<CurrentPayout>({ status: 'unconfigured' }),
  ]);
  return {
    ...helmStats,
    ...work,
    currentMonthActualPayout: actualPayout,
    turnovers: ops ? ops.totalCount : null,
  };
}

/**
 * Actual owner payout booked so far this calendar month, recognized at
 * checkout from bookings already on the books. Passes applyPacing:false so
 * there's no occupancy projection — the home tile shows real money, the
 * same "Actuals" the /revenue page defaults to. (Pacing is available there
 * via the view toggle.)
 */
async function getCurrentMonthActualPayout(): Promise<CurrentPayout> {
  if (!isHelmConfigured) return { status: 'unconfigured' };
  try {
    const { rangeStart, rangeEnd } = computeDateRange('this_month');
    const { portfolio } = await computeRevenueSnapshot(rangeStart, rangeEnd, {
      applyPacing: false,
    });
    return { status: 'ok', payout: portfolio.totalPayout };
  } catch (err) {
    // Loud in the logs, and visible on the tile. Swallowing this is how a
    // stale month's payout got to stand in for a live one.
    console.error('[home] current-month payout read failed:', err);
    return { status: 'failed' };
  }
}

const ACTIVE_SLIP_STATUSES = ['open', 'in_progress', 'scheduled'];
const ACTIVE_TASK_STATUSES = ['open', 'in_progress', 'blocked'];

/**
 * Open work due this week: slips scheduled and tasks due on or before the
 * sixth day from today (Gloucester), overdue included, snoozed slips left
 * out. Four head counts, no rows.
 */
async function getWeekWork(): Promise<{ weekWork: number | null; overdueWork: number | null }> {
  if (!isHelmConfigured) return { weekWork: null, overdueWork: null };
  try {
    const today = operatingDate();
    const weekEnd = workWeekEnd(today);
    const slips = () =>
      supabase
        .from('work_slips')
        .select('*', { count: 'exact', head: true })
        .in('status', ACTIVE_SLIP_STATUSES)
        .or(`snoozed_until.is.null,snoozed_until.lte.${today}`);
    const tasks = () =>
      supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .in('status', ACTIVE_TASK_STATUSES);
    const [slipWeek, slipLate, taskWeek, taskLate] = await Promise.all([
      slips().lte('scheduled_date', weekEnd),
      slips().lt('scheduled_date', today),
      tasks().lte('due_date', weekEnd),
      tasks().lt('due_date', today),
    ]);
    const parts = [availableCount(slipWeek), availableCount(slipLate), availableCount(taskWeek), availableCount(taskLate)];
    if (parts.some((n) => n === null)) return { weekWork: null, overdueWork: null };
    const [sw, sl, tw, tl] = parts as number[];
    return { weekWork: sw + tw, overdueWork: sl + tl };
  } catch {
    return { weekWork: null, overdueWork: null };
  }
}

const EMPTY_HELM_STATS = {
  latestMonth: null as string | null,
  latestStatus: null as string | null,
  totalPayout: 0,
  statementsAvailable: false,
  priorPayout: null as number | null,
  statementsCount: 0,
};

async function getHelmStats() {
  const empty = EMPTY_HELM_STATS;
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
    const { data: periods, error: periodsError } = await supabase
      .from('statement_periods')
      .select('id, month, status')
      .neq('month', currentYearMonth)
      .order('month', { ascending: false })
      .limit(2);

    if (periodsError) throw periodsError;
    const period = periods?.[0];
    if (!period) return { ...empty, statementsAvailable: true };
    const priorPeriod = periods?.[1] ?? null;

    const sumPayout = (rows: { owner_payout: number | null }[] | null): number =>
      (rows ?? []).reduce((s, x) => s + (Number(x.owner_payout) || 0), 0);

    const [statementResult, priorRes] = await Promise.all([
      supabase
        .from('property_statements')
        .select('owner_payout')
        .eq('period_id', period.id as string),
      priorPeriod
        ? supabase
            .from('property_statements')
            .select('owner_payout')
            .eq('period_id', priorPeriod.id as string)
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (statementResult.error) throw statementResult.error;
    const stmts = statementResult.data;
    return {
      statementsAvailable: true,
      latestMonth: period.month as string,
      latestStatus: period.status as string,
      totalPayout: sumPayout(stmts),
      priorPayout: priorPeriod && !priorRes.error ? sumPayout(priorRes.data) : null,
      statementsCount: stmts?.length ?? 0,
    };
  } catch {
    return empty;
  }
}

export default async function HelmHome() {
  // The headline payout tile is owner money. Staff get the two work
  // signals and no tile that links to /revenue, which would bounce them.
  const owner = await isOwnerSession();
  const ops = await loadHomeOps();
  const stats = await getDashboardStats(ops, owner);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      {/* CONCIERGE: drafts paused, and one line counting the guest
          emergencies and alerts the concierge could not finish on its own,
          linking to their rows on Messaging. Streams in, so a slow Mac Mini
          never holds up the page; renders nothing when all is well. */}
      <Suspense fallback={null}>
        <AiStatusBanner />
      </Suspense>
      <Suspense fallback={null}>
        <ConciergeAlertsLine />
      </Suspense>

      <HelmHero eyebrow="HELM" title="Today" paddingTop={32} paddingBottom={20} />

      {/* ASK HELM: the page's one input, directly under the title. */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 28 }}>
        <AskHelm showSuggestions={false} />
      </section>

      {/* The signed-in person's day leads; activity remains one tab away. */}
      <div>
        <HomeFeedTabs
          forMe={<ForMeFeed />}
          recentActivity={<TeamActivity limit={20} hideHeading />}
        />
      </div>

      {/* SIGNALS: the two numbers that change what you do today, each
          saying its window, and the month's payout for owners. */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
        {(stats.weekWork === null || stats.turnovers === null || stats.currentMonthActualPayout.status === 'failed') && (
          <p role="status" style={{ fontSize: 14, color: 'var(--negative)', marginBottom: 16 }}>
            Some numbers did not load. <RetryDashboard />
          </p>
        )}
        <div
          className="rt-helm-stat-strip"
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            display: 'grid',
            gridTemplateColumns: `repeat(${owner ? 3 : 2}, 1fr)`,
          }}
        >
          <Stat
            label="Open work · this week"
            value={stats.weekWork != null ? String(stats.weekWork) : 'Unavailable'}
            sub={
              stats.overdueWork == null
                ? 'could not count'
                : stats.overdueWork > 0
                  ? `${stats.overdueWork} overdue`
                  : 'nothing overdue'
            }
            href={stats.overdueWork != null && stats.overdueWork > 0 ? '/work?filter=overdue' : '/work'}
            size="hero"
            accent={stats.overdueWork != null && stats.overdueWork > 0}
          />
          <Stat
            label="Turnovers · next 7 days"
            value={stats.turnovers != null ? String(stats.turnovers) : 'Unavailable'}
            sub="All turnovers →"
            href="/turnovers"
            size="hero"
            last={!owner}
          />
          {owner && (
          <Stat
            label={(() => {
              // Headline the current month's booked-so-far payout. A failed
              // read says so; only an unconfigured Helm falls back to the
              // latest closed period, because that is a real answer rather
              // than a missing one.
              const p = stats.currentMonthActualPayout;
              if (p.status === 'ok') return `${currentMonthShortName()} payout`;
              if (p.status === 'failed') return `${currentMonthShortName()} payout`;
              return stats.latestMonth ? `${formatMonth(stats.latestMonth)} payout` : 'Owner payouts';
            })()}
            value={(() => {
              const p = stats.currentMonthActualPayout;
              if (p.status === 'ok') return formatCurrency(p.payout);
              if (p.status === 'failed' || !stats.statementsAvailable) return 'Unavailable';
              return stats.totalPayout > 0 ? formatCurrency(stats.totalPayout) : '—';
            })()}
            sub={(() => {
              const p = stats.currentMonthActualPayout;
              if (p.status === 'failed') return 'could not load; retry, or open Revenue';
              if (p.status === 'ok') {
                return stats.latestMonth && stats.totalPayout > 0
                  ? `booked so far · ${formatMonth(stats.latestMonth)} closed ${formatCurrency(stats.totalPayout)}`
                  : 'booked so far';
              }
              if (!stats.statementsAvailable) return 'payout data unavailable';
              return stats.latestMonth ? 'current payout unavailable · showing closed period' : 'current payout unavailable';
            })()}
            href={
              stats.currentMonthActualPayout.status === 'unconfigured'
                ? '/statements'
                : '/revenue?range=this_month'
            }
            size="hero"
            last
            accent
          />
          )}
        </div>
      </section>

      {/* CLEANINGS — the crew's next three days, from their own Jobber
          reminders. Sits with the signals because it IS today's question
          at 9 AM: is a cleaner coming, and when. Full page at
          /turnovers/cleanings. Renders nothing when the read fails. */}
      <CleaningsStrip />

      {/* Spacer keeps the footer pinned to the bottom whichever block is last. */}
      <div style={{ flex: 1 }} />

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

/** "May" — used in the headline of the current-month payout tile. */
function currentMonthShortName(): string {
  return new Date().toLocaleDateString('en-US', { month: 'long' });
}

function formatCurrency(value: number): string {
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  return `$${Math.round(value)}`;
}
