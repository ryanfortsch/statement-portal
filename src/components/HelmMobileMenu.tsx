'use client';

/**
 * The mobile replacement for the horizontal HelmModuleNav strip.
 *
 * Mirrors the desktop nav's two-tier structure so the two feel congruent:
 * the same three primary modules (Turnovers, Work, Messaging) sit at the
 * top as the daily-use set, then everything else lives under a "More"
 * section that is the identical overflow set the desktop "More" dropdown
 * shows (HELM_MODULES minus the primary tabs minus the Financials
 * sub-tabs). Both surfaces read from the same source, which is what keeps
 * them in sync.
 *
 * Unlike desktop, the More set isn't collapsed behind a click: a phone's
 * menu is already a dedicated full-screen sheet with room to scroll, so
 * hiding half of it behind another tap would add friction without saving
 * space. The hierarchy (primary up top, the rest demoted under a label)
 * carries the "consolidated" feel; the single vertical sheet keeps every
 * page one tap away with no horizontal swipe or nested dropdown.
 *
 * CSS in globals.css governs visibility: the trigger is `display: none` by
 * default and only flips on at `@media (max-width: 640px)`. Desktop keeps
 * HelmModuleNav unchanged.
 *
 * Active modules link out, parked modules render dimmed (still real
 * routes), soon modules render dimmed and inert, externals open in a new
 * tab. The current page is highlighted so the user can see where they are.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { HELM_MODULES, PRIMARY_MODULES, type HelmModule } from '@/lib/helm-modules';
import { MessagingPendingBadge } from './MessagingPendingBadge';

type Props = {
  current?: string;
};

export function HelmMobileMenu({ current }: Props) {
  const [open, setOpen] = useState(false);

  // Same split the desktop nav uses (HelmModuleNav + HelmModuleNavMore):
  // the primary trio, then everything else minus the hidden Financials
  // sub-tabs. Deriving both from the same data is what makes the two
  // surfaces congruent instead of two hand-maintained lists.
  const primaryIds = new Set(PRIMARY_MODULES.map((m) => m.id));
  const overflow: HelmModule[] = HELM_MODULES.filter(
    (m) => !primaryIds.has(m.id) && !m.hidden,
  );

  // Lock body scroll + listen for Escape while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="rt-mobile-menu-trigger"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
      >
        <span aria-hidden="true" className="rt-mobile-menu-icon">
          <span />
          <span />
          <span />
        </span>
        <span className="rt-mobile-menu-label">Menu</span>
      </button>

      {open && (
        <div
          className="rt-mobile-menu-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Helm modules"
        >
          <div className="rt-mobile-menu-header">
            <Link
              href="/"
              onClick={() => setOpen(false)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/rising-tide-logo.png"
                alt="Rising Tide"
                style={{ width: 28, height: 28, display: 'block' }}
              />
              <span
                className="font-serif"
                style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ink)' }}
              >
                Helm
              </span>
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              style={{
                background: 'transparent',
                border: '1px solid var(--rule)',
                width: 36,
                height: 36,
                fontSize: 18,
                lineHeight: 1,
                color: 'var(--ink-3)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              ✕
            </button>
          </div>

          <nav className="rt-mobile-menu-list" aria-label="Modules">
            {/* Primary trio: the daily-use tabs, same as desktop. */}
            {PRIMARY_MODULES.map((m) => (
              <ModuleItem
                key={m.id}
                module={m}
                active={m.id === current}
                prominent
                onPick={() => setOpen(false)}
              />
            ))}

            {/* Everything else, demoted under a label - the desktop
                "More" dropdown's contents, laid out inline here. */}
            <div className="rt-mobile-menu-group-label">More</div>
            {overflow.map((m) => (
              <ModuleItem
                key={m.id}
                module={m}
                active={m.id === current}
                onPick={() => setOpen(false)}
              />
            ))}
          </nav>
        </div>
      )}
    </>
  );
}

function ModuleItem({
  module: m,
  active,
  prominent = false,
  onPick,
}: {
  module: HelmModule;
  active: boolean;
  prominent?: boolean;
  onPick: () => void;
}) {
  // 'parked' modules are real routes that just render dimmer and sort
  // to the bottom of the list. Only true 'soon' (no page) is inert.
  const dim = m.status === 'soon' || m.status === 'parked';

  // The Messaging row carries the same pending-draft badge the desktop
  // tab does, so the "something's waiting" signal is visible on phones too.
  const badge = m.id === 'messaging' ? <MessagingPendingBadge /> : null;

  // Numbers (and the 08a sub-module quirk) were dropped from this menu to
  // match the desktop More dropdown - the canonical module numbers only
  // make sense on the home page where the full set reads as a table of
  // contents. Here every row is just title + status badge. Primary rows
  // render a touch larger so the daily-use trio reads as the lead tier.
  const content = (
    <div
      className="rt-mobile-menu-row"
      style={{
        background: active ? 'var(--paper-2)' : 'transparent',
        opacity: dim ? 0.45 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="font-serif"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            fontSize: prominent ? 19 : 16,
            fontWeight: 500,
            color: 'var(--ink)',
            letterSpacing: '-0.01em',
            lineHeight: 1.2,
          }}
        >
          {m.title}
          {badge}
          {m.status === 'soon' && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 9,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                color: 'var(--ink-4)',
                fontFamily: 'var(--font-inter), system-ui, sans-serif',
              }}
            >
              Soon
            </span>
          )}
          {m.status === 'external' && (
            <span
              aria-hidden="true"
              style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-4)' }}
            >
              ↗
            </span>
          )}
        </div>
      </div>
      {active && (
        <span
          aria-hidden="true"
          style={{
            fontSize: 9,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            fontWeight: 600,
            color: 'var(--signal)',
          }}
        >
          Here
        </span>
      )}
    </div>
  );

  if (m.status === 'external') {
    return (
      <a
        href={m.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onPick}
        style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
      >
        {content}
      </a>
    );
  }

  if (m.status === 'active' || m.status === 'parked') {
    return (
      <Link
        href={m.href}
        onClick={onPick}
        style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
      >
        {content}
      </Link>
    );
  }

  return content;
}
