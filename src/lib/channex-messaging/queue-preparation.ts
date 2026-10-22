/** Owner-side source-review adapter. No env, provider calls or scheduler activation. */
import { z } from 'zod';
import type { MessageRpc } from './worker.ts';
const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{32}$/);
const instant = z.string().regex(/T.*(Z|[+-][0-9]{2}:[0-9]{2})$/).refine(s => Number.isFinite(Date.parse(s)));
const evidence = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/);
const workflows = ['confirmation', 'pre_arrival', 'key_code', 'pre_checkout', 'cleaner_advance', 'cleaner_arrival'] as const;
const snapshotSchema = z.object({ canonical_revision: digest, context_revision: digest, observation_revision: uuid }).strict();
export type MessagePreparationSnapshot = z.infer<typeof snapshotSchema>;
const common = {
  review_id: uuid, context_revision: digest, observation_revision: uuid,
  workflow: z.enum(workflows), complete: z.literal(true), queued: z.literal(false), uncertain: z.literal(false),
  evidence_id: evidence, observed_at: instant,
};
const reviewSchema = z.discriminatedUnion('sent', [
  z.object({ ...common, sent: z.literal(true), source_account_id: evidence, source_reservation_id: evidence,
    recipient_refs: z.array(evidence).min(1).max(10),
    messages: z.array(z.object({ id: evidence, recipient_ref: evidence, sent_at: instant }).strict()).min(1).max(10),
  }).strict(),
  z.object({ ...common, sent: z.literal(false), stopped_at: instant, drained_at: instant, expires_at: instant,
    from_number: z.string().optional(), recipient_phones: z.array(z.string()).min(1).max(10).optional(),
    source_schedule: z.object({ scheduled_at: instant, observed_at: instant, evidence_id: evidence }).strict().optional(),
  }).strict(),
]);
const packetSchema = z.object({ bookingId: uuid, snapshot: snapshotSchema,
  entries: z.array(z.object({ automation_id: uuid, fire_at: instant, review: reviewSchema }).strict()).length(6),
}).strict();
export type ReviewedMessagePacket = z.infer<typeof packetSchema>;
const resultSchema = z.array(z.object({ send_id: uuid, workflow: z.enum(workflows),
  result: z.enum(['source_sent', 'future_registered']),
}).strict()).length(6);
function serverOnly() { if (typeof window !== 'undefined') throw Error('Message preparation requires a server'); }
/** Must be read before source evidence is reviewed. It never reveals clear content. */
export async function readMessagePreparationSnapshot(rpc: MessageRpc, bookingId: string): Promise<MessagePreparationSnapshot | null> {
  serverOnly();
  if (!uuid.safeParse(bookingId).success) throw Error('Invalid message preparation identity');
  try {
    const response = await rpc('automation_message_preparation_snapshot', { p_booking_id: bookingId });
    if (response.error) throw Error();
    if (response.data === null) return null;
    const parsed = snapshotSchema.safeParse(response.data);
    if (!parsed.success) throw Error();
    return parsed.data;
  } catch { throw Error('Message preparation context unavailable'); }
}
/** One transaction creates missing canonical rows and imports/registers all six.
 * The DB independently validates current timing, rule scope and source evidence.
 * No worker credential receives permission to call this owner-only RPC. A lost
 * response remains unconfirmed; this adapter never retries or enables a sender.
 */
export async function prepareReviewedMessageQueue(rpc: MessageRpc, input: unknown) {
  serverOnly();
  const parsed = packetSchema.safeParse(input);
  if (!parsed.success) throw Error('Complete reviewed message packet required');
  const packet = parsed.data;
  if (new Set(packet.entries.map(e => e.automation_id)).size !== 6 ||
      new Set(packet.entries.map(e => e.review.workflow)).size !== 6 ||
      packet.entries.some(e => e.review.context_revision !== packet.snapshot.context_revision ||
        e.review.observation_revision !== packet.snapshot.observation_revision)) throw Error('Message preparation evidence mismatch');
  try {
    const response = await rpc('automation_message_prepare_handoff', {
      p_booking_id: packet.bookingId, p_canonical_revision: packet.snapshot.canonical_revision, p_entries: packet.entries,
    });
    const result = resultSchema.safeParse(response.data);
    if (response.error || !result.success || new Set(result.data.map(r => r.send_id)).size !== 6 ||
        new Set(result.data.map(r => r.workflow)).size !== 6 || result.data.some(r =>
          r.result !== (packet.entries.find(e => e.review.workflow === r.workflow)!.review.sent ? 'source_sent' : 'future_registered'))) throw Error();
    return { state: 'prepared' as const, results: result.data.sort((a, b) => a.workflow.localeCompare(b.workflow)), canSend: false as const };
  } catch { throw Error('Message queue result unconfirmed; reconcile the existing packet before continuing'); }
}
