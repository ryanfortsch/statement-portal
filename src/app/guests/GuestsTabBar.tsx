import Link from 'next/link';

/**
 * Underline tab bar at the top of the Guests section. Two lenses on the
 * same set of people: Contacts (the marketing list, segments, campaigns)
 * and Reviews (reputation, five-star runs, below-five follow-ups).
 * Switching tabs is a plain link nav, so server-rendered with no client
 * state.
 */
export function GuestsTabBar({ active }: { active: 'contacts' | 'reviews' }) {
  const tabs = [
    { id: 'contacts', label: 'Contacts', href: '/guests' },
    { id: 'reviews', label: 'Reviews', href: '/guests?tab=reviews' },
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
