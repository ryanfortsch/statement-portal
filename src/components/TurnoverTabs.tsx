import { SectionTabs } from './SectionTabs';

/**
 * Sub-navigation tab strip for the Turnovers section. Pipeline is the
 * living turnover rail; Schedule is the cleaner checkout schedule (the
 * merged bookings + adjustments truth behind Rosa's daily digest);
 * Cleanings is the crew's own side of it (Cape Ann Elite's bookings from
 * their Jobber reminder texts, against our checkouts); Inspections
 * finally gets a standing tab instead of a whisper link (the full history
 * view is a later phase).
 *
 * Thin wrapper over SectionTabs, the shared strip primitive. `current` is
 * optional: a layout can render this prop-less and SectionTabs derives
 * the active tab from the pathname.
 */
export function TurnoverTabs({
  current,
}: {
  current?: 'pipeline' | 'schedule' | 'cleanings' | 'inspections';
}) {
  return (
    <SectionTabs
      current={current}
      tabs={[
        { id: 'pipeline', label: 'Pipeline', href: '/turnovers' },
        { id: 'schedule', label: 'Schedule', href: '/turnovers/schedule' },
        { id: 'cleanings', label: 'Cleanings', href: '/turnovers/cleanings' },
        { id: 'inspections', label: 'Inspections', href: '/inspections' },
      ]}
    />
  );
}
