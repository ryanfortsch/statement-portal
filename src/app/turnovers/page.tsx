import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { TurnoverTabs } from '@/components/TurnoverTabs';
import { auth } from '@/auth';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import { isCapeAnnOps } from '@/lib/property-scope';
import { AutoRefresh } from '../revenue/AutoRefresh';
import { SubmitButton } from '@/components/SubmitButton';
import { startInspection } from '../inspections/actions';
import { PropertyFilterSelect } from './PropertyFilterSelect';
import { BoardLine } from './BoardLine';
import { operatingDate } from '@/lib/operating-date';
import { loadPacketStatusByBooking } from '@/lib/field-packets';
import { loadCleaningSchedule } from '@/lib/cleaning-schedule';
import type { CleaningDay } from '@/lib/cleaning-days';
import { displayNameForEmail } from '@/lib/team';
import { composeBoard, type Board, type BoardCount, type BoardRow, type BoardStateKey } from '@/lib/turnover-board';
import {
  loadOperationsData,
  RANGE_DAYS,
  RANGE_LABEL,
  VALID_RANGES,
  type OperationsData,
  type Range,
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

// Out-of-region homes (properties.region != cape_ann) stay out of the filter
// options, exactly as they stay out of the pipeline. The gate is
// the registry column, read through lib/property-scope.ts, not a literal set.

/** Options for the header's property filter. Queried directly (not derived
 *  from the operations rows) because loadOperationsData narrows its
 *  property list to the active filter, which would leave the select with
 *  only the property already chosen. */
async function readPropertyOptions(): Promise<{ value: string; label: string }[]> {
  try {
    const { data } = await supabase
      .from('properties')
      .select('id, name, region')
      .eq('is_active', true)
      .order('name');
    return ((data ?? []) as { id: string; name: string; region: string | null }[])
      .filter(isCapeAnnOps)
      .map((p) => ({ value: p.id, label: p.name }));
  } catch {
    return [];
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

/** The crew's schedule for every day of the range, narrowed to the filtered
 *  home. Null when it cannot be read: the rows then carry no cleaner verdict
 *  and the page says so in one line, rather than implying nobody is booked. */
async function readCleaningDays(days: number, propertyId: string | undefined): Promise<CleaningDay[] | null> {
  try {
    const sched = await loadCleaningSchedule(supabase, { days });
    if (sched.scheduleError) return null;
    if (!propertyId) return sched.days;
    return sched.days.map((d) => ({
      ...d,
      items: d.items.filter((i) => i.propertyId === propertyId),
      skipped: d.skipped.filter((s) => s.propertyId === propertyId),
    }));
  } catch {
    return null;
  }
}

/** The board, from one clock read: every row and the strip see the same
 *  Eastern today and the same now. */
function buildBoard(data: OperationsData, cleaningDays: CleaningDay[] | null): Board {
  return composeBoard({
    turnovers: data.turnovers,
    cleaningDays,
    departureSignals: data.departureSignals,
    today: operatingDate(),
    rangeEnd: data.rangeEnd,
    nowMs: Date.now(),
    nameFor: displayNameForEmail,
  });
}

/** "today", "today or tomorrow", "in the next 7 days". */
function rangePhrase(range: Range): string {
  if (range === 'today') return 'today';
  if (range === '2d') return 'today or tomorrow';
  return `in the next ${RANGE_LABEL[range].toLowerCase()}`;
}

type PageProps = {
  searchParams: Promise<{
    range?: string;
    property?: string;
  }>;
};

export default async function TurnoversPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params?.range;
  const range: Range =
    rangeParam && (VALID_RANGES as string[]).includes(rangeParam)
      ? (rangeParam as Range)
      : '2d';

  const propertyFilter = params?.property?.trim() || undefined;

  // Canonical URL for this page's own links: every control preserves the
  // other control's state (list range, property filter) instead of
  // silently resetting it. The occupancy calendar, with its own range,
  // paging and month params, lives on the home page now.
  const opsHref = (over: {
    range?: Range;
    property?: string | null;
  }): string => {
    const q = new URLSearchParams();
    q.set('range', over.range ?? range);
    const prop = over.property !== undefined ? over.property : propertyFilter ?? null;
    if (prop) q.set('property', prop);
    return `/turnovers?${q.toString()}`;
  };

  if (!isHelmConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead />
        <TurnoverTabs current="pipeline" />
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56 }}>
          <div className="eyebrow">Turnovers</div>
          <p style={{ marginTop: 14, color: 'var(--ink-3)' }}>
            Ask Ryan: this page is not set up.
          </p>
        </section>
      </div>
    );
  }

  const [{ lastSyncedAt, isStale }, data, session, filterPropertyName, propertyOptions, cleaningDays] = await Promise.all([
    readSyncStatus(),
    loadOperationsData(range, '7d', propertyFilter, 0, undefined, { departures: true }),
    auth(),
    propertyFilter ? readPropertyName(propertyFilter) : Promise.resolve<string | null>(null),
    readPropertyOptions(),
    readCleaningDays(RANGE_DAYS[range] + 1, propertyFilter),
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

  const board = buildBoard(data, cleaningDays);
  const pending = board.days.reduce((n, d) => n + d.rows.length, 0);
  // The headline jumps to the first open row: the one at the top of the list.
  const firstOpen = board.days[0]?.rows[0] ?? null;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <TurnoverTabs current="pipeline" />

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
              ("3 turnovers pending" in 30px serif) and the total becomes
              the small qualifier — the old layout set the decoration big
              ("7 check-ins") and the work small. */}
          <div className="font-serif" style={{ fontSize: 22, fontWeight: 400, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            {board.total === 0 ? (
              <>No turnovers {rangePhrase(range)}.</>
            ) : pending > 0 ? (
              <>
                {/* A plain <a> for the same-page anchor: Next's Link can
                    suppress the browser's native fragment scroll. */}
                <a
                  href={firstOpen ? `#${firstOpen.id}` : undefined}
                  style={{ color: 'var(--ink)', textDecoration: 'none', borderBottom: '1px dashed var(--signal)', paddingBottom: 2 }}
                >
                  <strong style={{ fontSize: 30, fontWeight: 500, color: 'var(--ink)' }}>{pending}</strong>{' '}
                  turnover{pending === 1 ? '' : 's'} open
                </a>
                <span style={{ fontSize: 14, color: 'var(--ink-3)', marginLeft: 12 }}>
                  of {board.total} {rangePhrase(range)}
                </span>
              </>
            ) : (
              <>
                <span style={{ fontSize: 30, fontWeight: 500, color: 'var(--positive)' }}>All done</span>
                <span style={{ fontSize: 14, color: 'var(--ink-3)', marginLeft: 12 }}>
                  {board.total} turnover{board.total === 1 ? '' : 's'} {rangePhrase(range)}
                </span>
              </>
            )}
          </div>
          <nav
            className="flex items-baseline flex-wrap"
            style={{
              gap: '10px 16px',
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
            <span aria-hidden style={{ color: 'var(--rule)', fontSize: 12 }}>|</span>
            {/* Property filter: ?property= always worked, but the only way in
                was a handoff link from another page. This gives the filter a
                visible home in the controls row; opsHref keeps the rest of
                the URL state intact. */}
            <PropertyFilterSelect
              properties={propertyOptions}
              value={propertyFilter ?? ''}
              propertyHrefTemplate={opsHref({ property: '__P__' })}
              clearHref={opsHref({ property: null })}
            />
          </nav>
        </div>

        {/* The strip: how many rows show each state that wants a human,
            in the rows' own words (lib/turnover-board.ts), each a jump to
            the first row showing it. Quiet when nothing does. */}
        {board.counts.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 20px', padding: '11px 0 0', fontSize: 12 }}>
            {board.counts.map((c) => (
              <StateCount key={c.key} count={c} />
            ))}
          </div>
        )}
        {cleaningDays === null && (
          <div style={{ paddingTop: 10, fontSize: 12, color: 'var(--signal)' }}>
            Cape Ann Elite&rsquo;s bookings could not be read, so the rows show no cleaner.
          </div>
        )}

        <div
          className="flex items-center justify-end"
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
          {/* The two header links that sat here are gone: a walk with no
              check-in behind it starts from "Walk a home now" at the foot of
              the list, and Field has its own masthead tab. */}
          <AutoRefresh shouldRefresh={isStale} initialLabel={initialFooter} />
        </div>
      </section>

      {/* TURNOVER LIST */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, width: '100%' }}>
        {board.total === 0 ? (
          <div style={{ borderTop: '1px solid var(--ink)', padding: '24px 0', fontSize: 13, color: 'var(--ink-4)' }}>
            Pick a wider range to see what is coming.
          </div>
        ) : (
          <TurnoverList board={board} myEmail={myEmail} />
        )}
        <WalkHomeNow properties={propertyOptions} />
      </section>

      {/* The occupancy calendar has its own Turnovers page, so the rail
          reads alone here and the home page stays the person's day. */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <Link
          href="/turnovers/calendar"
          style={{ fontSize: 12, color: 'var(--ink-3)', textDecoration: 'underline', textUnderlineOffset: 3 }}
        >
          Occupancy calendar →
        </Link>
      </section>

      <HelmFooter module="Turnovers" right="Source: Guesty + Helm walks" />
    </div>
  );
}

/** The day divider's eyebrow text: "Today", "Tomorrow", or "Tue · Oct 20". */
function dividerLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  const d = new Date(`${date}T12:00:00Z`);
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (date === tomorrow.toISOString().slice(0, 10)) return 'Tomorrow';
  const dow = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${dow} · ${md}`;
}

/**
 * The board: open rows under a divider per day, in the order each day
 * happens; walked and ready rows folded under Done at the end, still
 * openable (Undo lives inside). One row component for all of them.
 */
function TurnoverList({ board, myEmail }: { board: Board; myEmail: string }) {
  return (
    <div style={{ borderTop: '1px solid var(--ink)' }}>
      {board.days.map((d) => (
        <div key={d.date}>
          <DayDivider label={dividerLabel(d.date, board.today)} accent={d.date === board.today} />
          {d.rows.map((r) => (
            <BoardLine key={r.id} row={r} today={board.today} myEmail={myEmail} />
          ))}
        </div>
      ))}
      <ReadyTurnovers rows={board.done} today={board.today} myEmail={myEmail} />
    </div>
  );
}

function ReadyTurnovers({ rows, today, myEmail }: { rows: BoardRow[]; today: string; myEmail: string }) {
  if (!rows.length) return null;
  // "Done" is the row's own word for this state, so the fold says the same.
  return (
    <details style={{ marginTop: 18 }}>
      <summary style={{ cursor: 'pointer', minHeight: 44, padding: '12px 0', fontSize: 13, color: 'var(--ink-3)' }}>
        Done · {rows.length}
      </summary>
      {rows.map((r) => (
        <BoardLine key={r.id} row={r} today={today} myEmail={myEmail} />
      ))}
    </details>
  );
}

/**
 * An ad-hoc walk with no check-in behind it (a re-inspection, a look at an
 * empty home). Sits under the list, where the eye lands after the rows,
 * instead of a second Start in the header; the same startInspection the
 * rows post to.
 */
function WalkHomeNow({ properties }: { properties: { value: string; label: string }[] }) {
  if (properties.length === 0) return null;
  return (
    <form
      action={startInspection}
      className="flex items-center gap-3 flex-wrap"
      style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid var(--rule)' }}
    >
      <label htmlFor="walk-home-now" className="eyebrow">Walk a home now</label>
      <select
        id="walk-home-now"
        name="property_id"
        required
        defaultValue=""
        style={{
          font: 'inherit',
          fontSize: 13,
          color: 'var(--ink)',
          background: 'transparent',
          border: '1px solid var(--rule)',
          padding: '8px 32px 8px 12px',
          minHeight: 40,
          minWidth: 220,
          outline: 'none',
          cursor: 'pointer',
          appearance: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%23506068' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 10px center',
          backgroundSize: '16px',
        }}
      >
        <option value="" disabled>Choose a home…</option>
        {properties.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>
      <SubmitButton label="Start" busyLabel="Starting…" className="rt-tn-start" />
    </form>
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

const STATE_HUE: Record<BoardStateKey, string> = {
  no_cleaner: 'var(--negative)',
  cleaner_late: 'var(--negative)',
  cleaner_early: 'var(--signal)',
  clean_unconfirmed: 'var(--signal)',
  cleaning_now: '#c0772f',
  walking: '#b8901a',
  needs_walk: 'var(--signal)',
};

/** One entry in the strip: a dot in the state's hue, the count, the row's
 *  own words, as a plain <a> to the first row showing it (native fragment
 *  scroll; Next's Link can suppress it). */
function StateCount({ count }: { count: BoardCount }) {
  return (
    <a
      href={`#${count.firstId}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', textDecoration: 'none', minHeight: 32 }}
    >
      <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: STATE_HUE[count.key], flex: '0 0 auto' }} />
      <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 600, color: 'var(--ink)' }}>{count.n}</span>
      <span style={{ color: 'var(--ink-3)' }}>{count.label}</span>
    </a>
  );
}
