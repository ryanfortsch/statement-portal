'use client';

import { useEffect } from 'react';
import { reloadedForNewDeployment } from '@/lib/version-skew';
import { hasUnsavedWork } from '@/lib/unsaved-work';

// If an action stays pending this long, suspect a stale bundle: after a
// deploy, an old tab's action still commits server-side but the response
// can't apply client-side, so the spinner runs forever ("Mark paid spinning
// for minutes", 2026-08-04). Long enough that a legitimately slow action
// (approve sending reports, publish texting inspectors) won't trip it.
export const STUCK_PENDING_MS = 10000;
// If it's STILL pending here, the response is lost, not slow - Vercel
// sheds an action response mid-burst after committing the write ("SAVING…"
// spun 2+ minutes on 2026-08-13 while the value had landed in 11 seconds),
// and the version probe stands down when no deploy landed. Reload once: the
// page renders whatever the action committed, and a genuinely lost write just
// brings the form back to try again. Kept well above any legitimate action
// runtime (post-#1206 actions answer in seconds; publish's SMS loop is the
// slowest at a handful of seconds).
export const FORCE_RELOAD_MS = 30000;

/**
 * Stuck-pending watchdog, two rungs, shared by SubmitButton and Button. At
 * 10s: the version-skew check; on a stale bundle this hard-reloads the tab
 * (at most once per deploy, never over unsaved work), landing on the state
 * the action already committed. At 30s: the response is lost (request
 * shed), not slow. Re-probe for a deploy, then reload. Both timers clear the
 * moment the action resolves.
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
    const t = setTimeout(() => void reloadedForNewDeployment(), STUCK_PENDING_MS);
    const t2 = setTimeout(async () => {
      if (await reloadedForNewDeployment()) return;
      if (yieldToUnsavedWork && hasUnsavedWork()) return;
      window.location.reload();
    }, FORCE_RELOAD_MS);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [pending, yieldToUnsavedWork]);
}
