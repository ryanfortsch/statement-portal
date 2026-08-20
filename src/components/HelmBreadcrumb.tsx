'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { activeModuleIdForPathname, HELM_MODULES } from '@/lib/helm-modules';

/**
 * Registry-driven breadcrumb for detail pages (Section / Page / Entity).
 * The leading crumb is the masthead section the pathname resolves to via
 * activeModuleIdForPathname, so it can never disagree with the lit tab;
 * callers pass only the trail below it. Replaces the hand-wired back
 * links that drift when a route moves.
 *
 * Crumbs with an href render as links; the final entity crumb usually
 * has none and reads in full ink. Same small-caps grammar as the eyebrow
 * class, one notch larger.
 */
export function HelmBreadcrumb({ trail }: { trail: { label: string; href?: string }[] }) {
  const pathname = usePathname();
  const sectionId = activeModuleIdForPathname(pathname);
  const section = sectionId ? HELM_MODULES.find((m) => m.id === sectionId) : undefined;

  const crumbs = [
    // The section href keeps any query it carries (e.g. Financials lands
    // on /revenue, Prospects on /properties/prospects).
    ...(section ? [{ label: section.navLabel ?? section.title, href: section.href }] : []),
    ...trail,
  ];

  if (crumbs.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="max-w-[1100px] mx-auto px-10 rt-breadcrumb"
      style={{
        width: '100%',
        paddingTop: 18,
        paddingBottom: 2,
        fontSize: 11,
        letterSpacing: '.14em',
        textTransform: 'uppercase',
      }}
    >
      <style>{`.rt-breadcrumb a:hover { color: var(--ink); }`}</style>
      {crumbs.map((c, i) => (
        <span key={i} style={{ whiteSpace: 'nowrap' }}>
          {i > 0 && <span style={{ color: 'var(--ink-4)' }}>{' / '}</span>}
          {c.href ? (
            <Link href={c.href} style={{ color: 'var(--ink-3)', fontWeight: 500, textDecoration: 'none' }}>
              {c.label}
            </Link>
          ) : (
            <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
