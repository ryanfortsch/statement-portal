'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { growthTabFor } from '@/lib/growth-tabs';
import { SectionTabs } from './SectionTabs';

/**
 * The one Growth strip: Marketing / Reviews / Contacts / Agreements /
 * Quotes / Competitors. Rendered by the Growth layouts through GrowthFrame,
 * never by a page, so every Growth page carries it in the same place and
 * clicking between siblings never moves it.
 *
 * Role-aware through SectionTabs: Quotes is an owner page (guest pricing is
 * set by the owners), so a staff login never sees the tab.
 */
export function GrowthTabs() {
  const current = growthTabFor(usePathname() ?? '') ?? undefined;
  return (
    <SectionTabs
      current={current}
      tabs={[
        { id: 'marketing', label: 'Marketing', href: '/marketing' },
        { id: 'reviews', label: 'Reviews', href: '/guests' },
        { id: 'contacts', label: 'Contacts', href: '/guests/contacts' },
        { id: 'agreements', label: 'Agreements', href: '/guests/agreements' },
        { id: 'quotes', label: 'Quotes', href: '/guests/quotes' },
        { id: 'competitors', label: 'Competitors', href: '/competitors' },
      ]}
    />
  );
}

/**
 * The Growth shell the three layouts render: paper, the masthead (handed in
 * from the server layout) and the strip, then the page. The agreement
 * document preview gets none of it, so Cmd+P still prints the bare sheet.
 */
export function GrowthFrame({ masthead, children }: { masthead: ReactNode; children: ReactNode }) {
  const pathname = usePathname() ?? '';
  if (growthTabFor(pathname) === null) return <>{children}</>;
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      {masthead}
      <GrowthTabs />
      {children}
    </div>
  );
}
