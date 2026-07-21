'use client';

/**
 * ThreadPanel: the full Guesty conversation, rendered the Helm way.
 *
 * Fetches the thread on mount (live from Guesty via the concierge), then
 * keeps it fresh with a light 20s refetch while open and visible. Layout
 * follows the owner-messaging transcript vocabulary — editorial keylines,
 * not chat bubbles: guest messages flush-left under a rule keyline, our
 * replies indented under a quiet chevron, with provenance labels Guesty
 * doesn't give you (Guesty automation vs. our AI vs. a human in Guesty).
 * Consecutive automation messages collapse to a single line so the thread
 * reads as the actual conversation, not a template dump.
 *
 * With `canSend`, a composer sits at the bottom: what you type is what
 * sends, on the conversation's own channel.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { ThreadMessage } from '@/lib/stay-concierge';
import { fetchThread, sendThreadMessage } from './thread-actions';
import { formatSessionDate, formatClockRange, prettifyTopic } from './format';

type Props = {
  conversationId: string;
  guestFirst: string;
  channel: string;
  module: string;
  listingId?: string;
  /** Show the manual-reply composer. Off inside approval cards (the card's
   * own actions are the reply surface there). */
  canSend?: boolean;
  /** Shown where the composer would sit when canSend is false for a channel
   * reason (e.g. direct-booked guests Guesty can't deliver to). */
  noSendNote?: string;
  /** Scroll cap for the message list. */
  maxHeight?: number;
};

const REFETCH_MS = 20_000;

/** Chip copy for how the pipeline handled an inbound message. */
function handledLabel(m: ThreadMessage): string {
  switch (m.approval_status) {
    case 'approved':
      return 'replied via Helm';
    case 'manual_sent':
      return 'you replied in Guesty';
    case 'rejected':
      return 'no reply needed';
    case 'auto_rejected_stale':
      return 'draft expired';
  }
  switch (m.action) {
    case 'auto_send':
    case 'auto_sent':
      return 'auto-replied';
    case 'escalated':
      return 'escalated to SMS';
    case 'no_reply_needed':
      return 'no reply needed';
  }
  return '';
}

function hostLabel(m: ThreadMessage): string {
  if (m.via === 'helm_ai') return 'Helm · AI';
  if (m.via === 'guesty_auto') return 'Guesty automation';
  if (m.via === 'operator') return 'You · via Helm';
  if (m.via === 'team') return m.sender_name ? `${m.sender_name} · in Guesty` : 'Team · in Guesty';
  return 'Host';
}

// Render plan: messages grouped under day headers, with consecutive
// Guesty-automation posts folded into one collapsible line.
type RenderItem =
  | { kind: 'day'; label: string; key: string }
  | { kind: 'message'; m: ThreadMessage; showLabel: boolean; key: string }
  | { kind: 'auto'; items: ThreadMessage[]; key: string };

function buildRenderItems(messages: ThreadMessage[]): RenderItem[] {
  const out: RenderItem[] = [];
  let day = '';
  let autoRun: ThreadMessage[] = [];
  let prev: ThreadMessage | null = null;

  const flushAuto = () => {
    if (autoRun.length > 0) {
      out.push({ kind: 'auto', items: autoRun, key: `auto-${autoRun[0].id || autoRun[0].at}` });
      autoRun = [];
    }
  };

  for (const m of messages) {
    const d = formatSessionDate(m.at) || 'Earlier';
    if (d !== day) {
      flushAuto();
      day = d;
      out.push({ kind: 'day', label: d, key: `day-${d}-${m.at}` });
      prev = null;
    }
    if (m.who === 'host' && m.via === 'guesty_auto') {
      autoRun.push(m);
      prev = m;
      continue;
    }
    flushAuto();
    // Same speaker continuing within ~20 min: drop the repeated label so a
    // burst reads as one voice.
    const showLabel =
      !prev ||
      prev.who !== m.who ||
      prev.via !== m.via ||
      Math.abs(new Date(m.at).getTime() - new Date(prev.at).getTime()) > 20 * 60_000;
    out.push({ kind: 'message', m, showLabel, key: m.id || `${m.at}-${m.body.slice(0, 12)}` });
    prev = m;
  }
  flushAuto();
  return out;
}

export function ThreadPanel({
  conversationId,
  guestFirst,
  channel,
  module,
  listingId,
  canSend = false,
  noSendNote,
  maxHeight = 520,
}: Props) {
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!opts?.quiet) setRefreshing(true);
      const res = await fetchThread(conversationId);
      if (res.ok) {
        setMessages(res.messages);
        setError(null);
      } else if (!opts?.quiet) {
        setError(res.error);
      }
      setRefreshing(false);
    },
    [conversationId],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Keep an open thread breathing without any interaction: a quiet refetch
  // every 20s, skipped while the tab is hidden.
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) load({ quiet: true });
    }, REFETCH_MS);
    return () => clearInterval(t);
  }, [load]);

  // Land on the newest message, and stay pinned to the bottom across quiet
  // refetches unless the operator has scrolled up to read history.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && messages && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  if (messages === null && !error) {
    return (
      <div style={{ borderTop: '1px solid var(--rule)', padding: '16px 0', fontSize: 13, color: 'var(--ink-3)' }}>
        Loading the conversation from Guesty…
      </div>
    );
  }

  if (error && messages === null) {
    return (
      <div style={{ borderTop: '1px solid var(--rule)', padding: '16px 0', fontSize: 13 }}>
        <span style={{ color: 'var(--signal)' }}>{error}</span>{' '}
        <button
          type="button"
          onClick={() => load()}
          className="eyebrow"
          style={{ color: 'var(--ink-3)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', marginLeft: 8 }}
        >
          Retry
        </button>
      </div>
    );
  }

  const items = buildRenderItems(messages || []);

  return (
    <div style={{ borderTop: '1px solid var(--rule)' }}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ maxHeight, overflowY: 'auto', padding: '14px 2px 6px' }}
      >
        {items.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: '6px 0 12px' }}>
            No messages on this conversation yet.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((item) => {
            if (item.kind === 'day') {
              return (
                <div
                  key={item.key}
                  className="font-serif"
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: 'var(--ink-2)',
                    paddingTop: 10,
                    borderTop: '1px solid var(--rule-soft, var(--rule))',
                  }}
                >
                  {item.label}
                </div>
              );
            }
            if (item.kind === 'auto') {
              return <AutoRunRow key={item.key} items={item.items} />;
            }
            return (
              <MessageRow
                key={item.key}
                m={item.m}
                showLabel={item.showLabel}
                guestFirst={guestFirst}
              />
            );
          })}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          padding: '8px 0',
          borderTop: '1px solid var(--rule-soft, var(--rule))',
        }}
      >
        <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
          Live from Guesty · refreshes every {REFETCH_MS / 1000}s
        </span>
        <button
          type="button"
          onClick={() => load()}
          disabled={refreshing}
          className="eyebrow"
          style={{
            color: 'var(--ink-3)',
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: refreshing ? 'wait' : 'pointer',
            marginLeft: 'auto',
          }}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {!canSend && noSendNote && (
        <div
          style={{
            borderTop: '1px solid var(--rule)',
            padding: '12px 0 4px',
            fontSize: 12,
            color: 'var(--ink-4)',
            fontStyle: 'italic',
          }}
        >
          {noSendNote}
        </div>
      )}

      {canSend && (
        <Composer
          conversationId={conversationId}
          channel={channel}
          module={module}
          listingId={listingId}
          onSent={(text) => {
            // Optimistic append so the reply is visible instantly; the next
            // quiet refetch reconciles with Guesty's canonical thread.
            setMessages((cur) => [
              ...(cur || []),
              {
                id: `local-${(cur || []).length}-${text.length}`,
                body: text,
                at: new Date().toISOString(),
                who: 'host',
                via: 'operator',
                sender_name: '',
              },
            ]);
            stickToBottomRef.current = true;
            setTimeout(() => load({ quiet: true }), 4_000);
          }}
        />
      )}
    </div>
  );
}

function MessageRow({
  m,
  showLabel,
  guestFirst,
}: {
  m: ThreadMessage;
  showLabel: boolean;
  guestFirst: string;
}) {
  const isGuest = m.who === 'guest';
  const handled = isGuest ? handledLabel(m) : '';
  const topic = isGuest && m.topic ? prettifyTopic(m.topic) : '';
  const container: React.CSSProperties = isGuest
    ? { borderLeft: '2px solid var(--rule)', paddingLeft: 12 }
    : { paddingLeft: 24, position: 'relative' };
  return (
    <div style={container}>
      {!isGuest && (
        <span aria-hidden style={{ position: 'absolute', left: 8, top: 0, color: 'var(--ink-4)', fontSize: 12 }}>
          ›
        </span>
      )}
      {showLabel && (
        <div className="eyebrow" style={{ color: 'var(--ink-3)', marginBottom: 3, display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span>{isGuest ? guestFirst || 'Guest' : hostLabel(m)}</span>
          <span style={{ color: 'var(--ink-4)', fontWeight: 400, letterSpacing: '0.08em' }} title={m.at}>
            {formatClockRange(m.at)}
          </span>
        </div>
      )}
      <p
        style={{
          margin: 0,
          fontSize: 14,
          lineHeight: 1.55,
          color: isGuest ? 'var(--ink)' : 'var(--ink-2)',
          whiteSpace: 'pre-wrap',
        }}
        title={showLabel ? undefined : m.at}
      >
        {m.body}
      </p>
      {(topic || handled) && (
        <div className="eyebrow" style={{ marginTop: 3, color: 'var(--ink-4)', fontSize: 9 }}>
          {[topic, handled].filter(Boolean).join(' · ')}
        </div>
      )}
    </div>
  );
}

/** N consecutive Guesty-automation posts, folded to one quiet line. This is
 * most of the noise in a Guesty thread (confirmation, welcome, agreement,
 * check-in details…); the fold keeps the human conversation readable while
 * keeping every template one click away. */
function AutoRunRow({ items }: { items: ThreadMessage[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ paddingLeft: 24 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="eyebrow"
        style={{ color: 'var(--ink-4)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
        title={items[0]?.at}
      >
        {items.length === 1
          ? `1 automated message ${open ? '▴' : '▾'}`
          : `${items.length} automated messages ${open ? '▴' : '▾'}`}
      </button>
      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((m) => (
            <div key={m.id || m.at} style={{ borderLeft: '2px solid var(--rule-soft, var(--rule))', paddingLeft: 10 }}>
              <div className="eyebrow" style={{ color: 'var(--ink-4)', marginBottom: 2, fontSize: 9 }} title={m.at}>
                Guesty automation · {formatClockRange(m.at)}
              </div>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-4)', whiteSpace: 'pre-wrap' }}>
                {m.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Composer({
  conversationId,
  channel,
  module,
  listingId,
  onSent,
}: {
  conversationId: string;
  channel: string;
  module: string;
  listingId?: string;
  onSent: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSend = () => {
    setError(null);
    const body = text;
    startTransition(async () => {
      const res = await sendThreadMessage(conversationId, body, module, listingId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setText('');
      onSent(body.trim());
    });
  };

  return (
    <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Write to the guest. Sends as-is via ${channel || 'Guesty'}; the AI won't touch it.`}
        rows={Math.max(2, Math.min(8, text.split('\n').length + 1))}
        style={{
          width: '100%',
          padding: 10,
          border: '1px solid var(--rule)',
          background: 'var(--paper)',
          fontFamily: 'inherit',
          fontSize: 14,
          lineHeight: 1.55,
          color: 'var(--ink)',
          resize: 'vertical',
        }}
      />
      {error && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--signal)', fontWeight: 500 }} role="alert">
          {error}
        </p>
      )}
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={handleSend}
          disabled={isPending || !text.trim()}
          aria-busy={isPending || undefined}
          style={{
            background: isPending || !text.trim() ? 'var(--ink-4)' : 'var(--ink)',
            color: 'var(--paper)',
            border: 'none',
            padding: '10px 18px',
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            fontWeight: 700,
            cursor: isPending || !text.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          {isPending ? 'Sending…' : `Send · ${channel || 'Guesty'}`}
        </button>
        <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
          Sends through Guesty on this guest&rsquo;s channel
        </span>
      </div>
    </div>
  );
}
