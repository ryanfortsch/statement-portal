import { MAX_INVENTORY_DAYS } from './inventory-limits.ts';
/** Exact, credential-free availability request persisted before provider IO. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { InventoryJob } from './inventory-outbox.ts';
export const AVAILABILITY_ENDPOINT = 'https://staging.channex.io/api/v1/availability';
const stamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const valueSchema = z.object({ property_id: z.string().uuid(), room_type_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), availability: z.union([z.literal(0), z.literal(1)]) }).strict();
const bodySchema = z.object({ values: z.array(valueSchema).min(1).max(MAX_INVENTORY_DAYS) }).strict();
export const availabilityRequestSchema = z.object({ format: z.literal(1), method: z.literal('POST'),
  url: z.literal(AVAILABILITY_ENDPOINT), body: z.string().min(1).max(100_000), digest,
  preparedAt: stamp, expiresAt: stamp }).strict();
export const availabilityReceiptSchema = z.object({ requestDigest: digest, receivedAt: stamp }).strict();
export type AvailabilityRequest = z.infer<typeof availabilityRequestSchema>;
export type AvailabilityReceipt = z.infer<typeof availabilityReceiptSchema>;
export function availabilityRequestDigest(body: string) {
  return createHash('sha256').update(JSON.stringify(['POST', AVAILABILITY_ENDPOINT, body])).digest('hex');
}
export function createAvailabilityRequest(values: z.infer<typeof valueSchema>[], preparedAt: number): AvailabilityRequest {
  const body = JSON.stringify(bodySchema.parse({ values }));
  return availabilityRequestSchema.parse({ format: 1, method: 'POST', url: AVAILABILITY_ENDPOINT,
    body, digest: availabilityRequestDigest(body), preparedAt, expiresAt: preparedAt + 5000 });
}
/** Also run during journal replay. No current-time dependency: use dispatch time. */
export function validateAvailabilityRequest(input: AvailabilityRequest, job: InventoryJob, dispatchedAt: number) {
  const request = availabilityRequestSchema.parse(input);
  const body = bodySchema.parse(JSON.parse(request.body));
  if (JSON.stringify(body) !== request.body || availabilityRequestDigest(request.body) !== request.digest ||
      request.expiresAt - request.preparedAt !== 5000 || !Number.isSafeInteger(dispatchedAt) ||
      dispatchedAt < request.preparedAt || dispatchedAt >= request.expiresAt) {
    throw new Error('Invalid availability request binding');
  }
  const first = body.values[0];
  let previous = '';
  for (const value of body.values) {
    const desired = job.days.find(day => day.date === value.date);
    if (!desired || desired.available !== value.availability || desired.stopSell !== (value.availability === 0) ||
        value.property_id !== first.property_id || value.room_type_id !== first.room_type_id || value.date <= previous ||
        !Number.isFinite(Date.parse(value.date)) || new Date(value.date).toISOString().slice(0, 10) !== value.date) {
      throw new Error('Request does not match desired availability');
    }
    previous = value.date;
  }
  return request;
}
export function validateAvailabilityReceipt(input: AvailabilityReceipt | undefined, task: string, job: InventoryJob) {
  const receipt = availabilityReceiptSchema.parse(input);
  z.string().uuid().parse(task);
  if (!job.request || receipt.requestDigest !== job.request.digest || job.dispatchedAt === undefined ||
      receipt.receivedAt < job.dispatchedAt) throw new Error('Receipt does not match dispatched request');
  return receipt;
}
