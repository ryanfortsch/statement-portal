import Link from 'next/link';

/**
 * Home-page feed tabs. "For Me" (the signed-in person's day) is the default;
 * "Recent Activity" (the team-wide event log) is `?tab=activity`.
 *
 * The tabs are links, not a client toggle: each view is rendered by the
 * server only when it is the one open. Recent Activity used to render hidden
 * under every home load, six queries for a panel nobody had opened.
 */
export function HomeFeedTabs({ active }: { active: 'forme' | 'activity' }) {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%' }}>
      <nav
        aria-label="Home feed"
        style={{
          display: 'flex',
          gap: 28,
          borderBottom: '1px solid var(--ink)',
        }}
      >
        <TabLink href="/" active={active === 'forme'}>
          For Me
        </TabLink>
        <TabLink href="/?tab=activity" active={active === 'activity'}>
          Recent Activity
        </TabLink>
      </nav>
    </section>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'inline-block',
        padding: '0 0 12px',
        marginBottom: -1,
        fontSize: 13,
        letterSpacing: '0.04em',
        fontWeight: active ? 600 : 400,
        color: active ? 'var(--ink)' : 'var(--ink-4)',
        borderBottom: active ? '2px solid var(--signal)' : '2px solid transparent',
        textDecoration: 'none',
      }}
    >
      {children}
    </Link>
  );
}
