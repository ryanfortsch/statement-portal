/** No runtime wiring: concrete adapters must enforce this durable storage contract. */
import { z } from 'zod';
import { revisionTime } from '../channex-staging/core.ts';
import { airbnbMappingSchema, airbnbRevisionSchema, normalizeAirbnbBookingRevision, parseAirbnbBookingRevision,
  type AirbnbBookingMapping, type AirbnbBookingRevision } from './revision.ts';

const receiptSchema = z.object({
  revision: airbnbRevisionSchema, canonicalBookingId: z.string().uuid(),
  outcome: z.enum(['applied', 'stale']), committed: z.literal(true),
  committedAt: z.string(), firstReceivedAt: z.string(),
}).strict();
export type AirbnbBookingReceipt = z.infer<typeof receiptSchema>;
export interface AirbnbBookingStore {
  /** Atomic canonical mutation + receipt. Replay must return the original receipt,
   * including timestamps. Older revisions must not resurrect a cancelled stay.
   * Same revision ID with different content must fail, never overwrite. */
  commit(revision: AirbnbBookingRevision): Promise<unknown>;
  receipt(revisionId: string): Promise<unknown>;
}
export interface AirbnbRevisionReader {
  /** Validate the active server mapping and generation before returning raw rows. */
  inspect(mapping: AirbnbBookingMapping): Promise<void>;
  feed(): Promise<unknown[]>;
  revision(id: string): Promise<unknown>;
  /** Adapter must re-fetch/compare exact revision before acknowledging it. */
  acknowledge(revision: AirbnbBookingRevision): Promise<void>;
}
function exactReceipt(raw: unknown, expected: AirbnbBookingRevision): AirbnbBookingReceipt {
  const r = receiptSchema.parse(raw);
  const revision = parseAirbnbBookingRevision(r.revision);
  if (JSON.stringify(revision) !== JSON.stringify(parseAirbnbBookingRevision(expected))) throw Error();
  const committedAt = revisionTime(r.committedAt), firstReceivedAt = revisionTime(r.firstReceivedAt);
  if (firstReceivedAt > committedAt) throw Error();
  return { ...r, revision, committedAt, firstReceivedAt };
}
/** Webhook hints select a provider pull; untrusted webhook bodies are never saved.
 * Full-batch validation precedes writes. ACK follows commit AND independent read.
 * This does not attest to initial booking coverage or enable message sending.
 */
export async function ingestAirbnbBookingRevisions(client: AirbnbRevisionReader, store: AirbnbBookingStore,
  mapping: AirbnbBookingMapping, selection?: { revisionId: string; bookingId: string }) {
  try {
    if (typeof window !== 'undefined') throw Error();
    const hint = selection === undefined ? undefined : z.object({
      revisionId: z.string().uuid(), bookingId: z.string().uuid(),
    }).strict().parse(selection);
    // Snapshot caller-owned configuration to prevent mutation during an await.
    const scope = Object.freeze(airbnbMappingSchema.parse(mapping));
    await client.inspect(scope);
    const raw = hint ? [await client.revision(hint.revisionId)] : await client.feed();
    if (!Array.isArray(raw) || raw.length > 100) throw Error();
    const rows = raw.map(r => normalizeAirbnbBookingRevision(r, scope));
    if (new Set(rows.map(r => r.revisionId)).size !== rows.length ||
        (hint && rows.some(r => r.revisionId !== hint.revisionId || r.bookingId !== hint.bookingId))) throw Error();
    rows.sort((a, b) => a.providerReceivedAt.localeCompare(b.providerReceivedAt) || a.revisionId.localeCompare(b.revisionId));
    const result = { received: rows.length, applied: 0, stale: 0, acknowledged: 0,
      completeCoverage: false as const, canSend: false as const };
    for (const revision of rows) {
      const committed = exactReceipt(await store.commit(structuredClone(revision)), revision);
      const durable = exactReceipt(await store.receipt(revision.revisionId), revision);
      if (JSON.stringify(committed) !== JSON.stringify(durable)) throw Error();
      await client.acknowledge(structuredClone(revision));
      result[durable.outcome]++; result.acknowledged++;
    }
    return result;
  } catch {
    throw Error('Airbnb ingestion incomplete; durable receipt and ACK require verification');
  }
}
