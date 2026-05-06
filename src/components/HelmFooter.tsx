/**
 * The standard Helm module footer: thin top rule, two-up content row at
 * 1100px max width, small-caps left, italic-serif right.
 *
 * Default content: left = "Rising Tide · {module}", right = italic
 * tagline. Pages can pass `left` / `right` as children to swap in module-
 * specific content (e.g. Revenue uses an AutoRefresh on the left and a
 * date range label on the right).
 */

import type { ReactNode } from 'react';

type Props = {
  /** Used to build the default left text "Rising Tide · {module}". Ignored if `left` is passed. */
  module?: string;
  /** Override the left slot entirely. */
  left?: ReactNode;
  /** Override the right slot entirely. Defaults to the company tagline. */
  right?: ReactNode;
};

const DEFAULT_TAGLINE = 'We care for your home as if it were our own.';

export function HelmFooter({ module, left, right }: Props) {
  return (
    <footer style={{ borderTop: '1px solid var(--ink)' }}>
      <div
        className="max-w-[1100px] mx-auto px-10 flex items-center justify-between"
        style={{
          padding: '14px 40px',
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
        }}
      >
        <span>
          {left ?? `Rising Tide${module ? ` · ${module}` : ''}`}
        </span>
        <span
          className="font-serif"
          style={{
            textTransform: 'none',
            letterSpacing: 0,
            fontStyle: 'italic',
            color: 'var(--ink-3)',
            fontSize: 11,
          }}
        >
          {right ?? `“${DEFAULT_TAGLINE}”`}
        </span>
      </div>
    </footer>
  );
}
