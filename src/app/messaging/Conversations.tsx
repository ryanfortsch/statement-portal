'use client';

/**
 * The Conversations browser: Guesty's inbox, rebuilt the Helm way.
 *
 * Every recent guest (in-house, upcoming, recently checked out) as a ledger
 * row — guest, property, channel, stay dates, latest activity — that
 * expands in place into the full thread (ThreadPanel) with a manual-reply
 * composer. Search and stay-status filters up top. The list itself comes
 * down with the page render (concierge caches the Guesty gather), so this
 * component only fetches when a thread is opened.
 */

import { useMemo, useState } from 'react';
import { Section } from '@/components/Section';
import type { ConversationSummary } from '@/lib/stay-concierge';
import { ThreadPanel } from './Thread';
import { relativeTimeShort, formatStayDates, channelTone, prettifySlug } from './format';

type Props = {
  initialConversations: ConversationSummary[];
  initialError: string | null;
};

const DEFAULT_VISIBLE = 8;

type StayFilter = 'all' | 'in_house' | 'upcoming' | 'checked_out';

const FILTERS: { id: StayFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'in_house', label: 'In house' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'checked_out', label: 'Checked out' },
];

const STAY_CHIP: Record<string, { label: string; tone: string }> = {
  in_house: { label: 'In house', tone: '#5b7b4e' },
  upcoming: { label: 'Upcoming', tone: '#3b5d8f' },
  checked_out: { label: 'Checked out', tone: 'var(--ink-4)' },
};

export function ConversationsBrowser({ initialConversations, initialError }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StayFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return initialConversations.filter((c) => {
      if (filter !== 'all' && c.stay_status !== filter) return false;
      if (!q) return true;
      const hay = `${c.guest_full} ${c.property_name} ${prettifySlug(c.listing_id)} ${c.channel}`.toLowerCase();
      return hay.includes(q);
    });
  }, [initialConversations, query, filter]);

  // The open thread must stay visible no matter what happens to the list
  // around it: slice truncation, a search that excludes it, a filter chip,
  // or the 15s refresh reordering rows. Unmounting it would destroy any
  // half-typed composer text, so the pin looks up the FULL list, not the
  // filtered one.
  const visible = showAll ? filtered : filtered.slice(0, DEFAULT_VISIBLE);
  const openRow = openId
    ? initialConversations.find((c) => c.conversation_id === openId)
    : null;
  const rows =
    openRow && !visible.some((c) => c.conversation_id === openId)
      ? [...visible, openRow]
      : visible;
  const hasMore = filtered.length > DEFAULT_VISIBLE;

  if (initialError && initialConversations.length === 0) {
    return (
      <Section title="Conversations" eyebrow="live from Guesty" paddingTop={36}>
        <div style={{ borderTop: '1px solid var(--rule)', padding: '16px 0', fontSize: 13, color: 'var(--ink-3)' }}>
          {initialError}
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Conversations"
      eyebrow={`${initialConversations.length} guests · in house, upcoming & recent`}
      paddingTop={36}
    >
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <div role="tablist" aria-label="Stay status" style={{ display: 'inline-flex', border: '1px solid var(--rule)', overflow: 'hidden' }}>
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
                  setShowAll(false);
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
                  borderRight: '1px solid var(--rule)',
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
            setShowAll(false);
          }}
          placeholder="Search guest or property…"
          aria-label="Search conversations"
          style={{
            flex: '1 1 200px',
            maxWidth: 320,
            padding: '8px 10px',
            border: '1px solid var(--rule)',
            background: 'var(--paper)',
            fontFamily: 'inherit',
            fontSize: 13,
            color: 'var(--ink)',
          }}
        />
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--rule)' }}>
        {rows.length === 0 && (
          <li style={{ padding: '16px 0', fontSize: 13, color: 'var(--ink-4)', borderBottom: '1px solid var(--rule)' }}>
            No conversations match.
          </li>
        )}
        {rows.map((c) => (
          <ConversationRow
            key={c.conversation_id}
            c={c}
            open={openId === c.conversation_id}
            onToggle={() =>
              setOpenId((cur) => (cur === c.conversation_id ? null : c.conversation_id))
            }
          />
        ))}
      </ul>

      {hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 14 }}>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
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
            {showAll ? 'Show less ▴' : `Show all ${filtered.length} ▾`}
          </button>
        </div>
      )}
    </Section>
  );
}

function ConversationRow({
  c,
  open,
  onToggle,
}: {
  c: ConversationSummary;
  open: boolean;
  onToggle: () => void;
}) {
  const propertyLabel = c.property_name || prettifySlug(c.listing_id) || 'unknown property';
  const stay = STAY_CHIP[c.stay_status];
  const stayLabel = formatStayDates(c.check_in, c.check_out);
  const lastAt = c.last_activity_at ? relativeTimeShort(c.last_activity_at) : '';
  return (
    <li style={{ borderBottom: '1px solid var(--rule)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        // Explicit resets rather than `all: unset`: unset would also kill
        // the global :focus-visible outline, leaving keyboard users with no
        // focus indicator on the row.
        style={{
          background: 'transparent',
          border: 'none',
          font: 'inherit',
          color: 'inherit',
          textAlign: 'left',
          boxSizing: 'border-box',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          flexWrap: 'wrap',
          width: '100%',
          padding: '12px 2px',
        }}
      >
        <span className="font-serif" style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
          {c.guest_full || c.guest_first || 'Guest'}
        </span>
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{propertyLabel}</span>
        {c.channel && (
          <span
            style={{
              fontSize: 9,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontWeight: 700,
              color: 'var(--paper)',
              background: channelTone(c.channel),
              padding: '2px 7px',
              borderRadius: 2,
              whiteSpace: 'nowrap',
            }}
          >
            {c.channel}
          </span>
        )}
        {stayLabel && (
          <span className="eyebrow" style={{ color: 'var(--ink-4)' }} title={`${c.check_in || '?'} to ${c.check_out || '?'}`}>
            {stayLabel}
          </span>
        )}
        {stay && (
          <span
            className="eyebrow"
            style={{ color: stay.tone, fontWeight: 600 }}
          >
            {stay.label}
          </span>
        )}
        {c.pending_count > 0 && (
          <span
            className="eyebrow"
            style={{ color: 'var(--signal)', fontWeight: 700 }}
            title="Drafts waiting in the queue above"
          >
            {c.pending_count} waiting
          </span>
        )}
        <span
          style={{
            flex: '1 1 140px',
            minWidth: 0,
            fontSize: 12,
            color: 'var(--ink-4)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'right',
          }}
          title={c.last_preview || undefined}
        >
          {c.last_preview
            ? `${c.last_who === 'host' ? 'Sent: ' : ''}${c.last_preview}`
            : ''}
        </span>
        <span
          className="eyebrow"
          style={{ color: 'var(--ink-4)', whiteSpace: 'nowrap' }}
          title={c.last_activity_at || undefined}
        >
          {lastAt || '—'} {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 2px 16px' }}>
          <ThreadPanel
            conversationId={c.conversation_id}
            guestFirst={c.guest_first || c.guest_full}
            channel={c.channel}
            module={c.module}
            listingId={c.listing_id}
            // Direct-booked guests have no Guesty channel our API can post
            // to (module comes back empty); hide the composer instead of
            // silently routing to the wrong module.
            canSend={!!c.module}
            noSendNote={
              c.module
                ? undefined
                : 'Direct-booked guest: Guesty cannot deliver a reply here. Use the SMS / WhatsApp flow.'
            }
            maxHeight={520}
          />
        </div>
      )}
    </li>
  );
}
