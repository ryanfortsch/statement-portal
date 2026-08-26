/**
 * Version-skew tripwire, shared by every surface that can catch a stale tab.
 *
 * After a Vercel deploy, a tab still on the old client bundle must NOT pull
 * the new build's RSC payload: the old runtime can't apply it, so the tab
 * spins into the error boundary and later server-action clicks go dead —
 * the action commits server-side while the button spins forever (observed
 * 2026-08-02, and again 2026-08-04 on the packet board's Mark paid). The
 * cure is a hard reload, which swaps the whole tab onto the new build.
 *
 * As of 2026-08-26 this is belt-and-braces, not the sole mechanism: platform
 * Skew Protection is enabled on the project (12h max age), so a stale tab is
 * routed back to its original deployment rather than breaking. This code stays
 * running alongside it for now. See next.config.ts for what gets retired once
 * a week of deploys confirms the platform feature is working.
 *
 * Extracted from AutoRefresh (#1189) so it isn't tied to the live-tracker
 * poll: VersionGuard runs it globally on tab wake + a slow interval, and
 * SubmitButton runs it when a form action stays pending suspiciously long.
 *
 * Compares this bundle's baked-in deployment id (next.config.ts `env`;
 * empty outside Vercel, which turns the check off) against the one
 * /api/version reports, and hard-reloads at most once per new id.
 */

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

// One probe at a time: wake listeners + interval + a pending watchdog can
// all fire together (tab wake IS a focus + visibility + timer catch-up),
// and a pile of concurrent /api/version fetches buys nothing.
let inFlight: Promise<boolean> | null = null;

/**
 * Returns true when the caller should skip its own follow-up work (a reload
 * is in flight, or the guard says we already reloaded for this exact
 * target). Fails open on any fetch hiccup so a flaky network never stalls
 * the caller's normal behavior.
 */
export function reloadedForNewDeployment(): Promise<boolean> {
  if (!CLIENT_DEPLOYMENT_ID) return Promise.resolve(false);
  if (inFlight) return inFlight;
  inFlight = (async () => {
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
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
