'use client';

import { useEffect } from 'react';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

// The deployment this client bundle was built from, inlined at build time
// via next.config.ts `env`. Empty outside Vercel (local dev), which turns
// the skew check off entirely.
const CLIENT_DEPLOYMENT_ID = process.env.NEXT_PUBLIC_DEPLOYMENT_ID || '';

// Remembers which server deployment id this tab last hard-reloaded for.
// Reloading at most once per new id is the loop guard: if a reload somehow
// doesn't clear the mismatch (stale cached document), the tab stays put
// instead of reload-cycling. sessionStorage survives the reload itself;
// the in-memory copy covers storage-disabled browsers, where the guard
// degrades to once per page load.
const RELOAD_GUARD_KEY = 'helm-skew-reloaded-for';
let reloadedForInMemory = '';

function alreadyReloadedFor(id: string): boolean {
  try {
    return sessionStorage.getItem(RELOAD_GUARD_KEY) === id;
  } catch {
    return reloadedForInMemory === id;
  }
}

function markReloadedFor(id: string) {
  reloadedForInMemory = id;
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, id);
  } catch {
    // sessionStorage unavailable; the in-memory guard above still holds.
  }
}

/**
 * Version-skew tripwire, run before every soft refresh. After a Vercel
 * deploy, a tab that's still on the old client bundle must NOT pull the
 * new build's RSC payload: the old runtime can't apply it, so the tab
 * spins into the error boundary and later server-action clicks go dead
 * (observed 2026-08-02; Hobby plan, so platform skew protection isn't
 * available). Compares this bundle's baked-in deployment id against the
 * one /api/version reports and hard-reloads once on mismatch, which swaps
 * the whole tab onto the new build.
 *
 * Returns true when the caller should skip its refresh (a reload is in
 * flight, or the guard says we already reloaded for this exact target).
 * Fails open on any fetch hiccup so a flaky network never stalls the
 * normal refresh cadence.
 */
async function reloadedForNewDeployment(): Promise<boolean> {
  if (!CLIENT_DEPLOYMENT_ID) return false;
  let serverId = '';
  try {
    const res = await fetch('/api/version', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    const id = (body as { deploymentId?: unknown } | null)?.deploymentId;
    serverId = typeof id === 'string' ? id : '';
  } catch {
    return false;
  }
  if (!serverId || serverId === CLIENT_DEPLOYMENT_ID) return false;
  if (alreadyReloadedFor(serverId)) return true;
  markReloadedFor(serverId);
  window.location.reload();
  return true;
}

/**
 * Quiet live-ness for a force-dynamic server page: re-fetches the RSC payload
 * on an interval (default 20s) so the view tracks reality without websockets.
 * Skips ticks while the tab is hidden and catches up the moment it's visible
 * again. Each tick first checks /api/version for a new deployment and
 * hard-reloads (once) instead of refreshing when one landed, so a stale
 * bundle never asks the new build for an RSC payload it can't render.
 * Renders nothing. Mount only while there's something live to watch
 * (an in-flight packet), so idle pages don't poll.
 */
export function AutoRefresh({ intervalMs = 20000 }: { intervalMs?: number }) {
  const softRefresh = useSoftRefresh();
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      if (await reloadedForNewDeployment()) return;
      // Re-check both gates: the version probe awaited, and meanwhile the
      // tab may have hidden or this component unmounted.
      if (!cancelled && !document.hidden) softRefresh();
    };
    const t = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [softRefresh, intervalMs]);
  return null;
}
