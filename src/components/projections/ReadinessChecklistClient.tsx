'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  setReadinessHave,
  setReadinessNote,
  requestReadinessReview,
} from '@/app/projections/actions';
import {
  READINESS_NOTE_FIELDS,
  type ReadinessNoteField,
  type RenderedGroup,
  type RenderedItem,
  type ReadinessContext,
} from '@/lib/projections-readiness';
import type { ReadinessState } from '@/lib/projections-types';

/**
 * Interactive Property Readiness Checklist — the in-the-field walkthrough
 * tool. Optimized for one-handed mobile use:
 *
 *   - Tap a row to toggle "all there" vs "none there" — fast path.
 *   - Tap the qty number to open the numeric keypad and enter a partial
 *     count ("they have 12 of the 18 coffee mugs"). Partial items get a
 *     half-filled checkbox and the gap renders as "12 / 18".
 *   - Notes textareas debounce-save 800ms after the last keystroke and
 *     flush on blur, so a brief pause persists without an explicit Save.
 *   - All writes are optimistic (UI updates immediately) and rolled back
 *     if the server action throws. No revalidatePath — keeps the page
 *     from flashing the parent /projections/loading.tsx mid-tap.
 *
 * Outstanding-items summary at the bottom of the page lists everything
 * with have < need, so the walkthrough produces a natural "shopping
 * list" of what the owner still needs to buy or source.
 *
 * Server state is read once on initial render via the `initial` prop;
 * subsequent server-side renders (after navigation) re-hydrate from
 * props on next mount. While the page is mounted, local state is the
 * source of truth.
 */
export function ReadinessChecklistClient({
  projectionId,
  propertyTag,
  salutation,
  propertyTypeLabel,
  groups,
  context,
  initial,
  printHref,
}: {
  projectionId: string;
  propertyTag: string;
  salutation: string;
  propertyTypeLabel: string;
  groups: RenderedGroup[];
  context: ReadinessContext;
  initial: ReadinessState;
  printHref: string;
}) {
  // Build the initial have-counts dict, falling back to the legacy
  // `checked` array (treated as "have = need").
  const buildInitialHave = (): Record<string, number> => {
    const out: Record<string, number> = { ...(initial.have ?? {}) };
    if (Array.isArray(initial.checked)) {
      for (const g of groups) {
        for (const it of g.items) {
          if (out[it.label] === undefined && initial.checked.includes(it.label)) {
            out[it.label] = it.count;
          }
        }
      }
    }
    return out;
  };

  const [have, setHave] = useState<Record<string, number>>(buildInitialHave);
  const [notes, setNotes] = useState<Record<string, string>>(() => ({ ...(initial.notes ?? {}) }));
  const [lastSaved, setLastSaved] = useState<string | null>(initial.updated_at ?? null);
  const [, startTransition] = useTransition();
  const noteTimers = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});

  // Review-email send state for the bottom-of-page "Send to team" button.
  // Tri-state: 'idle' / 'sending' / 'sent' / 'error'. 'sent' auto-resets
  // to 'idle' after 6s so a second send is reachable if needed.
  const [reviewStatus, setReviewStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Aggregate progress: an item counts as "done" when have >= need.
  const totals = useMemo(() => {
    let totalNeeded = 0;
    let totalHave = 0;
    let itemsTotal = 0;
    let itemsDone = 0;
    for (const g of groups) {
      for (const it of g.items) {
        itemsTotal += 1;
        totalNeeded += it.count;
        const h = Math.min(have[it.label] ?? 0, it.count);
        totalHave += h;
        if (h >= it.count) itemsDone += 1;
      }
    }
    return { totalNeeded, totalHave, itemsTotal, itemsDone };
  }, [groups, have]);

  const pct = totals.totalNeeded > 0
    ? Math.round((totals.totalHave / totals.totalNeeded) * 100)
    : 0;

  function persistHave(label: string, count: number, prevCount: number) {
    startTransition(async () => {
      try {
        await setReadinessHave(projectionId, label, count);
        setLastSaved(new Date().toISOString());
      } catch (err) {
        // Roll back optimistic update on failure.
        setHave((prev) => ({ ...prev, [label]: prevCount }));
        console.error('setReadinessHave failed:', err);
      }
    });
  }

  /**
   * Whole-row tap: cycle 0 ↔ full. If currently partial (0 < have < need)
   * treat it as a "complete it" — go to full.
   */
  function toggleItem(item: RenderedItem) {
    const current = have[item.label] ?? 0;
    const next = current >= item.count ? 0 : item.count;
    setHave((prev) => ({ ...prev, [item.label]: next }));
    persistHave(item.label, next, current);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { (navigator as Navigator & { vibrate?: (p: number) => void }).vibrate?.(8); } catch { /* ignore */ }
    }
  }

  /**
   * Direct count input — called from the qty input's onChange/onBlur.
   * Clamps to [0, need-count].
   */
  function setItemCount(item: RenderedItem, rawValue: string) {
    const parsed = parseInt(rawValue, 10);
    const current = have[item.label] ?? 0;
    const next = Number.isFinite(parsed)
      ? Math.max(0, Math.min(item.count, parsed))
      : 0;
    if (next === current) return;
    setHave((prev) => ({ ...prev, [item.label]: next }));
    persistHave(item.label, next, current);
  }

  function persistNote(key: string, value: string) {
    startTransition(async () => {
      try {
        await setReadinessNote(projectionId, key, value);
        setLastSaved(new Date().toISOString());
      } catch (err) {
        console.error('setReadinessNote failed:', err);
      }
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

  function sendReview() {
    setReviewStatus('sending');
    setReviewError(null);
    startTransition(async () => {
      try {
        const result = await requestReadinessReview(projectionId);
        if (result.ok) {
          setReviewStatus('sent');
          setTimeout(() => setReviewStatus('idle'), 6000);
        } else {
          setReviewStatus('error');
          setReviewError(result.reason || 'send failed');
        }
      } catch (err) {
        setReviewStatus('error');
        setReviewError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  // Build the "still needed" list for the summary at the bottom.
  const stillNeeded = useMemo(() => {
    const out: { label: string; need: number; have: number; gap: number; group: string }[] = [];
    for (const g of groups) {
      for (const it of g.items) {
        const h = Math.min(have[it.label] ?? 0, it.count);
        if (h < it.count) {
          out.push({
            label: it.label,
            need: it.count,
            have: h,
            gap: it.count - h,
            group: g.title,
          });
        }
      }
    }
    return out;
  }, [groups, have]);

  return (
    <>
      <style>{readinessClientCss}</style>
      <div className="rt-rc">
        {/* ─── Sticky header with progress + actions ──────────────── */}
        <header className="rt-rc-head">
          <div className="rt-rc-head-top">
            <Link href={`/projections/${projectionId}`} className="rt-rc-back">
              ← Prospect
            </Link>
            <Link href={printHref} target="_blank" className="rt-rc-print">
              Print version ↗
            </Link>
          </div>
          <div className="rt-rc-title-block">
            <div className="rt-rc-eyebrow">Property Readiness</div>
            <h1 className="rt-rc-h1">{propertyTag}</h1>
            <p className="rt-rc-tag">
              {salutation}&rsquo;s {propertyTypeLabel} · {context.maxGuests} guests ·{' '}
              {context.bedrooms} BR / {context.bathrooms} BA
              {context.bathroomsFromIntake ? '' : ' (est.)'}
            </p>
          </div>
          <div className="rt-rc-progress">
            <div className="rt-rc-progress-row">
              <span className="rt-rc-progress-num">
                {totals.itemsDone} of {totals.itemsTotal} complete
              </span>
              <span className="rt-rc-progress-pct">{pct}%</span>
            </div>
            <div className="rt-rc-progress-bar" aria-hidden>
              <div className="rt-rc-progress-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            {lastSaved && (
              <div className="rt-rc-saved">
                Last edit {formatSavedAt(lastSaved)}
              </div>
            )}
          </div>
        </header>

        {/* ─── Item groups ────────────────────────────────────────── */}
        {groups.map((g) => {
          const groupDone = g.items.filter(
            (i) => (have[i.label] ?? 0) >= i.count,
          ).length;
          return (
            <section className="rt-rc-group" key={g.title}>
              <div className="rt-rc-group-head">
                <h2 className="rt-rc-group-title">{g.title}</h2>
                <span className="rt-rc-group-count">{groupDone} / {g.items.length}</span>
              </div>
              <ul className="rt-rc-list">
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

        {/* ─── Walkthrough notes ──────────────────────────────────── */}
        <section className="rt-rc-group">
          <div className="rt-rc-group-head">
            <h2 className="rt-rc-group-title">Walkthrough notes</h2>
          </div>
          <div className="rt-rc-notes">
            {READINESS_NOTE_FIELDS.map((f) => (
              <NoteInput
                key={f.key}
                field={f}
                value={notes[f.key] ?? ''}
                onChange={(v) => onNoteChange(f.key, v)}
                onBlur={() => flushNote(f.key)}
              />
            ))}
          </div>
        </section>

        {/* ─── Still-needed summary (shopping list) ──────────────── */}
        <section className="rt-rc-group rt-rc-needed">
          <div className="rt-rc-group-head">
            <h2 className="rt-rc-group-title">Still needed</h2>
            <span className="rt-rc-group-count">
              {stillNeeded.length} item{stillNeeded.length === 1 ? '' : 's'}
            </span>
          </div>
          {stillNeeded.length === 0 ? (
            <p className="rt-rc-needed-empty">
              Everything is accounted for. The property is guest-ready.
            </p>
          ) : (
            <ul className="rt-rc-needed-list">
              {stillNeeded.map((n) => (
                <li key={n.label} className="rt-rc-needed-item">
                  <span className="rt-rc-needed-label">{n.label}</span>
                  <span className="rt-rc-needed-meta">
                    <span className="rt-rc-needed-group">{n.group}</span>
                    <span className="rt-rc-needed-qty">
                      {n.have > 0 ? `${n.have} / ${n.need}` : `Need ${n.need}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Send-to-team button. Emails Allie + CCs Ryan + Dotti so the
              team can review the punch list + walkthrough notes before
              anything goes outbound to the owner. */}
          <div className="rt-rc-send-wrap">
            <button
              type="button"
              className="rt-rc-send-btn"
              onClick={sendReview}
              disabled={reviewStatus === 'sending'}
              data-status={reviewStatus}
            >
              {reviewStatus === 'sending' && 'Sending…'}
              {reviewStatus === 'sent' && '✓ Sent to team'}
              {reviewStatus === 'error' && 'Retry send to team'}
              {reviewStatus === 'idle' && 'Send to team for review →'}
            </button>
            <p className="rt-rc-send-hint">
              {reviewStatus === 'sent'
                ? `Allie, Ryan, and you should have it shortly. Review and forward to ${salutation.split(' ')[0]} when ready.`
                : reviewStatus === 'error'
                  ? `Send failed: ${reviewError ?? 'unknown error'}. Try again or check the logs.`
                  : 'Emails the current still-needed list + walkthrough notes to Allie, Ryan, and you for review. Owner is not on the thread.'}
            </p>
          </div>
        </section>

        <footer className="rt-rc-foot">
          Walk-through · Rising Tide · risingtidestr.com
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

  const isFull = haveCount >= item.count;
  const isPartial = haveCount > 0 && haveCount < item.count;
  const isEmpty = haveCount === 0;

  return (
    <li
      className="rt-rc-item"
      data-state={isFull ? 'full' : isPartial ? 'partial' : 'empty'}
    >
      <button
        type="button"
        className="rt-rc-item-btn"
        onClick={onToggle}
        aria-pressed={isFull}
        aria-label={`${item.label}, ${haveCount} of ${item.count}, tap to toggle`}
      >
        <span className="rt-rc-check" aria-hidden>
          {isFull && (
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 8.5l3.5 3.5L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {isPartial && <span className="rt-rc-check-partial" aria-hidden />}
        </span>
        <span className="rt-rc-item-text">
          <span className="rt-rc-item-label">{item.label}</span>
          {item.note && <span className="rt-rc-item-note">{item.note}</span>}
        </span>
      </button>
      {/* Qty editor: numeric input + the / need-count. Stops click
          propagation so tapping the input doesn't also trigger the
          row's toggle handler. */}
      <div
        className="rt-rc-qty"
        onClick={(e) => e.stopPropagation()}
      >
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
          className="rt-rc-qty-input"
          aria-label={`${item.label} count`}
        />
        <span className="rt-rc-qty-sep">/</span>
        <span className="rt-rc-qty-need">{item.count}</span>
      </div>
    </li>
  );
}

function NoteInput({
  field,
  value,
  onChange,
  onBlur,
}: {
  field: ReadinessNoteField;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <label className="rt-rc-note">
      <span className="rt-rc-note-label">{field.label}</span>
      <span className="rt-rc-note-hint">{field.hint}</span>
      <textarea
        className="rt-rc-note-input"
        rows={field.rows ?? 2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder=""
      />
    </label>
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
const readinessClientCss = `
  .rt-rc {
    max-width: 720px;
    margin: 0 auto;
    padding: 0 16px 80px;
    color: var(--ink);
    background: var(--paper);
    min-height: 100vh;
  }

  /* ─── Sticky header ───────────────────────────────────────── */
  .rt-rc-head {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--paper);
    padding: 12px 16px 14px;
    margin: 0 -16px;
    border-bottom: 1px solid var(--rule);
  }
  .rt-rc-head-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }
  .rt-rc-back, .rt-rc-print {
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-3);
    text-decoration: none;
    padding: 6px 8px;
    margin: -6px -8px;
    border-radius: 4px;
    -webkit-tap-highlight-color: rgba(0,0,0,0.04);
  }
  .rt-rc-back:active, .rt-rc-print:active { background: var(--paper-2); }
  .rt-rc-title-block { margin-bottom: 10px; }
  .rt-rc-eyebrow {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
  }
  .rt-rc-h1 {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 26px;
    line-height: 1.1;
    font-weight: 300;
    letter-spacing: -0.02em;
    color: var(--ink);
    margin: 4px 0 0;
  }
  .rt-rc-tag {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--ink-3);
    line-height: 1.4;
  }

  .rt-rc-progress { margin-top: 4px; }
  .rt-rc-progress-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 4px;
  }
  .rt-rc-progress-num {
    font-size: 12px;
    color: var(--ink);
    letter-spacing: 0.02em;
  }
  .rt-rc-progress-pct {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 13px;
    letter-spacing: 0.04em;
    color: var(--signal);
    font-weight: 700;
  }
  .rt-rc-progress-bar {
    height: 3px;
    background: var(--rule);
    border-radius: 2px;
    overflow: hidden;
  }
  .rt-rc-progress-bar-fill {
    height: 100%;
    background: var(--signal);
    transition: width 200ms ease-out;
  }
  .rt-rc-saved {
    margin-top: 6px;
    font-size: 10px;
    color: var(--ink-4);
    font-style: italic;
  }

  /* ─── Item groups ────────────────────────────────────────── */
  .rt-rc-group { margin-top: 28px; }
  .rt-rc-group-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--ink);
    margin-bottom: 4px;
  }
  .rt-rc-group-title {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 22px;
    font-weight: 400;
    letter-spacing: -0.01em;
    color: var(--ink);
    margin: 0;
  }
  .rt-rc-group-count {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 11px;
    color: var(--ink-4);
    letter-spacing: 0.04em;
  }

  /* ─── Item rows ──────────────────────────────────────────── */
  .rt-rc-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .rt-rc-item {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: stretch;
    border-bottom: 1px solid var(--rule);
    gap: 6px;
  }
  .rt-rc-item-btn {
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
    transition: opacity 120ms ease;
  }
  .rt-rc-item-btn:active { background: var(--paper-2); }
  .rt-rc-check {
    width: 22px;
    height: 22px;
    border: 2px solid var(--ink-3);
    border-radius: 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--paper);
    flex-shrink: 0;
    transition: all 120ms ease;
    color: var(--paper);
    position: relative;
  }
  .rt-rc-item[data-state="full"] .rt-rc-check {
    background: var(--signal);
    border-color: var(--signal);
    color: var(--paper);
  }
  .rt-rc-item[data-state="partial"] .rt-rc-check {
    border-color: var(--signal);
    background: var(--paper);
  }
  /* Half-fill diagonal for partial state — gives an obvious "started
     but not done" look without needing a different icon. */
  .rt-rc-check-partial {
    position: absolute;
    inset: 2px;
    background: linear-gradient(135deg, var(--signal) 0 50%, transparent 50% 100%);
    border-radius: 3px;
  }
  .rt-rc-item-text { min-width: 0; }
  .rt-rc-item-label {
    display: block;
    font-size: 14.5px;
    line-height: 1.35;
    color: var(--ink);
    font-weight: 500;
    transition: all 160ms ease;
  }
  .rt-rc-item[data-state="full"] .rt-rc-item-label {
    color: var(--ink-4);
    text-decoration: line-through;
    text-decoration-color: var(--ink-4);
    text-decoration-thickness: 1px;
  }
  .rt-rc-item-note {
    display: block;
    font-size: 11px;
    color: var(--ink-4);
    font-style: italic;
    line-height: 1.3;
    margin-top: 2px;
  }

  /* Qty editor: input + " / need" suffix */
  .rt-rc-qty {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 6px 0 4px;
    align-self: center;
  }
  .rt-rc-qty-input {
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
  .rt-rc-qty-input::-webkit-outer-spin-button,
  .rt-rc-qty-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .rt-rc-qty-input:focus {
    outline: none;
    border-color: var(--signal);
    box-shadow: 0 0 0 3px rgba(200, 90, 58, 0.12);
  }
  .rt-rc-item[data-state="full"] .rt-rc-qty-input { color: var(--ink-4); }
  .rt-rc-qty-sep {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 13px;
    color: var(--ink-4);
  }
  .rt-rc-qty-need {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 13px;
    color: var(--ink-3);
    font-weight: 600;
    min-width: 22px;
    text-align: left;
  }

  /* ─── Walkthrough notes (real textareas) ─────────────────── */
  .rt-rc-notes {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 10px;
  }
  .rt-rc-note {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .rt-rc-note-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--ink);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .rt-rc-note-hint {
    font-size: 11px;
    color: var(--ink-4);
    font-style: italic;
    line-height: 1.3;
  }
  .rt-rc-note-input {
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
  .rt-rc-note-input:focus {
    outline: none;
    border-color: var(--ink);
    box-shadow: 0 0 0 3px rgba(0,0,0,0.04);
  }

  /* ─── Still needed (shopping list summary) ───────────────── */
  .rt-rc-needed-empty {
    font-size: 13px;
    color: var(--ink-3);
    font-style: italic;
    margin: 14px 0 0;
  }
  .rt-rc-needed-list {
    list-style: none;
    padding: 0;
    margin: 6px 0 0;
  }
  .rt-rc-needed-item {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px;
    align-items: baseline;
    padding: 10px 0;
    border-bottom: 1px solid var(--rule);
  }
  .rt-rc-needed-label {
    font-size: 14px;
    color: var(--ink);
    font-weight: 500;
  }
  .rt-rc-needed-meta {
    display: inline-flex;
    align-items: baseline;
    gap: 10px;
  }
  .rt-rc-needed-group {
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-4);
  }
  .rt-rc-needed-qty {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 13px;
    color: var(--signal);
    font-weight: 700;
  }

  /* Send-to-team action */
  .rt-rc-send-wrap {
    margin-top: 22px;
    padding-top: 16px;
    border-top: 1px solid var(--rule);
  }
  .rt-rc-send-btn {
    display: inline-block;
    background: var(--ink);
    color: var(--paper);
    border: none;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    padding: 14px 22px;
    min-height: 48px;
    cursor: pointer;
    transition: opacity 120ms ease, background 120ms ease;
    -webkit-tap-highlight-color: rgba(0,0,0,0.04);
  }
  .rt-rc-send-btn:disabled { opacity: 0.6; cursor: wait; }
  .rt-rc-send-btn[data-status="sent"] {
    background: var(--positive);
    color: var(--paper);
  }
  .rt-rc-send-btn[data-status="error"] {
    background: var(--negative);
    color: var(--paper);
  }
  .rt-rc-send-hint {
    margin: 10px 0 0;
    font-size: 12px;
    color: var(--ink-3);
    line-height: 1.5;
    max-width: 540px;
  }

  /* ─── Footer ──────────────────────────────────────────────── */
  .rt-rc-foot {
    margin-top: 40px;
    padding-top: 14px;
    border-top: 1px solid var(--rule);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-4);
    text-align: center;
  }

  /* ─── Desktop refinements (>720px) ────────────────────────── */
  @media (min-width: 720px) {
    .rt-rc { padding: 0 24px 80px; }
    .rt-rc-head {
      padding-left: 24px;
      padding-right: 24px;
      margin: 0 -24px;
    }
    .rt-rc-h1 { font-size: 34px; }
    .rt-rc-list {
      display: grid;
      grid-template-columns: 1fr 1fr;
      column-gap: 28px;
    }
    .rt-rc-notes {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px 28px;
    }
  }
`;
