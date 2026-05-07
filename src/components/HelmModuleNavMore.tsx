'use client';

/**
 * Dropdown that surfaces every Helm module not in the primary masthead
 * nav. Lives at the end of HelmModuleNav so anything not on the main
 * tab strip (Properties, Marketing, Forecast, Guest Intel, Admin, etc.)
 * is one click away instead of only reachable via Cmd+K or direct URL.
 *
 * Closes on Esc or click-outside. Active modules link out; soon modules
 * render dimmed and non-clickable.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { HELM_MODULES, PRIMARY_MODULES, type HelmModule } from '@/lib/helm-modules';

type Props = {
  current?: string;
};

export function HelmModuleNavMore({ current }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Everything that isn't already a tab on the masthead.
  const primaryIds = new Set(PRIMARY_MODULES.map((m) => m.id));
  const overflow: HelmModule[] = HELM_MODULES.filter((m) => !primaryIds.has(m.id));
  if (overflow.length === 0) return null;

  // Mark "More" as active if the current page is in the overflow set.
  const activeInMore = !!(current && overflow.some((m) => m.id === current));

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          fontWeight: 500,
          color: activeInMore || open ? 'var(--ink)' : 'var(--ink-3)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        More
        <span aria-hidden="true" style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 12px)',
            left: -14,
            zIndex: 60,
            minWidth: 280,
            background: 'var(--paper)',
            border: '1px solid var(--ink)',
            boxShadow: '0 14px 40px -16px rgba(30, 46, 52, 0.35)',
            padding: '6px 0',
          }}
        >
          {overflow.map((m) => (
            <ModuleItem key={m.id} module={m} active={m.id === current} onPick={() => setOpen(false)} />
          ))}
        </div>
      )}
    </div>
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
      style={{
        padding: '10px 16px',
        display: 'grid',
        gridTemplateColumns: '32px 1fr',
        gap: 12,
        alignItems: 'baseline',
        opacity: reachable ? 1 : 0.5,
        background: active ? 'var(--paper-2)' : 'transparent',
      }}
    >
      <span
        className="font-mono"
        style={{
          fontSize: 10,
          color: reachable ? 'var(--signal)' : 'var(--ink-4)',
          letterSpacing: '.08em',
        }}
      >
        {m.number}
      </span>
      <div>
        <div
          className="font-serif"
          style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', letterSpacing: '-0.01em' }}
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
                fontFamily: 'inherit',
              }}
            >
              Soon
            </span>
          )}
        </div>
        <div style={{ marginTop: 3, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.4 }}>
          {m.description}
        </div>
      </div>
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
