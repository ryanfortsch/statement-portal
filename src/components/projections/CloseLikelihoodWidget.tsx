'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setCloseLikelihood } from '@/app/projections/actions';

/**
 * Inline "% likely to close" widget. Two modes:
 *
 *   - View mode: shows "65%" big-serif + small "likely to close" caption.
 *     Hovering the wrapper reveals an Edit affordance; clicking enters
 *     edit mode.
 *   - Edit mode: number input + Save / Cancel. Saving calls
 *     setCloseLikelihood and refreshes the route so the badge updates
 *     everywhere it's surfaced.
 *
 * `size` switches between a hero-strip layout (large) and a list-row chip
 * (compact). Both share the same behavior.
 */
export function CloseLikelihoodWidget({
  projectionId,
  value,
  size = 'large',
}: {
  projectionId: string;
  value: number | null;
  size?: 'large' | 'chip';
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value != null ? String(value) : '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(next: number | null) {
    setError(null);
    startTransition(async () => {
      try {
        await setCloseLikelihood(projectionId, next);
        setEditing(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const raw = draft.trim();
    if (raw === '') return save(null);
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      setError('Must be 0–100');
      return;
    }
    save(Math.round(n));
  }

  // ─── View mode ─────────────────────────────────────────────────────────
  if (!editing) {
    if (size === 'chip') {
      return (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Click to set close likelihood"
          style={{
            background: value != null ? bandBg(value) : 'transparent',
            color: value != null ? bandFg(value) : 'var(--ink-4)',
            border: `1px solid ${value != null ? bandBorder(value) : 'var(--rule)'}`,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.04em',
            padding: '4px 10px',
            borderRadius: 999,
            cursor: 'pointer',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }}
        >
          {value != null ? `${value}% likely` : 'Set %'}
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          margin: 0,
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'inherit',
          color: 'inherit',
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 4 }}>Close likelihood</div>
        {value != null ? (
          <div className="font-serif tabular-nums" style={{ fontSize: 32, fontWeight: 400, color: 'var(--ink)', lineHeight: 1.05 }}>
            {value}%
            <span style={{ fontSize: 11, color: 'var(--ink-4)', marginLeft: 8, letterSpacing: '0.06em', fontFamily: 'var(--font-inter), system-ui, sans-serif' }}>
              ✎
            </span>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--ink-4)', fontStyle: 'italic', padding: '4px 0' }}>
            Click to set
          </div>
        )}
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>
          {value != null ? 'likely to close' : 'your call'}
        </div>
      </button>
    );
  }

  // ─── Edit mode ────────────────────────────────────────────────────────
  const containerStyle: React.CSSProperties =
    size === 'chip'
      ? { display: 'inline-flex', alignItems: 'center', gap: 6 }
      : { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 };

  return (
    <form onSubmit={onSubmit} style={containerStyle}>
      {size === 'large' && (
        <div className="eyebrow" style={{ marginBottom: 4 }}>Close likelihood</div>
      )}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setEditing(false);
              setDraft(value != null ? String(value) : '');
              setError(null);
            }
          }}
          disabled={pending}
          style={{
            background: 'var(--paper)',
            border: '1px solid var(--ink)',
            color: 'var(--ink)',
            fontFamily: 'var(--font-fraunces), "Times New Roman", serif',
            fontSize: size === 'chip' ? 13 : 28,
            fontWeight: 400,
            padding: size === 'chip' ? '4px 8px' : '6px 10px',
            outline: 'none',
            width: size === 'chip' ? 60 : 110,
            textAlign: 'right',
          }}
        />
        <span style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: size === 'chip' ? 13 : 28, color: 'var(--ink-3)' }}>%</span>
        <button
          type="submit"
          disabled={pending}
          style={{
            background: 'var(--ink)',
            color: 'var(--paper)',
            border: 'none',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            padding: '6px 10px',
            cursor: pending ? 'wait' : 'pointer',
          }}
        >
          {pending ? '…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setDraft(value != null ? String(value) : '');
            setError(null);
          }}
          disabled={pending}
          style={{
            background: 'transparent',
            color: 'var(--ink-3)',
            border: 'none',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            padding: '6px 6px',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
      {value != null && (
        <button
          type="button"
          onClick={() => save(null)}
          disabled={pending}
          style={{
            background: 'transparent',
            color: 'var(--negative)',
            border: 'none',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            padding: '2px 0',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      )}
      {error && <div style={{ fontSize: 11, color: 'var(--negative)' }}>{error}</div>}
    </form>
  );
}

// ─── Likelihood banding (colors for the chip) ──────────────────────────────
// Three bands. Cold (<33) reads muted, warm (33–66) reads neutral, hot (≥67)
// reads positive. Same visual code on the detail strip and the list chip so
// scanning is consistent.
function bandBg(pct: number): string {
  if (pct >= 67) return 'var(--paper-2)';
  if (pct >= 33) return 'var(--paper-2)';
  return 'var(--paper-2)';
}
function bandFg(pct: number): string {
  if (pct >= 67) return 'var(--positive)';
  if (pct >= 33) return 'var(--ink)';
  return 'var(--ink-4)';
}
function bandBorder(pct: number): string {
  if (pct >= 67) return 'var(--positive)';
  if (pct >= 33) return 'var(--ink-3)';
  return 'var(--rule)';
}
