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
 *
 * The list reaches past its default window (2026-10-18): "Show earlier stays"
 * steps back 120 days of check-ins at a time, and Dates jumps to the window
 * asked for, both through the concierge (stay-concierge #90). Search covers
 * everything loaded. Past two years, or when a window is too full to list,
 * it says older conversations are in Guesty, with a link, instead of ending.
 */

import { reviewAskContext } from '@/lib/review-ask-context';
import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
import { matchesInboxText } from '@/lib/inbox-search';
import { Section } from '@/components/Section';
import type { ConversationSummary } from '@/lib/stay-concierge';
import { ThreadPanel } from './Thread';
import { relativeTimeShort, formatStayDates, channelTone, prettifySlug } from './format';
import { loadConversationWindow } from './conversation-actions';
import {
  GUESTY_INBOX_URL,
  addDays,
  earlierWindow,
  formatWindow,
  reachedFloor,
  shortDay,
  windowProblem,
} from '@/lib/conversation-window';

/** A row from either source. Helm-native threads (conversation_id 'helm:…')
 * may carry the OTA deep link; concierge rows never do. Pure string checks
 * here on purpose: this is a client component and must not import the
 * server-side inbox module. */
export type InboxConversation = ConversationSummary & {
  external_thread_url?: string | null;
  thread_status?: string;
  review_count?: number;
};

const HELM_PREFIX = 'helm:';
const isHelmRow = (c: Pick<ConversationSummary, 'conversation_id'>) => c.conversation_id.startsWith(HELM_PREFIX);

type Props = {
  initialConversations: InboxConversation[];
  initialError: string | null;
  /** A thread to open on arrival (`/messaging?open=<id>`). */
  initialOpenId?: string | null;
  /** The check-in window the first list covers. */
  initialWindow?: CheckInWindow | null;
};

type CheckInWindow = { from: string; to: string; truncated?: boolean };

function todayYmd(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

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

export function ConversationsBrowser({ initialConversations, initialError, initialOpenId = null, initialWindow = null }: Props) {
  const today = todayYmd();
  const firstWindow: CheckInWindow = initialWindow ?? { from: addDays(today, -60), to: addDays(today, 60) };
  // Rows reached past the first list: earlier windows stepped back into, or
  // the dates asked for (which then replace the first list).
  const [extra, setExtra] = useState<InboxConversation[]>([]);
  const [windows, setWindows] = useState<CheckInWindow[]>([firstWindow]);
  const [picked, setPicked] = useState<CheckInWindow | null>(null);
  const [showDates, setShowDates] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reachError, setReachError] = useState<string | null>(null);
  const [reaching, startReach] = useTransition();
  const [query, setQuery] = useState('');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [filter, setFilter] = useState<StayFilter>('all');
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [showAll, setShowAll] = useState(false);

  // The list streams in after the page, so the browser's own jump to
  // #conversations has already passed by the time it exists: bring the
  // asked-for thread into view once it has mounted.
  useEffect(() => {
    if (!initialOpenId) return;
    document.getElementById(`conversation-${initialOpenId}`)?.scrollIntoView({ block: 'start' });
  }, [initialOpenId]);

  // The first list plus everything reached since, each conversation once.
  const all = useMemo(() => {
    const base = picked ? [] : initialConversations;
    const seen = new Set<string>();
    return [...base, ...extra].filter((c) => (seen.has(c.conversation_id) ? false : (seen.add(c.conversation_id), true)));
  }, [initialConversations, extra, picked]);
  const matching = useMemo(() => all.filter(c =>
    (filter === 'all' || c.stay_status === filter) && matchesInboxText(query, [c.guest_full, c.property_name, prettifySlug(c.listing_id), c.channel, c.last_preview])
  ), [all, query, filter]);
  const reviewCountsAvailable = all.every(c => c.review_count !== undefined);
  const earliest = windows.reduce((min, w) => (w.from < min ? w.from : min), windows[0].from);
  const latest = windows.reduce((max, w) => (w.to > max ? w.to : max), windows[0].to);
  const atFloor = reachedFloor(earliest, today);
  const anyTruncated = windows.some((w) => w.truncated);

  const reach = (from: string, to: string, mode: 'earlier' | 'dates') => {
    setReachError(null);
    startReach(async () => {
      const res = await loadConversationWindow(from, to);
      if (!res.ok) {
        setReachError(res.error);
        return;
      }
      const window = { from: res.from, to: res.to, truncated: res.truncated };
      if (mode === 'dates') {
        setPicked(window);
        setExtra(res.rows);
        setWindows([window]);
        setShowDates(false);
      } else {
        setExtra((cur) => [...cur, ...res.rows]);
        setWindows((cur) => [...cur, window]);
      }
      setShowAll(true);
    });
  };
  const stepBack = () => {
    const w = earlierWindow(earliest);
    reach(w.from, w.to, 'earlier');
  };
  const backToRecent = () => {
    setPicked(null);
    setExtra([]);
    setWindows([firstWindow]);
    setReachError(null);
  };
  const datesProblem = dateFrom || dateTo ? windowProblem(dateFrom, dateTo) : null;
  const readyCount = matching.filter(c => (c.review_count || 0) > 0).length;
  const filtered = reviewOnly && reviewCountsAvailable ? matching.filter(c => (c.review_count || 0) > 0) : matching;

  // The open thread must stay visible no matter what happens to the list
  // around it: slice truncation, a search that excludes it, a filter chip,
  // or the 15s refresh reordering rows. Unmounting it would destroy any
  // half-typed composer text, so the pin looks up the FULL list, not the
  // filtered one.
  const visible = showAll ? filtered : filtered.slice(0, DEFAULT_VISIBLE);
  const openRow = openId
    ? all.find((c) => c.conversation_id === openId)
    : null;
  const rows =
    openRow && !visible.some((c) => c.conversation_id === openId)
      ? [...visible, openRow]
      : visible;
  const hasMore = filtered.length > DEFAULT_VISIBLE;

  if (initialError && all.length === 0 && !picked) {
    return (
      <Section id="conversations" title="Conversations" eyebrow="live from Guesty and Helm" paddingTop={36}>
        <div style={{ borderTop: '1px solid var(--rule)', padding: '16px 0', fontSize: 13, color: 'var(--ink-3)' }}>
          {initialError}
        </div>
      </Section>
    );
  }

  return (
    <Section
      id="conversations"
      title="Conversations"
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
          placeholder="Guest, property, or latest message…"
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
        <button type="button" className="rt-quiet-btn" aria-expanded={showDates} onClick={() => setShowDates((v) => !v)}>
          {showDates ? 'Hide dates' : 'Dates'}
        </button>
        {picked && (
          <button type="button" className="rt-quiet-btn" onClick={backToRecent}>
            Back to recent stays
          </button>
        )}
      </div>

      {showDates && (
        <form
          aria-label="Check-in dates"
          onSubmit={(e) => {
            e.preventDefault();
            if (!windowProblem(dateFrom, dateTo)) reach(dateFrom, dateTo, 'dates');
          }}
          style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 12px', fontSize: 13, color: 'var(--ink-3)' }}
        >
          <span className="eyebrow" style={{ color: 'var(--ink-3)' }}>Check-ins from</span>
          <input type="date" value={dateFrom} max={today} onChange={(e) => setDateFrom(e.target.value)} aria-label="Check-ins from" style={{ padding: '6px 8px', border: '1px solid var(--rule)', background: 'var(--paper)', fontFamily: 'inherit', fontSize: 13 }} />
          <span>to</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="Check-ins to" style={{ padding: '6px 8px', border: '1px solid var(--rule)', background: 'var(--paper)', fontFamily: 'inherit', fontSize: 13 }} />
          <button
            type="submit"
            disabled={reaching || !dateFrom || !dateTo || !!datesProblem}
            style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--ink-2)', background: 'var(--paper)', border: '1px solid var(--ink-3)', padding: '8px 14px', cursor: 'pointer' }}
          >
            {reaching ? 'Loading…' : 'Show'}
          </button>
          {datesProblem && <span role="status" style={{ color: 'var(--signal)' }}>{datesProblem}</span>}
        </form>
      )}

      <div className="rt-conversation-status-filter">
        <button type="button" disabled={!reviewCountsAvailable} aria-pressed={reviewOnly} onClick={() => { setReviewOnly(v => !v); setShowAll(false); }}>{reviewCountsAvailable ? `Needs review (${readyCount})` : 'Review counts unavailable'}</button>
        {/* No running count: Show all N at the foot of the list carries it. */}
        {openRow && !visible.some(c => c.conversation_id === openRow.conversation_id) && (
          <span role="status">Open conversation kept below</span>
        )}
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--rule)' }}>
        {rows.length === 0 && (
          <li style={{ padding: '16px 0', fontSize: 13, color: 'var(--ink-4)', borderBottom: '1px solid var(--rule)' }}>
            No conversations match in check-ins {formatWindow(earliest, latest)}.
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

      {/* The list never just ends: it steps back a window at a time, and
          past what Helm reaches it says where the rest is. */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap', paddingTop: 14, fontSize: 12, color: 'var(--ink-3)' }}>
        <span>Check-ins {formatWindow(earliest, latest)}.</span>
        {!atFloor && (
          <button type="button" className="rt-quiet-btn" onClick={stepBack} disabled={reaching} aria-busy={reaching || undefined}>
            {reaching ? 'Loading earlier stays…' : `Show earlier stays (before ${shortDay(earliest)})`}
          </button>
        )}
        {(atFloor || anyTruncated || reachError) && (
          <span>
            {reachError ? `${reachError} ` : anyTruncated ? 'Some of these dates held more stays than Helm lists at once. ' : ''}
            Older conversations are in Guesty:{' '}
            <a href={GUESTY_INBOX_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ink-2)', textDecoration: 'underline' }}>
              open Guesty ↗
            </a>
          </span>
        )}
      </div>
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
      id={variant === 'thread' ? `conversation-${c.conversation_id}` : undefined}
      style={{
        scrollMarginTop: 100,
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
        {(c.review_count ?? c.pending_count) > 0 && (
          <span
            className="eyebrow"
            style={{ color: 'var(--signal)', fontWeight: 700 }}
            title={c.review_count !== undefined ? 'Messages awaiting review' : 'Pending drafts and scheduled sends'}
          >
            {c.review_count ?? c.pending_count} {c.review_count !== undefined ? 'for review' : 'active'}
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
            ? `${c.last_who === 'host' ? 'Sent: ' : ''}${reviewAskContext(c.last_preview) ?? c.last_preview}`
            : ''}
        </span>
        <span
          suppressHydrationWarning
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
            stayContext={{ reservationId: c.reservation_id, checkIn: c.check_in, checkOut: c.check_out }}
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
