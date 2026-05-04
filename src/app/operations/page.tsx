import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import { startInspection } from '../inspections/actions';
import { AutoRefresh } from '../revenue/AutoRefresh';
import {
  loadOperationsData,
  RANGE_LABEL,
  VALID_RANGES,
  type CalendarData,
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

function formatRelative(date: Date | null): string {
  if (!date) return 'never';
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)} hr ago`;
  return `${Math.round(diffSec / 86400)} d ago`;
}

type PageProps = {
  searchParams: Promise<{ range?: string }>;
};

export default async function OperationsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params?.range;
  const range: Range =
    rangeParam && (VALID_RANGES as string[]).includes(rangeParam)
      ? (rangeParam as Range)
      : 'today';

  if (!isHelmConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead current="operations" />
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56 }}>
          <div className="eyebrow">Operations</div>
          <p style={{ marginTop: 14, color: 'var(--ink-3)' }}>
            Configure Supabase env vars to load turnovers.
          </p>
        </section>
      </div>
    );
  }

  const { lastSyncedAt, isStale } = await readSyncStatus();
  const data = await loadOperationsData(range);
  const initialFooter = lastSyncedAt
    ? `Synced ${formatRelative(lastSyncedAt)}`
    : 'Not synced yet';

  const inspectionsLeft = data.totalCount - data.inspectionDoneCount;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="operations" />

      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Helm &middot; Operations</div>
        <h1
          className="font-serif"
          style={{
            fontSize: 44,
            lineHeight: 1.05,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            maxWidth: 720,
          }}
        >
          The <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>turnover pipeline.</em>
        </h1>
        <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.55, color: 'var(--ink-3)', maxWidth: 580 }}>
          Upcoming check-ins, prep status, and same-day turnovers. Live from Guesty, joined with Helm inspections.
        </p>
      </section>

      {/* RANGE TABS + SYNC STATUS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 18, width: '100%' }}>
        <div
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            padding: '14px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <nav className="flex items-baseline gap-5" style={{
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            fontWeight: 500,
          }}>
            {VALID_RANGES.map((r) => {
              const active = r === range;
              return (
                <Link
                  key={r}
                  href={`/operations?range=${r}`}
                  style={{
                    color: active ? 'var(--ink)' : 'var(--ink-3)',
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
          <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            <AutoRefresh shouldRefresh={isStale} initialLabel={initialFooter} />
          </span>
        </div>
      </section>

      {/* SUMMARY LINE */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 24, width: '100%' }}>
        <div
          className="font-serif"
          style={{ fontSize: 18, fontWeight: 400, color: 'var(--ink-2)', letterSpacing: '-0.01em' }}
        >
          {data.totalCount === 0 ? (
            <>No check-ins {range === 'today' ? 'today' : `in the next ${RANGE_LABEL[range].toLowerCase()}`}.</>
          ) : (
            <>
              <strong style={{ color: 'var(--ink)' }}>{data.totalCount}</strong> check-in
              {data.totalCount === 1 ? '' : 's'}
              {range === 'today' ? ' today' : ` in the next ${RANGE_LABEL[range].toLowerCase()}`}
              {inspectionsLeft > 0 ? (
                <>
                  {' · '}
                  <span style={{ color: 'var(--signal)' }}>
                    {inspectionsLeft} inspection{inspectionsLeft === 1 ? '' : 's'} pending
                  </span>
                </>
              ) : (
                <>
                  {' · '}
                  <span style={{ color: 'var(--positive)' }}>all prepped</span>
                </>
              )}
            </>
          )}
        </div>
      </section>

      {/* TURNOVER LIST */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, width: '100%' }}>
        {data.totalCount === 0 ? (
          <div style={{ borderTop: '1px solid var(--ink)', padding: '24px 0', fontSize: 13, color: 'var(--ink-4)' }}>
            Pick a wider range to see upcoming check-ins.
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {data.turnovers.map((t) => (
              <TurnoverRow key={`${t.propertyId}-${t.reservationId}`} turnover={t} />
            ))}
          </div>
        )}
      </section>

      {/* OCCUPANCY CALENDAR */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <h2 className="font-serif" style={{
            fontSize: 22,
            fontWeight: 400,
            letterSpacing: '-0.01em',
            color: 'var(--ink)',
            margin: 0,
          }}>
            On the calendar
          </h2>
          <span className="eyebrow">{data.calendar.days.length} day{data.calendar.days.length === 1 ? '' : 's'}</span>
        </div>
        <CalendarGrid calendar={data.calendar} />
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid var(--ink)' }}>
        <div
          className="max-w-[1100px] mx-auto px-10 flex items-center justify-between"
          style={{
            padding: '14px 40px',
            fontSize: 10,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-4)',
          }}
        >
          <span>Rising Tide &middot; Operations</span>
          <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontSize: 11 }}>
            Source: Guesty + Helm inspections
          </span>
        </div>
      </footer>
    </div>
  );
}

function TurnoverRow({ turnover: t }: { turnover: Turnover }) {
  const checkIn = formatDateLong(t.checkIn);
  const checkOut = formatDateShort(t.checkOut);
  const inspectionDone = t.inspectionStatus === 'complete';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '180px 1fr auto auto',
        gap: 24,
        alignItems: 'baseline',
        padding: '20px 0',
        borderBottom: '1px solid var(--rule)',
      }}
    >
      {/* Date column */}
      <div>
        <div className="font-serif" style={{ fontSize: 16, fontWeight: 400, color: 'var(--ink)', lineHeight: 1.2 }}>
          {checkIn}
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.04em' }}>
          → {checkOut}
          {t.nights ? ` · ${t.nights} nt${t.nights === 1 ? '' : 's'}` : ''}
        </div>
      </div>

      {/* Property + guest column */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="font-serif" style={{ fontSize: 18, fontWeight: 400, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
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
        <div style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.4 }}>
          {t.guestName || 'Unnamed guest'}
          {t.channel && (
            <>
              <span style={{ color: 'var(--ink-4)' }}> · </span>
              <span style={{ color: 'var(--ink-3)' }}>{t.channel}</span>
            </>
          )}
        </div>
        {t.previousCheckout && (
          <div
            style={{
              marginTop: 2,
              fontSize: 11,
              color: t.isSameDayTurnover ? 'var(--signal)' : 'var(--ink-4)',
              fontStyle: t.isSameDayTurnover ? 'normal' : 'italic',
            }}
          >
            {t.isSameDayTurnover
              ? 'Tight turnaround — previous guest checks out today'
              : `Prev. checkout ${formatDateShort(t.previousCheckout)}`}
          </div>
        )}
      </div>

      {/* Inspection status chip */}
      <span
        style={{
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          fontWeight: 600,
          color: inspectionDone ? 'var(--positive)' : 'var(--signal)',
          whiteSpace: 'nowrap',
        }}
      >
        {inspectionDone ? 'Inspection done' : 'Not inspected'}
      </span>

      {/* Action */}
      {inspectionDone && t.inspection ? (
        <Link
          href={`/inspections/${t.inspection.id}/summary`}
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
      )}
    </div>
  );
}

function CalendarGrid({ calendar }: { calendar: CalendarData }) {
  const { days, rows, todayIndex } = calendar;

  if (rows.length === 0) {
    return (
      <div style={{ borderTop: '1px solid var(--ink)', padding: '24px 0', fontSize: 13, color: 'var(--ink-4)' }}>
        No active properties.
      </div>
    );
  }

  const propertyColWidth = 144;
  const dayColMin = 40;
  const gridTemplate = `${propertyColWidth}px repeat(${days.length}, minmax(${dayColMin}px, 1fr))`;
  const headerHeight = 48;
  const rowHeight = 36;

  return (
    <div
      style={{
        borderTop: '1px solid var(--ink)',
        borderBottom: '1px solid var(--ink)',
        overflowX: 'auto',
      }}
    >
      <div style={{ minWidth: 'max-content', display: 'grid', gridTemplateColumns: gridTemplate }}>
        {/* HEADER ROW */}
        <div
          style={{
            height: headerHeight,
            borderBottom: '1px solid var(--rule)',
            background: 'var(--paper)',
          }}
        />
        {days.map((d, i) => {
          const isToday = i === todayIndex;
          const dt = new Date(`${d}T00:00:00`);
          const dow = dt.toLocaleDateString('en-US', { weekday: 'short' });
          const dn = dt.getDate();
          return (
            <div
              key={d}
              style={{
                height: headerHeight,
                borderBottom: '1px solid var(--rule)',
                borderLeft: '1px solid var(--rule-soft)',
                background: isToday ? 'var(--paper-2)' : 'var(--paper)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px 2px',
                position: 'relative',
              }}
            >
              {isToday && (
                <span
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 2,
                    background: 'var(--signal)',
                  }}
                />
              )}
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: isToday ? 'var(--signal)' : 'var(--ink-4)',
                  fontWeight: 500,
                }}
              >
                {dow}
              </div>
              <div
                className="font-serif tabular-nums"
                style={{
                  fontSize: 16,
                  fontWeight: 400,
                  lineHeight: 1.1,
                  color: isToday ? 'var(--signal)' : 'var(--ink)',
                  marginTop: 2,
                }}
              >
                {dn}
              </div>
            </div>
          );
        })}

        {/* PROPERTY ROWS */}
        {rows.map((row, rowIndex) => {
          const isLastRow = rowIndex === rows.length - 1;
          return (
            <PropertyCalendarRow
              key={row.property.id}
              row={row}
              days={days}
              todayIndex={todayIndex}
              rowHeight={rowHeight}
              isLastRow={isLastRow}
            />
          );
        })}
      </div>
    </div>
  );
}

function PropertyCalendarRow({
  row,
  days,
  todayIndex,
  rowHeight,
  isLastRow,
}: {
  row: CalendarData['rows'][number];
  days: string[];
  todayIndex: number;
  rowHeight: number;
  isLastRow: boolean;
}) {
  const rowBorder = isLastRow ? 'none' : '1px solid var(--rule-soft)';
  return (
    <>
      <div
        style={{
          height: rowHeight,
          borderBottom: rowBorder,
          padding: '0 14px',
          display: 'flex',
          alignItems: 'center',
          fontSize: 13,
          color: 'var(--ink)',
          background: 'var(--paper)',
        }}
      >
        {row.property.name}
      </div>
      {row.cells.map((cell, i) => {
        const isToday = i === todayIndex;
        const occupied = !!cell.reservation;
        // Connect adjacent cells of the same reservation: only the FIRST cell
        // of a reservation gets a left rule, so the visual block reads as one.
        const prevCell = i > 0 ? row.cells[i - 1] : null;
        const sameAsPrev =
          occupied &&
          !!prevCell?.reservation &&
          prevCell.reservation.guesty_reservation_id === cell.reservation!.guesty_reservation_id;

        const bg = occupied
          ? isToday
            ? 'var(--paper-3)'
            : 'var(--paper-2)'
          : isToday
            ? 'rgba(232, 184, 165, 0.18)' // signal-soft @ 18% for today vacancy
            : 'transparent';

        return (
          <div
            key={cell.date}
            style={{
              height: rowHeight,
              borderBottom: rowBorder,
              borderLeft: sameAsPrev ? 'none' : '1px solid var(--rule-soft)',
              background: bg,
              padding: '0 6px',
              display: 'flex',
              alignItems: 'center',
              fontSize: 11,
              color: 'var(--ink)',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              minWidth: 0,
            }}
            title={
              occupied && cell.reservation
                ? `${cell.reservation.guest_name ?? 'Guest'} · ${cell.reservation.check_in} → ${cell.reservation.check_out}`
                : undefined
            }
          >
            {cell.isCheckIn && cell.reservation ? (
              <span
                style={{
                  fontWeight: 500,
                  color: 'var(--ink)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {firstName(cell.reservation.guest_name)}
              </span>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function firstName(fullName: string | null): string {
  if (!fullName) return 'Guest';
  const trimmed = fullName.trim();
  if (!trimmed) return 'Guest';
  return trimmed.split(/\s+/)[0];
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
