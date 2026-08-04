'use client';

import { useEffect } from 'react';
import { reloadedForNewDeployment } from '@/lib/version-skew';

/**
 * Global stale-tab healer, mounted once in the root layout. Renders nothing.
 *
 * The live-tracker AutoRefresh only runs its skew check on pages with
 * something live to watch, so a tab woken on any other page (an approved
 * packet's Mark paid, the roster, a statement) kept its old bundle and
 * every server-action click went dead: the action committed server-side
 * while the button spun forever (2026-08-04). This closes that hole for
 * every Helm page:
 *
 * - on tab wake (visibilitychange/focus, plus pageshow for the iOS
 *   home-screen app resuming from the bfcache) — the overnight-deploy case
 * - on a slow interval while visible — a deploy landing mid-session, so a
 *   later <Link> click doesn't pull new-build RSC into the old runtime
 *
 * The check no-ops outside Vercel and reloads at most once per deployment
 * id (loop guard lives in version-skew.ts), so the steady-state cost is
 * one tiny same-origin fetch a minute per visible tab.
 */
export function VersionGuard({ intervalMs = 60000 }: { intervalMs?: number }) {
  useEffect(() => {
    const check = () => {
      if (!document.hidden) void reloadedForNewDeployment();
    };
    const t = setInterval(check, intervalMs);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [intervalMs]);
  return null;
}
