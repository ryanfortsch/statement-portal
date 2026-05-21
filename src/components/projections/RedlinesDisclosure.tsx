'use client';

import { useState, type ReactNode } from 'react';

/**
 * Launcher for the contract redlines panel.
 *
 * Replaces the old <details> disclosure — a small grey triangle labeled
 * "Apply owner redlines" that read like a footnote rather than a feature.
 * Dotti couldn't find the AI-redline tool because of it. This promotes
 * the launcher to a proper labeled, signal-colored button so the tool
 * reads as a first-class part of the contract workflow.
 *
 * Closed: solid signal-colored button (stands out, invites the click).
 * Open: outline button (recedes — the panel below is now the focus) +
 * a one-line explainer above the panel.
 *
 * The ContractRedlinesPanel is passed as children so this stays a thin
 * presentational wrapper with no knowledge of the panel internals.
 */
export function RedlinesDisclosure({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 14 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 9,
          background: open ? 'transparent' : 'var(--signal)',
          color: open ? 'var(--ink)' : 'var(--paper)',
          border: `1px solid ${open ? 'var(--ink)' : 'var(--signal)'}`,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          padding: '11px 18px',
          cursor: 'pointer',
        }}
      >
        <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>&#10022;</span>
        {open ? 'Hide owner redlines' : 'Apply owner redlines with Claude'}
      </button>
      {open && (
        <div style={{ paddingTop: 16 }}>
          <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 560 }}>
            Paste the owner&rsquo;s email or call notes below. Claude reads them and maps each request to a specific contract edit you can review, accept, or refine before applying.
          </p>
          {children}
        </div>
      )}
    </div>
  );
}
