'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PRIMARY_MODULES, activeModuleIdForPathname, type HelmModule } from '@/lib/helm-modules';
import { HelmModuleNavMore } from './HelmModuleNavMore';
import { MessagingPendingBadge } from './MessagingPendingBadge';
import { NavTabCount } from './NavTabCount';

export function HelmModuleNav() {
  // The active tab derives from the pathname, not a per-page prop: the
  // registry maps every route prefix to its section, so a page cannot lie
  // about where it is.
  const pathname = usePathname();
  const active = activeModuleIdForPathname(pathname ?? '');

  // Always show the primary set. If the current module isn't in the primary
  // set, the More dropdown handles it (no need to append a "you are here"
  // tab here too, since the More button activates when the page is in overflow).
  const visible: HelmModule[] = [...PRIMARY_MODULES];

  return (
    <nav className="flex items-baseline rt-helm-modulenav" style={{
      gap: 18,
      fontSize: 10,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      fontWeight: 500,
    }}>
      {visible.map((m) => (
        <ModuleLink key={m.id} module={m} active={m.id === active} />
      ))}
      <HelmModuleNavMore active={active} />
    </nav>
  );
}

function ModuleLink({ module: m, active }: { module: HelmModule; active: boolean }) {
  // The Messaging tab carries a pending-count badge so Dotti can see from
  // any module when a draft is waiting; the Field tab carries the packets
  // pill that lived on WorkTabs before Field became its own section. Both
  // are silent at 0.
  const badge =
    m.id === 'messaging' ? (
      <MessagingPendingBadge />
    ) : m.id === 'field' ? (
      <NavTabCount kind="fieldPackets" />
    ) : null;

  const label = m.navLabel ?? m.title;

  // Active still links to the module's own href (its "home" page), not just a
  // static label -- this module now covers several nested routes (e.g. Work
  // also covers Turnovers/Field/Properties/Today), so "active" doesn't mean
  // "I am exactly on this page," it means "I am somewhere in this section."
  // A plain span here would strand anyone on a nested page with no way back
  // to the section's own home via the masthead.
  if (active) {
    return (
      <Link
        href={m.href}
        style={{ color: 'var(--ink)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
      >
        {label}
        {badge}
      </Link>
    );
  }

  if (m.status === 'external') {
    return (
      <a
        href={m.href}
        target="_blank"
        rel="noopener noreferrer"
        title="Opens in a new tab"
        style={{ color: 'var(--ink-3)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
      >
        {label} <span style={{ fontSize: 8, opacity: 0.7 }}>↗</span>
        {badge}
      </a>
    );
  }

  if (m.status === 'soon') {
    return (
      <span style={{ color: 'var(--ink-4)' }} title="Coming soon">{label}</span>
    );
  }

  // Parked: built but de-prioritized. Renders dimmer than 'active' so
  // it reads as bottom-tier, but stays a real Link.
  if (m.status === 'parked') {
    return (
      <Link
        href={m.href}
        style={{ color: 'var(--ink-4)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
      >
        {label}
        {badge}
      </Link>
    );
  }

  return (
    <Link href={m.href} style={{ color: 'var(--ink-3)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
      {label}
      {badge}
    </Link>
  );
}
