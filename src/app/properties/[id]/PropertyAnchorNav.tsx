/**
 * Sticky in-page anchor strip for the property detail page. Lives between
 * the stat grid and the first content section; once the user scrolls past
 * it, it sticks to the bottom edge of the masthead (top: 57px) so the
 * section list stays reachable through the long scroll.
 *
 * Anchors are resolved against `id` attributes on the section wrappers.
 * Section ids are stable strings ("statements", "stays", ...) so the URL
 * fragment can also be linked into directly.
 */

type Anchor = {
  id: string;
  label: string;
  /** Hide the anchor when the section is empty — keeps the bar honest. */
  show: boolean;
};

export function PropertyAnchorNav({ anchors }: { anchors: Anchor[] }) {
  const visible = anchors.filter((a) => a.show);
  if (visible.length === 0) return null;

  return (
    <div
      className="sticky"
      style={{
        top: 57,
        zIndex: 40,
        background: 'var(--paper)',
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <div className="max-w-[1100px] mx-auto px-10">
        <nav
          className="flex items-baseline"
          style={{
            gap: 22,
            padding: '12px 0 11px',
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            fontWeight: 500,
          }}
        >
          {visible.map((a) => (
            <a
              key={a.id}
              href={`#${a.id}`}
              style={{ color: 'var(--ink-3)', textDecoration: 'none' }}
            >
              {a.label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
