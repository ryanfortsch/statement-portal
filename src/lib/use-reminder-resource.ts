'use client';

import { useState } from 'react';
import { useRecoverableAction } from './use-recoverable-action';

/** Refreshes never erase the last confirmed list or turn failures into empty results. */
export function useReminderResource<T>(
  fetchItems: () => Promise<{ ok: true; items: T[] } | { ok: false; error: string }>,
  failure: string,
) {
  const [items, setItems] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);
  const action = useRecoverableAction();
  const load = () => action.run(async () => {
    const result = await fetchItems();
    if (!result.ok) { action.setError(result.error); return; }
    setItems(result.items);
    setLoaded(true);
  }, failure);
  return { items, loaded, load, pending: action.pending, error: action.error };
}
