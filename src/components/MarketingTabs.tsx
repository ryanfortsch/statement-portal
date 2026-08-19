import Link from 'next/link';

/**
 * Sub-navigation tab strip for the Growth section. Marketing, Guests, and
 * Competitors are siblings: three lenses on the same audience-growth work.
 * This strip renders at the top of all three so they read as tabs of one
 * section; the masthead tab above reads "Growth" via navLabel and lights
 * by pathname. Same pattern FinancialsTabs / MessagingTabs use for their
 * own sections.
 *
 * Plain link nav, server-rendered, no client state. Guests keeps its own
 * GuestsTabBar (Reviews / Contacts / Agreements) underneath this strip.
 */
export function MarketingTabs({
  current,
}: {
  current: 'marketing' | 'guests' | 'competitors';
}) {
  const tabs = [
    { id: 'marketing', label: 'Marketing', href: '/marketing' },
    { id: 'guests', label: 'Guests', href: '/guests' },
    { id: 'competitors', label: 'Competitors', href: '/competitors' },
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
