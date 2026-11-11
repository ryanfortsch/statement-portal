import { cache } from 'react';
import { sessionRole } from '@/lib/helm-access-server';
import { listProposedPropertyUpdates } from '@/lib/stay-concierge';
import { factSourcesFor, factsToFileLabel, sumPendingFacts } from '@/lib/property-facts-to-file';

/**
 * The count of property facts waiting on the Quality lens, as the pill on
 * that lens's label in MessagingTabs (UX audit 2026-11-07, finding 6). It
 * used to be a line of its own floating between sections on three pages.
 * Nothing at zero and nothing when the concierge cannot be read: a count
 * is a nudge, never a ledger.
 *
 * The read is memoised per request so the loading skeleton's strip and the
 * page's strip share one concierge round trip.
 */
const pendingFacts = cache(async (): Promise<number | null> => {
  const role = await sessionRole();
  const results = await Promise.all(
    factSourcesFor(role).map((source) =>
      // The concierge's no-audience list is the owner bucket.
      listProposedPropertyUpdates(source === 'owner' ? undefined : source).catch(() => null),
    ),
  );
  return sumPendingFacts(results);
});

export async function PropertyFactsToFile() {
  const n = await pendingFacts();
  if (!n) return null;
  const label = factsToFileLabel(n);
  // The same pill MessagingTabCount draws for the audience and lens counts;
  // this one is server-rendered, so it carries the style itself.
  return (
    <span
      title={label}
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 6,
        minWidth: 16,
        height: 16,
        padding: '0 5px',
        borderRadius: 8,
        background: '#3b5d8f',
        color: 'var(--paper)',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0,
        lineHeight: 1,
        verticalAlign: 'middle',
      }}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}
