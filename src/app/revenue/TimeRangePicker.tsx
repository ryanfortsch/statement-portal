'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';
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

export function TimeRangePicker({ value }: { value: RangePreset }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(next: RangePreset) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('range', next);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <span className="eyebrow">Range</span>
      <select
        value={value}
        onChange={(e) => update(e.target.value as RangePreset)}
        disabled={pending}
        className="font-serif"
        style={{
          background: 'transparent',
          border: '1px solid var(--rule)',
          color: 'var(--ink)',
          fontSize: 15,
          fontWeight: 500,
          padding: '4px 24px 4px 10px',
          outline: 'none',
          cursor: pending ? 'wait' : 'pointer',
          appearance: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%23506068' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 6px center',
          backgroundSize: '14px',
          opacity: pending ? 0.6 : 1,
        }}
      >
        {PRESETS.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>
    </div>
  );
}
