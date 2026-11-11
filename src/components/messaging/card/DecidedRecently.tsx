'use client';

/**
 * "Decided recently": the one ledger under the queue on every inbox (the
 * guest queue's alone until 2026-10-18). Two kinds of row:
 *
 * - cards marked handled in the last hours that can still be reversed, with
 *   Undo. Dotti rejected a 65 Calderwood lead by mistake on 2026-09-20 and
 *   had no way back. The toast is the fast undo; this is the fallback for
 *   anything older, or decided on another device.
 * - resolved messages of the past 7 days that filed work, a note or a
 *   schedule change, each with one "Filed" line (Follow-up history folded in
 *   here, audit 2026-11-07). A sent reply appears only for what it filed,
 *   and has no Undo: it is with the person.
 *
 * Three rows, then it folds. With `followups`, the Filed lines stay live:
 * the ledger re-reads /api/messaging/followups every 30 seconds while the
 * tab is visible, and a failed read keeps the last confirmed lines.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { relativeTimeShort, statusToneColor } from '@/app/messaging/format';
import { scheduleUpdateLabel } from '@/lib/checkout-commitment';
import { NOTE_ROUTES, noteStatus, workStatus, workError, type MessageOutcomes } from '@/lib/message-outcomes';
import type { CardResult } from './types';
import { Button } from '@/components/Button';
import { CARD_AUDIENCE, hasFiled, mergeDecidedLedger, type DecidedRow, type FollowupAudience, type FollowupFeed, type LedgerFollowup } from './decided-ledger';

export type { DecidedRow };

// One word. A card closed without a reply is Handled whether the service
// filed it as rejected (the Reject verb, retired 2026-10-17) or manual_sent.
const LABELS: Record<string, string> = {
  rejected: 'Handled',
  manual_sent: 'Handled',
  approved: 'Sent',
};

const DEFAULT_VISIBLE = 3;

/** Live follow-ups for the audiences the page loaded. */
function useFollowups(feed?: FollowupFeed) {
  const [snapshot, setSnapshot] = useState<{ items: LedgerFollowup[]; error: boolean }>(() => ({ items: feed?.initial ?? [], error: !!feed?.error }));
  const active = useRef<AbortController | null>(null);
  const audiences = (feed?.audiences ?? []).join(',');
  const refresh = useCallback(async () => {
    if (!audiences) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 18000);
    try {
      const lists = await Promise.all(audiences.split(',').map(async (a) => {
        const res = await fetch(`/api/messaging/followups?audience=${a}`, { cache: 'no-store', signal: controller.signal });
        if (!res.ok) throw new Error('unavailable');
        const data = await res.json();
        if (!Array.isArray(data.items)) throw new Error('invalid');
        const audience = CARD_AUDIENCE[a as FollowupAudience];
        return (data.items as LedgerFollowup[]).map((f) => (audience ? { ...f, audience } : f));
      }));
      if (active.current === controller) setSnapshot({ items: lists.flat(), error: false });
    } catch {
      if (active.current === controller) setSnapshot((s) => ({ ...s, error: true }));
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) active.current = null;
    }
  }, [audiences]);
  const initial = feed?.initial;
  useEffect(() => {
    if (!audiences) return;
    const timer = setInterval(() => { if (!document.hidden && !active.current) void refresh(); }, 30000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    // Also reconciles freshly resolved cards when the page re-renders.
    const first = setTimeout(() => void refresh(), 0);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      const current = active.current;
      active.current = null;
      current?.abort();
    };
  }, [refresh, audiences, initial]);
  return { ...snapshot, refresh };
}

export function DecidedRecently({ items, undo, followups }: { items: DecidedRow[]; undo: (id: string, audience?: string) => Promise<CardResult>; followups?: FollowupFeed }) {
  const [expanded, setExpanded] = useState(false);
  const live = useFollowups(followups);
  const rows = useMemo(() => mergeDecidedLedger(items, live.items), [items, live.items]);
  if (rows.length === 0 && !live.error) return null;
  const visible = expanded ? rows : rows.slice(0, DEFAULT_VISIBLE);
  const hidden = rows.length - visible.length;

  return (
    <section
      aria-label="Decided recently"
      className="max-w-[1100px] mx-auto px-10"
      style={{ width: '100%', marginTop: 8, paddingBottom: 16 }}
    >
      <div
        className="eyebrow"
        style={{ display: 'flex', alignItems: 'baseline', gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--rule)' }}
      >
        <span style={{ color: 'var(--ink-3)' }}>Decided recently</span>
      </div>
      {live.error && (
        <p role="status" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--signal)' }}>
          Couldn’t load what these messages filed. The last loaded lines are shown.{' '}
          <Button variant="quiet" onClick={() => void live.refresh()}>Retry</Button>
        </p>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {visible.map((row) => {
          const who = (row.decidedBy || '').split('@')[0];
          const quote = (row.quote || '').replace(/\s+/g, ' ').trim();
          return (
            <li
              key={row.id}
              className="rt-msg-decided-row"
              style={{
                display: 'grid',
                gridTemplateColumns: '132px minmax(0, 1fr) auto auto',
                alignItems: 'center',
                columnGap: 16,
                padding: '10px 0',
                borderBottom: '1px solid var(--rule-soft)',
                fontSize: 13,
              }}
            >
              <span className="eyebrow" style={{ color: statusToneColor(row.status), fontWeight: 600, whiteSpace: 'nowrap' }}>
                {LABELS[row.status] || row.status}
              </span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={quote || undefined}>
                <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{row.name}</span>
                {row.property && <span style={{ color: 'var(--ink-3)' }}> · {row.property}</span>}
                {quote && <span style={{ color: 'var(--ink-4)' }}> · “{quote}”</span>}
              </span>
              <span suppressHydrationWarning style={{ color: 'var(--ink-4)', fontSize: 11, whiteSpace: 'nowrap' }} title={row.at || undefined}>
                {relativeTimeShort(row.at || '')}
                {who ? ` · ${who}` : ''}
              </span>
              {row.undoable === false
                ? <span />
                : <UndoButton id={row.id} undo={row.audience ? (id) => undo(id, row.audience) : undo} />}
              {hasFiled(row.outcomes) && <FiledLine value={row.outcomes!} />}
            </li>
          );
        })}
      </ul>
      {(hidden > 0 || expanded) && (
        <Button variant="quiet" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} style={{ marginTop: 10 }}>
          {expanded ? 'Show fewer' : `Show ${hidden} more`}
        </Button>
      )}
    </section>
  );
}

/** What a message filed, on one line under its row: each work item links to
 *  its page, a note still waiting links to its card, a schedule change to
 *  the schedule. A failure reads in signal. */
function FiledLine({ value }: { value: MessageOutcomes }) {
  const parts: ReactNode[] = [];
  const quiet = { color: 'var(--ink-4)' };
  const bad = { color: 'var(--signal)' };
  const link = { textDecoration: 'underline', textUnderlineOffset: 3 } as const;
  if (value.schedule) {
    parts.push(
      <span key="schedule" style={value.schedule.error ? bad : undefined}>
        <Link href="/turnovers/schedule" style={link}>{scheduleUpdateLabel(value.schedule)}</Link>
      </span>,
    );
  }
  value.work.forEach((work, i) => {
    const status = workStatus(work.status, work.assignee);
    const failed = ['blocked', 'unavailable'].includes(work.status) || !!work.error;
    parts.push(
      <span key={`work-${work.id || i}`} title={workError(work) || undefined}>
        {work.id ? <Link href={`/work/${encodeURIComponent(work.id)}`} style={link}>{work.title}</Link> : work.title}
        <span style={failed ? bad : quiet}> ({status}{work.assignee && work.assignee !== status ? `, ${work.assignee}` : ''})</span>
      </span>,
    );
  });
  value.notes.forEach((note, i) => {
    const label = `note to ${note.recipient || note.audience}`;
    const waiting = !!note.id && ['pending', 'scheduled', 'sending'].includes(note.status);
    parts.push(
      <span key={`note-${note.audience}-${note.id || i}`} title={note.error || note.body || undefined}>
        {waiting ? <Link href={`${NOTE_ROUTES[note.audience]}#approval-${encodeURIComponent(note.id)}`} style={link}>{label}</Link> : label}
        <span style={note.error || note.status === 'failed' ? bad : quiet}> ({noteStatus(note)})</span>
      </span>,
    );
  });
  return (
    <div style={{ gridColumn: '2 / -1', fontSize: 12, color: 'var(--ink-3)', marginTop: 4, minWidth: 0, overflowWrap: 'anywhere' }}>
      <span className="eyebrow" style={{ color: 'var(--ink-4)', marginRight: 6 }}>Filed</span>
      {parts.map((part, i) => <span key={i}>{i > 0 && ' · '}{part}</span>)}
      {value.error && <span style={bad}>{parts.length ? ' · ' : ''}{value.error}</span>}
    </div>
  );
}

/** Reverse a mark-handled from the ledger. A refusal reads back in plain
 *  words next to the button. */
export function UndoButton({ id, undo, label = 'Undo' }: { id: string; undo: (id: string) => Promise<CardResult>; label?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      const res = await undo(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(true);
      router.refresh();
    });
  };

  if (done) {
    return (
      <span className="eyebrow" style={{ color: 'var(--ink-3)', fontWeight: 600 }}>
        Back in queue
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <Button size="sm" onClick={onClick} pending={isPending} pendingLabel="Undoing">
        {label}
      </Button>
      {error && <span style={{ fontSize: 11, color: 'var(--signal, #c85a3a)', maxWidth: 260, textAlign: 'right' }}>{error}</span>}
    </span>
  );
}
