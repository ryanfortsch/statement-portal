'use client';

/**
 * Small button that opens the global Cmd+K command palette. Lives in
 * HelmMasthead so search is one tap away from any page (especially on
 * mobile, where the Cmd+K keyboard shortcut isn't reachable).
 *
 * Communicates with CommandPalette via a custom DOM event, so we don't
 * need to plumb open-state through any provider.
 */

import { useEffect, useState } from 'react';

export function CommandPaletteTrigger() {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(navigator.platform.toLowerCase().includes('mac'));
  }, []);

  function open() {
    window.dispatchEvent(new Event('helm:open-command-palette'));
  }

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Open search palette"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: 'transparent',
        border: '1px solid var(--rule)',
        padding: '4px 8px 4px 10px',
        cursor: 'pointer',
        color: 'var(--ink-3)',
        fontFamily: 'inherit',
        fontSize: 11,
        whiteSpace: 'nowrap',
      }}
    >
      <SearchIcon />
      <span>Search</span>
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
