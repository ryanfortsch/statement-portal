'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A guest review body that shows two lines and expands on tap. The "More"
 * control only appears when the text actually overflows those two lines
 * (measured, not guessed by character count), so a short review never gets a
 * pointless toggle.
 */
const CLAMPED: React.CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

export function ReviewText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      // Only meaningful while clamped; once open the box grows to fit.
      if (!open) setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [text, open]);

  return (
    <>
      <p
        ref={ref}
        style={{
          fontSize: 14,
          color: 'var(--ink-3)',
          lineHeight: 1.6,
          margin: '8px 0 0',
          ...(open ? {} : CLAMPED),
        }}
      >
        &ldquo;{text}&rdquo;
      </p>
      {(overflows || open) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '6px 0 0',
            font: 'inherit',
            fontSize: 12.5,
            fontWeight: 600,
            color: 'var(--tide-deep)',
          }}
        >
          {open ? 'Less' : 'More'}
        </button>
      )}
    </>
  );
}
