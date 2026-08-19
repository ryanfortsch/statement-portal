import { SectionTabs } from './SectionTabs';

/**
 * Sub-navigation tab strip for the Work section, which is now just the
 * queue: the board plus its Maintenance and Gear lenses. Turnovers, Field,
 * Properties, and Today were promoted out of this strip in the Phase 1
 * masthead expansion; each is its own masthead section (Today has no tab
 * at all, home and the morning SMS link it).
 *
 * Thin wrapper over SectionTabs, the shared strip primitive. `current` is
 * optional: the Work route layout renders this prop-less and SectionTabs
 * derives the active tab from the pathname.
 */
export function WorkTabs({
  current,
}: {
  current?: 'work' | 'maintenance' | 'gear';
}) {
  return (
    <SectionTabs
      current={current}
      tabs={[
        { id: 'work', label: 'Board', href: '/work' },
        { id: 'maintenance', label: 'Maintenance', href: '/work/maintenance' },
        { id: 'gear', label: 'Gear', href: '/work/gear' },
      ]}
    />
  );
}
