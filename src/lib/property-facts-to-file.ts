import type { HelmRole } from '@/lib/helm-access';

/**
 * "N property facts to file": the one line the four queue pages keep after
 * the proposed-property-update cards moved to the Quality lens
 * (/messaging/quality, 2026-10-17). Pure helpers; the concierge read lives in
 * components/PropertyFactsToFile.tsx so this file stays import-free for the
 * test runner.
 */

export type FactSource = 'guest' | 'cleaner' | 'contractor' | 'owner';

/** The sources a role may read. Owner correspondence is an owner page, so a
 *  staff login never counts, and never sees, a fact an owner shared. */
export function factSourcesFor(role: HelmRole | null): FactSource[] {
  return role === 'owner' ? ['guest', 'cleaner', 'contractor', 'owner'] : ['guest', 'cleaner', 'contractor'];
}

export function factsToFileLabel(n: number): string {
  return n === 1 ? '1 property fact to file' : `${n} property facts to file`;
}

/** Sum the pending facts across the reads that succeeded. null when none
 *  did (the line then stays off the page): a count is a nudge, never a
 *  ledger, so a partial read counts what it got. */
export function sumPendingFacts(
  results: ({ ok: true; data: { updates: { status?: string }[] } } | { ok: false } | null)[],
): number | null {
  let read = false;
  let total = 0;
  for (const r of results) {
    if (!r || !r.ok) continue;
    read = true;
    total += r.data.updates.filter((u) => !u.status || u.status === 'pending').length;
  }
  return read ? total : null;
}
