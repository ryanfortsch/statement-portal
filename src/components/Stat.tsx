/**
 * The standard Helm stat cell. Used in every module's stat strip.
 *
 * Visual:
 *   LABEL (eyebrow)
 *   42                 [delta pill, optional]
 *   sub line, optional
 *
 * The cell can be a static block or wrap a Link if `href` is passed.
 * `accent` swaps the value color to --signal (used for the headline metric
 * in a strip, e.g. Owner Payout). `last` removes the right border so the
 * cell can sit at the end of a horizontal grid without doubling the rule.
 *
 * Replaces the per-page Stat copies that drifted in props (some had
 * `delta`, some had `sub`, some took `href`).
 */

import Link, { LinkProps } from 'next/link';
import type { ReactNode } from 'react';

type Size = 'default' | 'hero';

type Props = {
  label: string;
  value: ReactNode;
  /** Sub line under the value. */
  sub?: string;
  /**
   * Period-over-period change as a percentage (e.g. 18.5 → "+18.5%").
   * Positive renders in --positive, negative in --negative, zero hides.
   */
  delta?: number | null;
  /** Use the signal color for the value. Reserved for headline metrics. */
  accent?: boolean;
  /**
   * Override the value color directly. Wins over `accent`. Use for cases
   * like the inspection summary's Pass / Issue / N/A strip where each
   * cell maps to a domain-specific semantic color (positive / signal /
   * ink-4) rather than the single signal-accent pattern.
   */
  valueColor?: string;
  /** No right border. Pass on the last cell of a horizontal grid. */
  last?: boolean;
  /** Wraps the cell in a Next Link. */
  href?: LinkProps['href'];
  /**
   * Visual size. "default" = 22px serif value. "hero" = 28px (used on the
   * home dashboard at-a-glance strip).
   */
  size?: Size;
};

export function Stat({
  label,
  value,
  sub,
  delta,
  accent = false,
  valueColor,
  last = false,
  href,
  size = 'default',
}: Props) {
  const valueSize = size === 'hero' ? 28 : 22;
  const padding = size === 'hero' ? '20px 22px' : '20px 16px';

  const inner = (
    <div
      className="rt-helm-stat"
      style={{
        padding,
        borderRight: last ? 'none' : '1px solid var(--rule)',
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div className="flex items-baseline" style={{ gap: 8 }}>
        <div
          className="font-serif tabular-nums rt-helm-stat-value"
          style={{
            fontSize: valueSize,
            fontWeight: 400,
            color: valueColor ?? (accent ? 'var(--signal)' : 'var(--ink)'),
            lineHeight: 1.05,
          }}
        >
          {value}
        </div>
        {delta != null && delta !== 0 && (
          <span
            className="font-mono tabular-nums"
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: delta > 0 ? 'var(--positive)' : 'var(--negative)',
            }}
          >
            {delta > 0 ? '+' : ''}{delta.toFixed(0)}%
          </span>
        )}
      </div>
      {sub && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)' }}>{sub}</div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
        {inner}
      </Link>
    );
  }
  return inner;
}
