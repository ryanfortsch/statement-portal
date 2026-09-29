'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { snoozeWorkSlip } from '../actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';

type Props = {
  slipId: string;
  initialSnoozedUntil: string | null;     // YYYY-MM-DD or null
};

const PRESETS: { id: string; label: string; daysFromNow: number }[] = [
  { id: 'tomorrow', label: 'Tomorrow', daysFromNow: 1 },
  { id: '3-days', label: '3 days', daysFromNow: 3 },
  { id: 'next-week', label: 'Next week', daysFromNow: 7 },
  { id: '2-weeks', label: 'Two weeks', daysFromNow: 14 },
  { id: 'next-month', label: 'Next month', daysFromNow: 30 },
];

// Local calendar dates, not UTC — after ~8 PM Eastern the UTC day is
// already tomorrow, which made "Tomorrow" compute two days out.
function localDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function utcDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// Every read path hides a slip only while snoozed_until > UTC "today"
// (work board, home, properties, search), so a stored date at or below
// UTC-today is a silent no-op. Snooze on the local calendar the operator
// means, clamped up to UTC-tomorrow when the two calendars disagree
// (evening Eastern).
function snoozeDay(offsetDays: number): string {
  const local = localDay(offsetDays);
  const floor = utcDay(1);
  return local >= floor ? local : floor;
}

/**
 * Snooze a slip from the active queue until a chosen date. The slip
 * stays in its current status; the read paths filter snoozed slips
 * with snoozed_until > today.
 *
 * Trigger styles vary by state:
 *   * Currently active (no snooze): "+ Snooze" ghost button
 *   * Currently snoozed: "Snoozed until <date>" with un-snooze action
 */
export function SnoozeButton({ slipId, initialSnoozedUntil }: Props) {
  const softRefresh = useSoftRefresh();
  const [open, setOpen] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState<string | null>(initialSnoozedUntil);
  const [customDate, setCustomDate] = useState('');
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<{ until: string | null } | null>(null);
  const saving = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  useUnsavedWorkGuard(pending || attempt !== null || customDate !== '');

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function apply(until: string | null) {
    if (saving.current) return;
    saving.current = true;
    setErr(null);
    setAttempt({ until });
    startTransition(async () => {
      try {
        const res = await snoozeWorkSlip({ id: slipId, until });
        if (!res.ok) {
          setErr(res.error);
          return;
        }
        setSnoozedUntil(until);
        setCustomDate('');
        setAttempt(null);
        setOpen(false);
        softRefresh();
      } catch {
        setErr('Could not confirm the snooze change. Retry to apply your selection.');
      } finally {
        saving.current = false;
      }
    });
  }

  function handleCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!customDate) return;
    // Same UTC-tomorrow floor as the presets; the input's min enforces it
    // in the picker but not against a hand-typed date.
    const floor = utcDay(1);
    apply(customDate >= floor ? customDate : floor);
  }

  const isSnoozed = !!snoozedUntil && snoozedUntil > utcDay(0);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        aria-expanded={open}
        style={{
          background: isSnoozed ? 'var(--paper-2)' : 'transparent',
          border: `1px solid ${isSnoozed ? 'var(--tide-deep)' : 'var(--rule)'}`,
          color: isSnoozed ? 'var(--tide-deep)' : 'var(--ink-3)',
          padding: '6px 12px',
          fontSize: 11,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          cursor: pending ? 'wait' : 'pointer',
          fontWeight: 500,
        }}
      >
        {pending && attempt ? 'Saving…' : isSnoozed ? `Snoozed until ${snoozedUntil}` : '+ Snooze'}
      </button>

      {!open && (attempt || customDate) && (
        <div style={{ marginTop: 4 }}>
          <button type="button" disabled={pending} onClick={() => setOpen(true)} style={{ fontSize: 11 }}>
            {err ? 'Snooze needs attention' : 'Unsaved snooze selection'}
          </button>
        </div>
      )}

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 60,
            minWidth: 220,
            background: 'var(--paper)',
            border: '1px solid var(--ink)',
            boxShadow: '0 8px 28px rgba(30, 46, 52, 0.12)',
            padding: 6,
          }}
        >
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => apply(snoozeDay(p.daysFromNow))}
              disabled={pending}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--ink)',
              }}
            >
              {p.label}
              <span style={{ marginLeft: 6, color: 'var(--ink-4)', fontSize: 11 }}>
                ({snoozeDay(p.daysFromNow)})
              </span>
            </button>
          ))}

          <form onSubmit={handleCustom} style={{ display: 'flex', gap: 6, padding: '6px 10px', marginTop: 4, borderTop: '1px solid var(--rule)' }}>
            <input
              type="date"
              aria-label="Snooze until"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              disabled={pending}
              min={snoozeDay(1)}
              style={{
                flex: 1,
                padding: '4px 8px',
                border: '1px solid var(--rule)',
                background: 'var(--paper)',
                fontSize: 12,
                color: 'var(--ink)',
                fontFamily: 'inherit',
              }}
            />
            <button
              type="submit"
              disabled={pending || !customDate}
              style={{
                background: 'var(--ink)',
                color: 'var(--paper)',
                border: 'none',
                padding: '4px 10px',
                fontSize: 10,
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                fontWeight: 600,
                cursor: customDate ? 'pointer' : 'default',
              }}
            >
              Snooze
            </button>
          </form>

          {isSnoozed && (
            <div style={{ borderTop: '1px solid var(--rule)', marginTop: 4, paddingTop: 4 }}>
              <button
                type="button"
                onClick={() => apply(null)}
                disabled={pending}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: 'var(--negative)',
                }}
              >
                Un-snooze (return to queue now)
              </button>
            </div>
          )}
          {err && attempt && (
            <div role="alert" style={{ fontSize: 11, color: 'var(--negative)', padding: '6px 10px', borderTop: '1px solid var(--rule)' }}>
              <div>{attempt.until ? `Snooze until ${attempt.until}` : 'Un-snooze'}: {err} Showing the last confirmed snooze.</div>
              <button type="button" disabled={pending} onClick={() => apply(attempt.until)} style={{ marginTop: 6 }}>Retry snooze change</button>
            </div>
          )}
          <button type="button" disabled={pending} onClick={() => { setCustomDate(''); setAttempt(null); setErr(null); setOpen(false); }} style={{ margin: '6px 10px', fontSize: 11 }}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
