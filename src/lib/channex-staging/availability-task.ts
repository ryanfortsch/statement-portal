/** Read-only staging task evidence. API shape observed against the completed
 * isolated Calderwood task on 2026-10-20; not a documented production contract.
 * Account metadata from the task response is intentionally discarded.
 */
import { z } from 'zod';
import { createAvailabilityRequest, validateAvailabilityRequest, validateAvailabilityReceipt } from './availability-request.ts';
import type { InventoryJob } from './inventory-outbox.ts';

const stamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z?$/);
const schema = z.object({ data: z.object({ type: z.literal('task'), id: z.string().uuid(),
  attributes: z.object({ id: z.string().uuid(), task: z.literal('Property.UpdateAvailability'),
    success: z.boolean().nullable(), errors: z.array(z.unknown()),
    received_at: timestamp, executed_at: timestamp.nullable(), finished_at: timestamp.nullable(),
    payload: z.unknown(), channel_events: z.array(z.unknown()).length(0),
  }),
}) });
function utc(value: string) {
  // Channex returns UTC timestamps without a zone and with microsecond precision.
  const ms = Date.parse(value.endsWith('Z') ? value : value + 'Z');
  if (!Number.isSafeInteger(ms) || new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw Error('Invalid task timestamp');
  }
  return ms;
}
export function availabilityTaskCompletion(raw: unknown, job: InventoryJob, now: number) {
  stamp.parse(now);
  if (!job.request || !job.receipt || !job.task || job.dispatchedAt === undefined) {
    throw Error('Task completion requires a saved request and accepted receipt');
  }
  const request = validateAvailabilityRequest(job.request, job, job.dispatchedAt);
  validateAvailabilityReceipt(job.receipt, job.task, job);
  if (job.receipt.receivedAt > now) throw Error('Task receipt is in the future');
  const data = schema.parse(raw).data, a = data.attributes;
  if (data.id !== job.task || a.id !== job.task) throw Error('Task identity mismatch');
  // Rebuild the canonical body to compare every field, regardless of JSON key order.
  const payload = z.object({ values: z.array(z.unknown()).min(1).max(366) }).strict().parse(a.payload);
  const actual = createAvailabilityRequest(payload.values as Parameters<typeof createAvailabilityRequest>[0], request.preparedAt);
  if (actual.digest !== request.digest || actual.body !== request.body) throw Error('Task payload mismatch');
  const receivedAt = utc(a.received_at), executedAt = a.executed_at === null ? null : utc(a.executed_at);
  const finishedAt = a.finished_at === null ? null : utc(a.finished_at);
  // Permit five seconds of transport-host clock skew, never timestamp inference.
  if (receivedAt < job.dispatchedAt - 5000 || receivedAt > now + 5000 ||
      (executedAt !== null && (executedAt < receivedAt || executedAt > now + 5000)) ||
      (finishedAt !== null && (executedAt === null || finishedAt < executedAt || finishedAt > now + 5000))) {
    throw Error('Task chronology mismatch');
  }
  if (finishedAt === null) return { status: 'pending' as const };
  if (a.success !== true || a.errors.length) return { status: 'failed' as const };
  return { status: 'completed' as const, task: job.task, requestDigest: request.digest,
    receivedAt, executedAt: executedAt!, finishedAt, observedAt: now };
}
