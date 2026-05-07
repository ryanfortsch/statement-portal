'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { RangePreset } from '@/lib/revenue-date-range';

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'mtd', label: 'Month to Date' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'last_30', label: 'Last 30 Days' },
  { value: 'last_90', label: 'Last 90 Days' },
  { value: 'ytd', label: 'Year to Date' },
  { value: 'full_year', label: `Full Year ${new Date().getFullYear()}` },
  { value: 'next_month', label: 'Next Month' },
  { value: 'next_90', label: 'Next 90 Days' },
];

/**
 * Editorial range picker. Renders as a paper/ink button with a Fraunces label
 * and a custom popover panel — not a native <select>, so the dropdown UI
 * matches the rest of the dashboard instead of the OS chrome.
 *
 * URL-synced: writing to ?range=<preset> via router.replace, wrapped in
 * useTransition so the page re-renders without a full reload.
 */
export function TimeRangePicker({ value }: { value: RangePreset }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const current = PRESETS.find((p) => p.value === value) ?? PRESETS[1];

  // Close on click-outside or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(next: RangePreset) {
    setOpen(false);
    if (next === value) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('range', next);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="font-serif"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 12,
          background: 'var(--paper)',
          border: '1px solid var(--ink)',
          color: 'var(--ink)',
          fontSize: 16,
          fontWeight: 400,
          letterSpacing: '-0.005em',
          padding: '8px 14px 8px 16px',
          cursor: pending ? 'wait' : 'pointer',
          opacity: pending ? 0.6 : 1,
          lineHeight: 1.2,
        }}
      >
        <span
          className="eyebrow"
          style={{ color: 'var(--ink-4)', fontWeight: 500, fontFamily: 'var(--font-sans, inherit)' }}
        >
          Range
        </span>
        <span style={{ fontStyle: 'italic', color: 'var(--tide-deep)' }}>
          {current.label}
        </span>
        <Caret open={open} />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Range presets"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 30,
            margin: 0,
            padding: '6px 0',
            minWidth: 240,
            listStyle: 'none',
            background: 'var(--paper)',
            border: '1px solid var(--ink)',
            boxShadow: '0 12px 32px -16px rgba(30, 46, 52, 0.35)',
          }}
        >
          {PRESETS.map((p) => {
            const selected = p.value === value;
            return (
              <li key={p.value} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => pick(p.value)}
                  className="font-serif"
                  style={{
                    display: 'flex',
                    width: '100%',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 16,
                    padding: '9px 18px',
                    background: 'transparent',
                    border: 'none',
                    color: selected ? 'var(--tide-deep)' : 'var(--ink)',
                    fontSize: 15,
                    fontStyle: selected ? 'italic' : 'normal',
                    fontWeight: selected ? 500 : 400,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(30, 46, 52, 0.04)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span>{p.label}</span>
                  {selected && (
                    <span aria-hidden="true" style={{ color: 'var(--signal)', fontSize: 13 }}>
                      ●
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 20 20"
      fill="none"
      style={{
        marginLeft: 2,
        transition: 'transform 120ms ease',
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
      }}
      aria-hidden="true"
    >
      <path
        d="M5 8l5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
