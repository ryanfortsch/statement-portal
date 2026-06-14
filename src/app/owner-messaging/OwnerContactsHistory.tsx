'use client';

import { useState } from 'react';
import { Section } from '@/components/Section';
import type {
  OwnerContactHistory,
  OwnerHistoryEvent,
} from '@/lib/stay-concierge';
import { prettifySlug, relativeTimeShort } from '@/app/messaging/format';

type Props = { initialContacts: OwnerContactHistory[] };

/**
 * Per-contact history feed for /owner-messaging. Sits below the inbox.
 * Each contact gets a collapsible header (name · property · last activity
 * · counts). Expanding reveals the chronological message stream:
 *  - inbound bubble (the owner's text), left-aligned, paper-2
 *  - sent bubble (our approved + delivered reply), right-aligned, ink
 *  - sent_outside bubble (operator handled it elsewhere — we know the
 *    draft existed but the actual send didn't go through Helm), right,
 *    paper-3
 *  - draft_skipped (rejected/superseded draft), greyed
 *  - escalated (no draft generated; signal-flagged)
 *
 * Owners with no message history yet won't appear here. The contacts
 * registry (Properties → Owner messaging contacts) is the place to add
 * new owners.
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
    <Section
      title="Contacts"
      eyebrow="Per-owner history · last 60 days"
      paddingTop={36}
    >
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
    contact.property_name ||
    prettifySlug(contact.property_id) ||
    '(no property)';
  const lastRel = relativeTimeShort(contact.last_at);

  return (
    <li
      style={{
        borderTop: '1px solid var(--rule)',
        padding: '14px 0',
      }}
    >
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

      {open && (
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            paddingLeft: 14,
            borderLeft: '2px solid var(--rule)',
          }}
        >
          {contact.messages.map((m, i) => (
            <MessageBubble key={`${m.at}-${i}`} ev={m} />
          ))}
        </div>
      )}
    </li>
  );
}

function MessageBubble({ ev }: { ev: OwnerHistoryEvent }) {
  const isInbound = ev.kind === 'inbound';
  const isSent = ev.kind === 'sent';
  const isSentOutside = ev.kind === 'sent_outside';
  const isSkipped = ev.kind === 'draft_skipped';
  const isEscalated = ev.kind === 'escalated';

  const alignSelf = isInbound ? 'flex-start' : 'flex-end';
  let bg: string = 'var(--paper-2)';
  let color: string = 'var(--ink)';
  let border: string = '1px solid var(--rule)';
  let label = '';

  if (isSent) {
    bg = 'var(--ink)';
    color = 'var(--paper)';
    border = 'none';
    label = 'sent via Helm';
  } else if (isSentOutside) {
    bg = 'var(--paper-3, var(--paper-2))';
    color = 'var(--ink)';
    label = 'replied directly';
  } else if (isSkipped) {
    bg = 'var(--paper-2)';
    color = 'var(--ink-3)';
    label = 'draft skipped';
  } else if (isEscalated) {
    border = '1px solid var(--signal)';
    color = 'var(--signal)';
    label = 'escalated';
  } else if (isInbound) {
    label = 'inbound';
  }

  const relTime = relativeTimeShort(ev.at);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignSelf,
        maxWidth: '78%',
        minWidth: 200,
        gap: 4,
      }}
    >
      <div
        style={{
          background: bg,
          color,
          border,
          padding: '10px 12px',
          fontSize: 14,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          fontStyle: isSkipped ? 'italic' : 'normal',
        }}
      >
        {ev.text}
      </div>
      <div
        className="eyebrow"
        style={{
          color: 'var(--ink-4)',
          fontSize: 9,
          textAlign: isInbound ? 'left' : 'right',
        }}
        title={ev.at}
      >
        {label}
        {ev.topic ? ` · ${ev.topic.replace(/_/g, ' ')}` : ''}
        {relTime ? ` · ${relTime}` : ''}
      </div>
    </div>
  );
}
