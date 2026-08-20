'use client';

/**
 * Month jump for the occupancy calendar: a native select styled to sit in
 * the editorial tab row. Picking a month navigates to ?calm=YYYY-MM (the
 * server rebuilds the grid as exactly that month); the blank option returns
 * to the rolling today-anchored window. Props are plain strings so this
 * client island never imports server-only code.
 */

import { useRouter } from 'next/navigation';

export function CalendarMonthSelect({
  months,
  value,
  monthHrefTemplate,
  clearHref,
}: {
  months: { value: string; label: string }[];
  /** Currently selected month ("2026-09") or '' when in the rolling view. */
  value: string;
  /** opsHref with __M__ where the month value belongs. */
  monthHrefTemplate: string;
  /** Href that exits month mode (rolling window, anchored today). */
  clearHref: string;
}) {
  const router = useRouter();
  return (
    <select
      aria-label="Jump to month"
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        router.push(v ? monthHrefTemplate.replace('__M__', v) : clearHref, { scroll: false });
      }}
      style={{
        appearance: 'none',
        WebkitAppearance: 'none',
        font: 'inherit',
        fontSize: 11,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        fontWeight: 500,
        color: value ? 'var(--ink)' : 'var(--ink-4)',
        background: 'transparent',
        border: 'none',
        borderBottom: value ? '2px solid var(--signal)' : '2px solid transparent',
        borderRadius: 0,
        padding: '0 14px 3px 0',
        cursor: 'pointer',
        // Tiny chevron so it reads as a control without a boxed-in look.
        backgroundImage:
          'url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%228%22 height=%225%22 viewBox=%220 0 8 5%22><path d=%22M0 0l4 5 4-5z%22 fill=%22%238ba0b4%22/></svg>")',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0 top 45%',
      }}
    >
      <option value="">Month</option>
      {months.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
