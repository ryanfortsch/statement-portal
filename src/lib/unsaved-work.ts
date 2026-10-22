'use client';

import { useEffect } from 'react';

/**
 * A tiny registry of "this tab has typing that isn't saved anywhere yet".
 *
 * Why it exists: a reload nobody asked for used to wipe typing. The old
 * VersionGuard hard-reloaded the tab whenever a deploy landed, and an operator
 * part-way through 29 caption fields lost the lot (2026-09-27,
 * /properties/19_rackliffe/caption-photos). VersionGuard is retired; the
 * reloads that remain are the ones below.
 *
 * Any client surface holding unsaved edits calls useUnsavedWorkGuard(true).
 * That does two things:
 *   1. arms the browser's own "Leave site?" prompt, so a stray Cmd+R or a
 *      back button asks first
 *   2. makes hasUnsavedWork() true, which tells Button's 30s lost-response
 *      reload (use-pending-watchdog.ts) to stand down and AutoRefresh to
 *      skip its tick, since a refresh into a newer deployment can be
 *      hard-reloaded by Next's deploymentId check
 *
 * Deliberately a count, not a boolean: several surfaces can be dirty at
 * once and each must be able to disarm only its own claim.
 */
let dirtyScopes = 0;

export function hasUnsavedWork(): boolean {
  return dirtyScopes > 0;
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!hasUnsavedWork()) return;
  e.preventDefault();
  // Legacy browsers key off the return value rather than preventDefault.
  e.returnValue = '';
}

/**
 * Registers/unregisters this component's unsaved edits while `dirty` is
 * true. Unmounting always releases the claim, so a navigation away can
 * never strand the flag on.
 */
export function useUnsavedWorkGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    dirtyScopes += 1;
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      dirtyScopes -= 1;
      if (dirtyScopes <= 0) {
        dirtyScopes = 0;
        window.removeEventListener('beforeunload', onBeforeUnload);
      }
    };
  }, [dirty]);
}
