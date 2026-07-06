import Link from 'next/link';

/**
 * Sub-navigation tab strip for the Field section. Packets (bundling visits into
 * priced jobs), Contractors (the roster), and Hiring (the applicant pipeline)
 * are three lenses on the same contractor operation. Each stays its own route
 * (URLs unchanged); the strip renders at the top of all three so they read as
 * tabs of one "Field" section. Mirrors FinancialsTabs: plain server-rendered
 * link nav, no client state.
 *
 * `current` highlights the active tab; the masthead separately highlights
 * "Field" (each page passes current="field" to HelmMasthead).
 */
export function FieldTabs({ current }: { current: 'packets' | 'contractors' | 'hiring' }) {
  const tabs = [
    { id: 'packets', label: 'Packets', href: '/operations/packets' },
    { id: 'contractors', label: 'Contractors', href: '/operations/contractors' },
    { id: 'hiring', label: 'Hiring', href: '/operations/contractors/applicants' },
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
