/**
 * Who actually wrote an email that one of our Google Groups relayed.
 *
 * statements@ and onboarding@ are Google Groups. When an owner writes to one
 * and the group re-sends the mail under its own address ("'Lisa Gruber' via
 * Statements" <statements@risingtidestr.com>), the owner survives only in
 * X-Original-Sender (and X-Original-From). Reading the From line alone filed
 * Lisa Gruber's 2026-11-01 email as one we sent. stay-concierge's owner
 * watcher carries the same rule (`_owner_sender`, OWNER_RELAY_GROUP_ADDRESSES).
 *
 * Only our own groups are unwrapped, so an outside list cannot pass a message
 * off as a contact's, and our own sends from a group address stay ours.
 */

export const RELAY_GROUP_ADDRESSES: readonly string[] = [
  'statements@risingtidestr.com',
  'onboarding@risingtidestr.com',
];

/** Bare lower-cased address from "Name <addr@x.y>" or a bare address. */
export function headerAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/<([^>]+)>/);
  const raw = (match ? match[1] : value).trim().toLowerCase();
  return raw.includes('@') ? raw : null;
}

/** The sender: the From address, or the original sender when the From is one of our relay groups. */
export function originalSender(
  header: (name: string) => string | null,
  relays: readonly string[] = RELAY_GROUP_ADDRESSES,
): string | null {
  const from = headerAddress(header('From'));
  if (!from || !relays.includes(from)) return from;
  return headerAddress(header('X-Original-Sender')) ?? headerAddress(header('X-Original-From')) ?? from;
}
