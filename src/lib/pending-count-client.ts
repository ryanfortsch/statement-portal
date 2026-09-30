/**
 * Client-side fetcher for /api/messaging/pending-count, shared by the
 * masthead badge and the four sub-tab count pills. Each of those used to
 * fire its own fetch on its own interval, so ONE open Helm tab produced
 * bursts of five identical requests, and several open tabs (all aligned to
 * the wall clock) produced the request stampedes that get shed with 503s on
 * under load and trip the /messaging error boundary. One in-flight promise plus
 * a short TTL collapse all of them into a single request per tab per window.
 */

export type PendingCounts = {
  guests?: number | null;
  owners?: number | null;
  cleaners?: number | null;
  contractors?: number | null;
};

const TTL_MS = 10_000;

let generation = 0;
const listeners = new Set<() => void>();

let cached: PendingCounts | null = null;
let cachedAt = 0;
let inFlight: Promise<PendingCounts | null> | null = null;

export function fetchPendingCounts(): Promise<PendingCounts | null> {
  if (cached && Date.now() - cachedAt < TTL_MS) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  const started = generation;
  const request = fetch('/api/messaging/pending-count', { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as PendingCounts;
      if (started !== generation) return null;
      cached = data;
      cachedAt = Date.now();
      return data;
    })
    .catch(() => null)
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

/**
 * A polling period with +-20% jitter, picked once per mount, so many open
 * tabs drift apart instead of polling in lockstep (runtime logs showed
 * same-millisecond bursts across tabs).
 */
export function jitteredInterval(baseMs: number): number {
  return Math.round(baseMs * (0.8 + Math.random() * 0.4));
}

/** A confirmed queue change invalidates older requests as well as cached counts. */
export function invalidatePendingCounts() {
  generation++;
  cachedAt = 0;
  inFlight = null;
  for (const listener of listeners) listener();
}

export function subscribePendingCounts(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
