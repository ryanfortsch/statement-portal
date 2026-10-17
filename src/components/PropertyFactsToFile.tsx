import Link from 'next/link';
import { sessionRole } from '@/lib/helm-access-server';
import { listProposedPropertyUpdates } from '@/lib/stay-concierge';
import { factSourcesFor, factsToFileLabel, sumPendingFacts } from '@/lib/property-facts-to-file';

/**
 * The one line a queue page keeps after the proposed-property-update cards
 * moved to the Quality lens (2026-10-17): a count and a link. Nothing at
 * zero and nothing when the concierge cannot be read; the lens tab is the
 * door either way, and an empty count on the working page would be noise.
 */
export async function PropertyFactsToFile() {
  const role = await sessionRole();
  const results = await Promise.all(
    factSourcesFor(role).map((source) =>
      // The concierge's no-audience list is the owner bucket.
      listProposedPropertyUpdates(source === 'owner' ? undefined : source).catch(() => null),
    ),
  );
  const n = sumPendingFacts(results);
  if (!n) return null;
  return (
    <div className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 4, paddingBottom: 28 }}>
      <Link href="/messaging/quality#facts" className="rt-inline-action">
        {factsToFileLabel(n)} →
      </Link>
    </div>
  );
}
