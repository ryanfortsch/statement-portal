import type { CSSProperties } from 'react';
import Link from 'next/link';
import { CalendarCellTooltip } from '@/app/operations/CalendarCellTooltip';
import { channelAccent } from '@/lib/channel-style';
import type { CalendarData } from '@/lib/operations';

/**
 * Portfolio occupancy calendar: one row per property, one column per day.
 * Stays render as channel-tinted bars using the half-cell model every
 * booking calendar uses: a bar starts at the CENTER of its check-in day
 * (right half filled) and ends at the CENTER of its check-out day (left
 * half filled). That makes check-ins and, critically, check-outs legible:
 * a checkout is a bar ending mid-cell, not an empty square that looks like
 * a plain vacancy. A same-day turnover shows both halves of one cell filled
 * (departing guest left, arriving guest right). Hover any bar for details.
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
      {/* Channel legend: decodes the bar tint on each stay. */}
      <div className="flex items-center flex-wrap" style={{ gap: 14, marginBottom: 6 }}>
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
                width: 14,
                height: 8,
                borderRadius: 3,
                background: `color-mix(in srgb, ${channelAccent(c.channel)} 26%, var(--paper))`,
                boxShadow: `inset 3px 0 0 ${channelAccent(c.channel)}`,
              }}
            />
            {c.label}
          </span>
        ))}
      </div>
      {/* One-line read of the bar grammar so checkouts aren't a guessing game. */}
      <p style={{ fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.04em', marginBottom: 12 }}>
        Each bar runs check-in &rarr; check-out. A bar ending mid-cell is a checkout that day.
      </p>
      {calendar.days.length - calendar.todayIndex > 7 && (
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

  const propertyColWidth = 152;
  const dayColMin = 44;
  const gridTemplate = `${propertyColWidth}px repeat(${days.length}, minmax(${dayColMin}px, 1fr))`;
  const headerHeight = 48;
  const rowHeight = 40;
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
          const isPast = i < todayIndex;
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
                // History columns read as context, not destinations.
                opacity: isPast ? 0.5 : 1,
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
        const isPast = i < todayIndex;
        const { am, pm } = cell;
        const prev = i > 0 ? row.cells[i - 1] : null;

        // A stay runs seamlessly across a midnight when the same guest sleeps
        // both nights (prev.pm === cell.am). Suppress the day separator there
        // so a multi-night stay reads as one continuous bar; keep the rule
        // everywhere else so vacant days and bar ends sit on a clean grid.
        const continuousLeft =
          !!am && !!prev?.pm && am.guesty_reservation_id === prev.pm.guesty_reservation_id;

        // Label the bar at its visible start: a real check-in, or the window's
        // left edge for a stay already in progress.
        const startsVisually =
          !!pm && (i === 0 || prev?.pm?.guesty_reservation_id !== pm.guesty_reservation_id);

        // How many consecutive cells this stay occupies in the visible window.
        // Used to size the absolute-positioned guest-name label so it spans the
        // full bar instead of getting clipped inside the start cell. A multi-
        // night stay walks pm-by-pm until the rid changes; a checkout day (am
        // set, pm null) is the last cell in the span.
        let spanCount = 1;
        if (startsVisually && pm) {
          const rid = pm.guesty_reservation_id;
          for (let j = i + 1; j < row.cells.length; j++) {
            const next = row.cells[j];
            if (next.am?.guesty_reservation_id !== rid) break;
            spanCount++;
            if (next.pm?.guesty_reservation_id !== rid) break; // checkout day caps the span
          }
        }

        // Channel-tinted fill so the bar's color reads at a glance; deepen it
        // under the today column. color-mix keeps the tint soft against paper.
        const tint = (accent: string) =>
          `color-mix(in srgb, ${accent} ${isToday ? 38 : 26}%, var(--paper))`;
        const BAR_INSET = 8; // vertical breathing room → bar floats in the row
        const RADIUS = 5;

        const primary = pm ?? am; // the reservation the hover tooltip describes
        const cellInner = (
          <div
            style={{
              position: 'relative',
              boxSizing: 'border-box',
              height: rowHeight,
              borderBottom: rowBorder,
              borderLeft: continuousLeft ? 'none' : '1px solid var(--rule-soft)',
              background: isToday ? 'rgba(232, 184, 165, 0.12)' : 'transparent',
              minWidth: 0,
              cursor: primary ? 'help' : 'default',
              // History columns recede behind today-and-forward. 0.55 keeps
              // the channel-tint legible against paper at AA.
              opacity: isPast ? 0.55 : 1,
            }}
          >
            {/* AM (left) half: morning occupant. On a checkout day this is
                the departing guest and the bar ENDS here: rounded + capped at
                the cell's center, which is the whole point: checkouts become
                visible instead of looking like a plain vacancy. */}
            {am && (
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  top: BAR_INSET,
                  bottom: BAR_INSET,
                  left: 0,
                  width: '50%',
                  background: tint(channelAccent(am.channel)),
                  borderTopRightRadius: cell.isCheckOut ? RADIUS : 0,
                  borderBottomRightRadius: cell.isCheckOut ? RADIUS : 0,
                  boxShadow: cell.isCheckOut
                    ? `inset -3px 0 0 ${channelAccent(am.channel)}`
                    : undefined,
                }}
              />
            )}
            {/* PM (right) half: night occupant. On a check-in day the bar
                STARTS here: rounded + capped at the cell's center. */}
            {pm && (
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  top: BAR_INSET,
                  bottom: BAR_INSET,
                  right: 0,
                  width: '50%',
                  background: tint(channelAccent(pm.channel)),
                  borderTopLeftRadius: cell.isCheckIn ? RADIUS : 0,
                  borderBottomLeftRadius: cell.isCheckIn ? RADIUS : 0,
                  boxShadow: cell.isCheckIn
                    ? `inset 3px 0 0 ${channelAccent(pm.channel)}`
                    : undefined,
                }}
              />
            )}
            {startsVisually && pm && (() => {
              const label = displayLabel(pm.guest_name);
              const isHold = label === 'Hold';
              // Guest is in residence: they physically keyed in on a guest code
              // during this (current) stay. Only the active stay ever carries
              // guestArrivedAt, so a set value is an unambiguous "they're home."
              const inResidence = !!pm.guestArrivedAt;
              // The bar's visible left edge is mid-cell on a real check-in
              // (right half filled) and the cell's left edge on a window-edge
              // already-in-progress stay (both halves filled). Anchor the
              // label to whichever applies so it always sits ON the bar.
              const labelLeft = cell.isCheckIn ? 'calc(50% + 7px)' : '7px';
              return (
                <span
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: labelLeft,
                    // Width derived from spanCount * cell-width so the label
                    // can extend across every cell of this stay without being
                    // clipped to just the start cell. 14px accounts for the
                    // 7px left inset + 7px right breathing room before the
                    // checkout cap. CSS `100%` resolves to one cell's track
                    // width (every track shares the same 1fr template).
                    width: `calc(${spanCount} * 100% - 14px)`,
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: '0.01em',
                    fontStyle: isHold ? 'italic' : 'normal',
                    color: isHold ? 'var(--ink-4)' : 'var(--ink)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    // Tooltip lives on each underlying cell; the label must
                    // never steal hover from the day the cursor is actually on.
                    pointerEvents: 'none',
                    // Live stay whose leftmost cell is in the past dims to
                    // 0.55 via the cell wrapper; the label name stays crisp.
                    opacity: 1,
                  }}
                >
                  {inResidence && (
                    <span
                      aria-label="Guest in residence"
                      style={{
                        color: 'var(--positive)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <HomeGlyph />
                    </span>
                  )}
                  {label}
                </span>
              );
            })()}
          </div>
        );

        if (!primary) {
          return <div key={cell.date}>{cellInner}</div>;
        }

        return (
          <CalendarCellTooltip
            key={cell.date}
            data={{
              guestName: primary.guest_name,
              channel: primary.channel,
              checkIn: primary.check_in,
              checkOut: primary.check_out,
              nights: primary.nights,
              hostPayout: primary.host_payout,
              confirmationCode: primary.confirmation_code,
              guestArrivedAt: primary.guestArrivedAt,
            }}
          >
            {cellInner}
          </CalendarCellTooltip>
        );
      })}
    </div>
  );
}

/** Filled house silhouette: marks a stay whose guest has physically keyed in
 *  and is in residence right now. Inherits color from its wrapper (--positive).
 *  Sized to sit inline before the guest name without crowding the bar. */
function HomeGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      style={{ marginRight: 3, verticalAlign: '-1px' }}
    >
      <path d="M12 3 2 11h2.2v9H10v-5.5h4V20h5.8v-9H22z" />
    </svg>
  );
}

function firstName(fullName: string | null): string {
  if (!fullName) return 'Guest';
  const trimmed = fullName.trim();
  if (!trimmed) return 'Guest';
  return trimmed.split(/\s+/)[0];
}

/**
 * Display label for the calendar bar. Same as firstName for real guests, but
 * normalizes Guesty's placeholder names ('Reservation', 'TBD', 'Guest', 'n/a')
 * to a styled "Hold" so an unnamed block doesn't read as a literal guest's
 * first name. The caller italicizes + dims when label === 'Hold' so it reads
 * as status, not a person.
 */
function displayLabel(fullName: string | null): string {
  const fn = firstName(fullName);
  return /^(reservation|tbd|guest|n\/a)$/i.test(fn) ? 'Hold' : fn;
}
