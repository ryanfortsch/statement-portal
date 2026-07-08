import Link from 'next/link';
import { MessagingTabCount } from './MessagingTabCount';

/**
 * Sub-navigation tab strip for the Messaging section. Guests and Owners are
 * two queues backed by the same Stay Concierge approval flow; previously they
 * sat as two separate top-level modules ("Messaging" + "Owner Messaging") that
 * read as parallel destinations. This strip renders at the top of both pages
 * so they read as two tabs of one section -- the same pattern FinancialsTabs
 * uses for Statements / Revenue / Forecast / Cost Analysis / Books.
 *
 * Plain link nav, server-rendered, no client state. The top module nav
 * separately highlights "Messaging" on both pages (each passes
 * current="messaging" to HelmMasthead).
 */
export function MessagingTabs({
  current,
}: {
  current: 'guests' | 'owners' | 'cleaners' | 'contractors';
}) {
  const tabs = [
    { id: 'guests', label: 'Guests', href: '/messaging' },
    { id: 'owners', label: 'Owners', href: '/owner-messaging' },
    { id: 'cleaners', label: 'Cleaners', href: '/cleaner-messaging' },
    { id: 'contractors', label: 'Contractors', href: '/contractor-messaging' },
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
              <MessagingTabCount category={t.id} />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
