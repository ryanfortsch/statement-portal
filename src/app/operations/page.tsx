import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { WorkTabs } from '@/components/WorkTabs';
import { OccupancyCalendar } from '@/components/OccupancyCalendar';
import { auth } from '@/auth';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import { AutoRefresh } from '../revenue/AutoRefresh';
import { CompactTurnoverRow } from './CompactTurnoverRow';
import { lifecycleOf, STAGE_HUES } from './turnover-format';
import { loadPacketStatusByBooking } from '@/lib/field-packets';
import {
  loadOperationsData,
  todayStr,
  RANGE_LABEL,
  VALID_RANGES,
  CALENDAR_RANGE_DAYS,
  CALENDAR_RANGE_LABEL,
  VALID_CALENDAR_RANGES,
  type CalendarRange,
  type Range,
  type Turnover,
} from '@/lib/operations';

export const dynamic = 'force-dynamic';

const STALE_MS = 30 * 60 * 1000;

async function readSyncStatus(): Promise<{ lastSyncedAt: Date | null; isStale: boolean }> {
  const { data } = await supabase
    .from('sync_status')
    .select('last_synced_at')
    .eq('source', 'guesty-reservations')
    .maybeSingle();
  const lastSyncedAt = data?.last_synced_at ? new Date(data.last_synced_at) : null;
  const isStale = !lastSyncedAt || Date.now() - lastSyncedAt.getTime() >= STALE_MS;
  return { lastSyncedAt, isStale };
}

async function readPropertyName(propertyId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('properties')
      .select('name')
      .eq('id', propertyId)
      .maybeSingle();
    return (data as { name: string } | null)?.name ?? null;
  } catch {
    return null;
  }
}

function formatRelative(date: Date | null): string {
  if (!date) return 'never';
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)} hr ago`;
  return `${Math.round(diffSec / 86400)} d ago`;
}

type PageProps = {
  searchParams: Promise<{ range?: string; cal?: string; property?: string; calo?: string }>;
};

export default async function OperationsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params?.range;
  const range: Range =
    rangeParam && (VALID_RANGES as string[]).includes(rangeParam)
      ? (rangeParam as Range)
      : 'today';

  const calParam = params?.cal;
  const calRange: CalendarRange =
    calParam && (VALID_CALENDAR_RANGES as string[]).includes(calParam)
      ? (calParam as CalendarRange)
      : '7d';

  // Calendar paging offset in days (the ‹ Today › pagers under "On the
  // calendar"). 0 = anchored on today; the lib clamps extremes.
  const caloParsed = parseInt(params?.calo ?? '', 10);
  const calOffset = Number.isFinite(caloParsed) ? caloParsed : 0;

  const propertyFilter = params?.property?.trim() || undefined;

  // Canonical URL for this page's own links: every control preserves the
  // other controls' state (list range, calendar range, paging offset,
  // property filter) instead of silently resetting them.
  const opsHref = (over: {
    range?: Range;
    cal?: CalendarRange;
    calo?: number;
    property?: string | null;
  }): string => {
    const q = new URLSearchParams();
    q.set('range', over.range ?? range);
    q.set('cal', over.cal ?? calRange);
    const calo = over.calo !== undefined ? over.calo : calOffset;
    if (calo !== 0) q.set('calo', String(calo));
    const prop = over.property !== undefined ? over.property : propertyFilter ?? null;
    if (prop) q.set('property', prop);
    return `/operations?${q.toString()}`;
  };

  if (!isHelmConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead current="work" />
        <WorkTabs current="turnovers" />
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56 }}>
          <div className="eyebrow">Turnovers</div>
          <p style={{ marginTop: 14, color: 'var(--ink-3)' }}>
            Configure Supabase env vars to load turnovers.
          </p>
        </section>
      </div>
    );
  }

  const [{ lastSyncedAt, isStale }, data, session, filterPropertyName] = await Promise.all([
    readSyncStatus(),
    loadOperationsData(range, calRange, propertyFilter, calOffset),
    auth(),
    propertyFilter ? readPropertyName(propertyFilter) : Promise.resolve<string | null>(null),
  ]);
  const myEmail = session?.user?.email ?? '';

  // Attach Field packet status to each turnover so the row shows who's
  // covering its inspection. The service-role Field read lives here, out of
  // the anon-client operations lib; if Field isn't configured it degrades to
  // no chip rather than erroring the whole page.
  try {
    const packetByBooking = await loadPacketStatusByBooking(data.turnovers.map((t) => t.reservationId));
    for (const t of data.turnovers) {
      const ps = packetByBooking.get(t.reservationId);
      if (ps) t.fieldPacket = { packetId: ps.packetId, status: ps.status, contractorName: ps.contractorName, visitDate: ps.visitDate ?? null, stopActive: ps.stopActive };
    }
  } catch {
    // Field tables unconfigured / unavailable — leave turnovers chip-less.
  }

  const initialFooter = lastSyncedAt
    ? `Synced ${formatRelative(lastSyncedAt)}`
    : 'Not synced yet';

  // "Pending" = still needs attention: not inspected AND not hand-marked
  // done. A manually-completed turnover counts as handled, so it drops out
  // of the header count + jump target just like an inspected one.
  const pendingTurnovers = data.turnovers.filter((t) => !isTurnoverDone(t));
  const inspectionsLeft = pendingTurnovers.length;

  // Live stage tally across the visible window, rendered as a thin strip of
  // counts under the summary so the operator reads the shape of the day at a
  // glance (who's mid-clean, who's waiting on a cleaner, who's clean-but-
  // unwalked) without scanning every row. Computed server-side off render
  // time (the clock read lives in the helper to keep the component body pure);
  // AutoRefresh keeps it current. Same lifecycleOf the rows use, so the strip
  // and the rails never disagree.
  const { counts, firsts } = computeStageCounts(pendingTurnovers);
  const { cleaningNow, awaitingCleaner, needsInspection, inspectingNow } = counts;
  const doneCount = data.totalCount - inspectionsLeft;
  const firstDone = data.turnovers.find(isTurnoverDone) ?? null;
  const hasLiveStages = cleaningNow + awaitingCleaner + needsInspection + inspectingNow > 0;

  // Where "N still need attention" should jump to when tapped:
  //   - exactly 1 pending AND it has an inspection row already (the operator
  //     started but didn't finish): resume URL straight into the runner.
  //   - otherwise: anchor link to the first pending turnover's card, so the
  //     operator lands next to its START INSPECTION button.
  // Starting an inspection fresh requires a server-action form submission
  // (the existing button on the row), which a plain <Link> can't do, so
  // the anchor path keeps the click on a real CTA instead of doing it for
  // the operator without confirmation.
  // The anchor target uses the SAME flightRank order TurnoverList renders in,
  // so the jump always lands on the first row on screen (previously it used
  // the chronological order and could scroll past an in-flight row that had
  // floated above it). Rank is computed once per row before sorting —
  // flightRank reads the clock internally, and a fresh read per comparator
  // call could go inconsistent across a stage boundary mid-sort.
  const orderedPending = pendingTurnovers
    .map((t) => ({ t, rank: flightRank(t) }))
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.t);
  let pendingHref: string | null = null;
  if (orderedPending.length === 1 && orderedPending[0].inspection?.id) {
    pendingHref = `/inspections/${orderedPending[0].inspection.id}`;
  } else if (orderedPending.length > 0) {
    const t = orderedPending[0];
    pendingHref = `#turnover-${t.propertyId}-${t.reservationId}`;
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="work" />
      <WorkTabs current="turnovers" />

      {/* Compact ops header — replaces the editorial hero + separate
          range-tabs + summary stack. Single bordered row carries the
          page summary on the left and the range tabs on the right;
          sync indicator drops underneath as small dim text. ~120px of
          chrome saved before any turnover row renders. */}
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ width: '100%', paddingTop: 28, paddingBottom: 24 }}
      >
        {propertyFilter && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              border: '1px solid var(--signal)',
              background: 'rgba(200, 90, 58, 0.06)',
              fontSize: 12,
              marginBottom: 18,
            }}
          >
            <span style={{ color: 'var(--signal)', fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', fontSize: 10 }}>
              Filter
            </span>
            <span style={{ color: 'var(--ink)', flex: 1 }}>
              Showing only <strong>{filterPropertyName ?? propertyFilter}</strong>
            </span>
            <Link
              href={opsHref({ property: null })}
              style={{
                fontSize: 11,
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                color: 'var(--ink-3)',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              Clear
            </Link>
          </div>
        )}

        <div
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            padding: '16px 0',
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 24,
            flexWrap: 'wrap',
          }}
        >
          {/* Attention-first summary: the ACTIONABLE count is the headline
              ("3 still need attention" in 30px serif) and the total becomes
              the small qualifier — the old layout set the decoration big
              ("7 check-ins") and the work small. */}
          <div className="font-serif" style={{ fontSize: 22, fontWeight: 400, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            {data.totalCount === 0 ? (
              <>No check-ins {range === 'today' ? 'today' : `in the next ${RANGE_LABEL[range].toLowerCase()}`}.</>
            ) : inspectionsLeft > 0 ? (
              <>
                {(() => {
                  const phrase = (
                    <>
                      <strong style={{ fontSize: 30, fontWeight: 500, color: 'var(--signal)' }}>
                        {inspectionsLeft}
                      </strong>{' '}
                      still need{inspectionsLeft === 1 ? 's' : ''} attention
                    </>
                  );
                  const linkStyle = {
                    color: 'var(--ink)',
                    textDecoration: 'none',
                    borderBottom: '1px dashed var(--signal)',
                    paddingBottom: 2,
                  } as const;
                  // For real route navigation (/inspections/{id} resume URL)
                  // we want Next's Link with prefetch + client routing. For
                  // a same-page hash anchor we use a plain <a> instead: the
                  // App Router's Link intercepts the click and (in some
                  // configurations) suppresses the browser's native
                  // fragment-scroll. A regular <a href="#..."> lets the
                  // browser do the scroll natively.
                  if (pendingHref?.startsWith('#')) {
                    return (
                      <a href={pendingHref} style={linkStyle} title="Jump to the first turnover that still needs an inspection">
                        {phrase}
                      </a>
                    );
                  }
                  if (pendingHref) {
                    return (
                      <Link href={pendingHref} style={linkStyle} title="Resume the inspection in progress">
                        {phrase}
                      </Link>
                    );
                  }
                  return <span>{phrase}</span>;
                })()}
                <span style={{ fontSize: 14, color: 'var(--ink-3)', marginLeft: 12 }}>
                  of {data.totalCount} check-in{data.totalCount === 1 ? '' : 's'}
                  {range === 'today' ? ' today' : ` · next ${RANGE_LABEL[range].toLowerCase()}`}
                </span>
              </>
            ) : (
              <>
                <span style={{ fontSize: 30, fontWeight: 500, color: 'var(--positive)' }}>All prepped</span>
                <span style={{ fontSize: 14, color: 'var(--ink-3)', marginLeft: 12 }}>
                  {data.totalCount} check-in{data.totalCount === 1 ? '' : 's'}
                  {range === 'today' ? ' today' : ` · next ${RANGE_LABEL[range].toLowerCase()}`}
                </span>
              </>
            )}
          </div>
          <nav
            className="flex items-baseline gap-4"
            style={{
              fontSize: 11,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              fontWeight: 500,
            }}
          >
            {VALID_RANGES.map((r) => {
              const active = r === range;
              return (
                <Link
                  key={r}
                  href={opsHref({ range: r })}
                  scroll={false}
                  style={{
                    color: active ? 'var(--ink)' : 'var(--ink-4)',
                    textDecoration: 'none',
                    borderBottom: active ? '2px solid var(--signal)' : '2px solid transparent',
                    paddingBottom: 4,
                  }}
                >
                  {RANGE_LABEL[r]}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Live stage strip — the shape of the day in one line. Only renders
            when something is actually in motion; "all prepped" already covers
            the quiet case above. */}
        {hasLiveStages && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '6px 20px',
              padding: '11px 0 0',
              fontSize: 12,
            }}
          >
            {/* Each entry renders the SAME pip treatment the micro-rails use
                (STAGE_HUES identity color; ring = a stage in motion, solid
                fill = done), so reading the strip once decodes every rail
                below — it doubles as the legend. Each count is an anchor to
                the first row in that stage (plain <a> for native fragment
                scroll, same reason as the header link). */}
            {cleaningNow > 0 && (
              <StageCount hue={STAGE_HUES[2]} label="cleaning now" n={cleaningNow} target={firsts.cleaning} />
            )}
            {awaitingCleaner > 0 && (
              <StageCount hue={STAGE_HUES[1]} label="awaiting cleaner" n={awaitingCleaner} target={firsts.awaiting} />
            )}
            {inspectingNow > 0 && (
              <StageCount hue={STAGE_HUES[4]} label="inspecting now" n={inspectingNow} target={firsts.inspecting} />
            )}
            {needsInspection > 0 && (
              <StageCount hue={STAGE_HUES[4]} label="clean · needs inspection" n={needsInspection} target={firsts.needsInspection} />
            )}
            {doneCount > 0 && (
              <StageCount hue="var(--positive)" done label="done" n={doneCount} target={firstDone} />
            )}
          </div>
        )}

        <div
          className="flex items-center justify-between"
          style={{
            marginTop: 8,
            fontSize: 10,
            color: 'var(--ink-4)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          {/* Inspections has no menu module of its own — this is the
              entry point. Links to /inspections, the start form (pick a
              property, begin) + recent-inspections list. Per-turnover
              "Start Inspection" buttons in the list below cover the
              scoped case; this covers ad-hoc walks and re-inspections. */}
          <Link
            href="/inspections"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--ink)',
              textDecoration: 'none',
              border: '1px solid var(--rule)',
              padding: '5px 11px',
              fontWeight: 600,
              letterSpacing: '0.12em',
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>+</span>
            Start inspection
          </Link>
          <Link
            href="/operations/packets"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--ink)',
              textDecoration: 'none',
              border: '1px solid var(--rule)',
              padding: '5px 11px',
              fontWeight: 600,
              letterSpacing: '0.12em',
            }}
          >
            Field packets
          </Link>
          <AutoRefresh shouldRefresh={isStale} initialLabel={initialFooter} />
        </div>
      </section>

      {/* TURNOVER LIST */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, width: '100%' }}>
        {data.totalCount === 0 ? (
          <div style={{ borderTop: '1px solid var(--ink)', padding: '24px 0', fontSize: 13, color: 'var(--ink-4)' }}>
            Pick a wider range to see upcoming check-ins.
          </div>
        ) : (
          <TurnoverList turnovers={data.turnovers} myEmail={myEmail} grouped={range !== 'today'} />
        )}
      </section>

      {/* OCCUPANCY CALENDAR */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <div
          className="flex items-baseline justify-between flex-wrap gap-3"
          style={{ marginBottom: 14 }}
        >
          <h2 className="font-serif" style={{
            fontSize: 22,
            fontWeight: 400,
            letterSpacing: '-0.01em',
            color: 'var(--ink)',
            margin: 0,
          }}>
            On the calendar
            {data.calendar.days.length > 0 && (
              <span
                className="font-sans"
                style={{
                  fontSize: 12,
                  color: calOffset === 0 ? 'var(--ink-4)' : 'var(--signal)',
                  marginLeft: 12,
                  letterSpacing: '0.02em',
                }}
              >
                {fmtCalDay(data.calendar.days[0])} &rarr;{' '}
                {fmtCalDay(data.calendar.days[data.calendar.days.length - 1])}
              </span>
            )}
          </h2>
          <nav className="flex items-baseline" style={{
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            fontWeight: 500,
            gap: 16,
          }}>
            {/* Pager: slide the window by one full page in either direction,
                Today snaps back. Guesty's calendar can do this; ours
                couldn't until now. */}
            <span className="flex items-baseline" style={{ gap: 10 }}>
              <Link
                href={opsHref({ calo: calOffset - CALENDAR_RANGE_DAYS[calRange] })}
                scroll={false}
                aria-label="Earlier"
                title="Page the calendar earlier"
                style={{ color: 'var(--ink)', textDecoration: 'none', fontSize: 14, lineHeight: 1 }}
              >
                &lsaquo;
              </Link>
              {calOffset !== 0 ? (
                <Link
                  href={opsHref({ calo: 0 })}
                  scroll={false}
                  style={{ color: 'var(--signal)', textDecoration: 'none' }}
                >
                  Today
                </Link>
              ) : (
                <span style={{ color: 'var(--ink-4)' }}>Today</span>
              )}
              <Link
                href={opsHref({ calo: calOffset + CALENDAR_RANGE_DAYS[calRange] })}
                scroll={false}
                aria-label="Later"
                title="Page the calendar later"
                style={{ color: 'var(--ink)', textDecoration: 'none', fontSize: 14, lineHeight: 1 }}
              >
                &rsaquo;
              </Link>
            </span>
            <span aria-hidden style={{ color: 'var(--rule)', fontSize: 12 }}>|</span>
            {VALID_CALENDAR_RANGES.map((cr) => {
              const active = cr === calRange;
              return (
                <Link
                  key={cr}
                  href={opsHref({ cal: cr })}
                  scroll={false}
                  style={{
                    color: active ? 'var(--ink)' : 'var(--ink-4)',
                    textDecoration: 'none',
                    borderBottom: active ? '2px solid var(--signal)' : '2px solid transparent',
                    paddingBottom: 3,
                  }}
                >
                  {CALENDAR_RANGE_LABEL[cr]}
                </Link>
              );
            })}
          </nav>
        </div>
        <OccupancyCalendar calendar={data.calendar} />
      </section>

      <HelmFooter module="Turnovers" right="Source: Guesty + Helm inspections" />
    </div>
  );
}

/**
 * The full turnover pipeline renders flat — every check-in in range is
 * always visible as one dense line, never collapsed behind an expander. The
 * operator works this list top to bottom, so hiding the tail would hide real
 * work.
 *
 * Two tiers, one row component: turnovers that still need attention (not
 * inspected and not hand-marked done) render up top, in-flight first; finished
 * ones sink to the bottom, dimmed (CompactTurnoverRow fades them by opacity).
 * The partition is stable, so it preserves the server-side chronological sort
 * within each tier. Result: the operator's eye lands on outstanding work, with
 * the finished turnovers tucked away but still reachable and expandable.
 */
function isTurnoverDone(t: Turnover): boolean {
  return t.inspectionStatus === 'complete' || t.manuallyCompleted;
}

// In-flight first: a cleaner physically in the house (entered, not finished)
// floats to the top, then checkout-passed-awaiting-cleaner, then the rest.
// Stable within each tier, so chronological order is preserved. The live,
// pulsing rows become the first thing the operator sees.
function flightRank(t: Turnover): number {
  // Rank by the SAME lifecycle the rail shows so the sort and the visuals
  // agree, and so lockless rows (no entry signal) don't permanently
  // masquerade as "awaiting cleaner" at the top of the list (the old version
  // keyed on enteredAt, which is null forever on a lockless home). A cleaner
  // physically in floats to the very top, then anything due-and-awaiting (a
  // monitored "awaiting cleaner" OR a lockless "needs clean"), then the rest.
  const lc = lifecycleOf(t, Date.now(), new Date().toISOString().slice(0, 10));
  if (lc.active === 'cleaning') return 0;
  if (lc.active === 'in' || lc.active === 'clean') return 1;
  return 2;
}

// Tally the active stage of each pending turnover for the header strip, and
// remember the FIRST turnover in each stage so each strip count can anchor-
// link straight to a row it's counting. The clock read (Date.now) lives here,
// not in the component body, so the page component stays pure under
// react-hooks/purity (same reason flightRank and formatRelative wrap their
// date reads).
type StageFirsts = {
  cleaning: Turnover | null;
  awaiting: Turnover | null;
  needsInspection: Turnover | null;
  inspecting: Turnover | null;
};
function computeStageCounts(pending: Turnover[]): {
  counts: {
    cleaningNow: number;
    awaitingCleaner: number;
    needsInspection: number;
    inspectingNow: number;
  };
  firsts: StageFirsts;
} {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  let cleaningNow = 0;
  let awaitingCleaner = 0;
  let needsInspection = 0;
  let inspectingNow = 0;
  const firsts: StageFirsts = { cleaning: null, awaiting: null, needsInspection: null, inspecting: null };
  for (const t of pending) {
    const lc = lifecycleOf(t, now, today);
    if (lc.active === 'cleaning') {
      cleaningNow += 1;
      firsts.cleaning ??= t;
    }
    // 'in' = monitored home awaiting a cleaner; 'clean' = lockless home that
    // needs cleaning. Both are "awaiting a clean" for the header tally.
    else if (lc.active === 'in' || lc.active === 'clean') {
      awaitingCleaner += 1;
      firsts.awaiting ??= t;
    }
    // The inspected stage splits: an inspection genuinely underway vs cleaned
    // and waiting for one to start.
    else if (lc.active === 'inspected') {
      if (lc.inspecting) {
        inspectingNow += 1;
        firsts.inspecting ??= t;
      } else {
        needsInspection += 1;
        firsts.needsInspection ??= t;
      }
    }
  }
  return { counts: { cleaningNow, awaitingCleaner, needsInspection, inspectingNow }, firsts };
}

/** "Jul 19" for the calendar-window caption next to the section title. */
function fmtCalDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/** The day divider's eyebrow text: "Today", or "Tue · Jul 8". */
function dividerLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  const d = new Date(`${date}T00:00:00`);
  const dow = d.toLocaleDateString('en-US', { weekday: 'short' });
  const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${dow} · ${md}`;
}

function TurnoverList({
  turnovers,
  myEmail,
  grouped,
}: {
  turnovers: Turnover[];
  myEmail: string;
  /** Multi-day ranges group rows under editorial day dividers; the Today
   *  range stays a flat list (one divider for one date is just noise). */
  grouped: boolean;
}) {
  // In-flight first among pending (a cleaner physically in the house floats
  // up), then the server's chronological order; done turnovers sink to the
  // bottom, dimmed. Every line is the same dense CompactTurnoverRow — tap any
  // one to expand its full lifecycle rail + secondary affordances in place.
  // Rank is computed ONCE per row (flightRank reads the clock internally, so
  // re-calling it during the sort and again during the partition could flip a
  // row across a stage boundary mid-render and land it in both groups).
  const ranked = turnovers
    .filter((t) => !isTurnoverDone(t))
    .map((t) => ({ t, rank: flightRank(t) }))
    .sort((a, b) => a.rank - b.rank);
  const pending = ranked.map((x) => x.t);
  const done = turnovers.filter((t) => isTurnoverDone(t));

  if (!grouped) {
    return (
      <div style={{ borderTop: '1px solid var(--ink)' }}>
        {pending.map((t) => (
          <CompactTurnoverRow key={`${t.propertyId}-${t.reservationId}`} t={t} myEmail={myEmail} />
        ))}
        {done.map((t) => (
          <CompactTurnoverRow key={`${t.propertyId}-${t.reservationId}`} t={t} myEmail={myEmail} />
        ))}
      </div>
    );
  }

  // Datebook layout for multi-day ranges: anything live (a cleaner in the
  // house, or due-and-awaiting) stays in a single "In motion" band up top —
  // that's today's action regardless of printed date — and everything else
  // groups under a day divider. Rows under a divider drop their repeated
  // check-in date (the divider already says it), keeping just the mono
  // "→ checkout · nights" trailer. Done rows sink to the bottom as before,
  // dates intact since they sit outside the day groups.
  const inMotion = ranked.filter((x) => x.rank < 2).map((x) => x.t);
  const upcoming = ranked.filter((x) => x.rank >= 2).map((x) => x.t);
  const groups: { date: string; rows: Turnover[] }[] = [];
  for (const t of upcoming) {
    const d = t.checkIn.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.date === d) last.rows.push(t);
    else groups.push({ date: d, rows: [t] });
  }
  const today = todayStr();

  return (
    <div style={{ borderTop: '1px solid var(--ink)' }}>
      {inMotion.length > 0 && (
        <>
          <DayDivider label="In motion" accent />
          {inMotion.map((t) => (
            <CompactTurnoverRow key={`${t.propertyId}-${t.reservationId}`} t={t} myEmail={myEmail} />
          ))}
        </>
      )}
      {groups.map((g) => (
        <div key={g.date}>
          <DayDivider label={dividerLabel(g.date, today)} accent={g.date === today} />
          {g.rows.map((t) => (
            <CompactTurnoverRow
              key={`${t.propertyId}-${t.reservationId}`}
              t={t}
              myEmail={myEmail}
              hideDate
            />
          ))}
        </div>
      ))}
      {done.map((t) => (
        <CompactTurnoverRow key={`${t.propertyId}-${t.reservationId}`} t={t} myEmail={myEmail} />
      ))}
    </div>
  );
}

/** Editorial day divider for the datebook list: a small letterspaced eyebrow
 *  ("TUE · JUL 8", or "TODAY" / "IN MOTION" in signal) above its rows. */
function DayDivider({ label, accent = false }: { label: string; accent?: boolean }) {
  return (
    <div
      style={{
        padding: '16px 6px 6px',
        fontSize: 9,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        fontWeight: 600,
        color: accent ? 'var(--signal)' : 'var(--ink-4)',
      }}
    >
      {label}
    </div>
  );
}

// One entry in the live stage strip: a rail-style pip, a tabular count, a
// label. The pip reuses the micro-rail's exact visual grammar (identity hue;
// ring = in motion, solid = done) so the strip doubles as the rail legend.
// With a target, the whole entry is a plain <a> to that row's anchor (native
// fragment scroll — Next's Link suppresses it, see the header comment).
function StageCount({
  hue,
  done = false,
  label,
  n,
  target,
}: {
  hue: string;
  done?: boolean;
  label: string;
  n: number;
  target: Turnover | null;
}) {
  const pip = done ? (
    <span
      aria-hidden
      style={{ width: 9, height: 9, borderRadius: '50%', background: hue, flex: '0 0 auto' }}
    />
  ) : (
    <span
      aria-hidden
      style={{
        width: 11,
        height: 11,
        borderRadius: '50%',
        background: 'var(--paper)',
        border: `2.5px solid ${hue}`,
        boxSizing: 'border-box',
        flex: '0 0 auto',
      }}
    />
  );
  const inner = (
    <>
      {pip}
      <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 600, color: 'var(--ink)' }}>{n}</span>
      <span style={{ color: 'var(--ink-3)' }}>{label}</span>
    </>
  );
  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    whiteSpace: 'nowrap',
    textDecoration: 'none',
  } as const;
  if (target) {
    return (
      <a
        href={`#turnover-${target.propertyId}-${target.reservationId}`}
        style={style}
        title={`Jump to ${target.propertyName}`}
      >
        {inner}
      </a>
    );
  }
  return <span style={style}>{inner}</span>;
}

