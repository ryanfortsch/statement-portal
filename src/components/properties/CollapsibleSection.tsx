import type { ReactNode } from 'react';

type Props = {
  title: string;
  /**
   * Glanceable headline rendered on the right side of the closed (and open)
   * header — e.g. "Last walk Mar 12 · 4 issues". Keep it short.
   */
  summary?: ReactNode;
  /** Render expanded on first paint. Default false. */
  defaultOpen?: boolean;
  /** Optional id so a section can be deep-linked via `#anchor` in a URL. */
  id?: string;
  /** Tone for the small expand affordance. */
  affordance?: 'show' | 'expand' | 'open';
  children: ReactNode;
};

const AFFORDANCE_LABELS: Record<NonNullable<Props['affordance']>, [string, string]> = {
  show: ['Show ↓', 'Hide ↑'],
  expand: ['Expand ↓', 'Collapse ↑'],
  open: ['Open ↓', 'Close ↑'],
};

const css = `
  details.rt-collapsible > summary { list-style: none; cursor: pointer; outline-offset: 4px; }
  details.rt-collapsible > summary::-webkit-details-marker { display: none; }
  details.rt-collapsible > summary:hover .rt-collapsible-title { color: var(--signal); }
  details.rt-collapsible > summary .rt-collapsible-when-closed { display: inline; }
  details.rt-collapsible > summary .rt-collapsible-when-open { display: none; }
  details.rt-collapsible[open] > summary .rt-collapsible-when-closed { display: none; }
  details.rt-collapsible[open] > summary .rt-collapsible-when-open { display: inline; }
  details.rt-collapsible > summary .rt-chev { display: inline-block; transition: transform 0.18s ease; transform-origin: 50% 55%; }
  details.rt-collapsible[open] > summary .rt-chev { transform: rotate(90deg); }
`;

/**
 * Editorial collapsible section, server-rendered via the native `<details>`
 * element. No client JS; toggling is a browser-native operation. Browser
 * find-in-page (Cmd+F) auto-expands matching content.
 *
 * Visual contract: matches the existing property-page section pattern —
 * one-pixel hairline rule above the header, serif h2 on the left, small
 * chevron + summary chip + show/hide affordance on the right. Closed state
 * still shows the at-a-glance summary so the page stays scannable.
 */
export function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  id,
  affordance = 'show',
  children,
}: Props) {
  const [closedLabel, openLabel] = AFFORDANCE_LABELS[affordance];

  return (
    <>
      <style>{css}</style>
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 36, width: '100%' }}>
        <details
          id={id}
          open={defaultOpen}
          className="rt-collapsible"
          style={{ borderTop: '1px solid var(--ink)' }}
        >
          <summary
            style={{
              padding: '14px 0 12px',
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <h2
              className="font-serif rt-collapsible-title"
              style={{
                fontSize: 22,
                fontWeight: 400,
                letterSpacing: '-0.01em',
                color: 'var(--ink)',
                margin: 0,
                display: 'flex',
                alignItems: 'baseline',
                gap: 12,
                transition: 'color 0.15s ease',
              }}
            >
              <span className="rt-chev" aria-hidden="true" style={{ fontSize: 14, color: 'var(--ink-3)' }}>▸</span>
              {title}
            </h2>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: 14,
                flexWrap: 'wrap',
                rowGap: 4,
              }}
            >
              {summary != null && (
                // Quiet lowercase meta, not an uppercase eyebrow — six of
                // these stack per tab, and "7 OF 49 FIELDS POPULATED" in
                // small caps read as a page full of shouting.
                <span style={{ fontSize: 12, color: 'var(--ink-4)', letterSpacing: '.02em' }}>
                  {summary}
                </span>
              )}
              <span
                aria-hidden="true"
                style={{
                  fontSize: 10,
                  letterSpacing: '.18em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-4)',
                  fontWeight: 500,
                }}
              >
                <span className="rt-collapsible-when-closed">{closedLabel}</span>
                <span className="rt-collapsible-when-open">{openLabel}</span>
              </span>
            </span>
          </summary>
          <div style={{ paddingTop: 6, paddingBottom: 22 }}>{children}</div>
        </details>
      </section>
    </>
  );
}

/**
 * Compact variant for stacking inside a parent CollapsibleSection — half the
 * vertical chrome, smaller header, no outer max-width wrapper. Use this for
 * the six operational subgroups (Specs, Utilities, STR setup, …) so the
 * parent holds the page-width container.
 */
export function CollapsibleSubSection({
  title,
  summary,
  defaultOpen = false,
  id,
  children,
}: Omit<Props, 'affordance'>) {
  return (
    <>
      <style>{css}</style>
      <details
        id={id}
        open={defaultOpen}
        className="rt-collapsible"
        style={{ borderTop: '1px solid var(--rule)' }}
      >
        <summary
          style={{
            padding: '12px 0 10px',
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <h3
            className="font-serif rt-collapsible-title"
            style={{
              fontSize: 16,
              fontWeight: 400,
              letterSpacing: '-0.005em',
              color: 'var(--ink)',
              margin: 0,
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              transition: 'color 0.15s ease',
            }}
          >
            <span className="rt-chev" aria-hidden="true" style={{ fontSize: 12, color: 'var(--ink-4)' }}>▸</span>
            {title}
          </h3>
          {summary != null && (
            <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.02em' }}>
              {summary}
            </span>
          )}
        </summary>
        <div style={{ paddingTop: 6, paddingBottom: 16 }}>{children}</div>
      </details>
    </>
  );
}
