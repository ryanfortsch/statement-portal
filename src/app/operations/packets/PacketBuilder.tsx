'use client';

import { useMemo, useState } from 'react';
import { maxPairwiseMiles } from '@/lib/proximity';
import type { WorkDay, WorkItem } from '@/lib/field-packets';
import { bundleAndSend } from './actions';

const TRAVEL_PER_MILE_CENTS = 300;

function fmtDay(d: string): string {
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}
function fmtShort(d: string): string {
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}
function timing(it: WorkItem): string {
  if (it.basis === 'checkout_day') return `after ${it.priorCheckout ? fmtShort(it.priorCheckout) : 'morning'} checkout`;
  if (it.basis === 'pre_checkin') return `before ${it.nextCheckin ? fmtShort(it.nextCheckin) : ''} check-in`;
  return 'vacant all day';
}

/**
 * Work-first packet builder. Lists upcoming inspections grouped by day; the
 * operator checks the nearby ones (or taps Suggest groupings) and bundles them
 * into a published packet in one step. Selection is constrained to a single
 * day — you can't bundle across days into one visit.
 */
export function PacketBuilder({ days }: { days: WorkDay[] }) {
  const [selDay, setSelDay] = useState<string | null>(null);
  const [selIds, setSelIds] = useState<string[]>([]);
  const [priceStr, setPriceStr] = useState('');

  const itemsByDay = useMemo(() => {
    const m = new Map<string, WorkItem[]>();
    for (const d of days) m.set(d.date, d.items);
    return m;
  }, [days]);

  function toggle(date: string, id: string) {
    setPriceStr('');
    if (selDay !== date) {
      setSelDay(date);
      setSelIds([id]);
      return;
    }
    setSelIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (next.length === 0) setSelDay(null);
      return next;
    });
  }

  function suggest() {
    for (const d of days) {
      const byCluster = new Map<number, string[]>();
      for (const it of d.items) {
        const a = byCluster.get(it.clusterId) ?? [];
        a.push(it.propertyId);
        byCluster.set(it.clusterId, a);
      }
      let bestIds: string[] | null = null;
      for (const ids of byCluster.values()) {
        if (ids.length >= 2 && (!bestIds || ids.length > bestIds.length)) bestIds = ids;
      }
      if (bestIds) {
        setSelDay(d.date);
        setSelIds(bestIds);
        setPriceStr('');
        return;
      }
    }
  }

  const selectedItems = useMemo(() => {
    if (!selDay) return [] as WorkItem[];
    return (itemsByDay.get(selDay) ?? []).filter((it) => selIds.includes(it.propertyId));
  }, [selDay, selIds, itemsByDay]);

  const pts = selectedItems.filter((it) => it.lat != null && it.lng != null).map((it) => ({ lat: it.lat!, lng: it.lng! }));
  const spread = pts.length > 1 ? maxPairwiseMiles(pts) : 0;
  const baseSum = selectedItems.reduce((a, it) => a + it.basePriceCents, 0);
  const suggestedDollars = Math.round((baseSum + Math.round(spread * TRAVEL_PER_MILE_CENTS)) / 100);

  const total = days.reduce((a, d) => a + d.items.length, 0);
  if (total === 0) {
    return (
      <p style={{ color: 'var(--ink-3)', fontSize: 14, marginTop: 24 }}>
        No inspections need covering in this window — everything upcoming is already out to a contractor or
        outside the dates. Widen the window above to see more.
      </p>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          Needs inspecting · {total}
        </span>
        <button type="button" onClick={suggest} style={ghost}>
          Suggest groupings
        </button>
      </div>

      <div style={{ border: '1px solid var(--rule)' }}>
        {days.map((d) => (
          <div key={d.date}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--ink-3)',
                padding: '10px 14px',
                background: 'rgba(0,0,0,0.02)',
                borderBottom: '1px solid var(--rule)',
              }}
            >
              {fmtDay(d.date)}
            </div>
            {d.items.map((it) => {
              const checked = selDay === d.date && selIds.includes(it.propertyId);
              return (
                <button
                  key={it.propertyId}
                  type="button"
                  onClick={() => toggle(d.date, it.propertyId)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    cursor: 'pointer',
                    background: checked ? 'rgba(200,90,58,0.06)' : 'transparent',
                    borderRadius: 0,
                    borderWidth: '0 0 1px 0',
                    borderStyle: 'solid',
                    borderColor: 'var(--rule)',
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      flexShrink: 0,
                      background: checked ? 'var(--signal)' : 'transparent',
                      border: checked ? 'none' : '1.5px solid var(--rule)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                    }}
                  >
                    {checked ? '✓' : ''}
                  </span>
                  <span style={{ flex: 1, fontSize: 14, color: 'var(--ink)' }}>{it.propertyName}</span>
                  <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>
                    {timing(it)}
                    {it.nearestMiles != null
                      ? ` · ${it.nearestMiles < 1 ? '<1' : Math.round(it.nearestMiles)} mi to nearest`
                      : ''}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {selectedItems.length > 0 && selDay && (
        <form
          action={bundleAndSend}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            flexWrap: 'wrap',
            border: '2px solid var(--signal)',
            padding: '12px 16px',
            marginTop: 14,
            background: 'rgba(200,90,58,0.04)',
          }}
        >
          <input type="hidden" name="visit_date" value={selDay} />
          <input type="hidden" name="property_ids" value={selIds.join(',')} />
          <input type="hidden" name="price_dollars" value={priceStr || String(suggestedDollars)} />
          <div>
            <div style={{ fontSize: 14, color: 'var(--ink)' }}>
              {selectedItems.length} selected · {fmtDay(selDay)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {spread > 0 ? `~${spread < 1 ? '<1' : Math.round(spread)} mi apart · ` : ''}one visit
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--ink-4)' }}>$</span>
            <input
              type="number"
              min={0}
              step={5}
              value={priceStr}
              placeholder={String(suggestedDollars)}
              onChange={(e) => setPriceStr(e.target.value)}
              style={{
                width: 72,
                font: 'inherit',
                fontSize: 14,
                color: 'var(--ink)',
                background: 'var(--paper)',
                border: '1px solid var(--rule)',
                padding: '6px 8px',
              }}
            />
            <button
              type="submit"
              style={{
                background: 'var(--signal)',
                color: 'var(--paper)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                padding: '10px 18px',
                whiteSpace: 'nowrap',
              }}
            >
              Bundle &amp; send →
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const ghost: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  border: '1px solid var(--rule)',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '7px 13px',
};
