import Link from 'next/link';

/** Two-tab switch over the Properties index: the managed roster at
 *  /properties and the prospect funnel at /properties/prospects.
 *  Server-rendered Links (no client JS) so each tab is a plain
 *  deep-linkable URL. Styled to match the property detail tab bar. */
export function PropertiesTabBar({ active }: { active: 'properties' | 'prospects' }) {
  const tabs = [
    { id: 'properties' as const, label: 'Properties', href: '/properties' },
    { id: 'prospects' as const, label: 'Prospects', href: '/properties/prospects' },
  ];
  return (
    <nav aria-label="Properties sections" style={{ borderBottom: '1px solid var(--ink)', marginBottom: 28 }}>
      <div className="max-w-[1100px] mx-auto px-10" style={{ display: 'flex', gap: 4 }}>
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <Link
              key={t.id}
              href={t.href}
              aria-current={on ? 'page' : undefined}
              style={{
                borderBottom: on ? '2px solid var(--ink)' : '2px solid transparent',
                margin: '0 0 -1px',
                padding: '14px 14px 12px',
                fontSize: 11,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                fontWeight: on ? 600 : 500,
                color: on ? 'var(--ink)' : 'var(--ink-3)',
                textDecoration: 'none',
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
