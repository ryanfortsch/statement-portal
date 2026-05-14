'use client';

import { useState, useTransition } from 'react';
import { deleteProjection } from '@/app/projections/actions';

/**
 * Hard-delete a prospect projection. This wipes the prospect record,
 * all redline overrides, custom clauses, onboarding intake, signing
 * audit trail — everything. Recovery is a Supabase support ticket;
 * there's no soft-delete column to flip back.
 *
 * Because of that destructive scope, the click flow is deliberately
 * inconvenient:
 *   1. Click the small "Delete prospect" link (collapsed by default,
 *      lives in a clearly-labeled Danger zone block).
 *   2. A typed-confirmation panel expands inline. The user must type
 *      the prospect's last name (case-insensitive) to enable the
 *      "Delete forever" button.
 *   3. Submit → server action → row gone.
 *
 * Dotti hit a one-click DELETE on the projection detail page thinking
 * it would reset the contract overrides. It deleted the whole 36
 * Granite prospect instead. Never again.
 */
export function DeleteProspectButton({
  projectionId,
  prospectName,
  prospectLastName,
}: {
  projectionId: string;
  prospectName: string;
  prospectLastName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [typed, setTyped] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const expected = prospectLastName.trim().toLowerCase();
  const enabled = expected.length > 0 && typed.trim().toLowerCase() === expected;

  const onDelete = () => {
    if (!enabled) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteProjection(projectionId);
      } catch (err) {
        // deleteProjection redirects on success; an error here means it failed.
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        style={collapsedButtonStyle}
      >
        Delete prospect…
      </button>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>Permanently delete this prospect</div>
      <p style={bodyStyle}>
        This wipes <strong>{prospectName}</strong> and everything tied to this projection — the
        contract draft, every redline override that&rsquo;s been applied, the onboarding intake,
        the signing audit. There is no undo.
      </p>
      <p style={bodyStyle}>
        If you just want to reset the contract edits back to the standard template,
        use <strong>Reset contract</strong> instead — the prospect record stays intact.
      </p>
      <label style={labelStyle}>
        Type <code style={codeStyle}>{prospectLastName}</code> to confirm
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={prospectLastName}
          autoComplete="off"
          style={inputStyle}
          disabled={pending}
        />
      </label>
      <div style={actionsRowStyle}>
        <button
          type="button"
          onClick={onDelete}
          disabled={!enabled || pending}
          style={enabled ? dangerButtonStyle : dangerButtonDisabledStyle}
        >
          {pending ? 'Deleting…' : 'Delete forever'}
        </button>
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setTyped('');
            setError(null);
          }}
          style={cancelButtonStyle}
          disabled={pending}
        >
          Cancel
        </button>
      </div>
      {error && <div style={errorStyle}>{error}</div>}
    </div>
  );
}

const collapsedButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '10px 14px',
  border: '1px dashed var(--rule)',
  cursor: 'pointer',
};
const panelStyle: React.CSSProperties = {
  border: '1px solid var(--negative)',
  borderLeft: '4px solid var(--negative)',
  padding: '14px 16px',
  background: 'var(--paper)',
};
const headerStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  color: 'var(--negative)',
  marginBottom: 8,
};
const bodyStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 12,
  color: 'var(--ink)',
  lineHeight: 1.6,
};
const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginTop: 10,
  fontSize: 11,
  color: 'var(--ink-3)',
};
const codeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono-dash, ui-monospace), monospace',
  fontSize: 12,
  color: 'var(--ink)',
  background: 'var(--paper-2)',
  padding: '1px 6px',
};
const inputStyle: React.CSSProperties = {
  border: '1px solid var(--rule)',
  borderBottom: '1px solid var(--ink)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 13,
  padding: '8px 10px',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};
const actionsRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginTop: 12,
};
const dangerButtonStyle: React.CSSProperties = {
  background: 'var(--negative)',
  color: 'var(--paper)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '13px 22px',
  border: '1px solid var(--negative)',
  cursor: 'pointer',
};
const dangerButtonDisabledStyle: React.CSSProperties = {
  ...dangerButtonStyle,
  opacity: 0.4,
  cursor: 'not-allowed',
};
const cancelButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '13px 18px',
  border: '1px solid var(--rule)',
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
