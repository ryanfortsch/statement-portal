/**
 * The three things every visit clears, printed flat. These were flip cards,
 * but on the portal's actual device (a phone) the hover handlers fought the
 * tap toggle so the full standard took two taps to read, and the payoff was
 * hiding the most important copy on the page behind a gesture. A plain
 * numbered list matches the "How a visit works" treatment right below it,
 * reads in one pass, and needs no client JS.
 */
const PILLARS = [
  {
    title: 'Perfection',
    desc: "You're the last eyes before check-in. Every surface and detail should look like the photos that booked the stay.",
  },
  {
    title: 'Maintenance',
    desc: 'Flag anything worn, leaking, or drifting toward a repair so we fix it before it ever reaches a review.',
  },
  {
    title: 'Supplies',
    desc: "Confirm the essentials are there, and note whatever's running low so we can restock fast.",
  },
];

export function FieldPillars() {
  return (
    <div>
      {PILLARS.map((p, i) => (
        <div
          key={p.title}
          style={{
            display: 'flex',
            gap: 14,
            paddingTop: i === 0 ? 0 : 16,
            marginTop: i === 0 ? 0 : 16,
            borderTop: i === 0 ? 'none' : '1px solid var(--rule-soft)',
          }}
        >
          <span className="font-mono" style={{ fontSize: 13, color: 'var(--tide)', fontWeight: 600, flexShrink: 0, width: 18 }}>
            {i + 1}
          </span>
          <div>
            <div className="font-serif" style={{ fontSize: 17 }}>{p.title}</div>
            <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.55 }}>{p.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
