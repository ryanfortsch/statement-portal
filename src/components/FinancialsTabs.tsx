import Link from 'next/link';

/**
 * Sub-navigation tab strip for the Financials section. Statements,
 * Revenue, Forecast, and Cost Analysis are four lenses on the same
 * money. Each remains its own route (URLs unchanged), but the strip
 * renders at the top of all four so they read as tabs of one
 * "Financials" section. Plain link nav -- server-rendered, no client
 * state -- mirroring GuestsTabBar.
 *
 * `current` highlights the active tab; the top module nav separately
 * highlights "Financials" (each page passes current="financials" to
 * HelmMasthead).
 */
export function FinancialsTabs({
  current,
}: {
  current: 'statements' | 'revenue' | 'forecast' | 'cost-analysis' | 'books';
}) {
  const tabs = [
    { id: 'statements', label: 'Statements', href: '/statements' },
    { id: 'revenue', label: 'Revenue', href: '/revenue' },
    { id: 'forecast', label: 'Forecast', href: '/forecast' },
    { id: 'cost-analysis', label: 'Cost Analysis', href: '/cost-analysis' },
    { id: 'books', label: 'LLC Accounting', href: '/books' },
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
