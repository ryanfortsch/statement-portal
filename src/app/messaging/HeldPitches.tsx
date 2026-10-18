'use client';

import { releaseHeldPitch } from './inbox-health-actions';

export type HeldPitch = { source_id: string; held_at: number; sender: string; subject: string };

/**
 * First-contact emails the pitch screen held in the last day: no draft was
 * written, so there is no card, and until 2026-10-18 they waited two folds
 * deep in Delivery & sync. Each waits here, one line, with Release ("Not a
 * pitch, draft it": the concierge drafts it on its next email check).
 */
export function HeldPitches({ items }: { items: HeldPitch[] }) {
  return (
    <section aria-label="Held as pitches" style={{ marginTop: 18, borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
      <div className="eyebrow" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>
        Held as {items.length === 1 ? 'a pitch' : 'pitches'} · no draft written
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((item) => (
          <li
            key={item.source_id}
            className="rt-wait-line"
            data-tone="held"
            style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13 }}
          >
            <span style={{ minWidth: 0, flex: '1 1 260px', overflowWrap: 'anywhere', color: 'var(--ink-2)' }}>
              Held as a pitch: <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{item.sender || 'Unknown sender'}</span>
              {item.subject ? ` · ${item.subject}` : ''}
              <span suppressHydrationWarning style={{ color: 'var(--ink-4)' }}> · {heldAgo(item.held_at)}</span>
            </span>
            <form action={releaseHeldPitch}>
              <input type="hidden" name="source_id" value={item.source_id} />
              <button type="submit" className="rt-quiet-btn" title="A real person: draft a reply on the next email check.">
                Not a pitch, draft it
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}

function heldAgo(epochSeconds: number): string {
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - epochSeconds) / 60));
  if (minutes < 60) return `${minutes || 1}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
