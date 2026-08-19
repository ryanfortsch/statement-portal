import { SectionTabs } from './SectionTabs';

/**
 * Sub-navigation tab strip for the Growth section. Marketing, Guests, and
 * Competitors are siblings: three lenses on the same audience-growth work.
 * This strip renders at the top of all three so they read as tabs of one
 * section; the masthead tab above reads "Growth" via navLabel and lights
 * by pathname. Guests keeps its own GuestsTabBar (Reviews / Contacts /
 * Agreements) underneath this strip.
 *
 * Thin wrapper over SectionTabs, the shared strip primitive. `current`
 * stays required here: the three routes share no common prefix, so the
 * caller names its own tab.
 */
export function MarketingTabs({
  current,
}: {
  current: 'marketing' | 'guests' | 'competitors';
}) {
  return (
    <SectionTabs
      current={current}
      tabs={[
        { id: 'marketing', label: 'Marketing', href: '/marketing' },
        { id: 'guests', label: 'Guests', href: '/guests' },
        { id: 'competitors', label: 'Competitors', href: '/competitors' },
      ]}
    />
  );
}
