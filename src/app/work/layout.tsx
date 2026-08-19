import type { ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { WorkTabs } from '@/components/WorkTabs';

/**
 * Work section layout: the masthead and tab strip render here once, so
 * every page under /work carries the chrome by construction. The strip is
 * prop-less; SectionTabs derives the active tab from the pathname, and the
 * detail routes (/work/[id], /work/tasks/[id]) fall back to the Board tab
 * via longest-prefix. The layout owns the min-h-screen paper shell; pages
 * contribute their content sections and footer as direct flex children.
 */
export default function WorkLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead />
      <WorkTabs />
      {children}
    </div>
  );
}
