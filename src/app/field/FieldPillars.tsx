'use client';

import { useState } from 'react';

/**
 * The three things every visit clears, as flip cards. Front carries the pillar
 * and its essence; tapping (or hovering on desktop) flips to the full standard.
 * Communicates the bar at a glance and rewards a tap with the detail, instead of
 * a flat numbered list.
 */
const PILLARS = [
  {
    title: 'Perfection',
    front: 'Flawless, staged, guest-ready.',
    back: "You're the last eyes before check-in. Every surface and detail should look like the photos that booked the stay.",
  },
  {
    title: 'Maintenance',
    front: 'Catch it before a guest does.',
    back: 'Flag anything worn, leaking, or drifting toward a repair so we fix it before it ever reaches a review.',
  },
  {
    title: 'Supplies',
    front: 'Stocked and ready.',
    back: "Confirm the essentials are there, and note whatever's running low so we can restock fast.",
  },
];

function face(isBack: boolean): React.CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid var(--rule)',
    borderTop: isBack ? '3px solid var(--signal)' : '1px solid var(--rule)',
    borderRadius: 12,
    background: isBack ? 'rgba(200,90,58,0.05)' : 'var(--paper-2, #fff)',
    padding: '16px 18px',
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
    transform: isBack ? 'rotateY(180deg)' : undefined,
    overflow: 'hidden',
    textAlign: 'left',
  };
}

function Flip({ title, front, back }: { title: string; front: string; back: string }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setFlipped((f) => !f)}
      onMouseEnter={() => setFlipped(true)}
      onMouseLeave={() => setFlipped(false)}
      aria-label={`${title}. ${back}`}
      style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'block', width: '100%', perspective: '900px' }}
    >
      <div
        style={{
          position: 'relative',
          height: 158,
          transition: 'transform .5s cubic-bezier(.2,.7,.3,1)',
          transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : undefined,
        }}
      >
        <div style={face(false)}>
          <div className="font-serif" style={{ fontSize: 18, fontWeight: 400 }}>{title}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.45 }}>{front}</div>
          <div style={{ marginTop: 'auto', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
            Tap to read
          </div>
        </div>
        <div style={face(true)}>
          <div style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.5 }}>{back}</div>
        </div>
      </div>
    </button>
  );
}

export function FieldPillars() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {PILLARS.map((p) => (
        <Flip key={p.title} {...p} />
      ))}
    </div>
  );
}
