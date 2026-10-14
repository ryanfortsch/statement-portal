/** Synthetic per-recipient ledger. No transport, persistence or live send permission. */
export type DeliveryState = 'sending' | 'accepted' | 'delivered' | 'unknown' | 'rejected';
export type Attempt = { id: string; state: DeliveryState; providerId: string | null };
export type RecipientDelivery = { recipientId: string; attempts: readonly Attempt[] };
export type CleanerDelivery = { messageId: string; recipients: readonly RecipientDelivery[] };
export type DeliveryEvent =
  | { type: 'start'; recipientId: string; attemptId: string }
  | { type: 'result'; recipientId: string; attemptId: string; state: DeliveryState; providerId?: string };

function nonempty(value: string) { return typeof value === 'string' && value.trim().length > 0; }
export function createCleanerDelivery(messageId: string, recipientIds: readonly string[]): CleanerDelivery {
  if (!nonempty(messageId) || !recipientIds.length || recipientIds.some(id => !nonempty(id))
      || new Set(recipientIds).size !== recipientIds.length) throw Error('Unique message and recipient identities required');
  return { messageId, recipients: recipientIds.map(recipientId => ({ recipientId, attempts: [] })) };
}
/** Rejected means authoritative evidence that the provider did not accept the send.
 * Timeouts, generic HTTP errors and missing receipts must be unknown, not rejected. */
export function recipientDisposition(recipient: RecipientDelivery) {
  if (recipient.attempts.some(a => a.state === 'delivered')) return 'delivered';
  if (recipient.attempts.some(a => a.state === 'accepted')) return 'await-delivery';
  if (recipient.attempts.some(a => a.state === 'sending' || a.state === 'unknown')) return 'reconcile';
  return recipient.attempts.length ? 'retry-review' : 'not-attempted';
}
export function applyCleanerDelivery(ledger: CleanerDelivery, event: DeliveryEvent): CleanerDelivery {
  if (!nonempty(event.attemptId)) throw Error('Attempt identity required');
  const recipient = ledger.recipients.find(r => r.recipientId === event.recipientId);
  if (!recipient) throw Error('Recipient is not in the frozen delivery list');
  const previous = recipient.attempts.find(a => a.id === event.attemptId);
  let attempts: readonly Attempt[];
  if (event.type === 'start') {
    // Replaying an existing claim is a no-op, never a second transport request.
    if (previous) return ledger;
    if (ledger.recipients.some(r => r.attempts.some(a => a.id === event.attemptId))) throw Error('Attempt identity already used');
    if (!['not-attempted', 'retry-review'].includes(recipientDisposition(recipient))) throw Error('Reconcile prior delivery before another attempt');
    attempts = [...recipient.attempts, { id: event.attemptId, state: 'sending', providerId: null }];
  } else {
    if (!previous) throw Error('Result has no matching attempt');
    if (event.state === 'sending') throw Error('A result cannot restart an attempt');
    if (event.providerId !== undefined && !nonempty(event.providerId)) throw Error('Invalid provider identity');
    if (previous.providerId && event.providerId && previous.providerId !== event.providerId) throw Error('Provider identity conflict');
    const providerId = previous.providerId ?? event.providerId ?? null;
    if (['accepted', 'delivered'].includes(event.state) && !providerId) throw Error('Provider identity required for acceptance or delivery');
    if (providerId && ledger.recipients.some(r => r.attempts.some(a => a.id !== event.attemptId && a.providerId === providerId))) throw Error('Provider identity already belongs to another attempt');
    // Positive delivery evidence cannot be downgraded by late/duplicate errors.
    const state = previous.state === 'delivered' ? 'delivered'
      : previous.state === 'accepted' && event.state !== 'delivered' ? 'accepted' : event.state;
    attempts = recipient.attempts.map(a => a.id === event.attemptId ? { ...a, state, providerId } : a);
  }
  return { ...ledger, recipients: ledger.recipients.map(r => r === recipient ? { ...r, attempts } : r) };
}
export function cleanerDeliverySummary(ledger: CleanerDelivery) {
  const recipients = ledger.recipients.map(r => ({ recipientId: r.recipientId, disposition: recipientDisposition(r) }));
  return { recipients, allDelivered: recipients.every(r => r.disposition === 'delivered'), canSend: false as const };
}
