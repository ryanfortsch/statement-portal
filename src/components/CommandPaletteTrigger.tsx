'use client';

/**
 * Button that opens the global Cmd+K command palette. Used in two
 * places:
 *
 *   - HelmMasthead (variant: 'masthead', default) — small, rule-bordered
 *     trigger sitting next to the user menu. Visible on every page.
 *   - The home page (variant: 'prominent') — a larger sibling to the
 *     "What's on for you" CTA. Replaces the inline live search input.
 *
 * Communicates with CommandPalette via a custom DOM event, so any
 * button can open the palette without prop drilling.
 */

import { useEffect, useState } from 'react';

type Props = {
  variant?: 'masthead' | 'prominent';
};

export function CommandPaletteTrigger({ variant = 'masthead' }: Props) {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(navigator.platform.toLowerCase().includes('mac'));
  }, []);

  function open() {
    window.dispatchEvent(new Event('helm:open-command-palette'));
  }

  if (variant === 'prominent') {
    return (
      <button
        type="button"
        onClick={open}
        aria-label="Open search palette"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 12,
          background: 'var(--paper)',
          border: '1px solid var(--ink)',
          padding: '8px 14px',
          cursor: 'pointer',
          color: 'var(--ink)',
          fontFamily: 'inherit',
          fontSize: 12,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 240,
          justifyContent: 'space-between',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <SearchIcon />
          <span>Search Helm</span>
        </span>
        <kbd
          className="font-mono"
          style={{
            fontSize: 10,
            color: 'var(--ink-4)',
            background: 'var(--paper-2)',
            padding: '1px 7px',
            letterSpacing: 0,
            fontFamily: 'inherit',
            fontWeight: 400,
          }}
        >
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Open search palette"
      title="Search Helm (⌘K)"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'transparent',
        border: '1px solid var(--rule)',
        padding: '4px 8px',
        cursor: 'pointer',
        color: 'var(--ink-3)',
        fontFamily: 'inherit',
        fontSize: 11,
        whiteSpace: 'nowrap',
      }}
    >
      <SearchIcon />
      <kbd
        className="font-mono"
        style={{
          fontSize: 10,
          color: 'var(--ink-4)',
          background: 'var(--paper-2)',
          padding: '1px 6px',
          letterSpacing: 0,
          fontFamily: 'inherit',
        }}
      >
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>
    </button>
  );
}

function SearchIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
