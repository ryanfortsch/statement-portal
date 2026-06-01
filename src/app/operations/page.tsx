import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { OccupancyCalendar } from '@/components/OccupancyCalendar';
import { auth } from '@/auth';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import { channelAccent, channelLabel } from '@/lib/channel-style';
import { startInspection } from '../inspections/actions';
import { AutoRefresh } from '../revenue/AutoRefresh';
import { PlanButton } from './PlanButton';
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
  const initialFooter = lastSyncedAt
    ? `Synced ${formatRelative(lastSyncedAt)}`
    : 'Not synced yet';

  const inspectionsLeft = data.totalCount - data.inspectionDoneCount;

  // Where "N inspections pending" should jump to when tapped:
  //   - exactly 1 pending AND it has an inspection row already (the operator
  //     started but didn't finish): resume URL straight into the runner.
  //   - otherwise: anchor link to the first pending turnover's card, so the
  //     operator lands next to its START INSPECTION button.
  // Starting an inspection fresh requires a server-action form submission
  // (the existing button on the row), which a plain <Link> can't do, so
  // the anchor path keeps the click on a real CTA instead of doing it for
  // the operator without confirmation.
  const pendingTurnovers = data.turnovers.filter((t) => t.inspectionStatus !== 'complete');
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
 * Top N turnover cards render up front; the rest collapse under a native
 * <details> expander so the pipeline doesn't read as an endless scroll
 * once we onboard more properties. The component is server-rendered so
 * we use the no-JS <details>/<summary> primitive rather than the client
 * useState pattern over on /work.
 */
const TURNOVER_INITIAL_LIMIT = 5;

function TurnoverList({ turnovers, myEmail }: { turnovers: Turnover[]; myEmail: string }) {
  const visible = turnovers.slice(0, TURNOVER_INITIAL_LIMIT);
  const rest = turnovers.slice(TURNOVER_INITIAL_LIMIT);
  return (
    <div style={{ borderTop: '1px solid var(--ink)' }}>
      {visible.map((t) => (
        <TurnoverRow key={`${t.propertyId}-${t.reservationId}`} turnover={t} myEmail={myEmail} />
      ))}
      {rest.length > 0 && (
        <details className="rt-turnover-expander">
          <summary
            style={{
              listStyle: 'none',
              cursor: 'pointer',
              borderBottom: '1px solid var(--rule)',
              padding: '14px 0',
              fontSize: 11,
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              fontWeight: 500,
              color: 'var(--ink-3)',
            }}
          >
            ↓ Show {rest.length} more turnover{rest.length === 1 ? '' : 's'}
          </summary>
          {rest.map((t) => (
            <TurnoverRow key={`${t.propertyId}-${t.reservationId}`} turnover={t} myEmail={myEmail} />
          ))}
        </details>
      )}
    </div>
  );
}

function TurnoverRow({ turnover: t, myEmail }: { turnover: Turnover; myEmail: string }) {
  const checkIn = formatDateLong(t.checkIn);
  const checkOut = formatDateShort(t.checkOut);
  const inspectionDone = t.inspectionStatus === 'complete';

  // Cleaning chip: show "Cleaned" once we have a Quo signal for the
  // (property, previousCheckout) pair. If previousCheckout is past and
  // we have no signal, surface "Awaiting cleaner" so the operator
  // notices a stale prep window. Suppressed entirely when
  // previousCheckout is null or in the future (cleaning isn't due yet).
  const today = new Date().toISOString().slice(0, 10);
  const cleaningExpected = t.previousCheckout !== null && t.previousCheckout <= today;
  const cleaningDone = t.cleaning !== null;
  const cleaningRelative = t.cleaning ? formatRelativeShort(t.cleaning.completedAt) : null;

  // Gap context: for non-same-day turnovers with a known previousCheckout,
  // surface how long the property has been sitting since the last guest.
  // Answers "is this a tight turn or has it been clean for a week?" at a
  // glance. Same-day cases use the existing "Tight turnaround" banner.
  const gapDays =
    !t.isSameDayTurnover && t.previousCheckout
      ? Math.max(
          0,
          Math.floor(
            (Date.parse(`${t.checkIn.slice(0, 10)}T00:00:00`) -
              Date.parse(`${t.previousCheckout}T00:00:00`)) /
              86_400_000,
          ),
        )
      : null;

  return (
    <div
      id={`turnover-${t.propertyId}-${t.reservationId}`}
      className="rt-turnover-row"
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr auto auto',
        gap: 20,
        alignItems: 'baseline',
        padding: '14px 0',
        borderBottom: '1px solid var(--rule)',
        // When the "N inspections pending" eyebrow scrolls to this row via
        // a #turnover-... anchor, leave breathing room so the row doesn't
        // land flush against the masthead.
        scrollMarginTop: 96,
      }}
    >
      {/* Date column. Top: check-in (the date the row is about). Middle:
          check-out + nights. Bottom: when the previous guest left (only
          when there's a non-zero gap). Stays in the fixed 160px column so
          it never wraps under right-side button pressure. */}
      <div className="rt-turnover-date">
        <div className="font-serif" style={{ fontSize: 16, fontWeight: 400, color: 'var(--ink)', lineHeight: 1.2 }}>
          {checkIn}
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.04em' }}>
          → {checkOut}
          {t.nights ? ` · ${t.nights} nt${t.nights === 1 ? '' : 's'}` : ''}
        </div>
        {!t.isSameDayTurnover && gapDays != null && gapDays >= 1 && t.previousCheckout && (
          <div
            style={{ marginTop: 2, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.04em' }}
            title={`Last guest checked out ${t.previousCheckout} · ${gapDays}-day gap`}
          >
            clear since {formatDateShort(t.previousCheckout)}
          </div>
        )}
      </div>

      {/* Property + guest column. Reserve a real minimum width so the
          property name + guest line never wrap onto five lines when the
          right side stacks Plan + Start Inspection buttons. Excess
          pressure pushes the chip cluster to wrap (it already flex-wraps)
          rather than the typography. */}
      <div className="rt-turnover-property" style={{ minWidth: 220 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            className="font-serif"
            style={{
              fontSize: 18,
              fontWeight: 400,
              color: 'var(--ink)',
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
            }}
          >
            {t.propertyName}
          </span>
          {t.isSameDayTurnover && (
            <span
              style={{
                fontSize: 9,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                fontWeight: 600,
                color: 'var(--paper)',
                background: 'var(--signal)',
                padding: '2px 7px',
                borderRadius: 2,
              }}
            >
              Same-Day
            </span>
          )}
        </div>
        {/* Guest + channel. Gap context lives in the fixed-width date
            column on the left so it never wraps under narrow conditions. */}
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            color: 'var(--ink-3)',
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={`${t.guestName || 'Unnamed guest'}${t.channel ? ` · ${t.channel}` : ''}`}
        >
          {t.guestName || 'Unnamed guest'}
          {t.channel && (
            <>
              <span style={{ color: 'var(--ink-4)' }}> · </span>
              <span
                aria-hidden
                style={{
                  display: 'inline-block',
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  background: channelAccent(t.channel),
                  marginRight: 5,
                  verticalAlign: 'baseline',
                }}
              />
              <span style={{ color: 'var(--ink-3)' }}>{channelLabel(t.channel)}</span>
            </>
          )}
        </div>
        {/* Same-day turnover keeps its loud signal banner — it's a real
            urgency signal worth its own line. Non-same-day gap context
            lives inline (above) so it never adds row height. */}
        {t.isSameDayTurnover && (
          <div
            className="rt-turnover-prev rt-turnover-prev-sameday"
            style={{
              marginTop: 2,
              fontSize: 11,
              color: 'var(--signal)',
              fontWeight: 500,
            }}
          >
            Tight turnaround · previous guest checks out today
          </div>
        )}
      </div>

      {/* Status: cleaning + inspection collapse to a single dim line of
          sentence-case text with color-coded labels per step. Work-slip
          count rides as a quiet link on a second line when present. The
          previous version stacked 3 uppercase letter-spaced 600-weight
          pills per row, which read as a wall of shouting status. */}
      <div
        className="rt-turnover-chips"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          justifyContent: 'flex-start',
          gap: 4,
          whiteSpace: 'nowrap',
          fontSize: 12,
          color: 'var(--ink-4)',
        }}
      >
        <div>
          {cleaningExpected && (
            <>
              <span
                style={{ color: cleaningDone ? 'var(--positive)' : 'var(--signal)' }}
                title={
                  t.cleaning
                    ? `Quo: cleaner finished ${cleaningRelative} ago${t.cleaning.sourcePhone ? ` (${t.cleaning.sourcePhone})` : ''}`
                    : 'No cleaner-completion text received via Quo for this turnover'
                }
              >
                {cleaningDone ? `Cleaned ${cleaningRelative}` : 'Awaiting cleaner'}
              </span>
              <span style={{ color: 'var(--ink-4)' }}>{' · '}</span>
            </>
          )}
          <span style={{ color: inspectionDone ? 'var(--positive)' : 'var(--signal)' }}>
            {inspectionDone ? 'Inspected' : 'Not inspected'}
          </span>
        </div>
        {t.lockBattery && t.lockBattery.isLow && (
          <span
            title={`Smart lock battery is ${
              t.lockBattery.pct != null ? `${t.lockBattery.pct}%` : t.lockBattery.status
            }. Pack replacement batteries for this turnover.`}
            style={{ color: 'var(--signal)', fontWeight: 600 }}
          >
            Lock battery {t.lockBattery.pct != null ? `${t.lockBattery.pct}%` : 'low'} · bring batteries
          </span>
        )}
        {t.openWorkSlipsCount > 0 && (
          <Link
            href={`/properties/${t.propertyId}/work-slips/print`}
            title={`View + print the ${t.openWorkSlipsCount} open work ${t.openWorkSlipsCount === 1 ? 'slip' : 'slips'} on this property`}
            style={{ fontSize: 11, color: 'var(--tide-deep)', textDecoration: 'none' }}
          >
            {t.openWorkSlipsCount} {t.openWorkSlipsCount === 1 ? 'slip' : 'slips'} · print →
          </Link>
        )}
      </div>

      {/* Action — done shows Summary; in-progress shows Resume; otherwise
          stack a plan-button + start-inspection CTA so the operator can
          schedule a walk in advance OR kick one off right now. */}
      {inspectionDone && t.inspection ? (
        <Link
          href={`/inspections/${t.inspection.id}/summary`}
          className="rt-turnover-action"
          style={{
            fontSize: 12,
            color: 'var(--ink-3)',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Summary →
        </Link>
      ) : t.inspection ? (
        <Link
          href={`/inspections/${t.inspection.id}`}
          className="rt-turnover-action"
          style={{
            fontSize: 12,
            color: 'var(--ink)',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            fontWeight: 500,
          }}
        >
          Resume →
        </Link>
      ) : (
        // Plan + Start Inspection side-by-side (was stacked vertically),
        // so this action column matches the height of a Summary/Resume
        // row. Keeps the right edge of every row at roughly the same
        // visual position across rows.
        <div className="rt-turnover-action" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <PlanButton
            guestyReservationId={t.reservationId}
            propertyId={t.propertyId}
            checkInDate={t.checkIn.slice(0, 10)}
            checkOutDate={t.checkOut.slice(0, 10)}
            planId={t.plan?.id ?? null}
            plannedForDate={t.plan?.planned_for_date ?? null}
            plannedBy={t.plan?.planned_by_email ?? null}
            assignedToEmail={t.plan?.assigned_to_email ?? null}
            myEmail={myEmail}
          />
          <form action={startInspection} style={{ margin: 0 }}>
            <input type="hidden" name="property_id" value={t.propertyId} />
            <button
              type="submit"
              style={{
                background: 'var(--ink)',
                color: 'var(--paper)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                padding: '9px 16px',
                border: 'none',
                cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
              Start Inspection
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function formatRelativeShort(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

function formatDateLong(value: string): string {
  if (!value) return '—';
  try {
    const d = new Date(`${value.slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return value;
  }
}

function formatDateShort(value: string): string {
  if (!value) return '—';
  try {
    const d = new Date(`${value.slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return value;
  }
}
