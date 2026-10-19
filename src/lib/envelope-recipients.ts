import { prettyPhone } from './payment-links-text.ts';

/**
 * The To line of a reply envelope, as the card prints it. An SMS number is
 * shown with the name the concierge has for it ("Danielle Ramsey · (617)
 * 293-3378"); Dotti, 2026-10-19: "can't you include the owners names that im
 * sending this to in the to line as well?". The names come from the service
 * with the numbers, never looked up here: the card reads out the send, it
 * does not describe one.
 */
export function toLine(envelope: { channel: string; to: string[]; to_names?: string[] }): string {
  const isEmail = envelope.channel === 'email';
  return envelope.to
    .map((t, i) => {
      if (isEmail) return t;
      const name = (envelope.to_names?.[i] || '').trim();
      return name ? `${name} · ${prettyPhone(t)}` : prettyPhone(t);
    })
    .join(', ');
}
