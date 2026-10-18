'use client';

import { useState, useTransition } from 'react';
import { markProspectInactive, reactivateProspect } from '@/app/projections/actions';

/**
 * Parking a dead deal has one verb, "Mark inactive", and it asks why in
 * both places it is offered, so the funnel remembers why a deal died
 * ("went with AVH", "decided not to rent"). The reason is optional; the
 * question is not skipped.
 *
 * - `InactiveQuickAction`: on a Prospects list row. "Mark inactive" opens
 *   the reason line in place; "Reactivate" is one tap. It renders outside
 *   the row's link, so typing a reason never navigates.
 * - `InactivePanel`: the workroom's Funnel status block, the same reason
 *   line always open, or the since-date and reason with Reactivate.
 *
 * Both call server actions that revalidate the funnel routes, so the list
 * re-sorts on the next render without a manual refresh.
 */

export const MARK_INACTIVE = 'Mark inactive';
const REASON_PLACEHOLDER = 'Why? For example, went with another manager';

function ReasonLine({
  projectionId,
  pending,
  run,
  onCancel,
  autoFocus = false,
}: {
  projectionId: string;
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => markProspectInactive(projectionId, reason));
      }}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}
    >
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={REASON_PLACEHOLDER}
        aria-label="Why this deal is inactive (optional)"
        maxLength={200}
        disabled={pending}
        autoFocus={autoFocus}
        style={reasonInputStyle}
      />
      <button type="submit" disabled={pending} style={outlineButtonStyle}>
        {pending ? 'Marking inactive…' : MARK_INACTIVE}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} disabled={pending} style={textButtonStyle}>
          Cancel
        </button>
      )}
    </form>
  );
}

function useRun() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };
  return { pending, error, run };
}

export function InactiveQuickAction({
  projectionId,
  mode,
}: {
  projectionId: string;
  mode: 'inactive' | 'reactivate';
}) {
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);

  if (mode === 'reactivate') {
    return (
      <div style={{ display: 'grid', justifyItems: 'end', gap: 6 }}>
        <button type="button" disabled={pending} onClick={() => run(() => reactivateProspect(projectionId))} style={textButtonStyle}>
          {pending ? 'Reactivating…' : 'Reactivate'}
        </button>
        {error && <div style={errorStyle}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', justifyItems: 'end', gap: 6, width: open ? '100%' : undefined }}>
      {open ? (
        <ReasonLine projectionId={projectionId} pending={pending} run={run} onCancel={() => setOpen(false)} autoFocus />
      ) : (
        <button type="button" onClick={() => setOpen(true)} style={textButtonStyle}>
          {MARK_INACTIVE}
        </button>
      )}
      {error && <div style={errorStyle}>{error}</div>}
    </div>
  );
}

export function InactivePanel({
  projectionId,
  inactiveAt,
  inactiveReason,
}: {
  projectionId: string;
  inactiveAt: string | null;
  inactiveReason: string | null;
}) {
  const { pending, error, run } = useRun();

  if (inactiveAt) {
    const since = new Date(inactiveAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/New_York',
    });
    return (
      <div>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 480 }}>
          Marked inactive <strong>{since}</strong>
          {inactiveReason ? <>: &ldquo;{inactiveReason}&rdquo;</> : null}. The record is intact;
          reactivating puts it back in the active funnel.
        </p>
        <button
          type="button"
          onClick={() => run(() => reactivateProspect(projectionId))}
          disabled={pending}
          style={outlineButtonStyle}
        >
          {pending ? 'Reactivating…' : 'Reactivate prospect'}
        </button>
        {error && <div style={errorStyle}>{error}</div>}
      </div>
    );
  }

  return (
    <div>
      <ReasonLine projectionId={projectionId} pending={pending} run={run} />
      {error && <div style={errorStyle}>{error}</div>}
    </div>
  );
}

const reasonInputStyle: React.CSSProperties = {
  border: '1px solid var(--rule)',
  borderBottom: '1px solid var(--ink)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 13,
  padding: '8px 10px',
  outline: 'none',
  fontFamily: 'inherit',
  flex: '1 1 260px',
  minWidth: 220,
  boxSizing: 'border-box',
};

const outlineButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '10px 18px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
};

const textButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  color: 'var(--ink-4)',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
  textDecorationColor: 'var(--rule)',
};

const errorStyle: React.CSSProperties = {
  marginTop: 10,
  padding: 8,
  borderLeft: '3px solid var(--negative)',
  background: 'var(--paper-2)',
  fontSize: 12,
  color: 'var(--ink)',
};
