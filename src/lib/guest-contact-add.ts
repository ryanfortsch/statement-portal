/**
 * Add contact on /guests/contacts, for an address already on the list.
 *
 * It used to upsert every address as subscribed with marketing consent and
 * mirror it to Resend, so adding someone who had unsubscribed, bounced or
 * marked a campaign as spam quietly put them back on every send (audit
 * 2026-10-17, report 10). An existing contact now keeps its status; only
 * names and tags are saved, and the form says which case it was. Pure, so
 * the action and the form share one wording.
 */

export type AddContactOutcome =
  | { kind: 'added' }
  | { kind: 'updated' }
  | { kind: 'kept'; status: string };

/** Anything but subscribed is a decision the guest (or their mail server) made; Helm keeps it. */
export function keepsExistingStatus(status: string | null | undefined): boolean {
  return !!status && status !== 'subscribed';
}

/** Tags on file plus the ones typed, each once, in order. */
export function mergeTags(onFile: readonly string[] | null | undefined, typed: readonly string[]): string[] {
  return [...new Set([...(onFile ?? []), ...typed])];
}

/** The line the form shows once the add is confirmed. */
export function addContactMessage(outcome: AddContactOutcome | void | null | undefined): string {
  // Anything but a known "already on the list" answer reads as a plain add.
  if (!outcome || (outcome.kind !== 'updated' && outcome.kind !== 'kept')) return 'Contact added';
  if (outcome.kind === 'updated') return 'Already on the list and subscribed. Name and tags saved.';
  switch (outcome.status) {
    case 'unsubscribed':
      return 'Already on the list and unsubscribed, so they stay unsubscribed and get no campaigns. Name and tags saved.';
    case 'bounced':
      return 'Already on the list, and mail to this address bounced, so it stays bounced and gets no campaigns. Name and tags saved.';
    case 'complained':
      return 'Already on the list, and they marked a campaign as spam, so they stay off every send. Name and tags saved.';
    case 'pending':
      return 'Already on the list and not yet confirmed, so they stay pending. Name and tags saved.';
    default:
      return `Already on the list as ${outcome.status}; that stays as it is. Name and tags saved.`;
  }
}
