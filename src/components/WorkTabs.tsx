import Link from 'next/link';

/**
 * Sub-navigation tab strip for the Work section, which is now just the
 * queue: the board plus its Maintenance and Gear lenses. Turnovers, Field,
 * Properties, and Today were promoted out of this strip in the Phase 1
 * masthead expansion; each is its own masthead section (Today has no tab
 * at all, home and the morning SMS link it). Same pattern FinancialsTabs
 * uses for Statements / Revenue / Forecast / Cost Analysis / Books.
 *
 * Plain link nav, server-rendered, no client state. The masthead
 * highlights "Work" for this group on its own, derived from the pathname.
 */
export function WorkTabs({
  current,
}: {
  current: 'work' | 'maintenance' | 'gear';
}) {
  const tabs = [
    { id: 'work', label: 'Board', href: '/work' },
    { id: 'maintenance', label: 'Maintenance', href: '/work/maintenance' },
    { id: 'gear', label: 'Gear', href: '/work/gear' },
  ] as const;

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 20, paddingBottom: 4 }}>
      <div className="flex items-baseline" style={{ gap: 28, borderBottom: '1px solid var(--ink)', overflowX: 'auto' }}>
        {tabs.map((t) => {
          const isActive = t.id === current;
          return (
            <Link
              key={t.id}
              href={t.href}
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
            </Link>
          );
        })}
      </div>
    </section>
  );
}
