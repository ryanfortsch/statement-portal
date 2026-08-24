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

// Inspection trades only: the contractor's own claimed work by day, with
// Cape Ann Elite's booked cleaning time beside each stop. Scoped to their
// OWN packets on purpose -- a fleet-wide cleaning view would hand a 1099
// contractor addresses for houses they were never awarded.
const SCHEDULE_TAB = {
  href: '/field/schedule',
  label: 'Schedule',
  match: (p: string) => p.startsWith('/field/schedule'),
};

// Office-granted only (work_board_access): the all-properties slip board.
const PROPERTY_WORK_TAB = {
  href: '/field/property-work',
  label: 'Property work',
  match: (p: string) => p.startsWith('/field/property-work'),
};

// Creative trade only: the contributor's current rate card.
const RATES_TAB = {
  href: '/field/rate-card',
  label: 'Rates',
  match: (p: string) => p.startsWith('/field/rate-card'),
};

export function FieldNav({
  showPropertyWork = false,
  showRates = false,
  showSchedule = false,
  homeLabel,
}: {
  showPropertyWork?: boolean;
  showRates?: boolean;
  showSchedule?: boolean;
  // Creative contributors land on a shoot list, not a packet board — so the
  // first tab reads "Shoots" for them.
  homeLabel?: string;
}) {
  const path = usePathname() || '/field';
  const tabs = [
    homeLabel ? { ...TABS[0], label: homeLabel } : TABS[0],
    ...(showSchedule ? [SCHEDULE_TAB] : []),
    ...(showPropertyWork ? [PROPERTY_WORK_TAB] : []),
    ...(showRates ? [RATES_TAB] : []),
    TABS[1],
  ];
  return (
    <nav
      style={{
        display: 'flex',
        borderBottom: '1px solid var(--rule)',
        background: 'var(--paper)',
      }}
    >
      {tabs.map((t) => {
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
