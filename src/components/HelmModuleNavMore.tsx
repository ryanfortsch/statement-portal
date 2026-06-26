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
import { getGroupedOverflowModules, type HelmModule } from '@/lib/helm-modules';

type Props = {
  current?: string;
};

export function HelmModuleNavMore({ current }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

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

  // Everything that isn't already a tab on the masthead, minus modules
  // hidden because they're tabs of a parent section (Statements / Revenue /
  // Forecast etc. live under Financials). Use the grouping helper for its
  // ORDER (Money -> Operations -> Growth -> Relationships -> Reference ->
  // Soon clusters related items) but render flat: a previous pass added
  // visible section headers and the resulting dropdown was nearly half the
  // viewport tall with six small-caps labels burning vertical real estate
  // on a ~14-item list. The implicit grouping reads fine without them.
  const items: HelmModule[] = getGroupedOverflowModules().flatMap((s) => s.modules);
  if (items.length === 0) return null;

  // Mark "More" as active if the current page is anywhere in the overflow.
  const activeInMore = !!(current && items.some((m) => m.id === current));

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
          {items.map((m) => (
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
  // 'parked' is a real route just like 'active' — it just renders
  // dimmer and sorts to the bottom of the dropdown. Only true 'soon'
  // (no page built yet) is unreachable.
  const dim = m.status === 'soon' || m.status === 'parked';

  // Numbers were dropped from the More dropdown - the canonical module
  // numbers live in helm-modules.ts and read fine on the home page where
  // every module renders in sequence, but here (filtered to non-primary
  // modules) they read as a broken list with gaps at 02/04/05/06/08 plus
  // the 08a sub-module for Guest Intel. Title-only is cleaner.
  const content = (
    <div
      style={{
        padding: '7px 18px',
        opacity: dim ? 0.5 : 1,
        background: active ? 'var(--paper-2)' : 'transparent',
      }}
    >
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
