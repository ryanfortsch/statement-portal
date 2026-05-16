'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

const PRESETS: { value: string; label: string }[] = [
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

/** YYYY-MM keys for the specific-month list: 15 months back through 4 ahead. */
function buildMonthOptions(): { value: string; label: string }[] {
  const now = new Date();
  const out: { value: string; label: string }[] = [];
  for (let offset = 4; offset >= -15; offset--) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    });
  }
  return out;
}

function labelForValue(value: string): string {
  const preset = PRESETS.find((p) => p.value === value);
  if (preset) return preset.label;
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (m) {
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  }
  return 'This Month';
}

/**
 * Editorial range picker. Paper/ink button + custom popover (not a native
 * <select>). The popover lists the preset ranges, then a scrollable list of
 * specific calendar months.
 *
 * `value` is the raw ?range= param: a preset keyword (this_month, last_30,
 * ...) or a YYYY-MM string for a specific month. URL-synced via
 * router.replace inside useTransition.
 */
export function TimeRangePicker({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const months = useMemo(buildMonthOptions, []);
  const currentLabel = labelForValue(value);

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

  function pick(next: string) {
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
        <span style={{ fontStyle: 'italic', color: 'var(--tide-deep)' }}>{currentLabel}</span>
        <Caret open={open} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Date range"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 30,
            minWidth: 240,
            maxHeight: 360,
            overflowY: 'auto',
            background: 'var(--paper)',
            border: '1px solid var(--ink)',
            boxShadow: '0 12px 32px -16px rgba(30, 46, 52, 0.35)',
          }}
        >
          <ul style={{ margin: 0, padding: '6px 0', listStyle: 'none' }}>
            {PRESETS.map((p) => (
              <Option key={p.value} label={p.label} selected={p.value === value} onClick={() => pick(p.value)} />
            ))}
          </ul>

          <div
            className="eyebrow"
            style={{
              padding: '8px 18px 4px',
              color: 'var(--ink-4)',
              borderTop: '1px solid var(--rule)',
            }}
          >
            Specific month
          </div>
          <ul style={{ margin: 0, padding: '2px 0 6px', listStyle: 'none' }}>
            {months.map((m) => (
              <Option key={m.value} label={m.label} selected={m.value === value} onClick={() => pick(m.value)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Option({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <li role="option" aria-selected={selected}>
      <button
        type="button"
        onClick={onClick}
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
        <span>{label}</span>
        {selected && (
          <span aria-hidden="true" style={{ color: 'var(--signal)', fontSize: 13 }}>
            ●
          </span>
        )}
      </button>
    </li>
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
