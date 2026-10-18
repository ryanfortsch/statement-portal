import { SectionTabs } from './SectionTabs';

/**
 * Sub-navigation tab strip for the Turnovers section. Pipeline is the
 * board, one line per house per day; Schedule is the cleaner checkout
 * schedule (the merged bookings + adjustments truth behind Rosa's daily
 * digest); Walks is the walk index at /inspections (the route keeps its
 * old name; the word a person reads is walk, per the 2026-10-17 audit).
 *
 * There is no Cleanings tab: the crew's verdict on each checkout prints on
 * its board row, and /turnovers/cleanings is the short "From Cape Ann
 * Elite" list of what no row can show, reached from the board and the
 * home feed. It lights Pipeline, the longest matching prefix.
 *
 * Thin wrapper over SectionTabs, the shared strip primitive. `current` is
 * optional: a layout can render this prop-less and SectionTabs derives
 * the active tab from the pathname.
 */
export function TurnoverTabs({
  current,
}: {
  current?: 'pipeline' | 'schedule' | 'inspections';
}) {
  return (
    <SectionTabs
      current={current}
      tabs={[
        { id: 'pipeline', label: 'Pipeline', href: '/turnovers' },
        { id: 'schedule', label: 'Schedule', href: '/turnovers/schedule' },
        { id: 'inspections', label: 'Walks', href: '/inspections' },
      ]}
    />
  );
}
