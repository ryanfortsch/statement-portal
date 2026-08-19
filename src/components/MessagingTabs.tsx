import { SectionTabs } from './SectionTabs';
import { MessagingTabCount } from './MessagingTabCount';

/**
 * Sub-navigation tab strip for the Messaging section. Guests, Owners,
 * Cleaners, and Contractors are queues backed by the same Stay Concierge
 * approval flow; this strip renders at the top of all four pages so they
 * read as tabs of one section. Each tab carries a MessagingTabCount pill
 * so the operator can see which queue has drafts waiting.
 *
 * Thin wrapper over SectionTabs, the shared strip primitive. `current`
 * stays required here: the four routes share no common prefix, so the
 * caller names its own tab.
 */
export function MessagingTabs({
  current,
}: {
  current: 'guests' | 'owners' | 'cleaners' | 'contractors';
}) {
  return (
    <SectionTabs
      current={current}
      tabs={[
        { id: 'guests', label: 'Guests', href: '/messaging', badge: <MessagingTabCount category="guests" /> },
        { id: 'owners', label: 'Owners', href: '/owner-messaging', badge: <MessagingTabCount category="owners" /> },
        { id: 'cleaners', label: 'Cleaners', href: '/cleaner-messaging', badge: <MessagingTabCount category="cleaners" /> },
        { id: 'contractors', label: 'Contractors', href: '/contractor-messaging', badge: <MessagingTabCount category="contractors" /> },
      ]}
    />
  );
}
