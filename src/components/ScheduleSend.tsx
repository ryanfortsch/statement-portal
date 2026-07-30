'use client';

import { useState } from 'react';

/**
 * Shared send-later (time delay) controls for the Owners / Cleaners /
 * Contractors messaging queues, ported from the guest queue's schedule
 * element (MessagingQueue.tsx keeps its own private copy — it shipped first
 * and stays untouched per the no-sweeps rule).
 *
 * The pieces: a welded split "Approve & send" button whose narrow chevron
 * opens the SchedulePopover (relative presets + an at-a-set-time picker),
 * plus the queued-state tone and time helpers.
 */

// Muted bronze for the queued (scheduled) state. Deliberately NOT
// var(--signal), which already means stale/aging/error on these cards.
export const QUEUED_TONE = '#7a6a3a';

// Quick-send presets, in minutes.
export const SEND_PRESETS: { label: string; minutes: number }[] = [
  { label: 'In 10 minutes', minutes: 10 },
  { label: 'In 30 minutes', minutes: 30 },
  { label: 'In 2 hours', minutes: 120 },
];

export function isoInMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** Build a UTC ISO from the operator's local Today/Tomorrow + HH:MM pick. */
export function isoFromDayTime(day: 'today' | 'tomorrow', hhmm: string): string {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  const d = new Date();
  if (day === 'tomorrow') d.setDate(d.getDate() + 1);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.toISOString();
}

/** Default time-input value: now rounded up to the next quarter hour (local). */
export function nextQuarterHour(): string {
  const d = new Date();
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15, 0, 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Welded two-segment send control: the wide left segment is the unchanged
// one-tap "Approve & send (now)"; the narrow chevron opens the schedule
// menu. The chevron is the only new pixel on a resting card.
export function SplitSendButton({
  label = 'Approve & send',
  onApprove,
  onToggle,
  disabled,
  toggleDisabled,
  toggleTitle,
  loading,
  loadingLabel = 'Sending…',
  open,
}: {
  label?: string;
  onApprove: () => void;
  onToggle: () => void;
  disabled?: boolean;
  /** Disable only the chevron (e.g. slip cards must send immediately). */
  toggleDisabled?: boolean;
  toggleTitle?: string;
  loading?: boolean;
  loadingLabel?: string;
  open?: boolean;
}) {
  const seg = (extra: React.CSSProperties): React.CSSProperties => ({
    background: disabled && !loading ? 'var(--ink-4)' : 'var(--ink)',
    color: 'var(--paper)',
    border: '2px solid var(--ink)',
    fontSize: 12,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled && !loading ? 0.7 : 1,
    ...extra,
  });
  return (
    <div style={{ display: 'inline-flex' }}>
      <button
        type="button"
        onClick={onApprove}
        disabled={disabled}
        aria-busy={loading || undefined}
        style={seg({ padding: '13px 20px', borderRight: 'none' })}
      >
        {loading ? loadingLabel : label}
      </button>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled || toggleDisabled}
        aria-haspopup="menu"
        aria-expanded={open || undefined}
        aria-label="Send later"
        title={toggleTitle || 'Send later'}
        style={seg({
          padding: '13px 11px',
          borderLeft: '1px solid rgba(255,255,255,0.28)',
          ...(toggleDisabled && !disabled ? { cursor: 'not-allowed', opacity: 0.55 } : {}),
        })}
      >
        <span
          style={{
            display: 'inline-block',
            fontSize: 10,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 120ms',
          }}
        >
          ▾
        </span>
      </button>
    </div>
  );
}

// The send-later menu. Relative presets fire immediately; "At a set time"
// reveals a time + Today/Tomorrow picker in place. Self-contained state for
// the custom picker; the caller only supplies onSchedule(sendAtIso).
export function SchedulePopover({
  onSchedule,
  disabled,
}: {
  onSchedule: (sendAtIso: string) => void;
  disabled?: boolean;
}) {
  const [custom, setCustom] = useState(false);
  const [customDay, setCustomDay] = useState<'today' | 'tomorrow'>('today');
  const [customTime, setCustomTime] = useState(nextQuarterHour);

  const rowStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid var(--rule)',
    padding: '10px 12px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 10,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    fontWeight: 600,
    color: 'var(--ink-2)',
  };
  return (
    <div
      role="menu"
      style={{ marginTop: 10, maxWidth: 320, border: '1px solid var(--rule)', background: 'var(--paper-2)' }}
    >
      {SEND_PRESETS.map((p) => (
        <button
          key={p.minutes}
          type="button"
          disabled={disabled}
          onClick={() => onSchedule(isoInMinutes(p.minutes))}
          style={rowStyle}
        >
          {p.label}
        </button>
      ))}
      {!custom ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setCustom(true)}
          style={{ ...rowStyle, borderBottom: 'none', color: 'var(--ink-3)' }}
        >
          At a set time…
        </button>
      ) : (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['today', 'tomorrow'] as const).map((d) => {
              const on = customDay === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setCustomDay(d)}
                  style={{
                    flex: 1,
                    padding: '7px 8px',
                    cursor: 'pointer',
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    fontWeight: 600,
                    border: `1px solid ${on ? 'var(--ink)' : 'var(--rule)'}`,
                    background: on ? 'var(--ink)' : 'var(--paper)',
                    color: on ? 'var(--paper)' : 'var(--ink-3)',
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="time"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
              style={{
                width: 120,
                padding: '8px 10px',
                border: '1px solid var(--rule)',
                background: 'var(--paper)',
                fontFamily: 'inherit',
                fontSize: 14,
                color: 'var(--ink)',
              }}
            />
            <span className="eyebrow" style={{ color: 'var(--ink-4)' }} title="Eastern Time">
              ET
            </span>
          </div>
          <button
            type="button"
            onClick={() => onSchedule(isoFromDayTime(customDay, customTime))}
            disabled={disabled}
            style={{
              background: disabled ? 'var(--ink-4)' : 'var(--ink)',
              color: 'var(--paper)',
              border: '2px solid var(--ink)',
              padding: '13px 22px',
              fontSize: 12,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              fontWeight: 700,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.7 : 1,
            }}
          >
            Schedule
          </button>
        </div>
      )}
    </div>
  );
}

/** Filled pill marking a queued (scheduled) card. */
export function QueuedBadge() {
  return (
    <span
      style={{
        fontSize: 9,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        fontWeight: 700,
        color: 'var(--paper)',
        background: QUEUED_TONE,
        padding: '2px 7px',
        borderRadius: 2,
        whiteSpace: 'nowrap',
      }}
      title="Queued to send automatically at the time shown. Cancel to edit."
    >
      Queued
    </span>
  );
}
