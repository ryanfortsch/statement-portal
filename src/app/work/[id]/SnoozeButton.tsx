'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { snoozeWorkSlip } from '../actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

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

function plus(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
  const ref = useRef<HTMLDivElement>(null);

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
    setErr(null);
    setOpen(false);
    setSnoozedUntil(until);
    startTransition(async () => {
      const res = await snoozeWorkSlip({ id: slipId, until });
      if (!res.ok) {
        setErr(res.error);
        // Roll back optimistic state on failure
        setSnoozedUntil(initialSnoozedUntil);
        return;
      }
      softRefresh();
    });
  }

  function handleCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!customDate) return;
    apply(customDate);
    setCustomDate('');
  }

  const isSnoozed = !!snoozedUntil && snoozedUntil > new Date().toISOString().slice(0, 10);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
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
        {pending ? 'Saving…' : isSnoozed ? `Snoozed until ${snoozedUntil}` : '+ Snooze'}
      </button>

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
              onClick={() => apply(plus(p.daysFromNow))}
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
                ({plus(p.daysFromNow)})
              </span>
            </button>
          ))}

          <form onSubmit={handleCustom} style={{ display: 'flex', gap: 6, padding: '6px 10px', marginTop: 4, borderTop: '1px solid var(--rule)' }}>
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              min={plus(1)}
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
              disabled={!customDate}
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
        </div>
      )}

      {err && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, fontSize: 11, color: 'var(--negative)', background: 'var(--paper)', border: '1px solid var(--negative)', padding: '6px 10px', maxWidth: 240 }}>
          {err}
        </div>
      )}
    </div>
  );
}
