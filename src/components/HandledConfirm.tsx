'use client';

import { useEffect, useState } from 'react';

/**
 * Mark handled on the owner, cleaner and contractor cards (2026-10-18). It
 * used to hide behind a "More actions" menu. Now it sits on the card, and
 * because the concierge keeps no undo for these audiences, it asks once the
 * house way ("Sure? Mark handled", like Retire and Cancel link): the first
 * tap arms it for five seconds, the second clears the card without sending.
 * The guest card has a server undo, so it uses one-tap reasons instead.
 */
const ARMED_MS = 5000;

export function HandledConfirm({
  onConfirm,
  disabled,
  loading,
  title,
}: {
  onConfirm: () => void;
  disabled?: boolean;
  loading?: boolean;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARMED_MS);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className="rt-quiet-btn"
      disabled={disabled}
      aria-busy={loading || undefined}
      data-armed={armed || undefined}
      title={title}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
    >
      {loading ? 'Marking…' : armed ? 'Sure? Mark handled' : 'Mark handled'}
    </button>
  );
}
