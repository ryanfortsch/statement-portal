'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A right-side drawer over the page: an editor too long to open inline
 * (the amenity catalog, a home's automation rules) slides in here and the
 * page under it stays put. Escape, the close button and the backdrop all
 * close it; focus moves in on open and returns to the opener on close.
 *
 * It sits above the masthead (z-50) and the property tab strip, so its
 * header is never covered. Render it only while open.
 */
export function Drawer({
  title,
  eyebrow,
  onClose,
  children,
  width = 520,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const panel = useRef<HTMLElement | null>(null);
  // The latest onClose without re-running the effect, so a parent that
  // passes a fresh arrow each render does not steal focus back on every key.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);

  return (
    <>
      <div
        aria-hidden="true"
        onClick={() => close.current()}
        style={{ position: 'fixed', inset: 0, background: 'rgba(11,37,69,0.18)', zIndex: 70 }}
      />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: `min(${width}px, 100vw)`,
          background: 'var(--paper)',
          borderLeft: '1px solid var(--ink)',
          boxShadow: '-12px 0 40px rgba(11,37,69,0.12)',
          padding: '24px 24px 40px',
          overflowY: 'auto',
          zIndex: 71,
          color: 'var(--ink)',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
          {eyebrow ? <div className="eyebrow">{eyebrow}</div> : <span />}
          <button
            type="button"
            onClick={() => close.current()}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ink-3)', lineHeight: 1, padding: 4 }}
          >
            ×
          </button>
        </div>
        <h3 className="font-serif" style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-0.01em', margin: '0 0 18px' }}>
          {title}
        </h3>
        {children}
      </aside>
    </>
  );
}
