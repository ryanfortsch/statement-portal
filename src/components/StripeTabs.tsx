import { SectionTabs } from './SectionTabs';

/**
 * The sub-strip under the Money strip's Stripe tab: Lookup, Balance charges,
 * Disputes. Three owner pages that used to hang off one prose sentence on
 * the lookup (UX audit 2026-11-07). Balance charges and Disputes sit in
 * OWNER_PATH_PREFIXES, so SectionTabs drops them for a staff login on its
 * own; the lookup page also decides on the server (`isOwnerSession()`) and
 * renders the strip for owners only, because a one-tab strip says nothing.
 */
export function StripeTabs({ current }: { current: 'lookup' | 'balance-charges' | 'disputes' }) {
  return (
    <SectionTabs
      current={current}
      tabs={[
        { id: 'lookup', label: 'Lookup', href: '/payments' },
        { id: 'balance-charges', label: 'Balance charges', href: '/payments/balance-charges' },
        { id: 'disputes', label: 'Disputes', href: '/payments/disputes' },
      ]}
    />
  );
}
