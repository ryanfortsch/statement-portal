/**
 * The Helm page head: eyebrow + serif title, right under the masthead.
 *
 * `plain` is the operations page head (Phase 1 of the 2026-10-17 audit): the
 * title is the nav name (the tab or breadcrumb the person clicked: "Channels",
 * "Contracts"; a detail page leads with the entity's name), with no italic
 * accent and no explainer. `line` is the one fact under it that earns the spot
 * ("18 live agreements across 22 homes."), or nothing. Every operations page
 * uses it; `page-titles-nav-names.test.ts` holds them to it.
 *
 * Without `plain` it is the editorial headline, kept for the home page's
 * "Today" and the statement upload step:
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
  /** Headline text up to the emphasis. Plain: the nav name. */
  title: string;
  /** The operations page head: nav-name title, working size, no accent. */
  plain?: boolean;
  /** Plain only: the one load-bearing line under the title, if any. */
  line?: ReactNode;
  /** Italic, tide-deep emphasis word(s). */
  emphasis?: string;
  /** Headline tail after the emphasis (rare, e.g. "are doing."). */
  titleSuffix?: string;
  /** Optional supporting paragraph under the headline. */
  description?: string;
  /** Slot for extra content directly under the description. */
  belowDescription?: ReactNode;
  /**
   * Top padding override. Defaults to 56px editorial, 32px plain.
   * Some pages (e.g. property detail) want a tighter top because they sit
   * below a back link.
   */
  paddingTop?: number;
  /** Bottom padding override. Defaults to 28px editorial, 20px plain. */
  paddingBottom?: number;
};

export function HelmHero({
  eyebrow,
  title,
  plain = false,
  line,
  emphasis,
  titleSuffix,
  description,
  belowDescription,
  paddingTop,
  paddingBottom,
}: Props) {
  if (plain) {
    return (
      <section
        className="max-w-[1100px] mx-auto px-10 rt-helm-hero rt-helm-hero-plain"
        style={{ paddingTop: paddingTop ?? 32, paddingBottom: paddingBottom ?? 20, width: '100%' }}
      >
        <div className="eyebrow" style={{ marginBottom: 10 }}>{eyebrow}</div>
        <h1
          className="font-serif rt-helm-hero-h1"
          style={{
            fontSize: 32,
            lineHeight: 1.1,
            fontWeight: 400,
            letterSpacing: '-0.015em',
            color: 'var(--ink)',
            margin: 0,
          }}
        >
          {title}
        </h1>
        {line ? (
          <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--ink-3)' }}>{line}</p>
        ) : null}
        {belowDescription}
      </section>
    );
  }
  return (
    <section
      className="max-w-[1100px] mx-auto px-10 rt-helm-hero"
      style={{ paddingTop: paddingTop ?? 56, paddingBottom: paddingBottom ?? 28, width: '100%' }}
    >
      <div className="eyebrow" style={{ marginBottom: 14 }}>{eyebrow}</div>
      <h1
        className="font-serif rt-helm-hero-h1"
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
