'use client';

import { useRef, useState, useTransition, type FormEvent } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { useUnsavedWorkGuard } from './unsaved-work';

/** Keep native and controlled fields in memory after a failed server action. */
export function useRetainedSubmission(
  action: (previous: { error: string }, data: FormData) => Promise<{ error: string }>,
  options: { uncertainMessage: string; blocked?: () => boolean; extraDirty?: boolean },
) {
  const lock = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  useUnsavedWorkGuard(dirty || pending || !!options.extraDirty);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || options.blocked?.()) return;
    const data = new FormData(event.currentTarget);
    lock.current = true;
    setDirty(true);
    setError('');
    start(async () => {
      try {
        const result = await action({ error: '' }, data);
        setError(result.error || options.uncertainMessage);
      } catch (err) {
        unstable_rethrow(err);
        setError(options.uncertainMessage);
      } finally {
        lock.current = false;
      }
    });
  }
  return { submit, markDirty: () => setDirty(true), pending, error };
}
