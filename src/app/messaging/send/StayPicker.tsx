'use client';

/**
 * Pick the stay you're writing to.
 *
 * Reuses the Inbox's own ConversationRow in `pick` mode, so a guest reads
 * identically wherever Dotti meets them - same name, property, channel,
 * stay dates and status chip - instead of a second, subtly different guest
 * list she has to learn.
 *
 * Two deliberate differences from the Inbox list:
 *   - Sorted by STAY PROXIMITY, not last activity. Proactive messages are
 *     almost always aimed at someone arriving or in the house right now;
 *     last-activity order buries them under whoever happened to reply.
 *   - Opens on `Current` (in house + arriving today), because that is the
 *     population this surface exists for. `All` is one click away.
 */

import { useMemo, useState } from 'react';
import type { ConversationSummary } from '@/lib/stay-concierge';
import { ConversationRow } from '../Conversations';
import { prettifySlug } from '../format';

export type StayFilterId = 'current' | 'in_house' | 'upcoming' | 'checked_out' | 'all';

const FILTERS: { id: StayFilterId; label: string }[] = [
  { id: 'current', label: 'Current' },
  { id: 'in_house', label: 'In house' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'checked_out', label: 'Checked out' },
  { id: 'all', label: 'All' },
];

const VISIBLE_STEP = 12;

/** Days between an ISO date and today (ET, passed in from the server so the
 * client clock can never disagree with the render). Missing dates sort last. */
function daysFromToday(iso: string, today: string): number {
  if (!iso) return 9999;
  const a = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 9999;
  return Math.round((a - b) / 86_400_000);
}

export function StayPicker({
  conversations,
  today,
  selectedId,
  onPick,
}: {
  conversations: ConversationSummary[];
  today: string;
  selectedId: string | null;
  onPick: (c: ConversationSummary) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StayFilterId>('current');
  const [visible, setVisible] = useState(VISIBLE_STEP);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = conversations.filter((c) => {
      if (filter === 'current') {
        if (c.stay_status !== 'in_house' && daysFromToday(c.check_in, today) !== 0) return false;
      } else if (filter !== 'all' && c.stay_status !== filter) {
        return false;
      }
      if (!q) return true;
      const hay = `${c.guest_full} ${c.guest_first} ${c.property_name} ${prettifySlug(c.listing_id)} ${c.channel}`.toLowerCase();
      return hay.includes(q);
    });
    // Stay proximity: whoever is closest to today (either direction) first.
    return matches.sort(
      (a, b) =>
        Math.abs(daysFromToday(a.check_in, today)) - Math.abs(daysFromToday(b.check_in, today)),
    );
  }, [conversations, query, filter, today]);

  const shown = rows.slice(0, visible);

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div
          role="tablist"
          aria-label="Stay status"
          style={{ display: 'inline-flex', border: '1px solid var(--rule)', overflow: 'hidden' }}
        >
          {FILTERS.map((f) => {
            const active = f.id === filter;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setFilter(f.id);
                  setVisible(VISIBLE_STEP);
                }}
                style={{
                  padding: '7px 12px',
                  fontSize: 10,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: active ? 'var(--ink)' : 'var(--paper)',
                  color: active ? 'var(--paper)' : 'var(--ink-3)',
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setVisible(VISIBLE_STEP);
          }}
          placeholder="Search guest or property..."
          aria-label="Search stays"
          style={{
            flex: '1 1 220px',
            minWidth: 0,
            padding: '8px 12px',
            fontSize: 13,
            fontFamily: 'inherit',
            color: 'var(--ink)',
            background: 'var(--paper)',
            border: '1px solid var(--rule)',
          }}
        />
      </div>

      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--ink-3)', padding: '12px 0', margin: 0 }}>
          {query.trim()
            ? 'No stay matches that search.'
            : 'No stays in this window. Try All.'}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--ink)' }}>
          {shown.map((c) => (
            <ConversationRow
              key={c.conversation_id}
              c={c}
              variant="pick"
              open={false}
              showChevron={false}
              selected={selectedId === c.conversation_id}
              onToggle={() => onPick(c)}
            />
          ))}
        </ul>
      )}

      {rows.length > shown.length && (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 14 }}>
          <button
            type="button"
            onClick={() => setVisible((v) => v + VISIBLE_STEP)}
            style={{
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              fontWeight: 600,
              color: 'var(--ink-3)',
              background: 'transparent',
              border: '1px solid var(--rule)',
              padding: '8px 16px',
              cursor: 'pointer',
            }}
          >
            Show more ({rows.length - shown.length} left) ▾
          </button>
        </div>
      )}
    </div>
  );
}
