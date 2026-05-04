'use client';

// Site + range selectors for /marketing. Both update the URL via
// router.push, which re-renders the server page with new searchParams.
// Pure client component, no state -- the URL is the state.

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

const RANGES = [
  { label: '7d', value: '7' },
  { label: '30d', value: '30' },
  { label: '90d', value: '90' },
];

type Props = {
  sites: { id: string; name: string }[];
  currentSite: string;
  currentRange: string;
  lastUpdatedISO: string | null;
};

export function FilterBar({ sites, currentSite, currentRange, lastUpdatedISO }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function update(key: 'site' | 'range', value: string) {
    const sp = new URLSearchParams(params.toString());
    sp.set(key, value);
    startTransition(() => router.push(`${pathname}?${sp.toString()}`));
  }

  const lastUpdatedLabel = lastUpdatedISO ? formatRelative(lastUpdatedISO) : 'no data yet';

  return (
    <div
      className="flex items-center justify-between"
      style={{
        borderTop: '1px solid var(--ink)',
        borderBottom: '1px solid var(--rule)',
        padding: '14px 0',
        gap: 24,
        flexWrap: 'wrap',
        opacity: isPending ? 0.6 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      <div className="flex items-center" style={{ gap: 16 }}>
        <Segmented
          options={[{ label: 'All', value: 'all' }, ...sites.map((s) => ({ label: s.name, value: s.id }))]}
          current={currentSite}
          onChange={(v) => update('site', v)}
        />
        <span style={{ width: 1, height: 14, background: 'var(--rule)' }} />
        <Segmented options={RANGES} current={currentRange} onChange={(v) => update('range', v)} />
      </div>
      <div
        className="font-mono"
        style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)' }}
      >
        Updated {lastUpdatedLabel}
      </div>
    </div>
  );
}

function Segmented({
  options,
  current,
  onChange,
}: {
  options: { label: string; value: string }[];
  current: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex" style={{ border: '1px solid var(--rule)', borderRadius: 0 }}>
      {options.map((o, i) => {
        const active = o.value === current;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              padding: '6px 12px',
              fontSize: 11,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              fontWeight: 500,
              background: active ? 'var(--ink)' : 'transparent',
              color: active ? 'var(--paper)' : 'var(--ink)',
              borderLeft: i === 0 ? 'none' : '1px solid var(--rule)',
              cursor: 'pointer',
              transition: 'background 0.12s',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}
