import Link from 'next/link';
import { HELM_MODULES, PRIMARY_MODULES, type HelmModule } from '@/lib/helm-modules';

type Props = {
  current?: string;
};

export function HelmModuleNav({ current }: Props) {
  // Always show the primary set. If the current module isn't in the primary
  // set, append it so the user sees a "you are here" anchor in the nav.
  const visible: HelmModule[] = [...PRIMARY_MODULES];
  if (current && !visible.find((m) => m.id === current)) {
    const extra = HELM_MODULES.find((m) => m.id === current);
    if (extra) visible.push(extra);
  }

  return (
    <nav className="flex items-baseline gap-4" style={{
      fontSize: 10,
      letterSpacing: '0.22em',
      textTransform: 'uppercase',
      fontWeight: 500,
    }}>
      {visible.map((m) => (
        <ModuleLink key={m.id} module={m} active={m.id === current} />
      ))}
    </nav>
  );
}

function ModuleLink({ module: m, active }: { module: HelmModule; active: boolean }) {
  if (active) {
    return <span style={{ color: 'var(--ink)' }}>{m.title}</span>;
  }

  if (m.status === 'external') {
    return (
      <a
        href={m.href}
        target="_blank"
        rel="noopener noreferrer"
        title="Opens in a new tab"
        style={{ color: 'var(--ink-3)', textDecoration: 'none' }}
      >
        {m.title} <span style={{ fontSize: 8, opacity: 0.7 }}>↗</span>
      </a>
    );
  }

  if (m.status === 'soon') {
    return (
      <span style={{ color: 'var(--ink-4)' }} title="Coming soon">{m.title}</span>
    );
  }

  return (
    <Link href={m.href} style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>
      {m.title}
    </Link>
  );
}
