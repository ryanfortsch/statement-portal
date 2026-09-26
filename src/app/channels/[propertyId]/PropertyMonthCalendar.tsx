'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  channelColor,
  fmtCellPrice,
  PRICE_SOURCE_LABEL,
  splitByRow,
  UNSELLABLE_LABEL,
  type BarSegment,
  type CalendarBarVM,
} from '@/lib/calendar-model';
import { EditDrawer, StayCard, type CalendarRowVM } from '../calendar/MultiCalendarGrid';

/**
 * The single-property month grid: seven columns, one cell per night, the
 * same server-built cells and bars as the multi-calendar but laid out as a
 * month so a day has room for its price, min-stay, CTA / CTD / closed marks
 * and the reason a vacant night cannot be sold.
 *
 * Interactions reuse the multi-calendar's drawers: click a vacant night to
 * price or close it (helm-run only), drag to hold a range, shift-click a
 * second night to quote the range from the first, click a bar for the stay.
 */

type Props = {
  row: CalendarRowVM;
  /** Grid dates in rows of seven, Sunday first, padded to whole weeks. */
  weeks: string[][];
  monthStart: string;
  monthEnd: string;
  today: string;
  monthLabel: string;
  /** Shorter cells for the hub; the full page uses the default. */
  compact?: boolean;
};

type Selection = { anchor: string; focus: string };
type Drawer =
  | { kind: 'edit'; start: string; end: string; mode?: 'price' | 'block' | 'quote' }
  | { kind: 'stay'; bar: CalendarBarVM };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function orderRange(a: string, b: string): { start: string; end: string } {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

export function PropertyMonthCalendar({ row, weeks, monthStart, monthEnd, today, monthLabel, compact = false }: Props) {
  const router = useRouter();
  const p = row.property;
  const cellH = compact ? 64 : 84;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [lastAnchor, setLastAnchor] = useState<string | null>(null);

  const cellByDate = useMemo(() => new Map(row.cells.map((c) => [c.date, c])), [row.cells]);
  const covered = useMemo(() => {
    const s = new Set<number>();
    for (const b of row.bars) for (let i = b.startIdx; i < b.endIdx; i++) s.add(i);
    return s;
  }, [row.bars]);

  const endDrag = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    if (selection) {
      const { start, end } = orderRange(selection.anchor, selection.focus);
      setDrawer({ kind: 'edit', start, end });
    }
  }, [dragging, selection]);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  }, [dragging, endDrag]);

  const isSelected = (date: string): boolean => {
    if (!selection) return false;
    const { start, end } = orderRange(selection.anchor, selection.focus);
    return date >= start && date <= end;
  };

  const close = () => {
    setDrawer(null);
    setSelection(null);
  };

  const piecesByWeek = useMemo(() => {
    const out = new Map<number, Array<{ bar: CalendarBarVM; col: number; span: number; prev: boolean; next: boolean }>>();
    for (const bar of row.bars) {
      const seg: BarSegment = {
        booking: { id: bar.id, status: bar.status, channel: bar.channel, check_in: bar.check_in, check_out: bar.check_out },
        startIdx: bar.startIdx,
        endIdx: bar.endIdx,
        nights: bar.endIdx - bar.startIdx,
        startsBefore: bar.startsBefore,
        endsAfter: bar.endsAfter,
      };
      for (const piece of splitByRow(seg, 7)) {
        const list = out.get(piece.row) ?? [];
        list.push({ bar, col: piece.col, span: piece.span, prev: piece.continuesFromPrevious || (piece.col === 0 && bar.startsBefore && piece.row === 0), next: piece.continuesToNext || (piece.col + piece.span === 7 && bar.endsAfter && piece.row === weeks.length - 1) });
        out.set(piece.row, list);
      }
    }
    return out;
  }, [row.bars, weeks.length]);

  return (
    <div style={{ position: 'relative', userSelect: dragging ? 'none' : undefined }}>
      <div style={{ border: '1px solid var(--ink)', background: 'var(--paper)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--ink)', background: 'var(--paper-2)' }}>
          {WEEKDAYS.map((w) => (
            <div key={w} style={{ padding: '7px 8px', fontSize: 9, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600 }}>
              {w}
            </div>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div key={week[0]} style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: wi === weeks.length - 1 ? 'none' : '1px solid var(--rule)', height: cellH }}>
            {week.map((d, ci) => {
              const idx = wi * 7 + ci;
              const cell = cellByDate.get(d);
              const inMonth = d >= monthStart && d <= monthEnd;
              const isCovered = covered.has(idx);
              const selected = isSelected(d);
              const isToday = d === today;
              const reason = cell?.reason ?? null;
              const vacantUnsellable = !isCovered && reason != null && reason !== 'stay' && reason !== 'block';
              const marks: string[] = [];
              if (cell?.cta) marks.push('CTA');
              if (cell?.ctd) marks.push('CTD');
              if (cell?.closed) marks.push('Closed');
              const title = cell
                ? [
                    d,
                    cell.priceCents != null ? `${fmtCellPrice(cell.priceCents)} (${PRICE_SOURCE_LABEL[cell.priceSource]})` : PRICE_SOURCE_LABEL.none,
                    cell.minNights ? `${cell.minNights} night min` : null,
                    marks.length ? marks.join(' / ') : null,
                    reason ? `${UNSELLABLE_LABEL[reason]}${cell.reasonDetail ? `: ${cell.reasonDetail}` : ''}` : 'Open',
                    cell.note ? `Note: ${cell.note}` : null,
                    cell.requests ? `${cell.requests} pending request${cell.requests === 1 ? '' : 's'}` : null,
                    'Click to price or hold · shift-click to quote a range',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : d;
              return (
                <div
                  key={d}
                  title={title}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    if (e.shiftKey && lastAnchor && lastAnchor !== d) {
                      e.preventDefault();
                      const { start, end } = orderRange(lastAnchor, d);
                      setSelection({ anchor: start, focus: end });
                      setDrawer({ kind: 'edit', start, end, mode: 'quote' });
                      return;
                    }
                    if (isCovered) return;
                    e.preventDefault();
                    setLastAnchor(d);
                    setSelection({ anchor: d, focus: d });
                    setDragging(true);
                    setDrawer(null);
                  }}
                  onMouseEnter={() => {
                    if (dragging && selection) setSelection({ ...selection, focus: d });
                  }}
                  style={{
                    position: 'relative',
                    borderLeft: ci === 0 ? 'none' : '1px solid var(--rule-soft)',
                    padding: '6px 8px',
                    background: selected
                      ? 'rgba(148,109,46,0.18)'
                      : !inMonth
                      ? 'rgba(11,37,69,0.035)'
                      : isToday
                      ? 'rgba(148,109,46,0.06)'
                      : 'transparent',
                    cursor: isCovered ? 'default' : 'pointer',
                    opacity: inMonth ? 1 : 0.55,
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                    <span className="tabular-nums" style={{ fontSize: 11, fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--signal)' : 'var(--ink-2)' }}>
                      {Number(d.slice(8, 10))}
                    </span>
                    {cell && cell.priceCents != null && !isCovered && (
                      <span
                        className="tabular-nums"
                        style={{
                          fontSize: compact ? 11 : 12,
                          color: cell.priceSource === 'helm' ? 'var(--ink)' : 'var(--ink-3)',
                          fontStyle: cell.priceSource === 'guesty_mirror' ? 'italic' : 'normal',
                          textDecoration: cell.closed ? 'line-through' : 'none',
                        }}
                      >
                        {fmtCellPrice(cell.priceCents)}
                      </span>
                    )}
                  </div>
                  {cell && !isCovered && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 2, fontSize: 8, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)', flexWrap: 'wrap', lineHeight: 1.2 }}>
                      {cell.minNights != null && cell.minNights > 1 && <span>{cell.minNights}n min</span>}
                      {marks.map((m) => (
                        <span key={m} style={{ color: m === 'Closed' ? 'var(--negative)' : 'var(--signal)' }}>{m}</span>
                      ))}
                      {vacantUnsellable && reason !== 'past' && <span style={{ color: 'var(--ink-3)' }}>{UNSELLABLE_LABEL[reason]}</span>}
                    </div>
                  )}
                  {cell && cell.requests > 0 && (
                    <span title={`${cell.requests} pending request${cell.requests === 1 ? '' : 's'}`} style={{ position: 'absolute', top: 8, right: 8, width: 6, height: 6, borderRadius: '50%', background: 'var(--signal)' }} />
                  )}
                </div>
              );
            })}

            {(piecesByWeek.get(wi) ?? []).map((piece) => {
              const color = channelColor(piece.bar.channel, piece.bar.isHold);
              const leftPct = ((piece.col + (piece.prev ? 0 : 0.5)) / 7) * 100;
              const rightPct = ((piece.col + piece.span - (piece.next ? 0 : 0.5)) / 7) * 100;
              return (
                <button
                  type="button"
                  key={`${piece.bar.id}-${piece.col}`}
                  onClick={() => {
                    setSelection(null);
                    setDrawer({ kind: 'stay', bar: piece.bar });
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title={`${piece.bar.label} · ${piece.bar.check_in} to ${piece.bar.check_out} · ${piece.bar.glyphLabel}`}
                  style={{
                    position: 'absolute',
                    left: `${leftPct}%`,
                    width: `calc(${rightPct - leftPct}% - 2px)`,
                    bottom: 7,
                    height: compact ? 20 : 24,
                    background: piece.bar.isHold
                      ? 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--ink-4) 40%, var(--paper)) 0 3px, var(--paper-2) 3px 7px)'
                      : color,
                    border: piece.bar.isHold ? '1px solid var(--ink-4)' : 'none',
                    borderRadius: piece.prev || piece.next ? 0 : 3,
                    color: piece.bar.isHold ? 'var(--ink-2)' : 'var(--paper)',
                    fontSize: 10,
                    padding: '0 7px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textAlign: 'left',
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    opacity: piece.bar.status === 'completed' ? 0.75 : 1,
                    zIndex: 1,
                  }}
                >
                  {!piece.prev && <span aria-hidden style={{ fontSize: 9, opacity: 0.85 }}>{piece.bar.glyph}</span>}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{piece.prev ? '' : piece.bar.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <p style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 8, lineHeight: 1.5 }}>
        {monthLabel} · {p.badgeLabel}. Click a vacant night to price, close or hold it; drag for a range; shift-click a second night to quote the span; click a bar for the stay.
        {!p.helmRun && ' Prices in italics are Guesty’s or PriceLabs’, mirrored; they cannot be edited here.'}
      </p>

      {drawer && drawer.kind === 'edit' && (
        <EditDrawer
          row={row}
          start={drawer.start}
          end={drawer.end}
          initialMode={drawer.mode}
          onClose={close}
          onSaved={() => {
            close();
            router.refresh();
          }}
        />
      )}
      {drawer && drawer.kind === 'stay' && <StayCard row={row} bar={drawer.bar} onClose={close} />}
    </div>
  );
}
