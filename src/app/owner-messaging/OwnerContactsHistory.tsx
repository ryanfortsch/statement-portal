'use client';

import { useMemo, useState } from 'react';
import { Section } from '@/components/Section';
import type { OwnerContactHistory } from '@/lib/stay-concierge';
import {
  prettifySlug,
  prettifyTopic,
  relativeTimeShort,
  formatSessionDate,
  formatClockRange,
} from '@/app/messaging/format';
import {
  buildSessions,
  SESSIONS_OPEN_DEFAULT,
  type Session,
  type Run,
  type OrphanReaction,
} from './conversation';

type Props = { initialContacts: OwnerContactHistory[] };

/**
 * Per-contact history for /owner-messaging, rendered as an editorial
 * transcript. Each owner collapses to a header row; expanding reveals the
 * conversation split into dated sessions (buildSessions). Within a session,
 * consecutive same-side messages cluster into one keylined run under a single
 * timestamp, and iMessage tapbacks hang as a small glyph on the message they
 * reacted to instead of sprawling as their own bubble.
 */
export function OwnerContactsHistory({ initialContacts }: Props) {
  if (initialContacts.length === 0) {
    return (
      <Section
        title="Contacts"
        eyebrow="Per-owner history"
        paddingTop={36}
        empty
        emptyMessage="No owner conversations yet. Once an owner texts or emails, their thread shows up here."
      />
    );
  }

  return (
    <Section title="Contacts" eyebrow="Per-owner history · last 60 days" paddingTop={36}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {initialContacts.map((c) => (
          <ContactRow key={c.owner_contact} contact={c} />
        ))}
      </ul>
    </Section>
  );
}

function ContactRow({ contact }: { contact: OwnerContactHistory }) {
  const [open, setOpen] = useState(false);
  const propertyLabel =
    contact.property_name || prettifySlug(contact.property_id) || '(no property)';
  const lastRel = relativeTimeShort(contact.last_at);
  const firstName = (contact.owner_name || '').trim().split(/\s+/)[0] || '';

  return (
    <li style={{ borderTop: '1px solid var(--rule)', padding: '14px 0' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 12,
          alignItems: 'baseline',
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span
            className="font-serif"
            style={{ fontSize: 16, fontWeight: 500, letterSpacing: '-0.005em', color: 'var(--ink)' }}
          >
            {contact.owner_name || contact.owner_contact}
          </span>
          <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
            {propertyLabel}
          </span>
          <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
            {contact.inbound_count} in · {contact.sent_count} sent
          </span>
        </div>
        <span className="eyebrow" style={{ color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>
          {lastRel ? `last ${lastRel}` : '—'}
          <span style={{ marginLeft: 10 }}>{open ? '▴' : '▾'}</span>
        </span>
      </button>

      {open && <Transcript messages={contact.messages} firstName={firstName} />}
    </li>
  );
}

function Transcript({
  messages,
  firstName,
}: {
  messages: OwnerContactHistory['messages'];
  firstName: string;
}) {
  // Newest session first. buildSessions returns oldest-first.
  const sessions = useMemo(() => buildSessions(messages).reverse(), [messages]);
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(sessions.slice(0, SESSIONS_OPEN_DEFAULT).map((s) => s.id)),
  );
  const [showAll, setShowAll] = useState(false);

  if (sessions.length === 0) {
    return (
      <div style={{ marginTop: 12, fontSize: 13, color: 'var(--ink-4)' }}>No messages in range.</div>
    );
  }

  const collapsedCount = sessions.filter((s) => !openIds.has(s.id)).length;
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column' }}>
      {sessions.map((s, i) =>
        openIds.has(s.id) ? (
          <OpenSession key={s.id} session={s} firstName={firstName} isFirst={i === 0} onCollapse={() => toggle(s.id)} />
        ) : (
          <CollapsedSession key={s.id} session={s} firstName={firstName} onExpand={() => toggle(s.id)} />
        ),
      )}
      {!showAll && collapsedCount > SESSIONS_OPEN_DEFAULT && (
        <button
          type="button"
          onClick={() => {
            setOpenIds(new Set(sessions.map((s) => s.id)));
            setShowAll(true);
          }}
          className="eyebrow"
          style={{
            all: 'unset',
            cursor: 'pointer',
            marginTop: 10,
            color: 'var(--ink-4)',
            alignSelf: 'flex-start',
          }}
        >
          Show all {sessions.length} conversations →
        </button>
      )}
    </div>
  );
}

function SessionHeader({
  session,
  firstName,
  isFirst,
  right,
}: {
  session: Session;
  firstName: string;
  isFirst: boolean;
  right: React.ReactNode;
}) {
  const metaParts: string[] = [];
  if (session.inbound > 0) metaParts.push(`${session.inbound} from ${firstName || 'owner'}`);
  if (session.sent > 0) metaParts.push(`${session.sent} ${session.sent === 1 ? 'reply' : 'replies'}`);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 16,
        borderTop: isFirst ? 'none' : '1px solid var(--rule)',
        paddingTop: isFirst ? 4 : 14,
        marginBottom: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span className="font-serif" style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>
          {formatSessionDate(session.startAt)}
        </span>
        {session.topic && (
          <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
            {prettifyTopic(session.topic)}
          </span>
        )}
        {metaParts.length > 0 && (
          <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
            {metaParts.join(' · ')}
          </span>
        )}
      </div>
      {right}
    </div>
  );
}

function OpenSession({
  session,
  firstName,
  isFirst,
  onCollapse,
}: {
  session: Session;
  firstName: string;
  isFirst: boolean;
  onCollapse: () => void;
}) {
  return (
    <div style={{ padding: '18px 0 16px' }}>
      <SessionHeader
        session={session}
        firstName={firstName}
        isFirst={isFirst}
        right={
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse conversation"
            className="eyebrow"
            style={{ all: 'unset', cursor: 'pointer', color: 'var(--ink-4)' }}
          >
            ▴
          </button>
        }
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
        {session.blocks.map((b, i) =>
          b.kind === 'run' ? (
            <RunBlock key={`${b.at}-${i}`} run={b.run} firstName={firstName} sessionChannel={session.channel} />
          ) : (
            <OrphanLine key={`${b.at}-${i}`} reaction={b.reaction} firstName={firstName} />
          ),
        )}
      </div>
    </div>
  );
}

function CollapsedSession({
  session,
  firstName,
  onExpand,
}: {
  session: Session;
  firstName: string;
  onExpand: () => void;
}) {
  // Preview: last inbound text in the session, truncated.
  const lastInbound = [...session.blocks]
    .reverse()
    .find((b) => b.kind === 'run' && b.run.side === 'owner');
  const previewText =
    lastInbound && lastInbound.kind === 'run'
      ? lastInbound.run.events[lastInbound.run.events.length - 1].text
      : '';
  const preview = previewText.replace(/\s+/g, ' ').trim().slice(0, 72);
  const glyphs = collectGlyphs(session);

  return (
    <button
      type="button"
      onClick={onExpand}
      aria-expanded={false}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'block',
        width: '100%',
        borderTop: '1px solid var(--rule)',
        padding: '12px 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span className="font-serif" style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink-2)' }}>
            {formatSessionDate(session.startAt)}
          </span>
          {session.topic && (
            <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
              {prettifyTopic(session.topic)}
            </span>
          )}
          <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
            {session.messageCount} {session.messageCount === 1 ? 'message' : 'messages'}
          </span>
          {glyphs && (
            <span style={{ fontSize: 12 }} aria-hidden="true">
              {glyphs}
            </span>
          )}
        </div>
        <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
          ▾
        </span>
      </div>
      {preview && (
        <div
          style={{
            marginTop: 5,
            fontSize: 13,
            color: 'var(--ink-3)',
            lineHeight: 1.5,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {preview}
          {previewText.length > 72 ? '…' : ''}
        </div>
      )}
    </button>
  );
}

function collectGlyphs(session: Session): string {
  const g: string[] = [];
  for (const b of session.blocks) {
    if (b.kind === 'run') for (const r of b.run.reactions) g.push(r.glyph);
    else g.push(b.reaction.glyph);
  }
  return g.slice(0, 6).join(' ');
}

function RunBlock({
  run,
  firstName,
  sessionChannel,
}: {
  run: Run;
  firstName: string;
  sessionChannel: string;
}) {
  const isOwner = run.side === 'owner';
  const isEscalated = run.kind === 'escalated';
  const isSkipped = run.kind === 'draft_skipped';
  const isSentOutside = run.kind === 'sent_outside';

  let label: string;
  if (isOwner) label = firstName || 'Owner';
  else if (isEscalated) label = 'escalated';
  else if (isSkipped) label = 'draft skipped';
  else if (isSentOutside) label = 'Helm · replied directly';
  else label = 'Helm';

  // Column treatment: owner + escalated flush-left with a keyline; our replies
  // indent under a quiet chevron. Escalation is the only place color appears.
  const containerStyle: React.CSSProperties = isOwner
    ? { borderLeft: '2px solid var(--rule)', paddingLeft: 12 }
    : isEscalated
      ? { borderLeft: '2px solid var(--signal)', paddingLeft: 12 }
      : { paddingLeft: 24 };

  const bodyColor = isOwner
    ? 'var(--ink)'
    : isEscalated
      ? 'var(--ink-2)'
      : isSkipped
        ? 'var(--ink-4)'
        : isSentOutside
          ? 'var(--ink-3)'
          : 'var(--ink-2)';

  const labelColor = isEscalated ? 'var(--signal)' : 'var(--ink-3)';

  const chanTok =
    run.channel && run.channel !== sessionChannel
      ? run.channel === 'email_gmail'
        ? ' · email'
        : ' · text'
      : '';

  const clock = formatClockRange(run.startAt, run.endAt);

  return (
    <div style={containerStyle}>
      <div className="eyebrow" style={{ color: labelColor, marginBottom: 4 }}>
        {!isOwner && <span aria-hidden="true" style={{ color: 'var(--ink-4)', marginRight: 6 }}>›</span>}
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {run.events.map((ev, i) => (
          <p
            key={`${ev.at}-${i}`}
            title={ev.at}
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.55,
              color: bodyColor,
              whiteSpace: 'pre-wrap',
              fontStyle: isSkipped ? 'italic' : 'normal',
              opacity: isSkipped ? 0.85 : 1,
            }}
          >
            {ev.text}
          </p>
        ))}
      </div>
      <div
        className="eyebrow"
        style={{ marginTop: 4, fontSize: 9, color: 'var(--ink-4)' }}
        title={run.endAt}
      >
        {clock}
        {chanTok}
        {run.reactions.length > 0 && (
          <span
            style={{ marginLeft: 8, fontSize: 11 }}
            title={`${firstName || 'Owner'} reacted`}
          >
            {run.reactions.map((r) => r.glyph).join(' ')}
          </span>
        )}
      </div>
    </div>
  );
}

function OrphanLine({ reaction, firstName }: { reaction: OrphanReaction; firstName: string }) {
  const quoted = reaction.quoted.replace(/\s+/g, ' ').trim().slice(0, 40);
  return (
    <div
      style={{
        paddingLeft: 24,
        fontSize: 11,
        fontStyle: 'italic',
        color: 'var(--ink-4)',
        lineHeight: 1.5,
      }}
      title={reaction.at}
    >
      {firstName || 'Owner'} reacted {reaction.glyph} “{quoted}
      {reaction.quoted.length > 40 ? '…' : ''}”
    </div>
  );
}
