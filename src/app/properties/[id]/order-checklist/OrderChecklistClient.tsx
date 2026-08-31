'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { setOrderHaveAction, setOrderNoteAction } from './actions';
import type { RenderedItem } from '@/lib/projections-readiness';
import {
  LINEN_VENDOR,
  type OrderChecklistState,
  type OrderContext,
  type OrderGroup,
} from '@/lib/order-checklist';

/**
 * Interactive outfitting order checklist. Same one-handed interaction
 * grammar as the prospect readiness walkthrough (tap a row to toggle
 * none/all, tap the number for a partial count, optimistic writes with
 * rollback), reframed around ordering: the gap between have and need rolls
 * up into the "To order" list at the bottom, which is the thing you read
 * to Fix Linens or into an Amazon cart. Cmd+P prints the whole sheet with
 * the interactive chrome stripped.
 */
export function OrderChecklistClient({
  propertyId,
  propertyName,
  groups,
  context,
  initial,
  supplyClosetLocation,
}: {
  propertyId: string;
  propertyName: string;
  groups: OrderGroup[];
  context: OrderContext;
  initial: OrderChecklistState;
  supplyClosetLocation: string | null;
}) {
  const [have, setHave] = useState<Record<string, number>>(() => ({ ...(initial.have ?? {}) }));
  const [notes, setNotes] = useState<Record<string, string>>(() => ({ ...(initial.notes ?? {}) }));
  const [lastSaved, setLastSaved] = useState<string | null>(initial.updated_at ?? null);
  const [, startTransition] = useTransition();
  const noteTimers = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});

  const totals = useMemo(() => {
    let itemsTotal = 0;
    let itemsDone = 0;
    let unitsToOrder = 0;
    for (const g of groups) {
      for (const it of g.items) {
        itemsTotal += 1;
        const h = Math.min(have[it.label] ?? 0, it.count);
        if (h >= it.count) itemsDone += 1;
        else unitsToOrder += it.count - h;
      }
    }
    return { itemsTotal, itemsDone, unitsToOrder };
  }, [groups, have]);

  function persistHave(label: string, count: number, prevCount: number) {
    startTransition(async () => {
      const res = await setOrderHaveAction({ propertyId, itemLabel: label, count }).catch(
        (err) => ({ ok: false as const, error: String(err) }),
      );
      if (res.ok) {
        setLastSaved(new Date().toISOString());
      } else {
        setHave((prev) => ({ ...prev, [label]: prevCount }));
        console.error('setOrderHaveAction failed:', res.error);
      }
    });
  }

  function toggleItem(item: RenderedItem) {
    const current = have[item.label] ?? 0;
    const next = current >= item.count ? 0 : item.count;
    setHave((prev) => ({ ...prev, [item.label]: next }));
    persistHave(item.label, next, current);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { (navigator as Navigator & { vibrate?: (p: number) => void }).vibrate?.(8); } catch { /* ignore */ }
    }
  }

  function setItemCount(item: RenderedItem, rawValue: string) {
    const parsed = parseInt(rawValue, 10);
    const current = have[item.label] ?? 0;
    const next = Number.isFinite(parsed) ? Math.max(0, Math.min(item.count, parsed)) : 0;
    if (next === current) return;
    setHave((prev) => ({ ...prev, [item.label]: next }));
    persistHave(item.label, next, current);
  }

  function persistNote(key: string, value: string) {
    startTransition(async () => {
      const res = await setOrderNoteAction({ propertyId, noteKey: key, value }).catch(
        (err) => ({ ok: false as const, error: String(err) }),
      );
      if (res.ok) setLastSaved(new Date().toISOString());
      else console.error('setOrderNoteAction failed:', res.error);
    });
  }

  function onNoteChange(key: string, value: string) {
    setNotes((prev) => ({ ...prev, [key]: value }));
    const timer = noteTimers.current[key];
    if (timer) clearTimeout(timer);
    noteTimers.current[key] = setTimeout(() => persistNote(key, value), 800);
  }

  function flushNote(key: string) {
    const timer = noteTimers.current[key];
    if (timer) clearTimeout(timer);
    noteTimers.current[key] = null;
    persistNote(key, notes[key] ?? '');
  }

  useEffect(() => {
    const timers = noteTimers.current;
    return () => {
      Object.values(timers).forEach((t) => { if (t) clearTimeout(t); });
    };
  }, []);

  // The order itself: everything with have < need, grouped.
  const toOrder = useMemo(() => {
    const out: { group: string; items: { label: string; gap: number; have: number; need: number }[] }[] = [];
    for (const g of groups) {
      const items = g.items
        .map((it) => {
          const h = Math.min(have[it.label] ?? 0, it.count);
          return { label: it.label, gap: it.count - h, have: h, need: it.count };
        })
        .filter((it) => it.gap > 0);
      if (items.length > 0) out.push({ group: g.title, items });
    }
    return out;
  }, [groups, have]);

  const bedsLine = context.beds
    .map((b) => `${b.count} ${b.size}`)
    .join(', ');

  return (
    <>
      <style>{orderCss}</style>
      <div className="rt-oc">
        <header className="rt-oc-head">
          <div className="rt-oc-head-top rt-oc-noprint">
            <Link href={`/properties/${propertyId}?tab=onboarding`} className="rt-oc-back">
              ← Onboarding
            </Link>
            <button type="button" className="rt-oc-print" onClick={() => window.print()}>
              Print ↗
            </button>
          </div>
          <div className="rt-oc-title-block">
            <div className="rt-oc-eyebrow">Outfitting order</div>
            <h1 className="rt-oc-h1">{propertyName}</h1>
            <p className="rt-oc-tag">
              {context.maxGuests} guests{context.guestsFromBeds ? '' : ' (est.)'} ·{' '}
              {context.bedCount} bed{context.bedCount === 1 ? '' : 's'}
              {context.bedsFromRooms ? ` (${bedsLine})` : ' (est. - walk the rooms first)'}
              {context.hasPullout ? ' + pullout' : ''} · {context.bedrooms} BR /{' '}
              {context.bathrooms} BA{context.bathroomsFromRecord ? '' : ' (est.)'}
            </p>
            {!context.bedsFromRooms && (
              <p className="rt-oc-warn">
                No beds on file yet, so linen quantities assume one queen per bedroom.{' '}
                <Link href={`/properties/${propertyId}?tab=onboarding`}>
                  Walk the rooms
                </Link>{' '}
                and the order re-computes from real bed sizes.
              </p>
            )}
          </div>
          <div className="rt-oc-progress rt-oc-noprint">
            <div className="rt-oc-progress-row">
              <span className="rt-oc-progress-num">
                {totals.itemsDone} of {totals.itemsTotal} covered
              </span>
              <span className="rt-oc-progress-pct">
                {totals.unitsToOrder} unit{totals.unitsToOrder === 1 ? '' : 's'} to order
              </span>
            </div>
            <div className="rt-oc-progress-bar" aria-hidden>
              <div
                className="rt-oc-progress-bar-fill"
                style={{ width: `${totals.itemsTotal > 0 ? Math.round((totals.itemsDone / totals.itemsTotal) * 100) : 0}%` }}
              />
            </div>
            {lastSaved && <div className="rt-oc-saved">Last edit {formatSavedAt(lastSaved)}</div>}
          </div>
        </header>

        {groups.map((g) => {
          const groupDone = g.items.filter((i) => (have[i.label] ?? 0) >= i.count).length;
          return (
            <section className="rt-oc-group" key={g.title}>
              <div className="rt-oc-group-head">
                <h2 className="rt-oc-group-title">{g.title}</h2>
                <span className="rt-oc-group-count">{groupDone} / {g.items.length}</span>
              </div>
              {g.blurb && <p className="rt-oc-group-blurb">{g.blurb}</p>}
              <ul className="rt-oc-list">
                {g.items.map((it) => (
                  <ItemRow
                    key={it.label}
                    item={it}
                    haveCount={have[it.label] ?? 0}
                    onToggle={() => toggleItem(it)}
                    onSetCount={(raw) => setItemCount(it, raw)}
                  />
                ))}
              </ul>
            </section>
          );
        })}

        {/* Order notes: PO numbers, ship dates, backorders */}
        <section className="rt-oc-group rt-oc-noprint">
          <div className="rt-oc-group-head">
            <h2 className="rt-oc-group-title">Order notes</h2>
          </div>
          <label className="rt-oc-note">
            <span className="rt-oc-note-hint">
              PO numbers, ship dates, what&rsquo;s on backorder, substitutions.
            </span>
            <textarea
              className="rt-oc-note-input"
              rows={3}
              value={notes.order_notes ?? ''}
              onChange={(e) => onNoteChange('order_notes', e.target.value)}
              onBlur={() => flushNote('order_notes')}
            />
          </label>
        </section>

        {/* The actual order */}
        <section className="rt-oc-group rt-oc-order">
          <div className="rt-oc-group-head">
            <h2 className="rt-oc-group-title">To order</h2>
            <span className="rt-oc-group-count">
              {toOrder.reduce((n, g) => n + g.items.length, 0)} line{toOrder.reduce((n, g) => n + g.items.length, 0) === 1 ? '' : 's'}
            </span>
          </div>
          {toOrder.length === 0 ? (
            <p className="rt-oc-order-empty">
              Everything is on hand. The home is outfitted.
            </p>
          ) : (
            toOrder.map((g) => (
              <div key={g.group} className="rt-oc-order-block">
                <div className="rt-oc-order-group">{g.group}</div>
                <ul className="rt-oc-order-list">
                  {g.items.map((it) => (
                    <li key={it.label} className="rt-oc-order-item">
                      <span className="rt-oc-order-label">{it.label}</span>
                      <span className="rt-oc-order-qty">
                        {it.have > 0 ? `${it.gap} more (${it.have}/${it.need})` : `${it.gap}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          {supplyClosetLocation && (
            <p className="rt-oc-order-hint">Supplies live: {supplyClosetLocation}</p>
          )}
          {notes.order_notes?.trim() && (
            <p className="rt-oc-order-hint rt-oc-printonly">Notes: {notes.order_notes}</p>
          )}
        </section>

        <footer className="rt-oc-foot">
          Outfitting order · {LINEN_VENDOR} linens at 2.5x · Rising Tide
        </footer>
      </div>
    </>
  );
}

function ItemRow({
  item,
  haveCount,
  onToggle,
  onSetCount,
}: {
  item: RenderedItem;
  haveCount: number;
  onToggle: () => void;
  onSetCount: (raw: string) => void;
}) {
  const [draft, setDraft] = useState<string>(String(haveCount));
  useEffect(() => { setDraft(String(haveCount)); }, [haveCount]);

  const isFull = haveCount >= item.count;
  const isPartial = haveCount > 0 && haveCount < item.count;

  return (
    <li className="rt-oc-item" data-state={isFull ? 'full' : isPartial ? 'partial' : 'empty'}>
      <button
        type="button"
        className="rt-oc-item-btn"
        onClick={onToggle}
        aria-pressed={isFull}
        aria-label={`${item.label}, ${haveCount} of ${item.count}, tap to toggle`}
      >
        <span className="rt-oc-check" aria-hidden>
          {isFull && (
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 8.5l3.5 3.5L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {isPartial && <span className="rt-oc-check-partial" aria-hidden />}
        </span>
        <span className="rt-oc-item-text">
          <span className="rt-oc-item-label">{item.label}</span>
          {item.note && <span className="rt-oc-item-note">{item.note}</span>}
        </span>
      </button>
      <div className="rt-oc-qty" onClick={(e) => e.stopPropagation()}>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={item.count}
          step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onSetCount(draft)}
          onFocus={(e) => e.target.select()}
          className="rt-oc-qty-input rt-oc-noprint"
          aria-label={`${item.label} on-hand count`}
        />
        <span className="rt-oc-qty-print rt-oc-printonly">{haveCount}</span>
        <span className="rt-oc-qty-sep">/</span>
        <span className="rt-oc-qty-need">{item.count}</span>
      </div>
    </li>
  );
}

function formatSavedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
      timeZone: 'America/New_York',
    });
  } catch {
    return iso;
  }
}

// ─── CSS ────────────────────────────────────────────────────────────────────
const orderCss = `
  .rt-oc {
    max-width: 720px;
    margin: 0 auto;
    padding: 0 16px 80px;
    color: var(--ink);
    background: var(--paper);
    min-height: 100vh;
  }
  .rt-oc-printonly { display: none; }

  /* ─── Sticky header ───────────────────────────────────────── */
  .rt-oc-head {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--paper);
    padding: 12px 16px 14px;
    margin: 0 -16px;
    border-bottom: 1px solid var(--rule);
  }
  .rt-oc-head-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }
  .rt-oc-back, .rt-oc-print {
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-3);
    text-decoration: none;
    background: none;
    border: none;
    font-family: inherit;
    cursor: pointer;
    padding: 6px 8px;
    margin: -6px -8px;
    border-radius: 4px;
    -webkit-tap-highlight-color: rgba(0,0,0,0.04);
  }
  .rt-oc-back:active, .rt-oc-print:active { background: var(--paper-2); }
  .rt-oc-title-block { margin-bottom: 10px; }
  .rt-oc-eyebrow {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
  }
  .rt-oc-h1 {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 26px;
    line-height: 1.1;
    font-weight: 300;
    letter-spacing: -0.02em;
    color: var(--ink);
    margin: 4px 0 0;
  }
  .rt-oc-tag {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--ink-3);
    line-height: 1.4;
  }
  .rt-oc-warn {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--signal);
    line-height: 1.45;
    max-width: 540px;
  }
  .rt-oc-warn a { color: var(--signal); }

  .rt-oc-progress { margin-top: 4px; }
  .rt-oc-progress-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 4px;
  }
  .rt-oc-progress-num { font-size: 12px; color: var(--ink); letter-spacing: 0.02em; }
  .rt-oc-progress-pct {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 12px;
    letter-spacing: 0.04em;
    color: var(--signal);
    font-weight: 700;
  }
  .rt-oc-progress-bar { height: 3px; background: var(--rule); border-radius: 2px; overflow: hidden; }
  .rt-oc-progress-bar-fill { height: 100%; background: var(--signal); transition: width 200ms ease-out; }
  .rt-oc-saved { margin-top: 6px; font-size: 10px; color: var(--ink-4); font-style: italic; }

  /* ─── Groups ─────────────────────────────────────────────── */
  .rt-oc-group { margin-top: 28px; }
  .rt-oc-group-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--ink);
    margin-bottom: 4px;
  }
  .rt-oc-group-title {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 22px;
    font-weight: 400;
    letter-spacing: -0.01em;
    color: var(--ink);
    margin: 0;
  }
  .rt-oc-group-count {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 11px;
    color: var(--ink-4);
    letter-spacing: 0.04em;
  }
  .rt-oc-group-blurb {
    margin: 6px 0 4px;
    font-size: 12px;
    color: var(--ink-3);
    line-height: 1.5;
    max-width: 600px;
  }

  /* ─── Item rows ──────────────────────────────────────────── */
  .rt-oc-list { list-style: none; padding: 0; margin: 0; }
  .rt-oc-item {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: stretch;
    border-bottom: 1px solid var(--rule);
    gap: 6px;
  }
  .rt-oc-item-btn {
    display: grid;
    grid-template-columns: 28px 1fr;
    gap: 12px;
    align-items: center;
    min-height: 56px;
    padding: 10px 4px;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: rgba(0,0,0,0.04);
  }
  .rt-oc-item-btn:active { background: var(--paper-2); }
  .rt-oc-check {
    width: 22px;
    height: 22px;
    border: 2px solid var(--ink-3);
    border-radius: 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--paper);
    flex-shrink: 0;
    color: var(--paper);
    position: relative;
  }
  .rt-oc-item[data-state="full"] .rt-oc-check { background: var(--signal); border-color: var(--signal); }
  .rt-oc-item[data-state="partial"] .rt-oc-check { border-color: var(--signal); }
  .rt-oc-check-partial {
    position: absolute;
    inset: 2px;
    background: linear-gradient(135deg, var(--signal) 0 50%, transparent 50% 100%);
    border-radius: 3px;
  }
  .rt-oc-item-text { min-width: 0; }
  .rt-oc-item-label {
    display: block;
    font-size: 14.5px;
    line-height: 1.35;
    color: var(--ink);
    font-weight: 500;
  }
  .rt-oc-item[data-state="full"] .rt-oc-item-label {
    color: var(--ink-4);
    text-decoration: line-through;
    text-decoration-thickness: 1px;
  }
  .rt-oc-item-note {
    display: block;
    font-size: 11px;
    color: var(--ink-4);
    font-style: italic;
    line-height: 1.3;
    margin-top: 2px;
  }
  .rt-oc-qty {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 6px 0 4px;
    align-self: center;
  }
  .rt-oc-qty-input {
    width: 46px;
    min-height: 36px;
    padding: 6px 8px;
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 15px;
    font-weight: 700;
    color: var(--signal);
    text-align: right;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 6px;
    -moz-appearance: textfield;
  }
  .rt-oc-qty-input::-webkit-outer-spin-button,
  .rt-oc-qty-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .rt-oc-qty-input:focus {
    outline: none;
    border-color: var(--signal);
    box-shadow: 0 0 0 3px rgba(200, 90, 58, 0.12);
  }
  .rt-oc-item[data-state="full"] .rt-oc-qty-input { color: var(--ink-4); }
  .rt-oc-qty-sep, .rt-oc-qty-print {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 13px;
    color: var(--ink-4);
  }
  .rt-oc-qty-need {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 13px;
    color: var(--ink-3);
    font-weight: 600;
    min-width: 22px;
    text-align: left;
  }

  /* ─── Order notes ────────────────────────────────────────── */
  .rt-oc-note { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
  .rt-oc-note-hint { font-size: 11px; color: var(--ink-4); font-style: italic; line-height: 1.3; }
  .rt-oc-note-input {
    margin-top: 4px;
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid var(--rule);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-inter), system-ui, sans-serif;
    font-size: 15px;
    line-height: 1.4;
    resize: vertical;
    min-height: 44px;
  }
  .rt-oc-note-input:focus { outline: none; border-color: var(--ink); box-shadow: 0 0 0 3px rgba(0,0,0,0.04); }

  /* ─── To order ───────────────────────────────────────────── */
  .rt-oc-order-empty { font-size: 13px; color: var(--ink-3); font-style: italic; margin: 14px 0 0; }
  .rt-oc-order-block { margin-top: 14px; }
  .rt-oc-order-group {
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-4);
    margin-bottom: 2px;
  }
  .rt-oc-order-list { list-style: none; padding: 0; margin: 0; }
  .rt-oc-order-item {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px;
    align-items: baseline;
    padding: 8px 0;
    border-bottom: 1px solid var(--rule);
  }
  .rt-oc-order-label { font-size: 14px; color: var(--ink); font-weight: 500; }
  .rt-oc-order-qty {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 13px;
    color: var(--signal);
    font-weight: 700;
  }
  .rt-oc-order-hint {
    margin: 14px 0 0;
    font-size: 12px;
    color: var(--ink-3);
    line-height: 1.5;
  }

  .rt-oc-foot {
    margin-top: 40px;
    padding-top: 14px;
    border-top: 1px solid var(--rule);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-4);
    text-align: center;
  }

  /* ─── Desktop (>720px) ───────────────────────────────────── */
  @media (min-width: 720px) {
    .rt-oc { padding: 0 24px 80px; }
    .rt-oc-head { padding-left: 24px; padding-right: 24px; margin: 0 -24px; }
    .rt-oc-h1 { font-size: 34px; }
    .rt-oc-list { display: grid; grid-template-columns: 1fr 1fr; column-gap: 28px; }
  }

  /* ─── Print: strip chrome, keep the sheet ────────────────── */
  @media print {
    .rt-oc { max-width: none; padding: 0; background: #fff; color: #1e2e34; }
    .rt-oc-noprint { display: none !important; }
    .rt-oc-printonly { display: inline; }
    .rt-oc-head { position: static; border-bottom: 1px solid #1e2e34; margin: 0; padding: 0 0 10px; }
    .rt-oc-group { break-inside: avoid; margin-top: 18px; }
    .rt-oc-item-btn { min-height: 0; padding: 5px 4px; }
    .rt-oc-check { width: 14px; height: 14px; border-width: 1.5px; }
    .rt-oc-list { display: grid; grid-template-columns: 1fr 1fr; column-gap: 28px; }
    .rt-oc-order { break-before: page; }
  }
`;
