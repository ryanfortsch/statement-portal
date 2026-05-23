import type { CSSProperties } from 'react';
import Link from 'next/link';
import { CalendarCellTooltip } from '@/app/operations/CalendarCellTooltip';
import { channelAccent } from '@/lib/channel-style';
import type { CalendarData } from '@/lib/operations';

/**
 * Portfolio occupancy calendar: one row per property, one column per day,
 * reservation blocks colored by channel with a hoverable detail tooltip.
 * Server-rendered. Shared by the /operations (Turnovers) page and the home
 * dashboard so both stay in lockstep.
 *
 * Renders the channel legend + a sideways-scroll hint + the grid. The
 * surrounding header (title, range tabs) stays with each caller, since the
 * two surfaces frame it differently.
 */

// Only channels that actually render in the turnover/calendar views
// (blocks are filtered out upstream, so they're omitted).
const CHANNEL_LEGEND: { label: string; channel: string }[] = [
  { label: 'Airbnb', channel: 'airbnb' },
  { label: 'VRBO', channel: 'vrbo' },
  { label: 'Booking.com', channel: 'booking' },
  { label: 'Direct', channel: 'direct' },
];

export function OccupancyCalendar({ calendar }: { calendar: CalendarData }) {
  return (
    <div>
      {/* Channel legend — decodes the colored spine on each block. */}
      <div className="flex items-center flex-wrap" style={{ gap: 14, marginBottom: 12 }}>
        {CHANNEL_LEGEND.map((c) => (
          <span
            key={c.channel}
            className="flex items-center"
            style={{ gap: 6, fontSize: 10, letterSpacing: '0.06em', color: 'var(--ink-4)' }}
          >
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                width: 10,
                height: 3,
                borderRadius: 2,
                background: channelAccent(c.channel),
              }}
            />
            {c.label}
          </span>
        ))}
      </div>
      {calendar.days.length > 7 && (
        <p
          style={{
            fontSize: 11,
            color: 'var(--ink-4)',
            letterSpacing: '0.04em',
            marginBottom: 10,
            fontStyle: 'italic',
          }}
        >
          Scroll the grid sideways to see all {calendar.days.length} days &rarr;
        </p>
      )}
      <CalendarGrid calendar={calendar} />
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
  // Deterministic width: at most day counts the grid fills the container
  // (1fr stretches the day columns); once 144 + N*40 exceeds the container
  // it hits this floor and scrolls with uniform 40px columns. Using an
  // explicit px floor instead of `max-content` keeps column widths from
  // being driven by guest-name length, which jumbled the grid at 14/30d.
  const minGridWidth = propertyColWidth + days.length * dayColMin;

  // Each visual row (header + every property) is its OWN grid with the
  // identical column template and width. Columns line up across rows
  // because they share that template; using independent per-row grids
  // (instead of one big auto-flow grid) makes it structurally impossible
  // for a cell to spill into the wrong column/row at any day count.
  const rowGridStyle: CSSProperties = {
    width: '100%',
    minWidth: `${minGridWidth}px`,
    display: 'grid',
    gridTemplateColumns: gridTemplate,
  };

  return (
    <div
      style={{
        borderTop: '1px solid var(--ink)',
        borderBottom: '1px solid var(--ink)',
        overflowX: 'auto',
      }}
    >
      {/* HEADER ROW (own grid) */}
      <div style={rowGridStyle}>
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
                boxSizing: 'border-box',
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
                minWidth: 0,
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
      </div>

      {/* PROPERTY ROWS (each its own grid) */}
      {rows.map((row, rowIndex) => {
        const isLastRow = rowIndex === rows.length - 1;
        return (
          <PropertyCalendarRow
            key={row.property.id}
            row={row}
            todayIndex={todayIndex}
            rowHeight={rowHeight}
            isLastRow={isLastRow}
            rowGridStyle={rowGridStyle}
          />
        );
      })}
    </div>
  );
}

function PropertyCalendarRow({
  row,
  todayIndex,
  rowHeight,
  isLastRow,
  rowGridStyle,
}: {
  row: CalendarData['rows'][number];
  todayIndex: number;
  rowHeight: number;
  isLastRow: boolean;
  rowGridStyle: CSSProperties;
}) {
  const rowBorder = isLastRow ? 'none' : '1px solid var(--rule-soft)';
  return (
    <div style={rowGridStyle}>
      <Link
        href={`/properties/${row.property.id}`}
        title={`Open ${row.property.name}`}
        style={{
          boxSizing: 'border-box',
          height: rowHeight,
          borderBottom: rowBorder,
          padding: '0 14px',
          display: 'flex',
          alignItems: 'center',
          fontSize: 13,
          color: 'var(--ink)',
          background: 'var(--paper)',
          minWidth: 0,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          textDecoration: 'none',
        }}
      >
        {row.property.name}
      </Link>
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

        // First visible cell of a reservation block gets a colored "spine"
        // in its channel accent — drawn as an inset box-shadow (not a wider
        // border) so it never perturbs the box model / column widths.
        const blockStart = occupied && !sameAsPrev;
        const cellInner = (
          <div
            style={{
              boxSizing: 'border-box',
              height: rowHeight,
              borderBottom: rowBorder,
              borderLeft: sameAsPrev ? 'none' : '1px solid var(--rule-soft)',
              boxShadow: blockStart
                ? `inset 3px 0 0 ${channelAccent(cell.reservation!.channel)}`
                : undefined,
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
              cursor: occupied ? 'help' : 'default',
            }}
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

        if (!occupied || !cell.reservation) {
          return <div key={cell.date}>{cellInner}</div>;
        }

        return (
          <CalendarCellTooltip
            key={cell.date}
            data={{
              guestName: cell.reservation.guest_name,
              channel: cell.reservation.channel,
              checkIn: cell.reservation.check_in,
              checkOut: cell.reservation.check_out,
              nights: cell.reservation.nights,
              hostPayout: cell.reservation.host_payout,
              confirmationCode: cell.reservation.confirmation_code,
            }}
          >
            {cellInner}
          </CalendarCellTooltip>
        );
      })}
    </div>
  );
}

function firstName(fullName: string | null): string {
  if (!fullName) return 'Guest';
  const trimmed = fullName.trim();
  if (!trimmed) return 'Guest';
  return trimmed.split(/\s+/)[0];
}
