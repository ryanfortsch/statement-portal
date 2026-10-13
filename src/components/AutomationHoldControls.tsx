'use client';

/** Shared presentation only: the caller owns persistence and authorization. */
export function AutomationHoldControls({ blockedReason, pending, onRelease }: {
  blockedReason: string | null; pending: boolean; onRelease?: () => void;
}) {
  return <div style={{ marginTop: 8 }}>
    <p>{blockedReason ?? 'This message will not send while held. Release returns it to the schedule; if overdue, it may send on the next worker run.'}</p>
    <button type="button" disabled={pending || !!blockedReason || !onRelease} onClick={onRelease}
      style={{ border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 12px', opacity: pending || blockedReason || !onRelease ? 0.5 : 1 }}>
      Release for sending
    </button>
    {!onRelease && !blockedReason && <p>Hold controls are not enabled in this environment.</p>}
  </div>;
}
