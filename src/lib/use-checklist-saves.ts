'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { ChecklistSaveQueue } from './checklist-save-queue';
import { useDraftNavigationGuard } from './use-draft-navigation-guard';

export function useChecklistSaves() {
  const [queue] = useState(() => new ChecklistSaveQueue());
  const status = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  useDraftNavigationGuard(status.dirty, status.saving);
  useEffect(() => () => queue.cancelQueued(), [queue]);
  return { queue, ...status };
}
