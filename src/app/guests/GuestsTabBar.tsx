import Link from 'next/link';

/**
 * Underline tab bar at the top of the Guests section. Three lenses on the
 * same set of people: Reviews (reputation), Contacts (the marketing list,
 * segments, campaigns), and Agreements (bespoke Stay Cape Ann rental
 * agreements for direct + mid-term stays). Switching tabs is a plain link
 * nav, so server-rendered with no client state.
 */
export function GuestsTabBar({ active }: { active: 'contacts' | 'reviews' | 'agreements' }) {
  // Reviews is the default lens (bare /guests); the others are click-ins.
  const tabs = [
    { id: 'reviews', label: 'Reviews', href: '/guests' },
    { id: 'contacts', label: 'Contacts', href: '/guests?tab=contacts' },
    { id: 'agreements', label: 'Agreements', href: '/guests?tab=agreements' },
  ] as const;

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 28 }}>
      <div className="flex items-baseline" style={{ gap: 28, borderBottom: '1px solid var(--ink)' }}>
        {tabs.map((t) => {
          const isActive = t.id === active;
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
