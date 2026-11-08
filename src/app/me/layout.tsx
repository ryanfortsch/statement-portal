import type { ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';

/**
 * My page layout: the masthead renders here once, so the page under /me
 * carries the shell by construction (the round-two audit's rule for a new
 * page). No tab strip: this is one page, reached from the avatar menu.
 */
export default function MeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      {children}
    </div>
  );
}
