'use client';

/**
 * Property filter for the turnover pipeline: a native select styled to sit
 * in the editorial header controls row, same treatment as the calendar's
 * month jump. Picking a property navigates to ?property=<id> via an href the
 * server built with opsHref, so the list range, calendar range, paging
 * offset, and month mode all survive; the blank option clears the filter.
 * Props are plain strings so this client island never imports server-only
 * code.
 */

import { useRouter } from 'next/navigation';

export function PropertyFilterSelect({
  properties,
  value,
  propertyHrefTemplate,
  clearHref,
}: {
  properties: { value: string; label: string }[];
  /** Currently filtered property id ("21_horton") or '' for all. */
  value: string;
  /** opsHref with __P__ where the property id belongs. */
  propertyHrefTemplate: string;
  /** Href that clears the filter (all properties). */
  clearHref: string;
}) {
  const router = useRouter();
  return (
    <select
      aria-label="Filter by property"
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        router.push(v ? propertyHrefTemplate.replace('__P__', v) : clearHref, { scroll: false });
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
      <option value="">All properties</option>
      {properties.map((p) => (
        <option key={p.value} value={p.value}>
          {p.label}
        </option>
      ))}
      {/* A handoff link can carry an id outside the options (inactive or
          non-operations property); surface it so the control never claims
          "All properties" while a filter is live. */}
      {value && !properties.some((p) => p.value === value) && (
        <option value={value}>{value}</option>
      )}
    </select>
  );
}
