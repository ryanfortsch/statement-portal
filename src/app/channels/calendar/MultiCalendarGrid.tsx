'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  channelColor,
  fmtCellPrice,
  FRESHNESS_COLOR,
  PRICE_SOURCE_LABEL,
  UNSELLABLE_LABEL,
  type CalendarBarVM,
  type CalendarCellVM,
  type Freshness,
} from '@/lib/calendar-model';
import { createBlockAction, quoteRangeAction, saveRateDaysAction, type CalendarActionResult, type QuoteRangeResult } from './calendar-actions';

/**
 * The fleet multi-calendar: one row per home, one column per night of the
 * month. Server-built rows (see /channels/calendar/page.tsx) come in as plain
 * data; this component draws them and owns the three interactions:
 *
 *   click a vacant night on a helm-run home    price / min-stay / close editor
 *   drag across vacant nights                  block editor (owner, maintenance,
 *                                              other, with a note)
 *   click a bar                                the stay card with its links
 *
 * A guesty-run row opens the same drawer but the price fields are disabled
 * with the reason: Guesty or PriceLabs set that number and Airbnb, VRBO and
 * Booking.com would never receive one typed here. Blocks are still allowed
 * (a hold in Helm is a hold on the Operations calendar and the export feed),
 * and the result copy says the hold lives in Helm only until the flip.
 */

export type CalendarRowVM = {
  property: {
    id: string;
    name: string;
    region: string;
    regionLabel: string;
    calendarAuthority: 'guesty' | 'helm';
    helmRun: boolean;
    badgeLabel: string;
    badgeKind: 'guesty' | 'shadow' | 'helm';
    freshness: Freshness;
    freshnessDetail: string;
    hasPlan: boolean;
  };
  cells: CalendarCellVM[];
  bars: CalendarBarVM[];
};

type Props = {
  rows: CalendarRowVM[];
  dates: string[];
  today: string;
  monthLabel: string;
};

type Selection = { propertyId: string; anchor: string; focus: string };

type Drawer =
  | { kind: 'edit'; propertyId: string; start: string; end: string }
  | { kind: 'stay'; propertyId: string; bar: CalendarBarVM };

const CHANNEL_LABELS: Record<string, string> = {
  airbnb: 'Airbnb',
  vrbo: 'VRBO',
  booking_com: 'Booking.com',
  direct: 'Direct',
  manual: 'Manual',
  block: 'Block',
  guesty: 'Guesty',
  other: 'Other',
};

const LABEL_W = 176;
const CELL_W = 46;
const ROW_H = 58;

function orderRange(a: string, b: string): { start: string; end: string } {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + 86_400_000).toISOString().slice(0, 10);
}

function weekdayShort(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).slice(0, 2);
}

export function MultiCalendarGrid({ rows, dates, today, monthLabel }: Props) {
  const router = useRouter();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [drawer, setDrawer] = useState<Drawer | null>(null);

  const rowById = useMemo(() => new Map(rows.map((r) => [r.property.id, r])), [rows]);

  const endDrag = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    if (selection) {
      const { start, end } = orderRange(selection.anchor, selection.focus);
      setDrawer({ kind: 'edit', propertyId: selection.propertyId, start, end });
    }
  }, [dragging, selection]);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  }, [dragging, endDrag]);

  const isSelected = (propertyId: string, date: string): boolean => {
    if (!selection || selection.propertyId !== propertyId) return false;
    const { start, end } = orderRange(selection.anchor, selection.focus);
    return date >= start && date <= end;
  };

  const close = () => {
    setDrawer(null);
    setSelection(null);
  };

  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          border: '1px solid var(--ink)',
          background: 'var(--paper)',
          overflowX: 'auto',
          userSelect: dragging ? 'none' : undefined,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${LABEL_W}px repeat(${dates.length}, ${CELL_W}px)`,
            borderBottom: '1px solid var(--ink)',
            background: 'var(--paper-2)',
            minWidth: 'fit-content',
            position: 'sticky',
            top: 0,
            zIndex: 2,
          }}
        >
          <div style={{ padding: '8px 12px', fontSize: 9, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-3)', alignSelf: 'end' }}>
            {monthLabel}
          </div>
          {dates.map((d) => {
            const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
            const weekend = wd === 0 || wd === 6;
            const isToday = d === today;
            return (
              <div
                key={d}
                title={d}
                style={{
                  textAlign: 'center',
                  padding: '6px 0 5px',
                  fontSize: 10,
                  lineHeight: 1.2,
                  color: isToday ? 'var(--signal)' : weekend ? 'var(--ink-3)' : 'var(--ink-2)',
                  fontWeight: isToday ? 700 : 500,
                  background: weekend ? 'rgba(11,37,69,0.03)' : 'transparent',
                  borderLeft: '1px solid var(--rule-soft)',
                }}
              >
                <div style={{ fontSize: 8, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{weekdayShort(d)}</div>
                <div className="tabular-nums">{Number(d.slice(8, 10))}</div>
              </div>
            );
          })}
        </div>

        {rows.length === 0 && (
          <div style={{ padding: '32px 16px', fontSize: 13, color: 'var(--ink-3)' }}>No homes match these filters.</div>
        )}

        {rows.map((row) => (
          <PropertyRow
            key={row.property.id}
            row={row}
            dates={dates}
            today={today}
            isSelected={isSelected}
            onCellDown={(date) => {
              setSelection({ propertyId: row.property.id, anchor: date, focus: date });
              setDragging(true);
              setDrawer(null);
            }}
            onCellEnter={(date) => {
              if (dragging && selection && selection.propertyId === row.property.id) {
                setSelection({ ...selection, focus: date });
              }
            }}
            onBarClick={(bar) => {
              setSelection(null);
              setDrawer({ kind: 'stay', propertyId: row.property.id, bar });
            }}
          />
        ))}
      </div>

      {drawer && drawer.kind === 'edit' && (
        <EditDrawer
          row={rowById.get(drawer.propertyId)!}
          start={drawer.start}
          end={drawer.end}
          onClose={close}
          onSaved={() => {
            close();
            router.refresh();
          }}
        />
      )}
      {drawer && drawer.kind === 'stay' && <StayCard row={rowById.get(drawer.propertyId)!} bar={drawer.bar} onClose={close} />}
    </div>
  );
}

function PropertyRow({
  row,
  dates,
  today,
  isSelected,
  onCellDown,
  onCellEnter,
  onBarClick,
}: {
  row: CalendarRowVM;
  dates: string[];
  today: string;
  isSelected: (propertyId: string, date: string) => boolean;
  onCellDown: (date: string) => void;
  onCellEnter: (date: string) => void;
  onBarClick: (bar: CalendarBarVM) => void;
}) {
  const p = row.property;
  const cellByDate = useMemo(() => new Map(row.cells.map((c) => [c.date, c])), [row.cells]);
  // Nights covered by a drawn bar; those cells do not take a click.
  const covered = useMemo(() => {
    const s = new Set<number>();
    for (const b of row.bars) for (let i = b.startIdx; i < b.endIdx; i++) s.add(i);
    return s;
  }, [row.bars]);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `${LABEL_W}px 1fr`,
        borderBottom: '1px solid var(--rule)',
        minWidth: 'fit-content',
      }}
    >
      <div style={{ padding: '10px 12px', borderRight: '1px solid var(--ink)', display: 'flex', flexDirection: 'column', gap: 3, justifyContent: 'center' }}>
        <Link href={`/channels/${p.id}`} className="font-serif" style={{ fontSize: 15, color: 'var(--ink)', textDecoration: 'none', lineHeight: 1.15 }}>
          {p.name}
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
          <span
            title={p.freshnessDetail}
            style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: FRESHNESS_COLOR[p.freshness], border: p.freshness === 'never' ? '1px solid var(--ink-4)' : 'none' }}
          />
          <span style={{ color: p.badgeKind === 'helm' ? 'var(--positive)' : p.badgeKind === 'shadow' ? 'var(--signal)' : 'var(--ink-3)' }}>{p.badgeLabel}</span>
          <span style={{ color: 'var(--ink-4)' }}>{p.regionLabel}</span>
        </div>
      </div>

      <div style={{ position: 'relative', width: dates.length * CELL_W, height: ROW_H }}>
        {dates.map((d, i) => {
          const cell = cellByDate.get(d);
          const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
          const weekend = wd === 0 || wd === 6;
          const isCovered = covered.has(i);
          const selected = isSelected(p.id, d);
          const reason = cell?.reason ?? null;
          const vacantUnsellable = !isCovered && reason != null && reason !== 'stay' && reason !== 'block';
          const title = cell
            ? [
                d,
                cell.priceCents != null ? `${fmtCellPrice(cell.priceCents)} (${PRICE_SOURCE_LABEL[cell.priceSource]})` : PRICE_SOURCE_LABEL.none,
                cell.minNights ? `${cell.minNights} night min` : null,
                cell.closed ? 'Closed' : null,
                reason ? `${UNSELLABLE_LABEL[reason]}${cell.reasonDetail ? `: ${cell.reasonDetail}` : ''}` : null,
                cell.requests ? `${cell.requests} request${cell.requests === 1 ? '' : 's'} pending` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : d;
          return (
            <div
              key={d}
              title={title}
              onMouseDown={(e) => {
                if (isCovered || e.button !== 0) return;
                e.preventDefault();
                onCellDown(d);
              }}
              onMouseEnter={() => onCellEnter(d)}
              style={{
                position: 'absolute',
                left: i * CELL_W,
                top: 0,
                width: CELL_W,
                height: '100%',
                borderLeft: '1px solid var(--rule-soft)',
                background: selected
                  ? 'rgba(148,109,46,0.18)'
                  : d === today
                  ? 'rgba(148,109,46,0.06)'
                  : weekend
                  ? 'rgba(11,37,69,0.03)'
                  : 'transparent',
                cursor: isCovered ? 'default' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingBottom: 5,
                gap: 1,
              }}
            >
              {!isCovered && cell && (
                <>
                  {cell.requests > 0 && (
                    <span title={`${cell.requests} pending request${cell.requests === 1 ? '' : 's'}`} style={{ position: 'absolute', top: 5, right: 5, width: 6, height: 6, borderRadius: '50%', background: 'var(--signal)' }} />
                  )}
                  {vacantUnsellable && (
                    <span style={{ fontSize: 8, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)', lineHeight: 1 }}>
                      {reason === 'off_season' ? 'season' : reason === 'closed' ? 'closed' : reason === 'past' ? '' : reason === 'advance_notice' ? 'notice' : reason === 'booking_window' ? 'window' : ''}
                    </span>
                  )}
                  <span
                    className="tabular-nums"
                    style={{
                      fontSize: 10,
                      lineHeight: 1,
                      color: cell.priceSource === 'helm' ? 'var(--ink)' : 'var(--ink-3)',
                      textDecoration: cell.closed ? 'line-through' : 'none',
                      fontStyle: cell.priceSource === 'guesty_mirror' ? 'italic' : 'normal',
                    }}
                  >
                    {cell.priceCents != null ? fmtCellPrice(cell.priceCents) : cell.reason === 'past' ? '' : '·'}
                  </span>
                  {cell.minNights != null && cell.minNights > 1 && cell.priceCents != null && (
                    <span style={{ fontSize: 8, color: 'var(--ink-4)', lineHeight: 1 }}>{cell.minNights}n</span>
                  )}
                </>
              )}
            </div>
          );
        })}

        {row.bars.map((bar) => {
          const left = bar.startIdx * CELL_W + (bar.startsBefore ? 0 : CELL_W / 2);
          const right = bar.endIdx * CELL_W + (bar.endsAfter ? 0 : CELL_W / 2);
          const width = Math.max(right - left, 8);
          const color = channelColor(bar.channel, bar.isHold);
          return (
            <button
              type="button"
              key={bar.id}
              onClick={() => onBarClick(bar)}
              onMouseDown={(e) => e.stopPropagation()}
              title={`${bar.label} · ${bar.check_in} to ${bar.check_out} · ${CHANNEL_LABELS[bar.channel] ?? bar.channel} · ${bar.glyphLabel}`}
              style={{
                position: 'absolute',
                left,
                top: 9,
                height: 24,
                width,
                background: bar.isHold
                  ? 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--ink-4) 40%, var(--paper)) 0 3px, var(--paper-2) 3px 7px)'
                  : color,
                border: bar.isHold ? '1px solid var(--ink-4)' : 'none',
                borderRadius: bar.startsBefore || bar.endsAfter ? 0 : 3,
                color: bar.isHold ? 'var(--ink-2)' : 'var(--paper)',
                fontSize: 10,
                padding: '0 7px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textAlign: 'left',
                fontWeight: 500,
                letterSpacing: '.02em',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                opacity: bar.status === 'completed' ? 0.75 : 1,
                zIndex: 1,
              }}
            >
              <span aria-hidden style={{ fontSize: 9, opacity: 0.85 }}>{bar.glyph}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{bar.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Drawers ─────────────────────────────────────────────────────────────────

function DrawerShell({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <aside
      role="dialog"
      aria-label={title}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(420px, 100vw)',
        background: 'var(--paper)',
        borderLeft: '1px solid var(--ink)',
        boxShadow: '-12px 0 40px rgba(11,37,69,0.12)',
        padding: '28px 28px 40px',
        overflowY: 'auto',
        zIndex: 40,
        color: 'var(--ink)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <div className="eyebrow">{eyebrow}</div>
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ink-3)', lineHeight: 1 }}>
          ×
        </button>
      </div>
      <h3 className="font-serif" style={{ fontSize: 26, fontWeight: 400, letterSpacing: '-0.01em', margin: '0 0 18px' }}>
        {title}
      </h3>
      {children}
    </aside>
  );
}

export function EditDrawer({
  row,
  start,
  end,
  onClose,
  onSaved,
  initialMode,
}: {
  row: CalendarRowVM;
  start: string;
  end: string;
  onClose: () => void;
  onSaved: () => void;
  initialMode?: 'price' | 'block' | 'quote';
}) {
  const p = row.property;
  const nights = row.cells.filter((c) => c.date >= start && c.date <= end);
  const single = nights.length === 1;
  const first = nights[0];
  const [mode, setMode] = useState<'price' | 'block' | 'quote'>(initialMode ?? (p.helmRun && single ? 'price' : 'block'));
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CalendarActionResult | null>(null);

  // Price fields prefilled from the first night's override state.
  const [nightly, setNightly] = useState<string>(first?.priceSource === 'helm' && first.priceCents != null ? String(Math.round(first.priceCents / 100)) : '');
  const [minNights, setMinNights] = useState<string>(first?.minNights != null ? String(first.minNights) : '');
  const [closed, setClosed] = useState<boolean>(!!first?.closed);
  const [note, setNote] = useState<string>(first?.note ?? '');

  const [holdKind, setHoldKind] = useState<'owner' | 'maintenance' | 'ota' | 'other'>('owner');
  const [holdNote, setHoldNote] = useState('');

  const rangeLabel = single ? start : `${start} to ${end} · ${nights.length} nights`;
  const checkOut = nextDay(end);

  const [guests, setGuests] = useState('2');
  const [quote, setQuote] = useState<QuoteRangeResult | null>(null);
  const runQuote = useCallback(() => {
    startTransition(async () => {
      const r = await quoteRangeAction({ propertyId: p.id, checkIn: start, checkOut, guests: Number(guests) || 1 });
      setQuote(r);
    });
  }, [p.id, start, checkOut, guests, startTransition]);
  // A shift-click opens the drawer straight on the quote tab; price it once
  // on arrival. The tab button prices on every later click.
  const autoQuoted = useRef(false);
  useEffect(() => {
    if (autoQuoted.current) return;
    if (initialMode === 'quote' && p.helmRun) {
      autoQuoted.current = true;
      runQuote();
    }
  }, [initialMode, p.helmRun, runQuote]);
  const openQuote = () => {
    setMode('quote');
    if (p.helmRun) runQuote();
  };

  const submitPrice = () => {
    setResult(null);
    startTransition(async () => {
      const r = await saveRateDaysAction({
        propertyId: p.id,
        start,
        end,
        nightlyDollars: nightly,
        minNights,
        closed,
        note,
      });
      setResult(r);
      if (r.ok) setTimeout(onSaved, 900);
    });
  };

  const submitBlock = () => {
    setResult(null);
    startTransition(async () => {
      const r = await createBlockAction({ propertyId: p.id, checkIn: start, checkOut, holdKind, note: holdNote });
      setResult(r);
      if (r.ok) setTimeout(onSaved, 1400);
    });
  };

  return (
    <DrawerShell eyebrow={`${p.name} · ${p.badgeLabel}`} title={rangeLabel} onClose={onClose}>
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--rule)', marginBottom: 18 }}>
        <TabButton active={mode === 'price'} onClick={() => setMode('price')} label="Price and rules" />
        <TabButton active={mode === 'block'} onClick={() => setMode('block')} label="Block these nights" />
        <TabButton active={mode === 'quote'} onClick={openQuote} label="Quote" />
      </div>

      {mode === 'price' && (
        <div style={{ display: 'grid', gap: 14 }}>
          {!p.helmRun && (
            <Note tone="signal">
              Guesty runs this calendar. The {fmtCellPrice(first?.priceCents ?? null) || 'price'} shown is Guesty&apos;s or PriceLabs&apos; number, mirrored here. A rate typed in Helm would never reach Airbnb, VRBO or Booking.com, so editing is off until the home is flipped.
            </Note>
          )}
          {p.helmRun && !p.hasPlan && (
            <Note tone="negative">
              This home has no rate plan yet, so a per-night override has nothing to override.{' '}
              <Link href={`/properties/${p.id}?tab=rates`} style={{ color: 'inherit' }}>Set the plan on the Rates tab.</Link>
            </Note>
          )}
          <Field label="Nightly rate (USD)" hint="Blank returns the night to the plan's own rate (weekend or base).">
            <input
              type="text"
              inputMode="decimal"
              value={nightly}
              onChange={(e) => setNightly(e.target.value)}
              disabled={!p.helmRun || pending}
              placeholder={first?.priceCents != null ? String(Math.round(first.priceCents / 100)) : 'plan rate'}
              style={inputStyle}
            />
          </Field>
          <Field label="Minimum nights" hint="Blank uses the plan default.">
            <input type="number" min={1} max={365} value={minNights} onChange={(e) => setMinNights(e.target.value)} disabled={!p.helmRun || pending} style={inputStyle} />
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
            <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} disabled={!p.helmRun || pending} />
            Closed (not for sale; shows as a hold on the export feed)
          </label>
          <Field label="Note" hint="Why this night is priced or closed this way. Shows on the property month grid.">
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} disabled={!p.helmRun || pending} style={inputStyle} />
          </Field>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
            <button type="button" onClick={submitPrice} disabled={!p.helmRun || pending} style={primaryButton(!p.helmRun || pending)}>
              {pending ? 'Saving…' : single ? 'Save night' : `Save ${nights.length} nights`}
            </button>
            <button type="button" onClick={onClose} style={ghostButton}>Cancel</button>
          </div>
        </div>
      )}

      {mode === 'block' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5, margin: 0 }}>
            Holds {nights.length} night{nights.length === 1 ? '' : 's'}, {start} to {checkOut} (the morning the hold ends). The database refuses the hold if another stay has any of these nights.
          </p>
          {!p.helmRun && (
            <Note tone="signal">Guesty still runs this calendar: the hold lives in Helm only until the flip. Block the dates in Guesty too.</Note>
          )}
          <Field label="Kind">
            <select value={holdKind} onChange={(e) => setHoldKind(e.target.value as typeof holdKind)} disabled={pending} style={inputStyle}>
              <option value="owner">Owner stay</option>
              <option value="maintenance">Maintenance</option>
              <option value="other">Other</option>
              <option value="ota">Channel block</option>
            </select>
          </Field>
          <Field label="Note" hint="Who or what. Rides into the Operations calendar and the cleaner schedule.">
            <input type="text" value={holdNote} onChange={(e) => setHoldNote(e.target.value)} disabled={pending} placeholder="July 4 family week; HVAC replacement" style={inputStyle} />
          </Field>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
            <button type="button" onClick={submitBlock} disabled={pending} style={primaryButton(pending)}>
              {pending ? 'Holding…' : 'Create block'}
            </button>
            <button type="button" onClick={onClose} style={ghostButton}>Cancel</button>
          </div>
        </div>
      )}

      {mode === 'quote' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5, margin: 0 }}>
            A direct-channel quote for {start} to {checkOut}, {nights.length} night{nights.length === 1 ? '' : 's'}, from Helm&apos;s rate plan and tax config through the same formula staycapeann.com uses.
          </p>
          {!p.helmRun && <Note tone="signal">Guesty prices this home. Helm quotes only the homes it runs.</Note>}
          {p.helmRun && (
            <>
              <Field label="Guests">
                <input type="number" min={1} max={30} value={guests} onChange={(e) => setGuests(e.target.value)} disabled={pending} style={inputStyle} />
              </Field>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" onClick={runQuote} disabled={pending} style={primaryButton(pending)}>
                  {pending ? 'Pricing…' : 'Re-quote'}
                </button>
                <Link href={`/channels/bookings/new?property=${p.id}&check_in=${start}&check_out=${checkOut}&guests=${guests}`} style={ghostLink}>
                  Book these dates
                </Link>
              </div>
            </>
          )}
          {quote && !quote.ok && <Note tone="negative">{quote.error}</Note>}
          {quote && quote.ok && <QuoteTable q={quote} />}
        </div>
      )}

      {result && (
        <div
          role="status"
          style={{
            marginTop: 18,
            borderLeft: `3px solid ${result.ok ? 'var(--positive)' : 'var(--negative)'}`,
            padding: '10px 14px',
            background: 'var(--paper-2)',
            fontSize: 13,
            lineHeight: 1.5,
            color: result.ok ? 'var(--ink)' : 'var(--negative)',
          }}
        >
          {result.ok ? result.message : result.error}
        </div>
      )}
    </DrawerShell>
  );
}

function QuoteTable({ q }: { q: Extract<QuoteRangeResult, { ok: true }> }) {
  const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const rows: Array<[string, string]> = [
    [`Accommodation · ${q.quote.nights} night${q.quote.nights === 1 ? '' : 's'}`, money(q.quote.accommodation_cents)],
  ];
  if (q.quote.extra_guest_cents > 0) rows.push(['Extra guests', money(q.quote.extra_guest_cents)]);
  if (q.quote.discount_cents > 0) rows.push([q.quote.discount_label ?? 'Discount', `-${money(q.quote.discount_cents)}`]);
  if (q.quote.markup_cents > 0) rows.push(['Direct rate adjustment', money(q.quote.markup_cents)]);
  if (q.quote.cleaning_cents > 0) rows.push(['Cleaning', money(q.quote.cleaning_cents)]);
  rows.push([q.quote.tax_exempt ? 'Occupancy tax (exempt)' : `Occupancy tax · ${(q.quote.tax_rate * 100).toFixed(2).replace(/\.?0+$/, '')}%`, money(q.quote.tax_cents)]);
  return (
    <div>
      <div
        style={{
          borderLeft: `3px solid ${q.available ? 'var(--positive)' : 'var(--negative)'}`,
          padding: '8px 12px',
          background: 'var(--paper-2)',
          fontSize: 12,
          marginBottom: 12,
          lineHeight: 1.5,
        }}
      >
        {q.available
          ? 'These nights are open.'
          : `Not bookable: ${q.unavailableDates.length} night${q.unavailableDates.length === 1 ? '' : 's'} unavailable${q.reservedDates.length > 0 ? ` (${q.reservedDates.length} reserved by a guest)` : ''}.`}
        {q.quote.violations.length > 0 && <> Rules: {q.quote.violations.map((v) => v.replace(/_/g, ' ')).join(', ')}.</>}
      </div>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              <td style={{ padding: '6px 0', color: 'var(--ink-2)' }}>{k}</td>
              <td className="tabular-nums" style={{ padding: '6px 0', textAlign: 'right' }}>{v}</td>
            </tr>
          ))}
          <tr>
            <td className="font-serif" style={{ padding: '10px 0 0', fontSize: 16 }}>Total</td>
            <td className="font-serif tabular-nums" style={{ padding: '10px 0 0', textAlign: 'right', fontSize: 16 }}>{money(q.quote.total_cents)}</td>
          </tr>
        </tbody>
      </table>
      <div className="font-mono" style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 10, lineHeight: 1.6 }}>
        {q.quote.nightly.map((n) => `${n.date.slice(5)} ${money(n.cents)}${n.source === 'override' ? '*' : ''}`).join(' · ')}
        {q.quote.nightly.some((n) => n.source === 'override') && <div>* per-night override</div>}
      </div>
    </div>
  );
}

export function StayCard({ row, bar, onClose }: { row: CalendarRowVM; bar: CalendarBarVM; onClose: () => void }) {
  const p = row.property;
  return (
    <DrawerShell eyebrow={`${p.name} · ${CHANNEL_LABELS[bar.channel] ?? bar.channel}`} title={bar.label} onClose={onClose}>
      <dl className="font-mono" style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 14px', fontSize: 12, margin: 0, color: 'var(--ink-2)' }}>
        <dt style={{ color: 'var(--ink-4)' }}>dates</dt>
        <dd style={{ margin: 0 }}>{bar.check_in} to {bar.check_out} · {bar.nights} night{bar.nights === 1 ? '' : 's'}</dd>
        <dt style={{ color: 'var(--ink-4)' }}>status</dt>
        <dd style={{ margin: 0 }}>{bar.status}{bar.isHold && bar.hold_kind ? ` · ${bar.hold_kind}` : ''}</dd>
        <dt style={{ color: 'var(--ink-4)' }}>source</dt>
        <dd style={{ margin: 0 }}>{bar.glyph} {bar.glyphLabel}</dd>
        {bar.code && (
          <>
            <dt style={{ color: 'var(--ink-4)' }}>code</dt>
            <dd style={{ margin: 0 }}>{bar.code}</dd>
          </>
        )}
        {bar.created_by && (
          <>
            <dt style={{ color: 'var(--ink-4)' }}>created by</dt>
            <dd style={{ margin: 0, wordBreak: 'break-all' }}>{bar.created_by}</dd>
          </>
        )}
        {bar.notes && (
          <>
            <dt style={{ color: 'var(--ink-4)' }}>note</dt>
            <dd style={{ margin: 0, fontFamily: 'inherit' }}>{bar.notes}</dd>
          </>
        )}
      </dl>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 22 }}>
        <Link href={`/channels/bookings/${bar.id}`} style={primaryLink}>Open record</Link>
        <Link href={`/channels/${p.id}`} style={ghostLink}>Property hub</Link>
        <Link href={`/channels/${p.id}/calendar?month=${bar.check_in.slice(0, 7)}`} style={ghostLink}>Month grid</Link>
      </div>
    </DrawerShell>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--ink)' : '2px solid transparent',
        marginBottom: -1,
        padding: '8px 12px 8px 0',
        marginRight: 16,
        fontSize: 10,
        letterSpacing: '.14em',
        textTransform: 'uppercase',
        fontWeight: 600,
        color: active ? 'var(--ink)' : 'var(--ink-4)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="eyebrow" style={{ color: 'var(--ink-3)' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.4 }}>{hint}</span>}
    </label>
  );
}

function Note({ tone, children }: { tone: 'signal' | 'negative'; children: React.ReactNode }) {
  return (
    <div style={{ borderLeft: `3px solid var(--${tone})`, padding: '10px 14px', background: 'var(--paper-2)', fontSize: 12, lineHeight: 1.5, color: 'var(--ink-2)' }}>
      {children}
    </div>
  );
}


const inputStyle: React.CSSProperties = {
  fontSize: 14,
  padding: '10px 12px',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  width: '100%',
  fontFamily: 'inherit',
};

function primaryButton(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? 'var(--ink-4)' : 'var(--ink)',
    color: 'var(--paper)',
    fontSize: 11,
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    fontWeight: 600,
    padding: '10px 18px',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

const ghostButton: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  fontSize: 11,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  fontWeight: 500,
  padding: '10px 12px',
  border: 'none',
  cursor: 'pointer',
};

const primaryLink: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 11,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  fontWeight: 600,
  padding: '10px 18px',
  textDecoration: 'none',
};

const ghostLink: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 11,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  fontWeight: 500,
  padding: '9px 16px',
  border: '1px solid var(--ink)',
  textDecoration: 'none',
};
