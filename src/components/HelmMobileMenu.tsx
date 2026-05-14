'use client';

/**
 * The mobile replacement for the horizontal HelmModuleNav strip. On phones
 * the strip required a horizontal swipe to reach "More", and reaching a
 * specific page like /reviews meant scrolling, tapping More, then picking
 * from a dropdown that lived inside the scrolling element. This component
 * collapses that to a single "Menu" trigger in the masthead that opens a
 * full-viewport sheet listing every module in one vertical list.
 *
 * CSS in globals.css governs visibility: the trigger is `display: none` by
 * default and only flips on at `@media (max-width: 640px)`. Desktop keeps
 * HelmModuleNav unchanged.
 *
 * Active modules link out, soon modules render dimmed and inert, externals
 * open in a new tab. The current page is highlighted so the user can see
 * where they are inside the menu.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { HELM_MODULES, type HelmModule } from '@/lib/helm-modules';

type Props = {
  current?: string;
};

export function HelmMobileMenu({ current }: Props) {
  const [open, setOpen] = useState(false);

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
            {HELM_MODULES.map((m) => (
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
  onPick,
}: {
  module: HelmModule;
  active: boolean;
  onPick: () => void;
}) {
  const reachable = m.status === 'active' || m.status === 'external';

  const content = (
    <div
      className="rt-mobile-menu-row"
      style={{
        background: active ? 'var(--paper-2)' : 'transparent',
        opacity: reachable ? 1 : 0.45,
      }}
    >
      <span
        className="font-mono"
        style={{
          fontSize: 11,
          color: reachable ? 'var(--signal)' : 'var(--ink-4)',
          letterSpacing: '.08em',
          width: 32,
          flexShrink: 0,
        }}
      >
        {m.number}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="font-serif"
          style={{
            fontSize: 18,
            fontWeight: 500,
            color: 'var(--ink)',
            letterSpacing: '-0.01em',
            lineHeight: 1.2,
          }}
        >
          {m.title}
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

  if (m.status === 'active') {
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
