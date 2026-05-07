/**
 * Generic loading skeleton for Helm module pages. Mounted via per-route
 * loading.tsx files so Next.js renders this instead of a white flash
 * while the server-rendered page is fetching data.
 *
 * Renders the real HelmMasthead (no data needed) plus paper-2-toned
 * placeholder blocks for the hero and the first content section. When
 * the actual page resolves, Next.js swaps this content out; because
 * the masthead markup is identical in both, it stays visible without
 * a layout reset.
 */

import { HelmMasthead } from './HelmMasthead';

type Props = {
  /** Module nav highlight, matches the active page's `current` prop. */
  current?: string;
  /** Eyebrow text (matches the page's HelmHero eyebrow). */
  eyebrow?: string;
  /** Approximate width of the hero headline placeholder. */
  headlineWidth?: number;
  /**
   * How many placeholder rows to render in the first content section.
   * Default 4 reads as a stat strip; bump higher for list-heavy pages.
   */
  contentRows?: number;
};

export function HelmLoading({
  current,
  eyebrow = 'Loading…',
  headlineWidth = 380,
  contentRows = 4,
}: Props) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead current={current} />

      {/* HERO placeholder */}
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}
      >
        <div
          className="eyebrow"
          style={{ marginBottom: 14, color: 'var(--ink-4)', opacity: 0.7 }}
        >
          {eyebrow}
        </div>
        <Block height={48} width={headlineWidth} />
        <Block height={14} width={Math.min(headlineWidth + 60, 580)} mt={18} />
      </section>

      {/* FIRST SECTION placeholder (stat strip / list) */}
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ width: '100%', paddingBottom: 56 }}
      >
        <Block height={14} width={120} mb={14} />
        <div
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
          }}
        >
          {Array.from({ length: contentRows }).map((_, i) => (
            <div
              key={i}
              style={{
                padding: '20px 16px',
                borderBottom:
                  i === contentRows - 1 ? 'none' : '1px solid var(--rule)',
                display: 'flex',
                alignItems: 'baseline',
                gap: 24,
              }}
            >
              <Block height={11} width={120} />
              <div style={{ flex: 1 }} />
              <Block height={20} width={90} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Block({
  height,
  width,
  mt,
  mb,
}: {
  height: number;
  width: number | string;
  mt?: number;
  mb?: number;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        height,
        width,
        maxWidth: '100%',
        background: 'var(--paper-2)',
        marginTop: mt,
        marginBottom: mb,
      }}
    />
  );
}
