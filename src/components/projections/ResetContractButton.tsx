'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { resetContractOverrides } from '@/app/projections/actions';

/**
 * Clears the contract overrides + legacy custom_clauses on the projection,
 * reverting the rendered contract to the standard template. The prospect
 * record itself, the projection inputs (term dates, fees, owner info),
 * the signing token, and any onboarding intake are all untouched.
 *
 * This is the action Dotti reached for when she hit DELETE thinking it
 * was "restart the contract." Now there's a separate, clearly-labeled
 * path for that use case.
 *
 * Single confirm dialog before firing — destructive but recoverable
 * (just re-run the redlines to bring the edits back), so no typed
 * confirmation needed.
 */
export function ResetContractButton({
  projectionId,
  hasOverrides,
}: {
  projectionId: string;
  hasOverrides: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    if (!window.confirm(
      'Clear all contract edits and revert to the standard template?\n\n' +
      'The prospect record, projection inputs, signing token, and onboarding intake stay intact. ' +
      'Only the Redlines-applied overrides + legacy Rider clauses are wiped. ' +
      'You can re-run the Redlines tool to bring edits back.',
    )) return;
    setError(null);
    startTransition(async () => {
      const res = await resetContractOverrides(projectionId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={pending || !hasOverrides}
        title={hasOverrides ? 'Clear all redline overrides on the contract' : 'No overrides to reset'}
        style={hasOverrides && !pending ? activeButtonStyle : disabledButtonStyle}
      >
        {pending ? 'Resetting…' : 'Reset contract'}
      </button>
      {error && <span style={errorStyle}>{error}</span>}
    </>
  );
}

const activeButtonStyle: React.CSSProperties = {
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
const disabledButtonStyle: React.CSSProperties = {
  ...activeButtonStyle,
  opacity: 0.4,
  cursor: 'not-allowed',
};
const errorStyle: React.CSSProperties = {
  marginLeft: 10,
  fontSize: 11,
  color: 'var(--negative)',
  fontStyle: 'italic',
};
