import Link from 'next/link';

/**
 * Sub-navigation tab strip for the Turnovers section. Pipeline is the
 * living turnover rail; Inspections finally gets a standing tab instead
 * of a whisper link (the full history view is a later phase). Same
 * pattern FinancialsTabs uses for the Money section.
 *
 * Plain link nav, server-rendered, no client state. The masthead
 * highlights "Turnovers" for this group on its own, derived from the
 * pathname.
 */
export function TurnoverTabs({
  current,
}: {
  current: 'pipeline' | 'inspections';
}) {
  const tabs = [
    { id: 'pipeline', label: 'Pipeline', href: '/operations' },
    { id: 'inspections', label: 'Inspections', href: '/inspections' },
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
