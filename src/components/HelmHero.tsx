/**
 * The standard Helm module hero: eyebrow + serif headline + optional
 * description. Used at the top of every module page, right under the
 * masthead.
 *
 * The headline reads as "{title} {emphasis}{titleSuffix}", where `emphasis`
 * is rendered in italic + tide-deep color (the editorial accent we use
 * across the dashboard). For pages where the emphasis word is at the end of
 * the sentence (most), pass just `title` + `emphasis`. For pages where
 * emphasis is mid-sentence (e.g. Marketing: "How the *sites* are doing."),
 * pass `title` + `emphasis` + `titleSuffix` to wrap the rest.
 *
 * Pages that need richer secondary content under the hero (a date range,
 * action chips, etc.) can pass `belowDescription` as children. The grid
 * wrapping, hero spacing, and editorial type rhythm stay consistent.
 */

import type { ReactNode } from 'react';

type Props = {
  /** Small caps eyebrow above the headline, e.g. "Helm · Revenue". */
  eyebrow: string;
  /** Headline text up to the emphasis. */
  title: string;
  /** Italic, tide-deep emphasis word(s). */
  emphasis?: string;
  /** Headline tail after the emphasis (rare, e.g. "are doing."). */
  titleSuffix?: string;
  /** Optional supporting paragraph under the headline. */
  description?: string;
  /** Slot for extra content directly under the description. */
  belowDescription?: ReactNode;
  /**
   * Top padding override. Defaults to 56px to match the established rhythm.
   * Some pages (e.g. property detail) want a tighter top because they sit
   * below a back link.
   */
  paddingTop?: number;
  /** Bottom padding override. Defaults to 28px. */
  paddingBottom?: number;
};

export function HelmHero({
  eyebrow,
  title,
  emphasis,
  titleSuffix,
  description,
  belowDescription,
  paddingTop = 56,
  paddingBottom = 28,
}: Props) {
  return (
    <section
      className="max-w-[1100px] mx-auto px-10"
      style={{ paddingTop, paddingBottom, width: '100%' }}
    >
      <div className="eyebrow" style={{ marginBottom: 14 }}>{eyebrow}</div>
      <h1
        className="font-serif"
        style={{
          fontSize: 44,
          lineHeight: 1.05,
          fontWeight: 300,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          maxWidth: 720,
          margin: 0,
        }}
      >
        {title}
        {emphasis ? (
          <>
            {title ? ' ' : ''}
            <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>{emphasis}</em>
          </>
        ) : null}
        {titleSuffix ? ` ${titleSuffix}` : null}
      </h1>
      {description && (
        <p
          style={{
            marginTop: 14,
            fontSize: 14,
            lineHeight: 1.55,
            color: 'var(--ink-3)',
            maxWidth: 580,
          }}
        >
          {description}
        </p>
      )}
      {belowDescription}
    </section>
  );
}
