'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  setLaunchStepStatus,
  setLaunchStepNotes,
  setLaunchStepField,
} from './actions';
import type { LaunchStep, LaunchStepRow, LaunchStepStatus } from '@/lib/launch-checklist';

type Props = {
  propertyId: string;
  step: LaunchStep;
  row: LaunchStepRow | null;
  /** True when the step was auto-resolved by data already on the property
   *  (fee set at promotion, bank last4 entered on the edit page, SCA page
   *  live, etc.) — the row's manual status is still `todo` in the DB but
   *  the operator's nothing left to do. Renders the read-only "Done"
   *  pill + an "Auto" tag, and the deep-link still appears so they can
   *  jump to the underlying surface to verify if they want. */
  autoResolved?: boolean;
  /** Current value of the property column this step writes through to
   *  (title / tax_cert_id / bank_last4 / listing_match). Only passed for
   *  the four `set_*` field steps; prefills the inline editor. */
  fieldValue?: string | null;
};

/** The four steps whose action maps to a real property column. For these
 *  the card renders an inline value field that writes the column straight
 *  through — the page's deriveStepResolved then ticks the step. */
const FIELD_ACTION_META: Record<
  string,
  { label: string; placeholder: string; mono?: boolean }
> = {
  set_external_title: { label: 'External listing title', placeholder: 'Stay at Wingaersheek' },
  set_tax_cert: { label: 'MA STR tax certificate ID', placeholder: 'C0585051070', mono: true },
  set_bank_last4: { label: 'Bank account last 4', placeholder: '1234', mono: true },
  set_listing_match: { label: 'Guesty listing-match substring', placeholder: '16 waterman', mono: true },
};

/**
 * Maps a step's `action` to a deep-link the operator can use to execute
 * the work from the checklist itself. Internal paths use Next routing;
 * external services open in a new tab. Returns null for actions that
 * don't have a destination yet (generate_copy, send_welcome, activate
 * lives on the launch page itself).
 */
function deepLinkFor(
  action: LaunchStep['action'],
  propertyId: string,
): { href: string; label: string; external: boolean } | null {
  switch (action) {
    case 'edit_field':
    case 'set_listing_match':
    case 'set_bank_last4':
    case 'set_tax_cert':
      return { href: `/properties/${propertyId}/edit`, label: 'Open property edit', external: false };
    case 'set_external_title':
      return { href: `/properties/${propertyId}/stay-cape-ann`, label: 'Open Stay Cape Ann', external: false };
    case 'open_quo':
      return { href: 'https://my.openphone.com/', label: 'Open Quo', external: true };
    case 'open_seam':
      return { href: 'https://console.seam.co/', label: 'Open Seam', external: true };
    default:
      return null;
  }
}

const STATUS_OPTIONS: Array<{ value: LaunchStepStatus; label: string }> = [
  { value: 'todo', label: 'To-do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'n_a', label: 'N/A' },
];

/**
 * One row in the launch checklist. The page renders these inside phase
 * sections. Status changes go through a server action and the page
 * re-renders via router.refresh().
 *
 * Visual model: every row carries a left-side status dot (24px circle,
 * varies per state) + a title-and-meta column + a right-side status
 * pill that opens the native select for changing state. Resolved
 * steps (done | skipped | n_a) mute the title and dim the row a touch
 * so live work pops by comparison. Auto-completed steps lose the
 * change affordance entirely and gain a small "Auto" badge.
 */
export function LaunchStepCard({ propertyId, step, row, autoResolved, fieldValue }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState<string>(row?.notes ?? '');
  const [notesPending, setNotesPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline field editor (the four set_* steps). Writes the real property
  // column; the page re-derives this step's resolved state from it.
  const fieldMeta = step.action ? FIELD_ACTION_META[step.action] : undefined;
  const [fieldDraft, setFieldDraft] = useState<string>(fieldValue ?? '');
  const [fieldPending, setFieldPending] = useState(false);
  const [fieldSaved, setFieldSaved] = useState(false);

  async function saveField() {
    if (!step.action) return;
    setFieldPending(true);
    setError(null);
    setFieldSaved(false);
    const res = await setLaunchStepField(propertyId, step.action, fieldDraft);
    setFieldPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setFieldSaved(true);
    router.refresh();
  }

  // Effective status: the operator's manual choice wins; otherwise the
  // derivation flag from the page bumps a todo row up to done.
  const manualStatus: LaunchStepStatus = row?.status ?? 'todo';
  const status: LaunchStepStatus =
    autoResolved && manualStatus === 'todo' ? 'done' : manualStatus;
  const isAuto = step.auto || (autoResolved && manualStatus === 'todo');
  const isDone = status === 'done';
  const isSkipped = status === 'skipped' || status === 'n_a';
  const isResolved = isDone || isSkipped;
  const link = deepLinkFor(step.action, propertyId);

  function changeStatus(next: LaunchStepStatus) {
    setError(null);
    startTransition(async () => {
      const res = await setLaunchStepStatus(propertyId, step.key, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  async function saveNotes() {
    setNotesPending(true);
    setError(null);
    const res = await setLaunchStepNotes(propertyId, step.key, notesDraft);
    setNotesPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <style>{rowCss}</style>
      <div
        className="rt-launch-row"
        data-state={status}
        data-pending={pending || undefined}
      >
        <div className="rt-launch-row-inner">
          {/* Left: status dot */}
          <div style={{ paddingTop: 2 }}>
            <StatusDot status={status} />
          </div>

          {/* Middle: title + meta */}
          <div style={{ minWidth: 0 }}>
            <div className="rt-launch-row-title-line">
              <span
                className="rt-launch-row-title"
                style={{
                  color: isResolved ? 'var(--ink-3)' : 'var(--ink)',
                  textDecoration: isSkipped ? 'line-through' : 'none',
                }}
              >
                {step.title}
              </span>
              {step.required && !isResolved && <Tag tone="signal">Required</Tag>}
              {step.gate && <Tag tone="ink">Activation gate</Tag>}
              {isAuto && <Tag tone="muted">Auto</Tag>}
            </div>

            {step.description && (
              <div className="rt-launch-row-desc">{step.description}</div>
            )}
            {step.why && (
              <div className="rt-launch-row-why">{step.why}</div>
            )}
            {step.example && (
              <div className="rt-launch-row-example">
                e.g.{' '}
                <span className="font-mono">{step.example}</span>
              </div>
            )}
            {row?.completed_at && isDone && (
              <div className="rt-launch-row-stamp">
                ✓ {formatRelative(row.completed_at)}
                {row.completed_by ? ` · ${row.completed_by}` : ''}
              </div>
            )}
            {error && <div className="rt-launch-row-error">{error}</div>}

            {/* Inline field editor — for the four steps that map to a real
                property column. Typing the value here writes the column
                through (via setLaunchStepField) and the step ticks itself
                off on the next render. No more inert notes / bouncing to
                another page just to set one field. */}
            {fieldMeta && (
              <div className="rt-launch-row-field">
                <label className="rt-launch-row-field-label">{fieldMeta.label}</label>
                <div className="rt-launch-row-field-row">
                  <input
                    type="text"
                    value={fieldDraft}
                    onChange={(e) => { setFieldDraft(e.target.value); setFieldSaved(false); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveField(); } }}
                    placeholder={fieldMeta.placeholder}
                    className={`rt-launch-row-field-input${fieldMeta.mono ? ' font-mono' : ''}`}
                  />
                  <button
                    type="button"
                    onClick={saveField}
                    disabled={fieldPending || fieldDraft.trim() === (fieldValue ?? '').trim()}
                    className="rt-launch-row-btn rt-launch-row-btn-primary"
                  >
                    {fieldPending ? 'Saving…' : fieldSaved ? 'Saved ✓' : 'Save'}
                  </button>
                </div>
              </div>
            )}

            {/* Deep-link: jumps to the surface where the step's actual
                work happens (the property edit page, Stay Cape Ann
                launcher, Quo console, Seam console). Shown even on
                resolved steps so the operator can re-open to verify
                or correct. */}
            {link && (
              <div style={{ marginTop: 10 }}>
                <a
                  href={link.href}
                  target={link.external ? '_blank' : undefined}
                  rel={link.external ? 'noopener noreferrer' : undefined}
                  className="rt-launch-row-deeplink"
                >
                  {link.label} {link.external ? '↗' : '→'}
                </a>
              </div>
            )}

            {/* Notes affordance — quiet until invoked. When a note exists,
                the preview shows inline so it's discoverable at a glance. */}
            <div className="rt-launch-row-notes">
              <button
                type="button"
                className="rt-launch-row-notes-toggle"
                onClick={() => setNotesOpen((v) => !v)}
              >
                {notesOpen
                  ? '− Hide note'
                  : row?.notes
                    ? '+ Edit note'
                    : '+ Add note'}
              </button>
              {row?.notes && !notesOpen && (
                <span className="rt-launch-row-notes-preview">
                  {row.notes.length > 90 ? row.notes.slice(0, 90) + '…' : row.notes}
                </span>
              )}
              {notesOpen && (
                <div style={{ marginTop: 10 }}>
                  <textarea
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    rows={3}
                    placeholder="Notes for this step…"
                    className="rt-launch-row-notes-textarea"
                  />
                  <div className="rt-launch-row-notes-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setNotesDraft(row?.notes ?? '');
                        setNotesOpen(false);
                      }}
                      className="rt-launch-row-btn rt-launch-row-btn-ghost"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        saveNotes().then(() => setNotesOpen(false));
                      }}
                      disabled={notesPending}
                      className="rt-launch-row-btn rt-launch-row-btn-primary"
                    >
                      {notesPending ? 'Saving…' : 'Save note'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: status pill / select. Auto steps (whether hard-coded
              at definition time or derived from property data on this
              render) get a read-only pill — the operator can still
              override via the deep-link to the underlying surface. */}
          <div className="rt-launch-row-status-col">
            {isAuto ? (
              <span
                aria-label="Auto-completed"
                className="rt-launch-row-status-readonly"
                data-state={status}
              >
                {readonlyStatusLabel(status)}
              </span>
            ) : (
              <span className="rt-launch-row-status-wrap" data-state={status}>
                <select
                  value={status}
                  onChange={(e) => changeStatus(e.target.value as LaunchStepStatus)}
                  disabled={pending}
                  className="rt-launch-row-status-select"
                  aria-label={`Change status for ${step.title}`}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <span className="rt-launch-row-status-caret" aria-hidden>⌄</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function StatusDot({ status }: { status: LaunchStepStatus }) {
  const styles: Record<LaunchStepStatus, { bg: string; border: string; mark?: string; markColor?: string }> = {
    todo: { bg: 'var(--paper)', border: 'var(--ink-4)' },
    in_progress: {
      bg: 'var(--paper)',
      border: 'var(--signal)',
      mark: '●',
      markColor: 'var(--signal)',
    },
    done: { bg: 'var(--positive)', border: 'var(--positive)', mark: '✓', markColor: 'var(--paper)' },
    skipped: { bg: 'var(--paper)', border: 'var(--rule)', mark: '–', markColor: 'var(--ink-4)' },
    n_a: { bg: 'var(--paper)', border: 'var(--rule)', mark: '∕', markColor: 'var(--ink-4)' },
  };
  const s = styles[status];
  // In-progress dot uses a smaller inner pip + signal ring (matches the
  // pipeline progress bar's "active" look on the prospect page).
  if (status === 'in_progress') {
    return (
      <span
        aria-label={status}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: 'var(--paper)',
          border: '2px solid var(--signal)',
          boxShadow: '0 0 0 3px var(--paper) inset, 0 0 0 5px var(--signal) inset',
        }}
      />
    );
  }
  return (
    <span
      aria-label={status}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        borderRadius: '50%',
        background: s.bg,
        border: `2px solid ${s.border}`,
        color: s.markColor ?? 'var(--ink-3)',
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {s.mark ?? ''}
    </span>
  );
}

function Tag({ tone, children }: { tone: 'signal' | 'ink' | 'muted'; children: React.ReactNode }) {
  const styles: Record<string, React.CSSProperties> = {
    signal: {
      color: 'var(--signal)',
      background: 'rgba(200, 90, 58, 0.08)',
      border: '1px solid rgba(200, 90, 58, 0.35)',
    },
    ink: {
      color: 'var(--ink)',
      background: 'var(--paper-2)',
      border: '1px solid var(--rule)',
    },
    muted: {
      color: 'var(--ink-4)',
      background: 'transparent',
      border: '1px solid var(--rule)',
    },
  };
  return (
    <span
      style={{
        ...styles[tone],
        fontSize: 9.5,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        fontWeight: 600,
        padding: '2px 7px',
        marginLeft: 8,
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  );
}

function readonlyStatusLabel(status: LaunchStepStatus): string {
  return STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const day = 86400000;
  if (diffMs < day) return 'today';
  if (diffMs < 2 * day) return 'yesterday';
  const days = Math.floor(diffMs / day);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── CSS ────────────────────────────────────────────────────────────────────
// Card-level cohesion: the row reads as a single "unit" with consistent
// spacing, subtle hover invitation, and per-state visual de-emphasis.
// Resolved steps fade just enough to surface the active ones; the status
// pill on the right gets a designed wrapper around the native <select>
// so the affordance is obviously interactive (border, caret, hover lift)
// while the underlying control stays accessible.
const rowCss = `
  .rt-launch-row {
    border-bottom: 1px solid var(--rule);
    transition: background 140ms ease, opacity 140ms ease;
  }
  .rt-launch-row:hover {
    background: var(--paper-2, #f5f1e7);
  }
  .rt-launch-row[data-pending] {
    opacity: 0.55;
  }
  .rt-launch-row[data-state="done"],
  .rt-launch-row[data-state="skipped"],
  .rt-launch-row[data-state="n_a"] {
    /* Resolved rows step back a touch so live work pops. */
    background: transparent;
  }
  .rt-launch-row[data-state="done"]:hover,
  .rt-launch-row[data-state="skipped"]:hover,
  .rt-launch-row[data-state="n_a"]:hover {
    background: var(--paper-2, #f5f1e7);
  }

  .rt-launch-row-inner {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) auto;
    gap: 16px;
    padding: 18px 4px;
    align-items: start;
  }

  .rt-launch-row-title-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0;
    row-gap: 6px;
  }
  .rt-launch-row-title {
    font-size: 14.5px;
    font-weight: 500;
    line-height: 1.4;
    letter-spacing: -0.005em;
  }
  .rt-launch-row-desc {
    margin-top: 6px;
    font-size: 12.5px;
    color: var(--ink-3);
    line-height: 1.55;
  }
  .rt-launch-row-why {
    margin-top: 4px;
    font-size: 11.5px;
    color: var(--ink-4, #8a9aa1);
    font-style: italic;
    line-height: 1.55;
  }
  .rt-launch-row-example {
    margin-top: 4px;
    font-size: 12px;
    color: var(--ink-3);
  }
  .rt-launch-row-stamp {
    margin-top: 8px;
    font-size: 11px;
    color: var(--positive);
    letter-spacing: 0.02em;
  }
  .rt-launch-row-error {
    margin-top: 8px;
    font-size: 11px;
    color: var(--negative, #b04a3a);
  }

  /* Deep-link to the surface where this step's work actually happens
     (property edit, Stay Cape Ann launcher, Quo, Seam). Quiet by
     default; on hover it lights up to ink. */
  .rt-launch-row-deeplink {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--ink-3);
    text-decoration: none;
    border-bottom: 1px dashed var(--rule);
    padding-bottom: 1px;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .rt-launch-row-deeplink:hover {
    color: var(--ink);
    border-bottom-color: var(--ink);
  }

  /* Inline field editor: the primary affordance on set_* steps. A
     labeled input + Save that writes the real property column. */
  .rt-launch-row-field { margin-top: 12px; max-width: 480px; }
  .rt-launch-row-field-label {
    display: block;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin-bottom: 6px;
  }
  .rt-launch-row-field-row { display: flex; gap: 8px; align-items: stretch; }
  .rt-launch-row-field-input {
    flex: 1;
    min-width: 0;
    padding: 9px 12px;
    border: 1px solid var(--rule);
    border-bottom: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font-size: 14px;
    outline: none;
  }
  .rt-launch-row-field-input:focus { border-color: var(--ink); }

  /* Notes affordance: a quiet button that lights up on hover. When a
     note exists, the preview sits inline next to the button so it's
     scannable while collapsed. */
  .rt-launch-row-notes { margin-top: 12px; }
  .rt-launch-row-notes-toggle {
    background: none;
    border: none;
    padding: 2px 0;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-4);
    cursor: pointer;
    transition: color 120ms ease;
  }
  .rt-launch-row-notes-toggle:hover { color: var(--ink); }
  .rt-launch-row-notes-preview {
    margin-left: 12px;
    font-size: 12px;
    color: var(--ink-3);
    font-style: italic;
  }
  .rt-launch-row-notes-textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--rule);
    background: var(--paper);
    color: var(--ink);
    font-family: inherit;
    font-size: 13px;
    line-height: 1.5;
    resize: vertical;
    box-sizing: border-box;
  }
  .rt-launch-row-notes-textarea:focus {
    outline: none;
    border-color: var(--ink);
    box-shadow: 0 0 0 3px rgba(0,0,0,0.04);
  }
  .rt-launch-row-notes-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 8px;
  }
  .rt-launch-row-btn {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    padding: 8px 14px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 120ms ease, color 120ms ease;
  }
  .rt-launch-row-btn-ghost {
    background: transparent;
    border-color: var(--rule);
    color: var(--ink-3);
  }
  .rt-launch-row-btn-ghost:hover { color: var(--ink); border-color: var(--ink); }
  .rt-launch-row-btn-primary {
    background: var(--ink);
    color: var(--paper);
  }
  .rt-launch-row-btn-primary:disabled { background: var(--ink-4); cursor: wait; }

  /* Status pill: a designed wrapper around the native <select>. The
     wrapper gets the border + caret + hover; the select itself is
     transparent and sits on top for accessibility. */
  .rt-launch-row-status-col { padding-top: 0; }
  .rt-launch-row-status-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--rule);
    background: var(--paper);
    min-width: 130px;
    transition: border-color 120ms ease, background 120ms ease;
  }
  .rt-launch-row-status-wrap:hover { border-color: var(--ink); }
  .rt-launch-row-status-wrap[data-state="in_progress"] {
    border-color: var(--signal);
    background: rgba(200, 90, 58, 0.05);
  }
  .rt-launch-row-status-wrap[data-state="done"] {
    border-color: var(--positive);
    background: rgba(47, 122, 58, 0.06);
  }
  .rt-launch-row-status-select {
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    background: transparent;
    border: none;
    color: inherit;
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    padding: 10px 28px 10px 14px;
    width: 100%;
    cursor: pointer;
    outline: none;
  }
  .rt-launch-row-status-wrap[data-state="todo"] .rt-launch-row-status-select { color: var(--ink); }
  .rt-launch-row-status-wrap[data-state="in_progress"] .rt-launch-row-status-select { color: var(--signal); }
  .rt-launch-row-status-wrap[data-state="done"] .rt-launch-row-status-select { color: var(--positive); }
  .rt-launch-row-status-wrap[data-state="skipped"] .rt-launch-row-status-select,
  .rt-launch-row-status-wrap[data-state="n_a"] .rt-launch-row-status-select { color: var(--ink-3); }
  .rt-launch-row-status-caret {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-60%);
    color: var(--ink-4);
    font-size: 13px;
    pointer-events: none;
    line-height: 1;
  }

  .rt-launch-row-status-readonly {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 130px;
    padding: 10px 14px;
    border: 1px solid var(--positive);
    background: rgba(47, 122, 58, 0.06);
    color: var(--positive);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  @media (max-width: 640px) {
    .rt-launch-row-inner {
      grid-template-columns: 28px minmax(0, 1fr);
      gap: 14px;
      padding: 16px 0;
    }
    .rt-launch-row-status-col {
      grid-column: 1 / -1;
      margin-left: 44px;
      margin-top: 6px;
    }
    .rt-launch-row-status-wrap,
    .rt-launch-row-status-readonly { min-width: 0; }
  }
`;
