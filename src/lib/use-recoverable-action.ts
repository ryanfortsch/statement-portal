'use client';

import { useRef, useState, useTransition } from 'react';
import { unstable_rethrow } from 'next/navigation';

/** Serialize a control's actions, retaining its draft when a response is lost. */
export function useRecoverableAction() {
  const busy = useRef(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(action: () => Promise<void>, failure: string) {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    start(async () => {
      try { await action(); }
      catch (err) { unstable_rethrow(err); setError(failure); }
      finally { busy.current = false; }
    });
  }
  return { busy, pending, error, setError, run };
}
