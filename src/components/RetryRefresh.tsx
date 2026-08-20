'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Self-healing for transient upstream failures. Mounted inside a "Service
 * not reachable" fallback, it re-runs the server render on an interval so a
 * stay-concierge restart blip heals on its own. Without this the error
 * state is sticky: the queue's own 15s refresh timer unmounts along with
 * the queue, so the page stays on the error until a manual reload no
 * matter how healthy the upstream is (2026-08-20, /messaging after a
 * service restart).
 *
 * The refresh runs in a transition for the same reason the queue's
 * softRefresh does: keep the current shell mounted while the new payload
 * streams instead of re-suspending to the skeleton.
 */
export function RetryRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  useEffect(() => {
    const t = setInterval(() => startTransition(() => router.refresh()), intervalMs);
    return () => clearInterval(t);
  }, [router, intervalMs]);
  return null;
}
