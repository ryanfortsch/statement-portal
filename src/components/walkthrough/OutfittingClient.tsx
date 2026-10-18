'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useChecklistSaves } from '@/lib/use-checklist-saves';
import { ChecklistSaveStatus } from '@/components/ChecklistSaveStatus';
import { useDraftNavigationGuard } from '@/lib/use-draft-navigation-guard';
import { setWalkthroughHaveAction, setWalkthroughNoteAction, type WalkthroughTarget } from '@/app/walkthrough-actions';
import { requestReadinessReview } from '@/app/projections/actions';
import type { ReadinessNoteField, RenderedItem } from '@/lib/projections-readiness';
import { haveCounts, type WalkthroughState } from '@/lib/home-walkthrough';
import { LINEN_VENDOR } from '@/lib/order-checklist';

/**
 * The outfitting walkthrough: one page that follows a home from the
 * prospect visit to the property, on one row of home_walkthroughs.
 *
 *   counting  the prospect visit (/prospects/<id>/readiness): what the home
 *             already has, the walkthrough notes, "Still needed", Send to
 *             team for review and the owner-facing print version.
 *   ordering  the property (/properties/<id>/order-checklist): the same
 *             items plus the Fix Linens rows, sized to the beds on file,
 *             with the gap rolled up into "To order". It survives
 *             activation; the counts made at the visit are where it starts.
 *
 * One interaction in both: tap a row to toggle none/all, type a partial
 * count, writes queued with retained drafts. Until 2026-10-18 these were
 * two clients (ReadinessChecklistClient, OrderChecklistClient) on two tables.
 */

export type OutfittingGroup = { title: string; blurb?: string; items: RenderedItem[] };

export type OutfittingMode =
  | {
      kind: 'counting';
      projectionId: string;
      /** The owner's first names, for the review hint. */
      salutation: string;
      /** The owner-facing punch list (a separate print deliverable). */
      printHref: string;
      noteFields: ReadinessNoteField[];
    }
  | {
      kind: 'ordering';
      propertyId: string;
      supplyClosetLocation: string | null;
      /** No beds on file: linen quantities are an estimate. */
      bedsMissing: boolean;
    };

export function OutfittingClient({
  mode,
  homeName,
  backHref,
  backLabel,
  tagLine,
  groups,
  initial,
}: {
  mode: OutfittingMode;
  homeName: string;
  backHref: string;
  backLabel: string;
  tagLine: string;
  groups: OutfittingGroup[];
  initial: WalkthroughState;
}) {
  const counting = mode.kind === 'counting';
  const target: WalkthroughTarget = counting ? { projectionId: mode.projectionId } : { propertyId: mode.propertyId };
  const [have, setHave] = useState<Record<string, number>>(() => haveCounts(initial, groups));
  const [notes, setNotes] = useState<Record<string, string>>(() => ({ ...(initial.notes ?? {}) }));
  const saves = useChecklistSaves();
  const lastSaved = saves.lastSaved ?? initial.updated_at ?? null;
  const haveRef = useRef(have);
  const notesRef = useRef(notes);

  // Send to team (counting only). The sent state holds until another edit,
  // so a second tap cannot send twice.
  const [reviewStatus, setReviewStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [reviewError, setReviewError] = useState<string | null>(null);
  const sending = useRef(false);
  useDraftNavigationGuard(reviewStatus === 'sending', reviewStatus === 'sending');

  const totals = useMemo(() => {
    let itemsTotal = 0;
    let itemsDone = 0;
    let unitsNeeded = 0;
    let unitsHave = 0;
    for (const g of groups) {
      for (const it of g.items) {
        itemsTotal += 1;
        unitsNeeded += it.count;
        const h = Math.min(have[it.label] ?? 0, it.count);
        unitsHave += h;
        if (h >= it.count) itemsDone += 1;
      }
    }
    return { itemsTotal, itemsDone, unitsToOrder: unitsNeeded - unitsHave, pct: unitsNeeded > 0 ? Math.round((unitsHave / unitsNeeded) * 100) : 0 };
  }, [groups, have]);

  // What is still missing, grouped: "Still needed" at the visit, "To order" once ours.
  const gaps = useMemo(() => {
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
  const gapLines = gaps.reduce((n, g) => n + g.items.length, 0);

  function edited(): boolean {
    if (sending.current) return false;
    setReviewStatus('idle');
    return true;
  }

  function persistHave(label: string, count: number) {
    saves.queue.enqueue('have:' + label, async () => {
      const result = await setWalkthroughHaveAction(target, label, count);
      if (!result.ok) throw new Error(result.error || 'Save failed');
    });
  }

  function toggleItem(item: RenderedItem) {
    if (!edited()) return;
    const current = haveRef.current[item.label] ?? 0;
    const next = current >= item.count ? 0 : item.count;
    haveRef.current = { ...haveRef.current, [item.label]: next };
    setHave(haveRef.current);
    persistHave(item.label, next);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { (navigator as Navigator & { vibrate?: (p: number) => void }).vibrate?.(8); } catch { /* ignore */ }
    }
  }

  function setItemCount(item: RenderedItem, rawValue: string) {
    if (!edited()) return;
    const parsed = parseInt(rawValue, 10);
    const current = haveRef.current[item.label] ?? 0;
    const next = Number.isFinite(parsed) ? Math.max(0, Math.min(item.count, parsed)) : 0;
    if (next === current) return;
    haveRef.current = { ...haveRef.current, [item.label]: next };
    setHave(haveRef.current);
    persistHave(item.label, next);
  }

  function onNoteChange(key: string, value: string) {
    if (!edited()) return;
    notesRef.current = { ...notesRef.current, [key]: value };
    setNotes(notesRef.current);
    saves.queue.enqueue('note:' + key, async () => {
      const result = await setWalkthroughNoteAction(target, key, value);
      if (!result.ok) throw new Error(result.error || 'Save failed');
    }, 800);
  }

  function flushNote() { void saves.queue.flush(); }

  async function sendReview() {
    if (mode.kind !== 'counting' || sending.current) return;
    sending.current = true;
    setReviewStatus('sending');
    setReviewError(null);
    try {
      if (!await saves.queue.flush()) {
        setReviewStatus('error');
        setReviewError('Save the remaining checklist changes before sending.');
        return;
      }
      const result = await requestReadinessReview(mode.projectionId);
      setReviewStatus(result.ok ? 'sent' : 'error');
      if (!result.ok) setReviewError(result.reason || 'Could not send the summary.');
    } catch {
      setReviewStatus('error');
      setReviewError('Could not confirm delivery. Check your email before trying again.');
    } finally {
      sending.current = false;
    }
  }

  const noteFields: ReadinessNoteField[] = counting
    ? mode.noteFields
    : [{ key: 'order_notes', label: 'Order notes', hint: 'PO numbers, ship dates, what is on backorder, substitutions.', rows: 3 }];

  return (
    <>
      <style>{outfittingCss}</style>
      <div className="rt-oc">
        <header className="rt-oc-head">
          <div className="rt-oc-head-top rt-oc-noprint">
            <Link href={backHref} className="rt-oc-back">← {backLabel}</Link>
            {mode.kind === 'counting' ? (
              <Link
                href={mode.printHref}
                target="_blank"
                className="rt-oc-print"
                onClick={(event) => {
                  if (saves.queue.getSnapshot().dirty) {
                    event.preventDefault();
                    setReviewError('Finish saving before opening the print version.');
                    setReviewStatus('error');
                    void saves.queue.flush();
                  }
                }}
              >
                Print version ↗
              </Link>
            ) : (
              <button type="button" className="rt-oc-print" onClick={() => window.print()}>Print</button>
            )}
          </div>
          <div className="rt-oc-title-block">
            <div className="rt-oc-eyebrow">{counting ? 'Outfitting · counting at the visit' : 'Outfitting · the order'}</div>
            <h1 className="rt-oc-h1">{homeName}</h1>
            <p className="rt-oc-tag">{tagLine}</p>
            {mode.kind === 'ordering' && mode.bedsMissing && (
              <p className="rt-oc-warn">
                No beds on file yet, so linen quantities assume one queen per bedroom.{' '}
                <Link href={`/properties/${mode.propertyId}?tab=facts#rooms`}>Add the rooms and beds</Link>{' '}
                and the order re-computes from real bed sizes.
              </p>
            )}
          </div>
          <div className="rt-oc-progress rt-oc-noprint">
            <div className="rt-oc-progress-row">
              <span className="rt-oc-progress-num">
                {totals.itemsDone} of {totals.itemsTotal} {counting ? 'complete' : 'covered'}
              </span>
              <span className="rt-oc-progress-pct">
                {counting ? `${totals.pct}%` : `${totals.unitsToOrder} unit${totals.unitsToOrder === 1 ? '' : 's'} to order`}
              </span>
            </div>
            <div className="rt-oc-progress-bar" aria-hidden>
              <div className="rt-oc-progress-bar-fill" style={{ width: `${counting ? totals.pct : totals.itemsTotal > 0 ? Math.round((totals.itemsDone / totals.itemsTotal) * 100) : 0}%` }} />
            </div>
            <ChecklistSaveStatus status={saves} retry={saves.queue.retry} />
            {!saves.dirty && lastSaved && <div className="rt-oc-saved">Last edit {formatSavedAt(lastSaved)}</div>}
          </div>
        </header>

        <fieldset disabled={reviewStatus === 'sending'} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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

          <section className="rt-oc-group rt-oc-noprint">
            <div className="rt-oc-group-head">
              <h2 className="rt-oc-group-title">{counting ? 'Walkthrough notes' : 'Order notes'}</h2>
            </div>
            <div className={counting ? 'rt-oc-notes' : undefined}>
              {noteFields.map((f) => (
                <label className="rt-oc-note" key={f.key}>
                  {counting && <span className="rt-oc-note-label">{f.label}</span>}
                  <span className="rt-oc-note-hint">{f.hint}</span>
                  <textarea
                    className="rt-oc-note-input"
                    rows={f.rows ?? 2}
                    value={notes[f.key] ?? ''}
                    onChange={(e) => onNoteChange(f.key, e.target.value)}
                    onBlur={() => flushNote()}
                    aria-label={f.label}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="rt-oc-group rt-oc-order">
            <div className="rt-oc-group-head">
              <h2 className="rt-oc-group-title">{counting ? 'Still needed' : 'To order'}</h2>
              <span className="rt-oc-group-count">
                {gapLines} {counting ? `item${gapLines === 1 ? '' : 's'}` : `line${gapLines === 1 ? '' : 's'}`}
              </span>
            </div>
            {gaps.length === 0 ? (
              <p className="rt-oc-order-empty">
                {counting ? 'Everything is accounted for. The home is guest-ready.' : 'Everything is on hand. The home is outfitted.'}
              </p>
            ) : (
              gaps.map((g) => (
                <div key={g.group} className="rt-oc-order-block">
                  <div className="rt-oc-order-group">{g.group}</div>
                  <ul className="rt-oc-order-list">
                    {g.items.map((it) => (
                      <li key={it.label} className="rt-oc-order-item">
                        <span className="rt-oc-order-label">{it.label}</span>
                        <span className="rt-oc-order-qty">
                          {counting
                            ? it.have > 0 ? `${it.have} / ${it.need}` : `Need ${it.need}`
                            : it.have > 0 ? `${it.gap} more (${it.have}/${it.need})` : `${it.gap}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
            {mode.kind === 'ordering' && mode.supplyClosetLocation && (
              <p className="rt-oc-order-hint">Supplies live: {mode.supplyClosetLocation}</p>
            )}
            {mode.kind === 'ordering' && notes.order_notes?.trim() && (
              <p className="rt-oc-order-hint rt-oc-printonly">Notes: {notes.order_notes}</p>
            )}

            {mode.kind === 'counting' && (
              <div className="rt-oc-send-wrap">
                <button
                  type="button"
                  className="rt-oc-send-btn"
                  onClick={sendReview}
                  disabled={reviewStatus === 'sending' || reviewStatus === 'sent'}
                  data-status={reviewStatus}
                >
                  {reviewStatus === 'sending' && 'Sending…'}
                  {reviewStatus === 'sent' && '✓ Sent to team'}
                  {reviewStatus === 'error' && 'Retry send to team'}
                  {reviewStatus === 'idle' && 'Send to team for review →'}
                </button>
                <p className="rt-oc-send-hint">
                  {reviewStatus === 'sent'
                    ? `The team should have it shortly. Review and forward to ${mode.salutation.split(' ')[0]} when ready.`
                    : reviewStatus === 'error'
                      ? reviewError ?? 'Could not send the summary.'
                      : 'Emails the still-needed list and walkthrough notes to the team for review. The owner is not on the thread.'}
                </p>
              </div>
            )}
          </section>
        </fieldset>

        <footer className="rt-oc-foot">
          {counting ? 'Outfitting · counted at the visit · Rising Tide' : `Outfitting order · ${LINEN_VENDOR} linens at 2.5x · Rising Tide`}
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
  // Local input value so typing doesn't fight the optimistic state update.
  const [draft, setDraft] = useState<string>(String(haveCount));
  useEffect(() => { setDraft(String(haveCount)); }, [haveCount]);
  useDraftNavigationGuard(draft !== String(haveCount));

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
      {/* Stops propagation so tapping the input does not also toggle the row. */}
      <div className="rt-oc-qty" onClick={(e) => e.stopPropagation()}>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={item.count}
          step={1}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); if (/^\d+$/.test(e.target.value)) onSetCount(e.target.value); }}
          onBlur={() => { onSetCount(draft); const count = parseInt(draft, 10); setDraft(String(Number.isFinite(count) ? Math.max(0, Math.min(item.count, count)) : 0)); }}
          onFocus={(e) => e.target.select()}
          className="rt-oc-qty-input rt-oc-noprint"
          aria-label={`${item.label} count`}
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
const outfittingCss = `
  .rt-oc {
    max-width: 720px;
    margin: 0 auto;
    padding: 0 16px 80px;
    color: var(--ink);
    background: var(--paper);
    width: 100%;
    box-sizing: border-box;
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
  .rt-oc-tag { margin: 6px 0 0; font-size: 12px; color: var(--ink-3); line-height: 1.4; }
  .rt-oc-warn { margin: 8px 0 0; font-size: 12px; color: var(--signal); line-height: 1.45; max-width: 540px; }
  .rt-oc-warn a { color: var(--signal); }

  .rt-oc-progress { margin-top: 4px; }
  .rt-oc-progress-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
  .rt-oc-progress-num { font-size: 12px; color: var(--ink); letter-spacing: 0.02em; }
  .rt-oc-progress-pct {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 12px;
    letter-spacing: 0.04em;
    color: var(--signal);
    font-weight: 700;
  }
  .rt-oc-progress-bar { height: 3px; background: var(--rule); overflow: hidden; }
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
  .rt-oc-group-count { font-family: var(--font-mono-dash), ui-monospace, monospace; font-size: 11px; color: var(--ink-4); letter-spacing: 0.04em; }
  .rt-oc-group-blurb { margin: 6px 0 4px; font-size: 12px; color: var(--ink-3); line-height: 1.5; max-width: 600px; }

  /* ─── Item rows ──────────────────────────────────────────── */
  .rt-oc-list { list-style: none; padding: 0; margin: 0; }
  .rt-oc-item { display: grid; grid-template-columns: 1fr auto; align-items: stretch; border-bottom: 1px solid var(--rule); gap: 6px; }
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
  .rt-oc-check-partial { position: absolute; inset: 2px; background: linear-gradient(135deg, var(--signal) 0 50%, transparent 50% 100%); }
  .rt-oc-item-text { min-width: 0; }
  .rt-oc-item-label { display: block; font-size: 14.5px; line-height: 1.35; color: var(--ink); font-weight: 500; }
  .rt-oc-item[data-state="full"] .rt-oc-item-label { color: var(--ink-4); text-decoration: line-through; text-decoration-thickness: 1px; }
  .rt-oc-item-note { display: block; font-size: 11px; color: var(--ink-4); font-style: italic; line-height: 1.3; margin-top: 2px; }
  .rt-oc-qty { display: inline-flex; align-items: center; gap: 4px; padding: 0 6px 0 4px; align-self: center; }
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
    -moz-appearance: textfield;
  }
  .rt-oc-qty-input::-webkit-outer-spin-button,
  .rt-oc-qty-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .rt-oc-qty-input:focus { outline: none; border-color: var(--signal); box-shadow: 0 0 0 3px rgba(200, 90, 58, 0.12); }
  .rt-oc-item[data-state="full"] .rt-oc-qty-input { color: var(--ink-4); }
  .rt-oc-qty-sep, .rt-oc-qty-print { font-family: var(--font-mono-dash), ui-monospace, monospace; font-size: 13px; color: var(--ink-4); }
  .rt-oc-qty-need { font-family: var(--font-mono-dash), ui-monospace, monospace; font-size: 13px; color: var(--ink-3); font-weight: 600; min-width: 22px; text-align: left; }

  /* ─── Notes ──────────────────────────────────────────────── */
  .rt-oc-notes { display: grid; grid-template-columns: 1fr; gap: 4px; }
  .rt-oc-note { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
  .rt-oc-note-label { font-size: 13px; font-weight: 600; color: var(--ink); }
  .rt-oc-note-hint { font-size: 11px; color: var(--ink-4); font-style: italic; line-height: 1.3; }
  .rt-oc-note-input {
    margin-top: 4px;
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid var(--rule);
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-inter), system-ui, sans-serif;
    font-size: 15px;
    line-height: 1.4;
    resize: vertical;
    min-height: 44px;
  }
  .rt-oc-note-input:focus { outline: none; border-color: var(--ink); box-shadow: 0 0 0 3px rgba(0,0,0,0.04); }

  /* ─── Still needed / To order ────────────────────────────── */
  .rt-oc-order-empty { font-size: 13px; color: var(--ink-3); font-style: italic; margin: 14px 0 0; }
  .rt-oc-order-block { margin-top: 14px; }
  .rt-oc-order-group { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-4); margin-bottom: 2px; }
  .rt-oc-order-list { list-style: none; padding: 0; margin: 0; }
  .rt-oc-order-item { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid var(--rule); }
  .rt-oc-order-label { font-size: 14px; color: var(--ink); font-weight: 500; }
  .rt-oc-order-qty { font-family: var(--font-mono-dash), ui-monospace, monospace; font-size: 13px; color: var(--signal); font-weight: 700; }
  .rt-oc-order-hint { margin: 14px 0 0; font-size: 12px; color: var(--ink-3); line-height: 1.5; }

  /* ─── Send to team (counting) ────────────────────────────── */
  .rt-oc-send-wrap { margin-top: 24px; }
  .rt-oc-send-btn {
    width: 100%;
    min-height: 48px;
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .rt-oc-send-btn:disabled { opacity: 0.6; cursor: default; }
  .rt-oc-send-btn[data-status="sent"] { background: var(--positive); border-color: var(--positive); opacity: 1; }
  .rt-oc-send-hint { margin: 8px 0 0; font-size: 12px; color: var(--ink-3); line-height: 1.5; }

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
    .rt-oc-notes { grid-template-columns: 1fr 1fr; column-gap: 24px; }
    .rt-oc-send-btn { width: auto; padding: 0 28px; }
  }

  /* ─── Print: strip chrome, keep the sheet ────────────────── */
  @media print {
    .rt-oc { max-width: none; padding: 0; background: #fff; color: #1e2e34; }
    .rt-oc-noprint, .rt-oc-send-wrap { display: none !important; }
    .rt-oc-printonly { display: inline; }
    .rt-oc-head { position: static; border-bottom: 1px solid #1e2e34; margin: 0; padding: 0 0 10px; }
    .rt-oc-group { break-inside: avoid; margin-top: 18px; }
    .rt-oc-item-btn { min-height: 0; padding: 5px 4px; }
    .rt-oc-check { width: 14px; height: 14px; border-width: 1.5px; }
    .rt-oc-list { display: grid; grid-template-columns: 1fr 1fr; column-gap: 28px; }
    .rt-oc-order { break-before: page; }
  }
`;
