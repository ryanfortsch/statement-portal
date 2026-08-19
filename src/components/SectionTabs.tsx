'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * The one tab-strip primitive for Helm's section sub-navigation. Every
 * per-section strip (WorkTabs, TurnoverTabs, MessagingTabs, FinancialsTabs,
 * MarketingTabs, FieldTabs, GuestsTabBar) is a thin wrapper that hands this
 * component its tab array; the markup lives here once so the strips cannot
 * drift apart visually.
 *
 * Active tab resolution: an explicit `current` wins when provided (required
 * for ?tab= / ?trade= strips, where the pathname cannot tell tabs apart);
 * otherwise the tab whose href (query-stripped) is the longest prefix of the
 * current pathname lights up, so a strip rendered prop-less from a section
 * layout highlights correctly on every descendant page.
 *
 * `secondRow` renders directly below the tab row inside the same section
 * wrapper (FieldTabs uses it for its lens row).
 */
export type SectionTab = {
  id: string;
  label: string;
  href: string;
  badge?: ReactNode;
};

export function SectionTabs({
  tabs,
  current,
  secondRow,
}: {
  tabs: SectionTab[];
  current?: string;
  secondRow?: ReactNode;
}) {
  const pathname = usePathname();

  let activeId = current;
  if (activeId === undefined) {
    let bestLen = 0;
    for (const t of tabs) {
      const prefix = t.href.split(/[?#]/)[0];
      if (!prefix) continue;
      const matches = pathname === prefix || pathname.startsWith(prefix + '/');
      if (matches && prefix.length > bestLen) {
        bestLen = prefix.length;
        activeId = t.id;
      }
    }
  }

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 20, paddingBottom: 4 }}>
      <div className="flex items-baseline" style={{ gap: 28, borderBottom: '1px solid var(--ink)', overflowX: 'auto' }}>
        {tabs.map((t) => {
          const isActive = t.id === activeId;
          return (
            <Link
              key={t.id}
              href={t.href}
              aria-current={isActive ? 'page' : undefined}
              style={{
                fontSize: 13,
                letterSpacing: '.04em',
                textTransform: 'uppercase',
                fontWeight: 600,
                color: isActive ? 'var(--ink)' : 'var(--ink-4)',
                textDecoration: 'none',
                paddingBottom: 12,
                borderBottom: isActive ? '2px solid var(--signal)' : '2px solid transparent',
                marginBottom: -1,
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
              {t.badge}
            </Link>
          );
        })}
      </div>
      {secondRow}
    </section>
  );
}
