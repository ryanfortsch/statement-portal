import Link from 'next/link';

/**
 * Sub-navigation tab strip for the Marketing section. Guests (the
 * guest-facing subscriber list, reviews, and agreements) used to sit as its
 * own top-level module; it's a second lens on the same audience-growth work
 * Marketing already covers, so this strip renders at the top of both and
 * lets the masthead collapse to a single "Marketing" tab. Same pattern
 * FinancialsTabs / MessagingTabs / WorkTabs use for their own sections.
 *
 * Plain link nav, server-rendered, no client state. The top module nav
 * separately highlights "Marketing" on both pages (each passes
 * current="marketing" to HelmMasthead). Guests keeps its own GuestsTabBar
 * (Reviews / Contacts / Agreements) underneath this strip.
 */
export function MarketingTabs({
  current,
}: {
  current: 'marketing' | 'guests';
}) {
  const tabs = [
    { id: 'marketing', label: 'Marketing', href: '/marketing' },
    { id: 'guests', label: 'Guests', href: '/guests' },
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
