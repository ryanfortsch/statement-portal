import type { ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';

/**
 * Appointments section layout: the masthead and footer render here once, so
 * the agenda, the add form and the edit form carry Helm's chrome by
 * construction (they were bare <main> blocks with a "← Today" link until the
 * 2026-11-07 audit). No tab strip: the section is one page and two forms,
 * reached from the home's Upcoming block and Cmd+K. The layout owns the
 * min-h-screen paper shell; pages contribute their content.
 */
export default function AppointmentsLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead />
      <div style={{ flex: 1 }}>{children}</div>
      <HelmFooter module="Appointments" right="Source: Helm" />
    </div>
  );
}
