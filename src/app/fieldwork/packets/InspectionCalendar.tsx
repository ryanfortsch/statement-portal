'use client';

import { useState } from 'react';
import { centroid, maxPairwiseMiles } from '@/lib/proximity';
import { PROXIMITY_MILES, MAX_STOPS, priceCents, isRushVisit } from '@/lib/field-pricing';
import type { CalRow, InspectionCalendarData } from '@/lib/field-packets';
import { PacketRouteMap } from '@/app/field/PacketRouteMap';
import { bundleAndSend, bundleAsDraft } from './actions';

// Greedy proximity clusters of the properties open (inspectable) on a given
// day. Each cluster is one feasible "one visit"; the largest is the best bundle.
// One hue per meaning: green = you can act, blue = someone already has,
// grey = the home isn't available (flat for a guest, striped for an owner
// block so the two greys can't blur together), orange = your current pick.
// Which column is TODAY. Fifteen identical pale columns with nothing marking
// the current one is a miscount waiting to happen — Dotti read a guest-
// occupied 3 Locust as open because she was looking one column over.
const TODAY_ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

const OPEN_BG = 'rgba(63,153,34,0.22)';
const HANDLED_BG = 'rgba(58,107,138,0.34)';
const OCCUPIED_BG = 'rgba(30,46,52,0.10)';
const BLOCKED_BG =
  'repeating-linear-gradient(45deg, rgba(30,46,52,0.16) 0 4px, rgba(30,46,52,0.05) 4px 8px)';

function clustersOnDay(day: string, rows: CalRow[]): CalRow[][] {
  const open = rows.filter(
    (r) => r.cells.find((c) => c.date === day)?.inspectable && r.lat != null && r.lng != null,
  );
  const clusters: CalRow[][] = [];
  const remaining = open.slice();
  while (remaining.length) {
    const cluster = [remaining.shift()!];
    let changed = true;
    while (changed && cluster.length < MAX_STOPS) {
      changed = false;
      for (let i = 0; i < remaining.length; i++) {
        const trial = [...cluster, remaining[i]].map((r) => ({ lat: r.lat!, lng: r.lng! }));
        if (maxPairwiseMiles(trial) <= PROXIMITY_MILES) {
          cluster.push(remaining[i]);
          remaining.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  return Math.round((Date.parse(`${dateStr}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86_400_000);
}

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

export function InspectionCalendar({ days, rows, assignable }: Pick<InspectionCalendarData, 'days' | 'rows'> & {
  /** Inspectors this trade's work can be handed straight to (cleared to claim). */
  assignable: { id: string; name: string }[];
}) {
  const [selDay, setSelDay] = useState<string | null>(null);
  const [selProps, setSelProps] = useState<string[]>([]);
  const [priceStr, setPriceStr] = useState('');
  const [sending, setSending] = useState(false);
  // Empty = post to everyone of this trade. Tick names and the packet is shown
  // and texted to only those inspectors — they still claim it themselves,
  // first come, exactly like any other packet.
  const [offerTo, setOfferTo] = useState<string[]>([]);
  const toggleOffer = (id: string) =>
    setOfferTo((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

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

  function pickBundle(day: string, propIds: string[]) {
    setSelDay(day);
    setSelProps(propIds);
    setPriceStr('');
  }

  // Column-click picks the largest NEARBY cluster that day, not everyone open
  // (which could span 15 miles).
  function selectColumn(day: string) {
    const cs = clustersOnDay(day, rows);
    if (cs.length === 0) return;
    const largest = cs.reduce((a, b) => (b.length > a.length ? b : a));
    pickBundle(day, largest.map((r) => r.propertyId));
  }

  const selectedRows = selDay ? (selProps.map((id) => rowById.get(id)).filter(Boolean) as CalRow[]) : [];
  const pts = selectedRows.filter((r) => r.lat != null && r.lng != null).map((r) => ({ lat: r.lat!, lng: r.lng! }));
  const spread = pts.length > 1 ? maxPairwiseMiles(pts) : 0;
  const suggestedDollars = Math.round(
    priceCents({
      basePrices: selectedRows.map((r) => r.basePriceCents),
      spreadMiles: spread,
      center: pts.length > 0 ? centroid(pts) : null,
      isRush: isRushVisit(selDay),
    }) / 100,
  );
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
      <div style={{ overflowX: 'auto', border: '1px solid var(--rule)', borderRadius: 10, background: 'var(--paper-2, #fff)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: gridCols, minWidth: 640 }}>
          <div style={{ borderBottom: '1px solid var(--rule)' }} />
          {days.map((d) => {
            const h = dayHead(d);
            const isSel = d === selDay;
            const isToday = d === TODAY_ET;
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
                  background: isSel ? 'rgba(200,90,58,0.08)' : isToday ? 'rgba(11,37,69,0.06)' : 'transparent',
                  borderTop: isToday ? '2px solid var(--tide-deep)' : '2px solid transparent',
                  cursor: 'pointer',
                  lineHeight: 1.2,
                }}
              >
                <div style={{ fontSize: 10, color: isToday ? 'var(--tide-deep)' : 'var(--ink-4)', fontWeight: isToday ? 700 : 400, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {isToday ? 'TODAY' : h.wd}
                </div>
                <div style={{ fontSize: 13, color: isToday ? 'var(--tide-deep)' : 'var(--ink-3)', fontWeight: isToday ? 700 : 400 }}>{h.n}</div>
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

      {/* Color states in one key; the check-in edge accent is a different kind
          of mark, so it gets its own line instead of sitting among the fills. */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: 'var(--ink-3)', marginTop: 10, alignItems: 'center' }}>
        <Swatch bg={OPEN_BG} label="open to inspect" />
        <Swatch bg={HANDLED_BG} label="handled — out to a contractor, or done" />
        <Swatch bg={OCCUPIED_BG} label="guest in house" />
        <Swatch bg={BLOCKED_BG} label="owner / blocked" />
        <Swatch bg="var(--signal)" label="picked" />
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>
        Initials in a handled day are whoever has it — the inspector it&apos;s assigned to, or who walked it.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>
        <span style={{ width: 4, height: 14, background: 'var(--signal)', flexShrink: 0 }} />
        A red left edge marks the day a guest checks in, the deadline to inspect by.
      </div>

      {selectedRows.length > 1 && (
        <div style={{ marginTop: 16 }}>
          {/* key on the selection so the map remounts and redraws when the
              picked stops change (PacketRouteMap draws once on mount). */}
          <PacketRouteMap
            key={`${selDay}:${[...selProps].sort().join(',')}`}
            stops={selectedRows
              .filter((r) => r.lat != null && r.lng != null)
              .map((r, i) => ({ label: r.propertyName, lat: r.lat!, lng: r.lng!, order: i }))}
          />
        </div>
      )}

      {selectedRows.length > 0 && selDay && (
        <form
          action={async (fd: FormData) => {
            setSending(true);
            try {
              if (fd.get('mode') === 'draft') {
                // Save a draft and jump to the packet page to add a setup /
                // one-off before publishing (bundleAsDraft redirects there).
                await bundleAsDraft(fd);
              } else {
                await bundleAndSend(fd);
                // Clear the picked day/properties so the board shows the fresh
                // packet under "Out to contractors" instead of staying stuck.
                setSelProps([]);
                setSelDay(null);
                setPriceStr('');
                setOfferTo([]);
              }
            } finally {
              setSending(false);
            }
          }}
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
          <input type="hidden" name="offer_to" value={offerTo.join(',')} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>
              {selectedRows.length} selected{area ? ` on ${area}` : ''} · {fmtDay(selDay)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              {spread > 0 ? `~${spread < 1 ? '<1' : Math.round(spread)} mi apart · ` : ''}one visit · suggested pay ${suggestedDollars} · leave blank to use it
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {assignable.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Who can see this">
                <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>Show to</span>
                {assignable.map((c) => {
                  const on = offerTo.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleOffer(c.id)}
                      aria-pressed={on}
                      title={on ? `Only these inspectors will see it` : `Limit this packet to ${c.name}`}
                      style={{
                        font: 'inherit',
                        fontSize: 12.5,
                        cursor: 'pointer',
                        borderRadius: 999,
                        padding: '6px 11px',
                        border: `1px solid ${on ? 'var(--tide-deep)' : 'var(--rule)'}`,
                        background: on ? 'rgba(58,107,138,0.12)' : 'var(--paper-2, #fff)',
                        color: on ? 'var(--tide-deep)' : 'var(--ink-3)',
                        fontWeight: on ? 600 : 400,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {on ? '✓ ' : ''}{c.name.split(' ')[0]}
                    </button>
                  );
                })}
                {offerTo.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOfferTo([])}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 11.5, textDecoration: 'underline', textUnderlineOffset: 3, padding: 0 }}
                  >
                    everyone
                  </button>
                )}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--rule)', borderRadius: 8, padding: '5px 9px', background: 'var(--paper-2, #fff)' }}>
              <span style={{ color: 'var(--ink-4)', fontSize: 13 }}>$</span>
              <input
                type="number"
                min={0}
                step={1}
                value={priceStr}
                placeholder={String(suggestedDollars)}
                onChange={(e) => setPriceStr(e.target.value)}
                aria-label="Packet price"
                style={{ width: 56, font: 'inherit', fontSize: 14, color: 'var(--ink)', background: 'transparent', border: 'none', outline: 'none', padding: 0 }}
              />
            </div>
            <button
              type="submit"
              name="mode"
              value="draft"
              disabled={sending}
              title="Save as a draft and open it, so you can add a property setup or one-off job before publishing"
              style={{
                background: 'var(--paper-2, #fff)',
                color: 'var(--ink-3)',
                border: '1px solid var(--rule)',
                borderRadius: 8,
                cursor: sending ? 'default' : 'pointer',
                opacity: sending ? 0.6 : 1,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                padding: '11px 16px',
                whiteSpace: 'nowrap',
              }}
            >
              Review &amp; add-ons
            </button>
            <button
              type="submit"
              name="mode"
              value="send"
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
              {sending
                ? 'Sending…'
                : offerTo.length
                  ? `Send to ${offerTo.length} inspector${offerTo.length === 1 ? '' : 's'} →`
                  : 'Bundle & send →'}
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
  const dd = daysUntil(row.nextDeadline);
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 12px',
          fontSize: 13,
          color: 'var(--ink)',
          borderBottom: '1px solid var(--rule)',
          minHeight: 34,
        }}
      >
        {row.propertyName}
        {dd != null && dd >= 0 && dd <= 2 && (
          <span
            title={`Guest checks in ${dd === 0 ? 'today' : `in ${dd} day${dd === 1 ? '' : 's'}`} — still uncovered`}
            style={{ fontSize: 10, fontWeight: 600, color: 'var(--signal)', whiteSpace: 'nowrap' }}
          >
            {dd === 0 ? 'today' : `${dd}d`}
          </span>
        )}
      </div>
      {days.map((d) => {
        const c = cellByDate.get(d);
        const isSel = selDay === d && selected.includes(row.propertyId);
        const clickable = !!c?.inspectable;
        let bg = 'transparent';
        if (c?.state === 'blocked') bg = BLOCKED_BG;
        else if (c?.state === 'occupied') bg = OCCUPIED_BG;
        else if (isSel) bg = 'var(--signal)';
        else if (c?.inspectable) bg = OPEN_BG;
        // Out to a contractor and already-done both mean the same thing to the
        // operator here — not your problem — so they share one fill; the hover
        // says which. (Two greens for "act" vs "handled" read as one colour.)
        else if (c?.covered || c?.inspected) bg = HANDLED_BG;
        else bg = 'rgba(30,46,52,0.03)';
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
                  ? `${row.propertyName}'s next guest is out to ${c.who ? c.who : 'a contractor'}`
                  : c?.inspected
                    ? `${row.propertyName}'s next turnover is handled${c.who ? ` — inspected by ${c.who}` : ' — inspected or marked done'}`
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
            {isSel ? '✓' : (c?.covered || c?.inspected) && c?.who ? (
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--tide-deep)' }}>{c.who}</span>
            ) : ''}
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

