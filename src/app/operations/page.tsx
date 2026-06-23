import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { OccupancyCalendar } from '@/components/OccupancyCalendar';
import { auth } from '@/auth';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import { AutoRefresh } from '../revenue/AutoRefresh';
import { CompactTurnoverRow } from './CompactTurnoverRow';
import { lifecycleOf } from './turnover-format';
import { loadPacketStatusByBooking } from '@/lib/field-packets';
import {
  loadOperationsData,
  RANGE_LABEL,
  VALID_RANGES,
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
  searchParams: Promise<{ range?: string; cal?: string; property?: string }>;
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

  const propertyFilter = params?.property?.trim() || undefined;

  if (!isHelmConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead current="operations" />
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
    loadOperationsData(range, calRange, propertyFilter),
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
      if (ps) t.fieldPacket = { packetId: ps.packetId, status: ps.status, contractorName: ps.contractorName };
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
  const { cleaningNow, awaitingCleaner, needsInspection } = computeStageCounts(pendingTurnovers);
  const doneCount = data.totalCount - inspectionsLeft;
  const hasLiveStages = cleaningNow + awaitingCleaner + needsInspection > 0;

  // Where "N inspections pending" should jump to when tapped:
  //   - exactly 1 pending AND it has an inspection row already (the operator
  //     started but didn't finish): resume URL straight into the runner.
  //   - otherwise: anchor link to the first pending turnover's card, so the
  //     operator lands next to its START INSPECTION button.
  // Starting an inspection fresh requires a server-action form submission
  // (the existing button on the row), which a plain <Link> can't do, so
  // the anchor path keeps the click on a real CTA instead of doing it for
  // the operator without confirmation.
  let pendingHref: string | null = null;
  if (pendingTurnovers.length === 1 && pendingTurnovers[0].inspection?.id) {
    pendingHref = `/inspections/${pendingTurnovers[0].inspection.id}`;
  } else if (pendingTurnovers.length > 0) {
    const t = pendingTurnovers[0];
    pendingHref = `#turnover-${t.propertyId}-${t.reservationId}`;
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="operations" />

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
              href={`/operations?range=${range}&cal=${calRange}`}
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
          <div className="font-serif" style={{ fontSize: 22, fontWeight: 400, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            {data.totalCount === 0 ? (
              <>No check-ins {range === 'today' ? 'today' : `in the next ${RANGE_LABEL[range].toLowerCase()}`}.</>
            ) : (
              <>
                <strong style={{ color: 'var(--ink)' }}>{data.totalCount}</strong>{' '}
                check-in{data.totalCount === 1 ? '' : 's'}
                {range === 'today' ? ' today' : ` · next ${RANGE_LABEL[range].toLowerCase()}`}
                {inspectionsLeft > 0 ? (
                  pendingHref ? (
                    // For real route navigation (/inspections/{id} resume URL)
                    // we want Next's Link with prefetch + client routing. For
                    // a same-page hash anchor we use a plain <a> instead: the
                    // App Router's Link intercepts the click and (in some
                    // configurations) suppresses the browser's native
                    // fragment-scroll, leaving "1 inspection pending" looking
                    // like a dead link. A regular <a href="#..."> just lets
                    // the browser do the scroll natively, which is what we
                    // want here.
                    pendingHref.startsWith('#') ? (
                      <a
                        href={pendingHref}
                        style={{
                          color: 'var(--signal)',
                          fontSize: 14,
                          marginLeft: 12,
                          textDecoration: 'none',
                          borderBottom: '1px dashed currentColor',
                        }}
                        title="Jump to the first turnover that still needs an inspection"
                      >
                        · {inspectionsLeft} inspection{inspectionsLeft === 1 ? '' : 's'} pending →
                      </a>
                    ) : (
                      <Link
                        href={pendingHref}
                        style={{
                          color: 'var(--signal)',
                          fontSize: 14,
                          marginLeft: 12,
                          textDecoration: 'none',
                          borderBottom: '1px dashed currentColor',
                        }}
                        title="Resume the inspection in progress"
                      >
                        · {inspectionsLeft} inspection{inspectionsLeft === 1 ? '' : 's'} pending →
                      </Link>
                    )
                  ) : (
                    <span style={{ color: 'var(--signal)', fontSize: 14, marginLeft: 12 }}>
                      · {inspectionsLeft} inspection{inspectionsLeft === 1 ? '' : 's'} pending
                    </span>
                  )
                ) : (
                  <span style={{ color: 'var(--positive)', fontSize: 14, marginLeft: 12 }}>
                    · all prepped
                  </span>
                )}
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
                  href={`/operations?range=${r}&cal=${calRange}`}
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
            {cleaningNow > 0 && <StageCount dot="#b08a2e" label="cleaning now" n={cleaningNow} />}
            {awaitingCleaner > 0 && <StageCount dot="var(--signal)" label="awaiting cleaner" n={awaitingCleaner} />}
            {needsInspection > 0 && <StageCount dot="var(--tide-deep)" label="clean · needs inspection" n={needsInspection} />}
            {doneCount > 0 && <StageCount dot="var(--positive)" label="done" n={doneCount} />}
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
          <TurnoverList turnovers={data.turnovers} myEmail={myEmail} />
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
          </h2>
          <nav className="flex items-baseline gap-4" style={{
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            fontWeight: 500,
          }}>
            {VALID_CALENDAR_RANGES.map((cr) => {
              const active = cr === calRange;
              return (
                <Link
                  key={cr}
                  href={`/operations?range=${range}&cal=${cr}`}
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

// Tally the active stage of each pending turnover for the header strip. The
// clock read (Date.now) lives here, not in the component body, so the page
// component stays pure under react-hooks/purity (same reason flightRank and
// formatRelative wrap their date reads).
function computeStageCounts(pending: Turnover[]): {
  cleaningNow: number;
  awaitingCleaner: number;
  needsInspection: number;
} {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  let cleaningNow = 0;
  let awaitingCleaner = 0;
  let needsInspection = 0;
  for (const t of pending) {
    const lc = lifecycleOf(t, now, today);
    if (lc.active === 'cleaning') cleaningNow += 1;
    // 'in' = monitored home awaiting a cleaner; 'clean' = lockless home that
    // needs cleaning. Both are "awaiting a clean" for the header tally.
    else if (lc.active === 'in' || lc.active === 'clean') awaitingCleaner += 1;
    else if (lc.active === 'inspected') needsInspection += 1;
  }
  return { cleaningNow, awaitingCleaner, needsInspection };
}

function TurnoverList({ turnovers, myEmail }: { turnovers: Turnover[]; myEmail: string }) {
  // In-flight first among pending (a cleaner physically in the house floats
  // up), then the server's chronological order; done turnovers sink to the
  // bottom, dimmed. Every line is the same dense CompactTurnoverRow — tap any
  // one to expand its full lifecycle rail + secondary affordances in place.
  const pending = turnovers
    .filter((t) => !isTurnoverDone(t))
    .sort((a, b) => flightRank(a) - flightRank(b));
  const done = turnovers.filter((t) => isTurnoverDone(t));
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

// One entry in the live stage strip: a colored dot, a tabular count, a label.
function StageCount({ dot, label, n }: { dot: string; label: string; n: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flex: '0 0 auto' }} />
      <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 600, color: 'var(--ink)' }}>{n}</span>
      <span style={{ color: 'var(--ink-3)' }}>{label}</span>
    </span>
  );
}

