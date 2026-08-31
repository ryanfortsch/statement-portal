'use client';

import { useState, useTransition } from 'react';
import { markProspectInactive, reactivateProspect } from '@/app/projections/actions';

/**
 * Demote / reactivate controls for the Inactive prospect state.
 *
 * Two surfaces share this file:
 *
 * - `InactiveQuickAction`: the one-click "Demote" / "Reactivate" text
 *   button on a Prospects list row. The row is a row-wide <Link>, so the
 *   handler preventDefault + stopPropagation (same pattern as the CRM
 *   list and turnover rows) — clicking the button must not navigate.
 *   Demote here is reasonless-by-design: it's the fast sweep for "these
 *   four are dead"; a reason can ride along from the detail page.
 *
 * - `InactivePanel`: the detail-page block. Demoting from here offers an
 *   optional one-line reason ("went with AVH", "decided not to rent") so
 *   the funnel remembers *why* the deal died. When the prospect is
 *   already inactive it shows the since-date + reason and a Reactivate
 *   button instead.
 *
 * Both call server actions that revalidate the funnel routes, so the
 * list re-sorts on the next render without a manual refresh.
 */

export function InactiveQuickAction({
  projectionId,
  mode,
}: {
  projectionId: string;
  mode: 'demote' | 'reactivate';
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startTransition(async () => {
          if (mode === 'demote') await markProspectInactive(projectionId);
          else await reactivateProspect(projectionId);
        });
      }}
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: pending ? 'default' : 'pointer',
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        color: 'var(--ink-4)',
        textDecoration: 'underline',
        textUnderlineOffset: 3,
        textDecorationColor: 'var(--rule)',
        opacity: pending ? 0.5 : 1,
      }}
    >
      {mode === 'demote'
        ? pending ? 'Demoting…' : 'Demote'
        : pending ? 'Reactivating…' : 'Reactivate'}
    </button>
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
  const [reason, setReason] = useState('');
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
          {inactiveReason ? <> — &ldquo;{inactiveReason}&rdquo;</> : null}. The record is intact;
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional) — e.g. went with another manager"
          disabled={pending}
          style={{
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
          }}
        />
        <button
          type="button"
          onClick={() => run(() => markProspectInactive(projectionId, reason))}
          disabled={pending}
          style={outlineButtonStyle}
        >
          {pending ? 'Demoting…' : 'Mark inactive'}
        </button>
      </div>
      {error && <div style={errorStyle}>{error}</div>}
    </div>
  );
}

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

const errorStyle: React.CSSProperties = {
  marginTop: 10,
  padding: 8,
  borderLeft: '3px solid var(--negative)',
  background: 'var(--paper-2)',
  fontSize: 12,
  color: 'var(--ink)',
};
