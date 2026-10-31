/** Explicit isolated-staging recovery preparation. Not wired to a route, worker or
 * hosted adapter. The original journal is immutable; a retry has its own ledger.
 * A verified retry does NOT establish that its uncertain predecessor is settled.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { replayInventoryJournal, inventoryJournalVersion, inventoryResumeAfter } from './inventory-journal.ts';
import { inventoryDigest, type InventoryJob } from './inventory-outbox.ts';
import { validateAvailabilityRequest, validateAvailabilityReceipt } from './availability-request.ts';
import type { ChannexAvailabilityClient } from './availability-client.ts';

const stamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reviewSchema = z.object({ originalId: z.string().min(1), originalToken: z.string().min(1),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/), reviewedBy: z.string().email(),
  reason: z.string().trim().min(1).max(500), reviewedAt: stamp, expiresAt: stamp }).strict();
export type RetryReview = z.infer<typeof reviewSchema>;
export type RetryRecord = {
  id: string; originalId: string; originalToken: string; originalJournalVersion: number;
  review: RetryReview; job: InventoryJob;
  outcome: 'submitting' | 'uncertain' | 'submitted' | 'rejected' | 'verified';
  originalSettled: false;
};
export type RetrySnapshot = {
  revision: number; journal: unknown; records: RetryRecord[];
  // Must be obtained from the canonical projection and registered route, not UI inputs.
  current: { authority: 'helm' | 'guesty'; complete: boolean; freshUntil: number;
    workerPaused: boolean; generation: number; connection: string; property: string;
    propertyId: string; roomTypeId: string; date: string; available: 0 | 1 };
};
export interface ReviewedRetryStore {
  read(): Promise<RetrySnapshot>;
  /** Atomically compare revision AND all source/journal/configuration inputs in
   * expected, enforce one record per original attempt, and append the record.
   * The same transaction must enforce the paused worker and freshness at now.
   * false/throw is NEVER permission to send. No existing hosted RPC implements
   * this contract yet; do not substitute a plain journal append or file write.
   */
  reserve(expected: RetrySnapshot, record: RetryRecord, now: number): Promise<boolean>;
  /** CAS append a new record version; retain earlier versions for audit. */
  update(expected: RetrySnapshot, record: RetryRecord): Promise<boolean>;
}
export type RetryClient = Pick<ChannexAvailabilityClient, 'route' | 'prepare' | 'completion'>;
function retryId(review: RetryReview) {
  return 'reviewed-retry-' + createHash('sha256').update(JSON.stringify([
    review.originalId, review.originalToken, review.requestDigest,
  ])).digest('hex');
}
function eligible(s: RetrySnapshot, input: RetryReview, client: RetryClient, now: number) {
  stamp.parse(now); stamp.parse(s.revision);
  const review = reviewSchema.parse(input), { journal, queue } = replayInventoryJournal(s.journal);
  const original = queue.list().find(j => j.id === review.originalId), c = s.current, r = client.route;
  if (review.reviewedAt > now || review.expiresAt <= now || review.expiresAt <= review.reviewedAt ||
      review.expiresAt - review.reviewedAt > 60_000) throw Error('Retry review expired or invalid');
  if (!original || original.status !== 'uncertain' || original.token !== review.originalToken ||
      !original.request || original.request.digest !== review.requestDigest || original.task || original.receipt ||
      original.dispatchedAt === undefined) throw Error('Original unreceipted attempt changed');
  const request = validateAvailabilityRequest(original.request, original, original.dispatchedAt);
  const values = JSON.parse(request.body).values;
  if (values.length !== 1) throw Error('Reviewed retry supports exactly one original date');
  const v = values[0];
  if (!c.workerPaused || c.authority !== 'helm' || !c.complete || !Number.isSafeInteger(c.freshUntil) || c.freshUntil <= now ||
      c.date !== v.date || c.available !== v.availability || c.propertyId !== v.property_id || c.roomTypeId !== v.room_type_id ||
      c.generation !== original.generation || c.connection !== original.connection || c.property !== original.property ||
      r.environment !== 'staging' || r.generation !== c.generation || r.connection !== c.connection || r.helmProperty !== c.property ||
      r.propertyId !== c.propertyId || r.roomTypeId !== c.roomTypeId) throw Error('Retry target or current desired value changed');
  if (queue.list().some(j => j.id !== original.id && !['verified', 'superseded'].includes(j.status)) ||
      now < inventoryResumeAfter(journal)) throw Error('Retry lane is not isolated');
  const id = retryId(review);
  // Any record, including a rejected or verified retry, consumes this review path.
  if (s.records.some(a => a.id === id || (a.originalId === original.id && a.originalToken === original.token))) {
    throw Error('Original attempt already has a recovery record');
  }
  const days = [{ date: v.date as string, available: v.availability as 0 | 1, stopSell: v.availability === 0 }];
  const job: InventoryJob = { id, environment: 'staging', property: original.property, connection: original.connection,
    generation: original.generation, version: original.version, days, digest: inventoryDigest(days),
    status: 'pending', attempts: 0, nextAttemptAt: now };
  return { review, original, job, originalJournalVersion: inventoryJournalVersion(journal) };
}

/** One attempt, never a retry loop. Existing client performs isolated-property,
 * no-channel, fresh single-use permit and exact staging endpoint checks.
 */
export async function sendReviewedRetryOnce(store: ReviewedRetryStore, client: RetryClient,
  review: RetryReview, clock = Date.now) {
  const first = await store.read();
  const prepared = eligible(first, review, client, clock());
  const permit = await client.prepare(prepared.job);
  if (!permit.request) return { status: 'already-matches' as const, originalSettled: false as const };
  // A delta permit must match the ORIGINAL exact body, including remote IDs.
  if (permit.request.body !== prepared.original.request!.body || permit.request.digest !== review.requestDigest) {
    throw Error('Retry permit changed the original payload');
  }
  const latest = await store.read(), now = clock();
  const checked = eligible(latest, review, client, now);
  const request = validateAvailabilityRequest(permit.request, checked.job, now);
  const leaseUntil = Math.min(request.expiresAt, review.expiresAt, latest.current.freshUntil);
  if (leaseUntil <= now) throw Error('Retry freshness expired');
  const job: InventoryJob = { ...checked.job, status: 'submitting', attempts: 1,
    token: checked.job.id + ':1', leaseUntil, request, dispatchedAt: now };
  const record: RetryRecord = { id: job.id, originalId: review.originalId, originalToken: review.originalToken,
    originalJournalVersion: checked.originalJournalVersion, review: structuredClone(checked.review), job,
    outcome: 'submitting', originalSettled: false };
  if (!await store.reserve(latest, record, now)) return { status: 'blocked' as const };
  // Throws leave a durable submitting barrier. The caller must never erase it.
  if (clock() >= leaseUntil) throw Error('Retry expired after reservation; review required');
  let outcome: Awaited<ReturnType<typeof permit.submit>>;
  try { outcome = await permit.submit(job); } catch { outcome = { status: 'ambiguous' }; }
  const next = structuredClone(record);
  if (outcome.status === 'accepted') {
    next.job.task = outcome.task;
    next.job.receipt = validateAvailabilityReceipt({ requestDigest: request.digest, receivedAt: clock() }, outcome.task, job);
    next.job.status = 'submitted'; next.outcome = 'submitted';
  } else {
    next.job.status = outcome.status === 'ambiguous' ? 'uncertain' : 'needs-review';
    next.outcome = outcome.status === 'ambiguous' ? 'uncertain' : 'rejected';
  }
  const saved = await store.read();
  if (JSON.stringify(saved.records.find(a => a.id === record.id)) !== JSON.stringify(record) ||
      !await store.update(saved, next)) throw Error('Retry outcome not saved; do not resend');
  return { status: next.outcome, originalSettled: false as const };
}

/** Verifies only the distinct retry receipt through existing task/payload/readback
 * checks. The old journal remains uncertain and the normal lane remains blocked.
 */
export async function checkReviewedRetry(store: ReviewedRetryStore, client: RetryClient, id: string) {
  const s = await store.read(), record = s.records.find(a => a.id === id);
  if (!record || record.outcome !== 'submitted' || !record.job.receipt || !record.job.task) return { status: 'blocked' as const };
  const evidence = await client.completion(record.job);
  if (evidence.status !== 'completed' || !evidence.complete || evidence.digest !== record.job.digest) return { status: 'unverified' as const };
  const next = structuredClone(record); next.outcome = 'verified'; next.job.status = 'verified';
  if (!await store.update(s, next)) return { status: 'blocked' as const };
  return { status: 'verified' as const, originalSettled: false as const };
}
