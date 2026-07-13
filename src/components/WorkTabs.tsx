import Link from 'next/link';

/**
 * Sub-navigation tab strip for the Work section. Work, Turnovers, Field,
 * Properties, and Today used to sit as separate top-level modules; they're
 * five lenses on the same day-to-day operating rhythm, so this strip renders
 * at the top of all five and lets the masthead collapse to a single "Work"
 * tab. Same pattern FinancialsTabs uses for Statements / Revenue / Forecast /
 * Cost Analysis / Books, and MessagingTabs uses for Guests / Owners /
 * Cleaners / Contractors.
 *
 * Plain link nav, server-rendered, no client state. The top module nav
 * separately highlights "Work" on every page in this group (each passes
 * current="work" to HelmMasthead). Each destination keeps whatever internal
 * tab bar it already had (FieldTabs, PropertiesTabBar) underneath this strip.
 */
export function WorkTabs({
  current,
}: {
  current: 'work' | 'turnovers' | 'field' | 'properties' | 'today';
}) {
  const tabs = [
    { id: 'work', label: 'Work', href: '/work' },
    { id: 'turnovers', label: 'Turnovers', href: '/operations' },
    { id: 'field', label: 'Field', href: '/operations/packets' },
    { id: 'properties', label: 'Properties', href: '/properties' },
    { id: 'today', label: 'Today', href: '/today' },
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
