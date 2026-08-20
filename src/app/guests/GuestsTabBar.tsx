import { SectionTabs } from '@/components/SectionTabs';

/**
 * Underline tab bar at the top of the Guests section. Three lenses on the
 * same set of people: Reviews (reputation), Contacts (the marketing list,
 * segments, campaigns), and Agreements (bespoke Stay Cape Ann rental
 * agreements for direct + mid-term stays).
 *
 * Thin wrapper over SectionTabs, the shared strip primitive. The lenses are
 * real routes now, but `active` is still passed through as an explicit
 * current: pathname derivation would light Reviews (the bare /guests href)
 * on any /guests/* descendant such as /guests/[id] or /guests/campaigns,
 * so each lens page names its own tab instead.
 */
export function GuestsTabBar({ active }: { active: 'contacts' | 'reviews' | 'agreements' }) {
  // Reviews is the default lens (bare /guests); the others are click-ins.
  return (
    <SectionTabs
      current={active}
      tabs={[
        { id: 'reviews', label: 'Reviews', href: '/guests' },
        { id: 'contacts', label: 'Contacts', href: '/guests/contacts' },
        { id: 'agreements', label: 'Agreements', href: '/guests/agreements' },
      ]}
    />
  );
}
