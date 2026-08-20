import { SectionTabs } from './SectionTabs';

/**
 * Sub-navigation tab strip for the Turnovers section. Pipeline is the
 * living turnover rail; Inspections finally gets a standing tab instead
 * of a whisper link (the full history view is a later phase).
 *
 * Thin wrapper over SectionTabs, the shared strip primitive. `current` is
 * optional: a layout can render this prop-less and SectionTabs derives
 * the active tab from the pathname.
 */
export function TurnoverTabs({
  current,
}: {
  current?: 'pipeline' | 'inspections';
}) {
  return (
    <SectionTabs
      current={current}
      tabs={[
        { id: 'pipeline', label: 'Pipeline', href: '/turnovers' },
        { id: 'inspections', label: 'Inspections', href: '/inspections' },
      ]}
    />
  );
}
