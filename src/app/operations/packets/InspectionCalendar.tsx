'use client';

import { useState } from 'react';
import { maxPairwiseMiles } from '@/lib/proximity';
import type { CalRow, InspectionCalendarData } from '@/lib/field-packets';
import { bundleAndSend } from './actions';

const TRAVEL_PER_MILE_CENTS = 300;
const PROXIMITY_MILES = 3;

function dayHead(d: string): { wd: string; n: string } {
  try {
    const dt = new Date(`${d}T00:00:00`);
    return { wd: dt.toLocaleDateString('en-US', { weekday: 'short' }), n: dt.toLocaleDateString('en-US', { day: 'numeric' }) };
  } catch {
    return { wd: '', n: d };
  }
}
function fmtDay(d: string): string {
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

export function InspectionCalendar({ days, rows }: InspectionCalendarData) {
  const [selDay, setSelDay] = useState<string | null>(null);
  const [selProps, setSelProps] = useState<string[]>([]);
  const [priceStr, setPriceStr] = useState('');
  const [sending, setSending] = useState(false);

  const rowById = new Map(rows.map((r) => [r.propertyId, r]));

  function toggle(propertyId: string, day: string) {
    setPriceStr('');
    if (selDay !== day) {
      setSelDay(day);
      setSelProps([propertyId]);
      return;
    }
    setSelProps((prev) => {
      const next = prev.includes(propertyId) ? prev.filter((x) => x !== propertyId) : [...prev, propertyId];
      if (next.length === 0) setSelDay(null);
      return next;
    });
  }

  function selectColumn(day: string) {
    const open = rows.filter((r) => r.cells.find((c) => c.date === day)?.inspectable).map((r) => r.propertyId);
    if (open.length === 0) return;
    setSelDay(day);
    setSelProps(open);
    setPriceStr('');
  }

  function suggest() {
    for (const day of days) {
      const open = rows.filter((r) => r.cells.find((c) => c.date === day)?.inspectable && r.lat != null && r.lng != null);
      if (open.length < 2) continue;
      for (let i = 0; i < open.length; i++) {
        const cluster = [open[i]];
        for (let j = 0; j < open.length; j++) {
          if (j === i) continue;
          const trial = [...cluster, open[j]].map((r) => ({ lat: r.lat!, lng: r.lng! }));
          if (maxPairwiseMiles(trial) <= PROXIMITY_MILES) cluster.push(open[j]);
        }
        if (cluster.length >= 2) {
          setSelDay(day);
          setSelProps(cluster.map((r) => r.propertyId));
          setPriceStr('');
          return;
        }
      }
    }
  }

  const selectedRows = selDay ? (selProps.map((id) => rowById.get(id)).filter(Boolean) as CalRow[]) : [];
  const pts = selectedRows.filter((r) => r.lat != null && r.lng != null).map((r) => ({ lat: r.lat!, lng: r.lng! }));
  const spread = pts.length > 1 ? maxPairwiseMiles(pts) : 0;
  const baseSum = selectedRows.reduce((a, r) => a + r.basePriceCents, 0);
  const suggestedDollars = Math.round((baseSum + Math.round(spread * TRAVEL_PER_MILE_CENTS)) / 100);
  const area = (() => {
    const counts = new Map<string, number>();
    for (const r of selectedRows) {
      const m = (r.propertyName || '').match(/[A-Za-z][A-Za-z\s]+$/);
      const k = (m ? m[0] : r.propertyName).trim();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] > 1 ? top[0] : null;
  })();

  if (rows.length === 0) {
    return (
      <p style={{ color: 'var(--ink-3)', fontSize: 14, marginTop: 24 }}>
        No inspections need covering in this window. Widen the dates above.
      </p>
    );
  }

  const gridCols = `150px repeat(${days.length}, minmax(40px, 1fr))`;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          Open windows · {rows.length} {rows.length === 1 ? 'property' : 'properties'}
        </span>
        <button type="button" onClick={suggest} style={ghost}>Suggest a day</button>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--rule)', borderRadius: 10, background: 'var(--paper-2, #fff)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: gridCols, minWidth: 640 }}>
          <div style={{ borderBottom: '1px solid var(--rule)' }} />
          {days.map((d) => {
            const h = dayHead(d);
            const isSel = d === selDay;
            return (
              <button
                key={d}
                type="button"
                onClick={() => selectColumn(d)}
                title="Plan a visit this day — selects every property open"
                style={{
                  textAlign: 'center',
                  padding: '8px 2px',
                  borderBottom: '1px solid var(--rule)',
                  borderLeft: '1px solid var(--rule)',
                  background: isSel ? 'rgba(200,90,58,0.08)' : 'transparent',
                  cursor: 'pointer',
                  lineHeight: 1.2,
                }}
              >
                <div style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h.wd}</div>
                <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{h.n}</div>
              </button>
            );
          })}

          {rows.map((r) => (
            <CalendarRow
              key={r.propertyId}
              row={r}
              days={days}
              selDay={selDay}
              selected={selProps}
              onToggle={toggle}
            />
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: 'var(--ink-3)', marginTop: 10, alignItems: 'center' }}>
        <Swatch bg="rgba(63,153,34,0.18)" label="open to inspect" />
        <Swatch bg="rgba(58,107,138,0.16)" label="already out to a contractor" />
        <Swatch bg="rgba(30,46,52,0.08)" label="guest in house" />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 4, height: 14, background: 'var(--signal)' }} /> next check-in
        </span>
        <Swatch bg="var(--signal)" label="picked" />
      </div>

      {selectedRows.length > 0 && selDay && (
        <form
          action={bundleAndSend}
          onSubmit={() => setSending(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            border: '2px solid var(--signal)',
            borderRadius: 12,
            padding: '14px 18px',
            marginTop: 16,
            background: 'rgba(200,90,58,0.05)',
          }}
        >
          <input type="hidden" name="visit_date" value={selDay} />
          <input type="hidden" name="property_ids" value={selProps.join(',')} />
          <input type="hidden" name="price_dollars" value={priceStr || String(suggestedDollars)} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>
              {selectedRows.length} selected{area ? ` on ${area}` : ''} · {fmtDay(selDay)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              {spread > 0 ? `~${spread < 1 ? '<1' : Math.round(spread)} mi apart · ` : ''}one visit · suggested pay ${suggestedDollars}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--rule)', borderRadius: 8, padding: '5px 9px', background: 'var(--paper-2, #fff)' }}>
              <span style={{ color: 'var(--ink-4)', fontSize: 13 }}>$</span>
              <input
                type="number"
                min={0}
                step={5}
                value={priceStr}
                placeholder={String(suggestedDollars)}
                onChange={(e) => setPriceStr(e.target.value)}
                aria-label="Packet price"
                style={{ width: 56, font: 'inherit', fontSize: 14, color: 'var(--ink)', background: 'transparent', border: 'none', outline: 'none', padding: 0 }}
              />
            </div>
            <button
              type="submit"
              disabled={sending}
              style={{
                background: 'var(--signal)',
                color: 'var(--paper)',
                border: 'none',
                borderRadius: 8,
                cursor: sending ? 'default' : 'pointer',
                opacity: sending ? 0.6 : 1,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                padding: '11px 20px',
                whiteSpace: 'nowrap',
              }}
            >
              {sending ? 'Sending…' : 'Bundle & send →'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function CalendarRow({
  row,
  days,
  selDay,
  selected,
  onToggle,
}: {
  row: CalRow;
  days: string[];
  selDay: string | null;
  selected: string[];
  onToggle: (propertyId: string, day: string) => void;
}) {
  const cellByDate = new Map(row.cells.map((c) => [c.date, c]));
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          fontSize: 13,
          color: 'var(--ink)',
          borderBottom: '1px solid var(--rule)',
          minHeight: 34,
        }}
      >
        {row.propertyName}
      </div>
      {days.map((d) => {
        const c = cellByDate.get(d);
        const isSel = selDay === d && selected.includes(row.propertyId);
        const clickable = !!c?.inspectable;
        let bg = 'transparent';
        if (c?.state === 'blocked') bg = 'rgba(30,46,52,0.16)';
        else if (c?.state === 'occupied') bg = 'rgba(30,46,52,0.08)';
        else if (isSel) bg = 'var(--signal)';
        else if (c?.inspectable) bg = 'rgba(63,153,34,0.18)';
        else if (c?.covered) bg = 'rgba(58,107,138,0.16)';
        else bg = 'rgba(30,46,52,0.025)';
        return (
          <button
            key={d}
            type="button"
            disabled={!clickable}
            onClick={() => clickable && onToggle(row.propertyId, d)}
            title={
              clickable
                ? `${row.propertyName} is open ${fmtDay(d)} — click to inspect that day`
                : c?.covered
                  ? `${row.propertyName}'s next guest is already out to a contractor`
                  : undefined
            }
            style={{
              minHeight: 34,
              margin: 2,
              borderRadius: 4,
              borderWidth: 0,
              borderLeft: c?.checkIn ? '3px solid var(--signal)' : undefined,
              background: bg,
              cursor: clickable ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 12,
            }}
          >
            {isSel ? '✓' : ''}
          </button>
        );
      })}
    </>
  );
}

function Swatch({ bg, label }: { bg: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 14, height: 14, borderRadius: 3, background: bg }} /> {label}
    </span>
  );
}

const ghost: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  border: '1px solid var(--rule)',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '8px 14px',
};
