'use client';

import { useState } from 'react';

import {
  horizonYmd,
  isoFromDateTime,
  isoInMinutes,
  nextQuarterHour,
  SEND_PRESETS,
  todayYmd,
} from '@/lib/schedule-time';

/**
 * Shared send-later (time delay) controls for the Owners / Cleaners /
 * Contractors messaging queues, ported from the guest queue's schedule
 * element. MessagingQueue.tsx still keeps its own private copy of the CHROME
 * (it shipped first, and a divergence there is visible on screen); both now
 * import their date math from lib/schedule-time.ts, because a divergence in
 * THAT is silent and lands a message on the wrong day.
 *
 * The pieces: a welded split "Approve & send" button whose narrow chevron
 * opens the SchedulePopover (relative presets + an at-a-set-time picker),
 * plus the queued-state tone.
 */

// The date/time arithmetic lives in lib/schedule-time.ts (tested there).
// Re-exported so the queues keep importing their send-later kit from one
// place rather than reaching past this module for half of it.
export { isoFromDateTime, isoInMinutes, nextQuarterHour, SEND_PRESETS } from '@/lib/schedule-time';

// Muted bronze for the queued (scheduled) state. Deliberately NOT
// var(--signal), which already means stale/aging/error on these cards.
export const QUEUED_TONE = '#7a6a3a';

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
// reveals a date + time picker in place, defaulting to today so the common
// "later today" pick costs no extra taps. Self-contained state for the
// custom picker; the caller only supplies onSchedule(sendAtIso).
export function SchedulePopover({
  onSchedule,
  disabled,
}: {
  onSchedule: (sendAtIso: string) => void;
  disabled?: boolean;
}) {
  const [custom, setCustom] = useState(false);
  const [customDate, setCustomDate] = useState(todayYmd);
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="date"
              value={customDate}
              min={todayYmd()}
              max={horizonYmd()}
              onChange={(e) => setCustomDate(e.target.value)}
              aria-label="Send on"
              style={{
                flex: '1 1 150px',
                minWidth: 150,
                padding: '8px 10px',
                border: '1px solid var(--rule)',
                background: 'var(--paper)',
                fontFamily: 'inherit',
                fontSize: 14,
                color: 'var(--ink)',
              }}
            />
            <input
              type="time"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
              aria-label="Send at"
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
            onClick={() => onSchedule(isoFromDateTime(customDate, customTime))}
            disabled={disabled || !customDate}
            style={{
              background: disabled || !customDate ? 'var(--ink-4)' : 'var(--ink)',
              color: 'var(--paper)',
              border: '2px solid var(--ink)',
              padding: '13px 22px',
              fontSize: 12,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              fontWeight: 700,
              cursor: disabled || !customDate ? 'not-allowed' : 'pointer',
              opacity: disabled || !customDate ? 0.7 : 1,
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
