/** Quo-shaped signed receipt rehearsal. No HTTP route, real credentials or SMS access. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { assertCleanerFixture, isCleanerFixtureId, type CleanerDeliveryStorage } from './cleaner-delivery-worker.ts';
import { cleanerDeliverySummary } from './cleaner-delivery.ts';
import type { DeliveryRecord, StoredCleanerDelivery } from './cleaner-delivery-history.ts';

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Malformed receipt');
  return value as ObjectValue;
}
/** Mirrors the documented Quo signature format, with explicit test credentials only. */
function authenticate(rawBody: string, signature: string | null, key: string, now: number): ObjectValue {
  if (typeof rawBody !== 'string' || Buffer.byteLength(rawBody) > 65536 || !Number.isSafeInteger(now)
      || typeof key !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(key)
      || Buffer.from(key, 'base64').length < 32 || Buffer.from(key, 'base64').toString('base64') !== key) throw Error('Invalid receipt authentication input');
  const match = signature?.match(/^hmac;1;(\d{13});([A-Za-z0-9+/]{43}=)$/);
  if (!match || Math.abs(now - Number(match[1])) > 300000) throw Error('Receipt signature missing, malformed or expired');
  let body: ObjectValue;
  try { body = object(JSON.parse(rawBody)); } catch { throw Error('Malformed receipt'); }
  const computed = createHmac('sha256', Buffer.from(key, 'base64')).update(`${match[1]}.${JSON.stringify(body)}`).digest();
  const supplied = Buffer.from(match[2], 'base64');
  if (computed.length !== supplied.length || !timingSafeEqual(computed, supplied)) throw Error('Receipt signature mismatch');
  return body;
}

export type VerifiedCleanerReceipt = { id: string; providerId: string; recipientId: string };
export type CleanerReceiptInput = { rawBody: string; signature: string | null; testSigningKey: string; now: number };

export function verifyCleanerDeliveryReceipt(input: CleanerReceiptInput): VerifiedCleanerReceipt {
  const body = authenticate(input.rawBody, input.signature, input.testSigningKey, input.now);
  const message = object(object(body.data).object);
  if (!isCleanerFixtureId(body.id) || body.type !== 'message.delivered'
      || !isCleanerFixtureId(message.id) || message.phoneNumberId !== 'HELMTEST-ops-line'
      || message.direction !== 'outgoing' || message.status !== 'delivered'
      || !Array.isArray(message.to) || message.to.length !== 1 || !isCleanerFixtureId(message.to[0])) {
    throw Error('Only fictional outbound delivered receipts on the rehearsal line are supported');
  }
  return validateCleanerReceipt({ id: body.id, providerId: message.id, recipientId: message.to[0] });
}

/** Storage accepts only this minimal normalized evidence, never the raw payload. */
export function validateCleanerReceipt(value: unknown): VerifiedCleanerReceipt {
  const row = object(value);
  if (Object.keys(row).sort().join(',') !== 'id,providerId,recipientId'
      || !isCleanerFixtureId(row.id) || !isCleanerFixtureId(row.providerId)
      || typeof row.recipientId !== 'string' || !['HELMTEST-cleaner-a', 'HELMTEST-cleaner-b'].includes(row.recipientId)) throw Error('Invalid fictional receipt');
  return { id: row.id, providerId: row.providerId, recipientId: row.recipientId };
}

export function planCleanerReceipt(current: StoredCleanerDelivery, value: VerifiedCleanerReceipt): DeliveryRecord | null {
  const receipt = validateCleanerReceipt(value);
  assertCleanerFixture(current.ledger.messageId, current.ledger.recipients.map(r => r.recipientId));
  // A recipient match alone cannot bind an unknown provider message to an attempt.
  const matches = current.ledger.recipients.flatMap(recipient => recipient.attempts
    .filter(attempt => attempt.providerId === receipt.providerId).map(attempt => ({ recipient, attempt })));
  if (matches.length !== 1) return null;
  const { recipient, attempt } = matches[0];
  if (recipient.recipientId !== receipt.recipientId) throw Error('Receipt recipient does not match the provider attempt');
  return { id: `receipt:${receipt.id}`, event: { type: 'result', recipientId: recipient.recipientId,
    attemptId: attempt.id, state: 'delivered', providerId: receipt.providerId } };
}

/** Direct reconciliation helper for existing fixtures. Ingest new events through the durable inbox. */
export async function reconcileCleanerDeliveryReceipt(input: CleanerReceiptInput & { store: CleanerDeliveryStorage }) {
  const evidence = verifyCleanerDeliveryReceipt(input);
  const current = await input.store.read();
  const planned = planCleanerReceipt(current, evidence);
  if (!planned) return { status: 'unmatched-provider' as const, canSend: false as const };
  const saved = await input.store.append(current.version, planned);
  return { status: saved.appended ? 'recorded' as const : 'duplicate' as const,
    summary: cleanerDeliverySummary(saved.state.ledger), canSend: false as const };
}
