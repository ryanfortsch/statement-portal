/**
 * The standard Helm content section: serif h2 + small-caps eyebrow on the
 * right, optional right-slot for actions (sync buttons, filters), thin
 * black rule under the head, and either a children block or an empty-state
 * line.
 *
 * Promoted out of the property detail page, where it was originally
 * defined inline. Now used across modules so section heads stay aligned
 * on type, weight, padding, and rule.
 */

import type { ReactNode } from 'react';

type Props = {
  /** Anchor id on the section wrapper. Used by sticky in-page nav. */
  id?: string;
  /** Section title (serif h2). */
  title: string;
  /** Optional eyebrow shown to the right of the title. */
  eyebrow?: string;
  /** Optional action slot to the right of the title (e.g. a Sync button). */
  right?: ReactNode;
  /** True when there is no data to render. Shows `emptyMessage` instead of `children`. */
  empty?: boolean;
  /** Copy shown when `empty` is true. */
  emptyMessage?: string;
  /** Top padding. Defaults match the existing rhythm at 24px. */
  paddingTop?: number;
  /** Bottom padding. Defaults to 48px. */
  paddingBottom?: number;
  children?: ReactNode;
};

export function Section({
  id,
  title,
  eyebrow,
  right,
  empty = false,
  emptyMessage = '',
  paddingTop = 24,
  paddingBottom = 48,
  children,
}: Props) {
  return (
    <section
      id={id}
      className="max-w-[1100px] mx-auto px-10"
      style={{ paddingTop, paddingBottom, width: '100%', scrollMarginTop: 100 }}
    >
      <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
        <h2
          className="font-serif"
          style={{
            fontSize: 22,
            fontWeight: 400,
            letterSpacing: '-0.01em',
            color: 'var(--ink)',
            margin: 0,
          }}
        >
          {title}
        </h2>
        {(right || eyebrow) && (
          <div className="flex items-center" style={{ gap: 16 }}>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            {right}
          </div>
        )}
      </div>
      {empty ? (
        <div
          style={{
            borderTop: '1px solid var(--ink)',
            padding: '20px 0',
            fontSize: 12,
            color: 'var(--ink-4)',
          }}
        >
          {emptyMessage}
        </div>
      ) : (
        children
      )}
    </section>
  );
}
