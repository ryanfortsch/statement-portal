'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { setReadinessChecked, setReadinessNote } from '@/app/projections/actions';
import {
  READINESS_NOTE_FIELDS,
  type ReadinessNoteField,
  type RenderedGroup,
  type ReadinessContext,
} from '@/lib/projections-readiness';
import type { ReadinessState } from '@/lib/projections-types';

/**
 * Interactive Property Readiness Checklist — the in-the-field walkthrough
 * tool. Optimized for one-handed mobile use:
 *
 *   - Tap-anywhere-on-the-row toggles a check.
 *   - Big finger-friendly targets (44pt min) per Apple HIG.
 *   - Notes textareas debounce-save 800ms after the last keystroke and
 *     flush on blur, so a brief pause persists without an explicit Save.
 *   - All writes are optimistic (UI updates immediately) and rolled back
 *     if the server action throws.
 *
 * Server state is read once on initial render via the `initial` prop;
 * subsequent server-side renders (after revalidatePath) re-hydrate the
 * initial state from props on next mount. While the page is mounted,
 * local state is the source of truth.
 *
 * The static printable version lives at /projections/<id>/readiness/print
 * and is used by puppeteer to render the owner-facing PDF.
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
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initial.checked ?? []));
  const [notes, setNotes] = useState<Record<string, string>>(() => ({ ...(initial.notes ?? {}) }));
  const [lastSaved, setLastSaved] = useState<string | null>(initial.updated_at ?? null);
  const [, startTransition] = useTransition();
  const noteTimers = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});

  // Aggregate progress across all groups for the sticky header.
  const totalItems = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups]);
  const checkedCount = checked.size;
  const pct = totalItems > 0 ? Math.round((checkedCount / totalItems) * 100) : 0;

  function persistCheck(label: string, nextChecked: boolean) {
    startTransition(async () => {
      try {
        await setReadinessChecked(projectionId, label, nextChecked);
        setLastSaved(new Date().toISOString());
      } catch (err) {
        // Roll back optimistic update on failure so the UI matches the DB.
        setChecked((prev) => {
          const next = new Set(prev);
          if (nextChecked) next.delete(label);
          else next.add(label);
          return next;
        });
        console.error('setReadinessChecked failed:', err);
      }
    });
  }

  function toggleItem(label: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      const nextChecked = !next.has(label);
      if (nextChecked) next.add(label);
      else next.delete(label);
      persistCheck(label, nextChecked);
      return next;
    });
    // Gentle haptic feedback on phones that support it.
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { (navigator as Navigator & { vibrate?: (p: number) => void }).vibrate?.(8); } catch { /* ignore */ }
    }
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
    // Debounce: only persist 800ms after the last keystroke.
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

  // Cleanup pending debounce timers on unmount.
  useEffect(() => {
    const timers = noteTimers.current;
    return () => {
      Object.values(timers).forEach((t) => { if (t) clearTimeout(t); });
    };
  }, []);

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
              <span className="rt-rc-progress-num">{checkedCount} of {totalItems}</span>
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
          const groupChecked = g.items.filter((i) => checked.has(i.label)).length;
          return (
            <section className="rt-rc-group" key={g.title}>
              <div className="rt-rc-group-head">
                <h2 className="rt-rc-group-title">{g.title}</h2>
                <span className="rt-rc-group-count">{groupChecked} / {g.items.length}</span>
              </div>
              <ul className="rt-rc-list">
                {g.items.map((it) => {
                  const isChecked = checked.has(it.label);
                  return (
                    <li key={it.label} className="rt-rc-item" data-checked={isChecked || undefined}>
                      <button
                        type="button"
                        className="rt-rc-item-btn"
                        onClick={() => toggleItem(it.label)}
                        aria-pressed={isChecked}
                      >
                        <span className="rt-rc-check" aria-hidden>
                          {isChecked && (
                            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M3 8.5l3.5 3.5L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <span className="rt-rc-item-text">
                          <span className="rt-rc-item-label">{it.label}</span>
                          {it.note && <span className="rt-rc-item-note">{it.note}</span>}
                        </span>
                        <span className="rt-rc-item-qty">{it.count}</span>
                      </button>
                    </li>
                  );
                })}
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

        <footer className="rt-rc-foot">
          Walk-through · Rising Tide · risingtidestr.com
        </footer>
      </div>
    </>
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
// Mobile-first: assume narrow viewport, scale up at >720px to a comfy
// two-column layout for desktop preview. Tap targets are ≥44pt; checkboxes
// are 22px with extra padding on the button so the full row is grabbable.
// Sticky header keeps progress visible while scrolling long groups.
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
    padding: 12px 0 14px;
    margin: 0 -16px;
    padding-left: 16px;
    padding-right: 16px;
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
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 12px;
    font-weight: 700;
    color: var(--ink);
    letter-spacing: 0.02em;
  }
  .rt-rc-progress-pct {
    font-size: 11px;
    letter-spacing: 0.14em;
    color: var(--signal);
    font-weight: 600;
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
    border-bottom: 1px solid var(--rule);
  }
  .rt-rc-item-btn {
    display: grid;
    grid-template-columns: 28px 1fr auto;
    gap: 14px;
    align-items: center;
    width: 100%;
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
  }
  .rt-rc-item[data-checked] .rt-rc-check {
    background: var(--signal);
    border-color: var(--signal);
    color: var(--paper);
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
  .rt-rc-item[data-checked] .rt-rc-item-label {
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
  .rt-rc-item-qty {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 15px;
    color: var(--signal);
    font-weight: 700;
    letter-spacing: 0.02em;
    min-width: 30px;
    text-align: right;
  }
  .rt-rc-item[data-checked] .rt-rc-item-qty {
    color: var(--ink-4);
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
      margin: 0 -24px;
      padding-left: 24px;
      padding-right: 24px;
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
