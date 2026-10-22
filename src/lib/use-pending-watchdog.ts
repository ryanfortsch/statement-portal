'use client';

import { useEffect } from 'react';
import { hasUnsavedWork } from '@/lib/unsaved-work';

// If an action is still pending here, the response is lost, not slow: Vercel
// sheds an action response mid-burst after committing the write ("SAVING…"
// spun 2+ minutes on 2026-08-13 while the value had landed in 11 seconds).
// Reload once: the page renders whatever the action committed, and a
// genuinely lost write just brings the form back to try again. Kept well
// above any legitimate action runtime (post-#1206 actions answer in seconds;
// publish's SMS loop is the slowest at a handful of seconds).
//
// A stale bundle after a deploy is not this hook's job any more. Platform
// Skew Protection routes an old tab's action to its own deployment for 12
// hours, and past that Next's deploymentId check hard-reloads the tab on its
// next navigation or action (next.config.ts). The 10s version probe that
// used to run first was retired with VersionGuard and /api/version.
export const FORCE_RELOAD_MS = 30000;

/**
 * Stuck-pending watchdog, shared by SubmitButton and Button. At 30s the
 * response is lost (request shed), not slow: reload once. The timer clears
 * the moment the action resolves.
 *
 * `yieldToUnsavedWork` (Button's default): the 30s reload stands down while
 * the page has registered unsaved work (useUnsavedWorkGuard), because a
 * client-side call can legitimately run long (an AI draft) and a reload
 * would throw away what it is working on. SubmitButton keeps the
 * unconditional reload it always had.
 */
export function usePendingWatchdog(pending: boolean, { yieldToUnsavedWork = false }: { yieldToUnsavedWork?: boolean } = {}) {
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => {
      if (yieldToUnsavedWork && hasUnsavedWork()) return;
      window.location.reload();
    }, FORCE_RELOAD_MS);
    return () => clearTimeout(t);
  }, [pending, yieldToUnsavedWork]);
}
