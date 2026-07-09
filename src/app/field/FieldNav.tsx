'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Persistent contractor nav — the two places she actually goes: her Work board
 * and her Profile. Lives in FieldShell so it's on every authenticated Field
 * page (a packet was reachable, but Profile and the way back to Work were not).
 * A top strip, not a bottom bar, because the packet page owns a sticky bottom
 * claim/submit bar.
 */
const TABS: Array<{ href: string; label: string; match: (p: string) => boolean }> = [
  {
    href: '/field',
    label: 'Work',
    match: (p) => p === '/field' || p.startsWith('/field/packet') || p.startsWith('/field/inspect'),
  },
  {
    href: '/field/profile',
    label: 'Profile',
    match: (p) => p.startsWith('/field/profile'),
  },
];

export function FieldNav() {
  const path = usePathname() || '/field';
  return (
    <nav
      style={{
        display: 'flex',
        borderBottom: '1px solid var(--rule)',
        background: 'var(--paper)',
      }}
    >
      {TABS.map((t) => {
        const active = t.match(path);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            style={{
              flex: 1,
              minHeight: 46,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '12px 8px',
              fontSize: 13,
              letterSpacing: '0.05em',
              textDecoration: 'none',
              color: active ? 'var(--signal)' : 'var(--ink-3)',
              fontWeight: active ? 600 : 500,
              borderBottom: active ? '2px solid var(--signal)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
