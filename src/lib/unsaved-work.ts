'use client';

import { useEffect } from 'react';

/**
 * A tiny registry of "this tab has typing that isn't saved anywhere yet".
 *
 * Why it exists: VersionGuard hard-reloads the tab whenever a deploy lands
 * (on a 60s interval AND on every tab focus). This repo deploys many times
 * an hour, so an operator part-way through filling 29 caption fields could
 * lose the lot to a reload they never asked for and could not have seen
 * coming (2026-09-27, /properties/19_rackliffe/caption-photos).
 *
 * Any client surface holding unsaved edits calls useUnsavedWorkGuard(true).
 * That does two things:
 *   1. arms the browser's own "Leave site?" prompt, so a stray Cmd+R or a
 *      back button asks first
 *   2. makes hasUnsavedWork() true, which tells the skew reload to wait
 *
 * Waiting is safe: platform Skew Protection (12h) routes a stale tab back
 * to its own deployment, so the old bundle keeps working. The skew check
 * keeps running, so the tab still heals itself the moment the work is
 * saved or discarded.
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
