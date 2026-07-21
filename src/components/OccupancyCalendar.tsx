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

// Channels that render as solid stay bars. Owner/maintenance holds render
// too (hatched grey, see blockFill) and get their own legend entry below.
const CHANNEL_LEGEND: { label: string; channel: string }[] = [
  { label: 'Airbnb', channel: 'airbnb' },
  { label: 'VRBO', channel: 'vrbo' },
  { label: 'Booking.com', channel: 'booking' },
  { label: 'Direct', channel: 'direct' },
];

/** An owner / maintenance hold (bookings.status = 'block'). Rendered as a
 *  hatched grey bar so held dates stop reading as bookable vacancy, while
 *  staying visually junior to real guest stays. */
function isBlockRes(r: { status: string | null } | null): boolean {
  return r?.status === 'block';
}

/** Hatched fill for hold bars: thin 135° grey stripes over paper. Distinct
 *  at a glance from every solid channel tint, and quiet enough to recede. */
function blockFill(): string {
  return `repeating-linear-gradient(135deg, color-mix(in srgb, var(--ink-4) 34%, var(--paper)) 0 3px, transparent 3px 7px)`;
}

export function OccupancyCalendar({ calendar }: { calendar: CalendarData }) {
  return (
    <div>
      {/* Channel legend: decodes the bar tint on each stay. One quiet row —
          the grid explains itself from here. */}
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
        <span
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
              background: blockFill(),
              boxShadow: 'inset 0 0 0 1px var(--rule)',
            }}
          />
          Owner / hold
        </span>
      </div>
      <CalendarGrid calendar={calendar} />
    </div>
  );
}

function CalendarGrid({ calendar }: { calendar: CalendarData }) {
  const { days, rows, today } = calendar;

  if (rows.length === 0) {
    return (
      <div style={{ borderTop: '1px solid var(--ink)', padding: '24px 0', fontSize: 13, color: 'var(--ink-4)' }}>
        No active properties.
      </div>
    );
  }

  // Wide enough for "53 Rocky Neck (Down)" + the sold-% chip without
  // ellipsis — two rows reading identically ("53 Rocky Ne…") was worse
  // than the 20px of grid it costs.
  const propertyColWidth = 172;
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
            // Frozen corner over the sticky property-name column below.
            position: 'sticky',
            left: 0,
            zIndex: 3,
            boxShadow: '1px 0 0 var(--rule)',
          }}
        />
        {days.map((d, i) => {
          const isToday = d === today;
          const isPast = d < today;
          const dt = new Date(`${d}T00:00:00`);
          const dow = dt.toLocaleDateString('en-US', { weekday: 'short' });
          const dn = dt.getDate();
          const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
          // Month cue where orientation needs it: the window's first column
          // and every 1st of a month swap the weekday line for the month
          // name, so a paged-ahead window never turns into anonymous digits.
          const monthLabel =
            i === 0 || dn === 1 ? dt.toLocaleDateString('en-US', { month: 'short' }) : null;
          return (
            <div
              key={d}
              style={{
                boxSizing: 'border-box',
                height: headerHeight,
                borderBottom: '1px solid var(--rule)',
                // The today column's left edge starts the full-height "now"
                // line that the body cells continue below.
                borderLeft: isToday ? '1px solid var(--signal)' : '1px solid var(--rule-soft)',
                background: isToday
                  ? 'var(--paper-2)'
                  : isWeekend
                    ? 'rgba(30, 46, 52, 0.035)'
                    : 'var(--paper)',
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
                  color: isToday ? 'var(--signal)' : monthLabel ? 'var(--ink-2)' : 'var(--ink-4)',
                  fontWeight: monthLabel ? 600 : 500,
                }}
              >
                {monthLabel ?? dow}
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
            today={today}
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
  today,
  rowHeight,
  isLastRow,
  rowGridStyle,
}: {
  row: CalendarData['rows'][number];
  today: string;
  rowHeight: number;
  isLastRow: boolean;
  rowGridStyle: CSSProperties;
}) {
  const rowBorder = isLastRow ? 'none' : '1px solid var(--rule-soft)';
  return (
    <div style={rowGridStyle}>
      <Link
        href={`/properties/${row.property.id}`}
        title={
          row.occupancyPct != null
            ? `Open ${row.property.name} — ${row.occupancyPct}% of its bookable nights in this window are sold`
            : `Open ${row.property.name}`
        }
        style={{
          boxSizing: 'border-box',
          height: rowHeight,
          borderBottom: rowBorder,
          padding: '0 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          color: 'var(--ink)',
          background: 'var(--paper)',
          minWidth: 0,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textDecoration: 'none',
          // Frozen pane: the name column stays put while the day grid
          // scrolls sideways, so 30-day rows never become anonymous bars.
          // The opaque paper background + soft right rule hide bars
          // passing underneath.
          position: 'sticky',
          left: 0,
          zIndex: 2,
          boxShadow: '1px 0 0 var(--rule)',
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {row.property.name}
        </span>
        {/* Sold share of this window's bookable nights (held nights out of
            the denominator). Quiet by design — orientation, not a KPI. */}
        {row.occupancyPct != null && (
          <span
            className="tabular-nums"
            aria-hidden
            style={{ fontSize: 9, color: 'var(--ink-4)', letterSpacing: '0.04em', flexShrink: 0 }}
          >
            {row.occupancyPct}%
          </span>
        )}
      </Link>
      {row.cells.map((cell, i) => {
        const isToday = cell.date === today;
        const isPast = cell.date < today;
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
        // Owner/maintenance holds swap the solid tint for a hatched grey.
        const tint = (accent: string) =>
          `color-mix(in srgb, ${accent} ${isToday ? 38 : 26}%, var(--paper))`;
        const fillFor = (r: NonNullable<typeof am>) =>
          isBlockRes(r) ? blockFill() : tint(channelAccent(r.channel));
        const BAR_INSET = 8; // vertical breathing room → bar floats in the row
        const RADIUS = 5;

        const primary = pm ?? am; // the reservation the hover tooltip describes

        // Column washes, most-specific first: the today column keeps its
        // warm band, short-gap nights get the opportunity tint, weekends a
        // barely-there grey so Sat/Sun read down the whole grid.
        const dowIdx = new Date(`${cell.date}T00:00:00`).getDay();
        const isWeekend = dowIdx === 0 || dowIdx === 6;
        const cellWash = isToday
          ? 'rgba(232, 184, 165, 0.12)'
          : cell.gapNights != null && !isPast
            ? 'color-mix(in srgb, var(--signal) 7%, transparent)'
            : isWeekend
              ? 'rgba(30, 46, 52, 0.035)'
              : 'transparent';

        // Open-night annotation: the posted rate on any night with no
        // occupant (fully vacant cell, or the open night of a checkout
        // day), today forward. Hover title carries min-stay + gap detail —
        // native tooltip, zero hydration weight.
        const showPrice = !pm && !isPast && cell.price != null;
        const openTitleBits: string[] = [];
        if (!pm && !isPast) {
          if (cell.gapNights != null) {
            openTitleBits.push(
              `${cell.gapNights}-night gap between stays`,
            );
          }
          if (cell.price != null) openTitleBits.push(`$${Math.round(cell.price).toLocaleString('en-US')} posted`);
          if (cell.minNights != null && cell.minNights > 1) openTitleBits.push(`${cell.minNights}-night min`);
        }
        const openTitle = openTitleBits.length > 0 ? openTitleBits.join(' · ') : undefined;
        // A turnover-day cell carries two different stays (departing am,
        // arriving pm): surface BOTH in the tooltip so the outgoing guest's
        // details stop hiding behind a hover on the previous day. Gated on a
        // GENUINE flip (am checks out this date AND pm checks in this date):
        // a bare id mismatch also happens where an owner block overlaps its
        // padded $0 direct-booking twin, and those boundary cells would
        // otherwise claim an "Out / In" that contradicts the stays' dates.
        const departing =
          am &&
          pm &&
          am.guesty_reservation_id !== pm.guesty_reservation_id &&
          cell.isCheckOut &&
          cell.isCheckIn
            ? am
            : null;
        const cellInner = (
          <div
            style={{
              position: 'relative',
              boxSizing: 'border-box',
              height: rowHeight,
              borderBottom: rowBorder,
              // The signal-colored left edge continues the header's "now"
              // line down every row, cutting through mid-flight bars too —
              // that is the point: the line marks this instant on the bar.
              borderLeft: isToday
                ? '1px solid var(--signal)'
                : continuousLeft
                  ? 'none'
                  : '1px solid var(--rule-soft)',
              background: cellWash,
              minWidth: 0,
              cursor: primary ? 'help' : 'default',
              // History columns recede behind today-and-forward. 0.55 keeps
              // the channel-tint legible against paper at AA.
              opacity: isPast ? 0.55 : 1,
            }}
            title={primary ? undefined : openTitle}
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
                  background: fillFor(am),
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
                  background: fillFor(pm),
                  borderTopLeftRadius: cell.isCheckIn ? RADIUS : 0,
                  borderBottomLeftRadius: cell.isCheckIn ? RADIUS : 0,
                  boxShadow: cell.isCheckIn
                    ? `inset 3px 0 0 ${channelAccent(pm.channel)}`
                    : undefined,
                }}
              />
            )}
            {/* Posted-rate annotation on open nights (vacant cell, or the
                open night of a checkout day). Sits under the labels and
                never intercepts hover. */}
            {showPrice && (
              <span
                aria-hidden
                className="font-mono tabular-nums"
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: am ? '50%' : 0,
                  right: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9,
                  letterSpacing: '0.02em',
                  // One quiet style everywhere — the gap wash alone marks
                  // gaps; bolded signal-colored prices read as alarms.
                  color: 'var(--ink-4)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  pointerEvents: 'none',
                }}
              >
                ${Math.round(cell.price!)}
              </span>
            )}
            {startsVisually && pm && (() => {
              // A hold bar earns a real name when the Guesty day mirror
              // knows one: the block's note ("Carpet Cleaning"), or "Owner"
              // for an owner-portal block, or its structured reason. Only
              // an unmirrored hold still reads as bare "Hold". A guest stay
              // whose name never synced renders as a clean unlabeled bar —
              // the channel tint says occupied; a fake "Guest" says nothing.
              const isHold = isBlockRes(pm);
              const label = isHold
                ? pm.hold?.note?.trim() ||
                  (pm.hold?.kind === 'owner' ? 'Owner' : pm.hold?.reason?.trim() || 'Hold')
                : displayLabel(pm.guest_name);
              // Guest is in residence: they physically keyed in on a guest code
              // during this (current) stay. Only the active stay ever carries
              // guestArrivedAt, so a set value is an unambiguous "they're home."
              const inResidence = !!pm.guestArrivedAt;
              if (!label && !inResidence) return null;
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
                    // A named hold reads a step darker than the bare "Hold"
                    // placeholder so real information doesn't whisper.
                    color: isHold ? (label === 'Hold' ? 'var(--ink-4)' : 'var(--ink-3)') : 'var(--ink)',
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

        const toTooltipData = (r: NonNullable<typeof primary>) => ({
          guestName: r.guest_name,
          channel: r.channel,
          checkIn: r.check_in,
          checkOut: r.check_out,
          nights: r.nights,
          hostPayout: r.host_payout,
          confirmationCode: r.confirmation_code,
          guestArrivedAt: r.guestArrivedAt,
          isBlock: isBlockRes(r),
          hold: r.hold,
        });

        return (
          <CalendarCellTooltip
            key={cell.date}
            data={toTooltipData(primary)}
            departing={departing ? toTooltipData(departing) : undefined}
            cellIsToday={isToday}
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
 * Display label for a REAL stay's bar: the guest's first name, or null for
 * Guesty placeholder names ('Reservation', 'TBD', 'n/a') — a booking whose
 * name hasn't synced renders as a clean unlabeled bar. (The old "Hold"
 * mapping made real revenue read as a block, and a literal "Guest" label
 * was wallpaper.) Actual holds carry status='block' and never reach this.
 */
function displayLabel(fullName: string | null): string | null {
  if (!fullName || !fullName.trim()) return null;
  const fn = firstName(fullName);
  return /^(reservation|tbd|guest|n\/a)$/i.test(fn) ? null : fn;
}
