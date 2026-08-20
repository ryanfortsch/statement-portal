/**
 * The three things every visit clears, printed flat. These were flip cards,
 * but on the portal's actual device (a phone) the hover handlers fought the
 * tap toggle so the full standard took two taps to read, and the payoff was
 * hiding the most important copy on the page behind a gesture. A plain
 * numbered list matches the "How a visit works" treatment right below it,
 * reads in one pass, and needs no client JS.
 *
 * Per-trade: inspectors and handymen hold different standards, so each trade
 * gets its own trio (cleaning reads the inspection set until it has one).
 */
const INSPECTION_PILLARS = [
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

const MAINTENANCE_PILLARS = [
  {
    title: 'Fixed right',
    desc: "No patch jobs. Do it the way you'd do it in your own house.",
  },
  {
    title: 'Guest-ready when you leave',
    desc: 'These are vacation rentals. Sawdust swept, tools out, everything back where a guest expects it. The repair should be invisible.',
  },
  {
    title: 'Eyes open',
    desc: "You're inside homes we can't visit every day. Flag anything else that's worn, leaking, or about to break.",
  },
];

export function FieldPillars({ trade = 'inspection' }: { trade?: string }) {
  const pillars = trade === 'maintenance' ? MAINTENANCE_PILLARS : INSPECTION_PILLARS;
  return (
    <div>
      {pillars.map((p, i) => (
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
