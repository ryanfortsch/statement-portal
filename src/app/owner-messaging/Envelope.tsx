'use client';

import type { ReplyEnvelope } from '@/lib/stay-concierge';
import { prettyPhone } from '@/lib/payment-links-text';

/** The owner's own subject line, so an email reads as the email it is.
 *  Carried on the envelope because that is where the service already put
 *  it; SMS cards have none and render nothing. */
export function InboundSubject({ envelope }: { envelope?: ReplyEnvelope }) {
  const subject = (envelope?.subject || '').replace(/^re:\s*/i, '').trim();
  if (!subject) return null;
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--ink-2)',
        marginBottom: 4,
        letterSpacing: '-0.005em',
      }}
    >
      {subject}
    </div>
  );
}

/**
 * Where an approved reply actually goes, and the identity it leaves as.
 *
 * The service computes this with the same function its sender builds the
 * outgoing message from, so the block is a readout of behaviour rather than
 * a description of it. Never assemble an envelope here: a recipient list
 * Helm invents is a claim about a send Helm does not perform. When the
 * service sends no envelope (an older build), this renders nothing, because
 * a card showing no recipients is honest and a card guessing them is not.
 */
/**
 * The line under the From address.
 *
 * Whoever the owner wrote to is who answers, preferring the person at the
 * keyboard when they wrote to more than one of us (Ryan, 2026-09-24: "if
 * it's addressed to Allie and Ryan can you have it sent as Ryan ... i
 * (ryan) am the one actually hitting the button"). Gmail silently rewrites
 * a From that is not a verified send-as identity on the sending mailbox, so
 * when the preferred name cannot be used the card says which one it wanted
 * and what is missing, rather than quietly sending as somebody else.
 *
 * Nothing here describes how the send is wired. "Sent from the dotti@
 * mailbox" read as a contradiction of the From line rather than an
 * explanation of it (Dotti, 2026-09-24: "so is this from dotti or allie,
 * im confused").
 */
function fromAside(envelope: ReplyEnvelope): string {
  const { from_reason: reason, preferred_from: wanted, mailbox, from_address: from } = envelope;
  if (reason === 'unverified' && wanted) {
    return `${wanted} was on the owner's email too, but it is not a verified sender on this mailbox yet, so Gmail would rewrite it`;
  }
  if (reason === 'senders_unknown' && wanted) {
    return `meant to answer as ${wanted}, but which senders Gmail will honour could not be checked just now`;
  }
  if (reason === 'addressed') {
    return "the owner wrote to them, so they are the one answering";
  }
  if (mailbox && mailbox !== from) {
    return `${from} lands in the ${mailbox} mailbox, so the reply comes back there`;
  }
  return '';
}

export function Envelope({ envelope }: { envelope?: ReplyEnvelope }) {
  if (!envelope) return null;
  const isEmail = envelope.channel === 'email';
  const to = envelope.to.map((t) => (isEmail ? t : prettyPhone(t))).join(', ');
  if (!to && !envelope.from_address) return null;

  const rows: { label: string; value: string; aside?: string }[] = [];
  if (isEmail) {
    rows.push({
      label: 'From',
      value: envelope.from_name
        ? `${envelope.from_name} <${envelope.from_address}>`
        : envelope.from_address,
      aside: fromAside(envelope),
    });
    rows.push({ label: 'To', value: to || 'nobody, so this card cannot send' });
    rows.push({
      label: 'Cc',
      value: envelope.cc.length ? envelope.cc.join(', ') : 'no one',
      // Says the rule, so a name in this list reads as the owner's choice
      // rather than something the draft decided to add.
      aside: envelope.cc.length ? 'everyone else the owner put on the email' : '',
    });
    if (envelope.reply_to) {
      rows.push({
        label: 'Reply-To',
        value: envelope.reply_to,
        // Replies follow the From. Answering as somebody whose mail Helm
        // does not watch would take the thread out of the queue entirely,
        // so the return address stays on the watched one.
        aside: 'so the answer comes back into Helm and not only to a personal inbox',
      });
    }
    if (envelope.subject) rows.push({ label: 'Subject', value: envelope.subject });
  } else {
    rows.push({
      label: 'Line',
      value: [envelope.from_name, prettyPhone(envelope.from_address)]
        .filter(Boolean)
        .join(' · '),
    });
    rows.push({ label: 'To', value: to || 'nobody, so this card cannot send' });
  }

  const missed = [...envelope.also_outside, ...envelope.also_rising_tide];
  const outside = envelope.also_outside.length > 0;
  let note = '';
  if (!envelope.original_known) {
    note = isEmail
      ? 'Who else the owner addressed was not recorded on this card, so the list above may be short.'
      : 'Quo re-checks this thread for other participants when it sends, so the reply may reach more people than are listed.';
  } else if (missed.length > 0) {
    note = `${missed.join(', ')} ${missed.length === 1 ? 'was' : 'were'} on the message you are answering and will not receive this reply.`;
  }

  return (
    <div
      style={{
        border: '1px solid var(--rule)',
        borderLeft: outside ? '3px solid var(--signal)' : '1px solid var(--rule)',
        background: 'var(--paper)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <span
            className="eyebrow"
            style={{ color: 'var(--ink-4)', minWidth: 58, flexShrink: 0, fontSize: 9 }}
          >
            {r.label}
          </span>
          <span style={{ minWidth: 0 }}>
            <span
              className="font-mono"
              style={{
                fontSize: 12,
                color: 'var(--ink-2)',
                lineHeight: 1.5,
                wordBreak: 'break-word',
              }}
            >
              {r.value}
            </span>
            {r.aside && (
              <span
                style={{
                  display: 'block',
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: 'var(--ink-4)',
                  marginTop: 1,
                }}
              >
                {r.aside}
              </span>
            )}
          </span>
        </div>
      ))}
      {note && (
        <p
          style={{
            margin: '6px 0 0',
            fontSize: 12,
            lineHeight: 1.5,
            color: outside ? 'var(--signal)' : 'var(--ink-3)',
          }}
        >
          {note}
        </p>
      )}
    </div>
  );
}
