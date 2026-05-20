import Link from 'next/link';
import { HELM_MODULES, PRIMARY_MODULES, type HelmModule } from '@/lib/helm-modules';
import { HelmModuleNavMore } from './HelmModuleNavMore';
import { MessagingPendingBadge } from './MessagingPendingBadge';

type Props = {
  current?: string;
};

export function HelmModuleNav({ current }: Props) {
  // Always show the primary set. If the current module isn't in the primary
  // set, the More dropdown handles it (no need to append a "you are here"
  // tab here too, since the More button activates when current is in overflow).
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
        <ModuleLink key={m.id} module={m} active={m.id === current} />
      ))}
      <HelmModuleNavMore current={current} />
    </nav>
  );
}

function ModuleLink({ module: m, active }: { module: HelmModule; active: boolean }) {
  // The Messaging tab carries a pending-count badge so Dotti can see from
  // any module when a draft is waiting. The badge is silent at 0.
  const badge = m.id === 'messaging' ? <MessagingPendingBadge /> : null;

  if (active) {
    return (
      <span style={{ color: 'var(--ink)', display: 'inline-flex', alignItems: 'center' }}>
        {m.title}
        {badge}
      </span>
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
        {m.title} <span style={{ fontSize: 8, opacity: 0.7 }}>↗</span>
        {badge}
      </a>
    );
  }

  if (m.status === 'soon') {
    return (
      <span style={{ color: 'var(--ink-4)' }} title="Coming soon">{m.title}</span>
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
        {m.title}
        {badge}
      </Link>
    );
  }

  return (
    <Link href={m.href} style={{ color: 'var(--ink-3)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
      {m.title}
      {badge}
    </Link>
  );
}
