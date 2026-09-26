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

import { useMemo, useState, type ReactNode } from 'react';
import { Section } from '@/components/Section';
import type { ConversationSummary } from '@/lib/stay-concierge';
import { ThreadPanel } from './Thread';
import { relativeTimeShort, formatStayDates, channelTone, prettifySlug } from './format';

/** A row from either source. Helm-native threads (conversation_id 'helm:…')
 * may carry the OTA deep link; concierge rows never do. Pure string checks
 * here on purpose: this is a client component and must not import the
 * server-side inbox module. */
export type InboxConversation = ConversationSummary & {
  external_thread_url?: string | null;
  thread_status?: string;
};

const HELM_PREFIX = 'helm:';
const isHelmRow = (c: Pick<ConversationSummary, 'conversation_id'>) => c.conversation_id.startsWith(HELM_PREFIX);

type Props = {
  initialConversations: InboxConversation[];
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
      <Section title="Conversations" eyebrow="live from Guesty and Helm" paddingTop={36}>
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

/**
 * One ledger row. Exported so the Send lens can reuse the exact row the
 * Inbox uses - same guest/property/channel/stay reading, so a stay looks
 * identical wherever she meets it.
 *
 * `variant='pick'` turns the row from a thread disclosure into a selectable
 * target: clicking selects instead of expanding, the thread never mounts,
 * and the caller supplies its own `trailing` slot.
 */
export function ConversationRow({
  c,
  open,
  onToggle,
  variant = 'thread',
  selected = false,
  trailing,
  showChevron = true,
}: {
  c: InboxConversation;
  open: boolean;
  onToggle: () => void;
  variant?: 'thread' | 'pick';
  selected?: boolean;
  trailing?: ReactNode;
  showChevron?: boolean;
}) {
  const propertyLabel = c.property_name || prettifySlug(c.listing_id) || 'unknown property';
  const stay = STAY_CHIP[c.stay_status];
  const stayLabel = formatStayDates(c.check_in, c.check_out);
  const lastAt = c.last_activity_at ? relativeTimeShort(c.last_activity_at) : '';
  const helm = isHelmRow(c);
  const otaUrl = !c.module && c.external_thread_url ? c.external_thread_url : null;
  const noSendNote = c.module
    ? undefined
    : otaUrl
      ? `${c.channel || 'This channel'} has no send rail Helm can use. Reply in the ${c.channel || 'OTA'} app; a draft you write below copies to the clipboard.`
      : helm
        ? 'No phone on file for this guest yet. Once they text the GUESTS line, replies send from here.'
        : 'Direct-booked guest: Guesty cannot deliver a reply here. Use the SMS / WhatsApp flow.';
  return (
    <li
      style={{
        borderBottom: '1px solid var(--rule)',
        background: selected ? 'var(--paper-2)' : 'transparent',
        borderLeft: selected ? '3px solid var(--signal)' : '3px solid transparent',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={variant === 'thread' ? open : undefined}
        aria-pressed={variant === 'pick' ? selected : undefined}
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
        {helm && (
          <span
            className="eyebrow"
            style={{
              color: 'var(--ink-3)',
              border: '1px solid var(--rule)',
              padding: '1px 6px',
              whiteSpace: 'nowrap',
            }}
            title="A Helm-native thread: recorded in Helm, not read from Guesty"
          >
            Helm
          </span>
        )}
        {helm && c.thread_status && c.thread_status !== 'open' && (
          <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
            {c.thread_status}
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
          {lastAt || '—'} {showChevron ? (open ? '▴' : '▾') : ''}
        </span>
        {trailing}
      </button>
      {variant === 'thread' && open && (
        <div style={{ padding: '0 2px 16px' }}>
          <ThreadPanel
            conversationId={c.conversation_id}
            guestFirst={c.guest_first || c.guest_full}
            channel={c.channel}
            module={c.module}
            listingId={c.listing_id}
            contextName={c.guest_full || c.guest_first || 'Guest'}
            contextMeta={[propertyLabel, stayLabel, c.channel]
              .filter(Boolean)
              .join(' · ')}
            // An empty module means no rail Helm can send on: a direct-booked
            // Guesty guest, or a Helm OTA thread whose only "send" is the OTA
            // app. Hide the composer instead of silently routing wrong.
            canSend={!!c.module}
            noSendNote={noSendNote}
            maxHeight={520}
          />
          {otaUrl && <OtaReplyBlock url={otaUrl} channel={c.channel} guestFirst={c.guest_first || c.guest_full} />}
        </div>
      )}
    </li>
  );
}

/**
 * What stands in for the composer on an OTA thread: the deep link into the
 * OTA app (the only place a reply can be sent in the pilot) and a draft box
 * whose text copies to the clipboard so the operator can write here, in
 * Helm's calm, and paste there.
 */
function OtaReplyBlock({ url, channel, guestFirst }: { url: string; channel: string; guestFirst: string }) {
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const label = channel ? `Open in ${channel}` : 'Open thread';

  const copy = async () => {
    const text = draft.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
    setTimeout(() => setCopied('idle'), 2500);
  };

  return (
    <div style={{ borderTop: '1px solid var(--rule)', padding: '12px 0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: 'var(--ink)',
            color: 'var(--paper)',
            padding: '9px 16px',
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            fontWeight: 700,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {label} ↗
        </a>
        <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
          Replies to {guestFirst || 'this guest'} go out in the {channel || 'OTA'} app
        </span>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={`Draft a reply to ${guestFirst || 'the guest'} here, then copy it into ${channel || 'the app'}.`}
        rows={Math.max(2, Math.min(8, draft.split('\n').length + 1))}
        aria-label="Draft to copy"
        style={{
          width: '100%',
          padding: '10px 12px',
          border: '1px solid var(--rule)',
          background: 'var(--paper-2)',
          fontFamily: 'inherit',
          fontSize: 14,
          lineHeight: 1.55,
          color: 'var(--ink)',
          resize: 'vertical',
        }}
      />
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="eyebrow" style={{ color: copied === 'failed' ? 'var(--signal)' : 'var(--ink-4)' }}>
          {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy blocked by the browser; select and copy by hand' : 'Nothing sends from here'}
        </span>
        <button
          type="button"
          onClick={copy}
          disabled={!draft.trim()}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            color: draft.trim() ? 'var(--ink)' : 'var(--ink-4)',
            border: '1px solid var(--rule)',
            padding: '8px 16px',
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            fontWeight: 600,
            cursor: draft.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          Copy draft
        </button>
      </div>
    </div>
  );
}
