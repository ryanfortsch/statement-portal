'use client';

/**
 * Small Cmd+K trigger shown in the HelmMasthead, next to the user menu.
 * Opens the global command palette (Search mode) via a custom DOM event,
 * so it works without prop drilling. Visible on every page.
 *
 * The home page has its own inline Ask Helm panel and no longer uses this
 * trigger.
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
      aria-label="Search Helm"
      title="Search Helm (⌘K)"
      className="rt-helm-search-trigger"
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
