'use client';

/**
 * Global Cmd+K (Ctrl+K) command palette. Mounted in the root layout so
 * it's reachable from every page. Wraps the same UniversalSearch
 * experience used inline on the home page.
 *
 * Open/close:
 *   - Cmd+K (Mac) or Ctrl+K (everywhere else) toggles.
 *   - Esc closes (UniversalSearch handles its own Esc on the input;
 *     this component also closes on Esc when the input isn't focused).
 *   - Clicking the backdrop closes.
 *   - Selecting a result auto-closes (via UniversalSearch's router.push
 *     and our open=false on route change).
 *
 * The palette renders nothing when closed, so there's zero overhead on
 * routes that don't open it.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { UniversalSearch } from './UniversalSearch';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const lastPath = useRef(pathname);

  // Close automatically when the route changes (i.e., user picked a result).
  useEffect(() => {
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      setOpen(false);
    }
  }, [pathname]);

  // Global key listener: Cmd/Ctrl+K toggles. Esc closes from anywhere
  // (the inner input also handles Esc, but this catches edge cases).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isModK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isModK) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Custom event so a button anywhere in the app (e.g., a search icon
  // in the masthead) can open the palette without prop drilling.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('helm:open-command-palette', onOpen);
    return () => window.removeEventListener('helm:open-command-palette', onOpen);
  }, []);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Helm command palette"
      onMouseDown={(e) => {
        // Close on backdrop click (but not when clicking inside the panel).
        if (e.target === e.currentTarget) setOpen(false);
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(30, 46, 52, 0.45)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '12vh',
        paddingLeft: 16,
        paddingRight: 16,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 640,
          background: 'var(--paper)',
          border: '1px solid var(--ink)',
          boxShadow: '0 24px 60px -20px rgba(30, 46, 52, 0.45)',
          padding: 14,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <UniversalSearch
          autoFocus
          placeholder="Search Helm or jump to a page…"
        />
      </div>
    </div>
  );
}
