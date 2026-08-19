import { SectionTabs } from '@/components/SectionTabs';

/**
 * Underline tab bar at the top of the Guests section. Three lenses on the
 * same set of people: Reviews (reputation), Contacts (the marketing list,
 * segments, campaigns), and Agreements (bespoke Stay Cape Ann rental
 * agreements for direct + mid-term stays).
 *
 * Thin wrapper over SectionTabs, the shared strip primitive. `active` is
 * passed through as an explicit current: all three tabs are ?tab= query
 * links on the one /guests route, so pathname derivation cannot tell
 * them apart.
 */
export function GuestsTabBar({ active }: { active: 'contacts' | 'reviews' | 'agreements' }) {
  // Reviews is the default lens (bare /guests); the others are click-ins.
  return (
    <SectionTabs
      current={active}
      tabs={[
        { id: 'reviews', label: 'Reviews', href: '/guests' },
        { id: 'contacts', label: 'Contacts', href: '/guests?tab=contacts' },
        { id: 'agreements', label: 'Agreements', href: '/guests?tab=agreements' },
      ]}
    />
  );
}
