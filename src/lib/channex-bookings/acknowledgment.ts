import 'server-only';
import { z } from 'zod';
import { record } from './primitives.ts';
import { airbnbMappingSchema, type AirbnbBookingMapping } from './revision.ts';
import { compareAirbnbRevisionObservation } from './acknowledgment-match.ts';
import { parseAirbnbBookingReceipt, type AirbnbBookingStore } from './ingestion.ts';
import { createAirbnbRevisionReader } from './client.ts';

export interface AirbnbAcknowledgmentReader {
  inspect(mapping: AirbnbBookingMapping): Promise<void>;
  /** Raw response required: acknowledged revisions may have masked fields. */
  revision(id: string): Promise<unknown>;
}
type Reason = 'PROVIDER_ACKNOWLEDGED' | 'PROVIDER_NOT_CONFIRMED' | 'INVALID_SCOPE'
  | 'RECEIPT_UNAVAILABLE' | 'RECEIPT_CHANGED' | 'PROVIDER_READ_FAILED' | 'REVISION_MISMATCH';

/** A point-in-time observation, never a retry, repair, coverage grant or send gate.
 * Read the existing unmasked receipt independently on either side of provider IO.
 * Only an explicit provider ACK and matching retained data resolve uncertainty.
 */
export async function inspectAirbnbAcknowledgment(client: AirbnbAcknowledgmentReader,
  store: Pick<AirbnbBookingStore, 'receipt'>, mapping: AirbnbBookingMapping, revisionId: string) {
  const result = (reason: Reason) => ({
    status: reason === 'PROVIDER_ACKNOWLEDGED' ? 'confirmed' as const
      : reason === 'PROVIDER_NOT_CONFIRMED' ? 'unconfirmed' as const : 'needs_review' as const,
    reason, providerWrites: 0 as const, bookingsChanged: 0 as const, messagesSent: 0 as const,
    canRetryAcknowledgment: false as const, canSend: false as const, completeCoverage: false as const,
  });
  let scope: AirbnbBookingMapping;
  try {
    if (typeof window !== 'undefined') throw Error();
    scope = Object.freeze(airbnbMappingSchema.parse(mapping));
    z.uuid().parse(revisionId);
  } catch { return result('INVALID_SCOPE'); }
  let durable: ReturnType<typeof parseAirbnbBookingReceipt>;
  try { durable = parseAirbnbBookingReceipt(await store.receipt(revisionId)); }
  catch { return result('RECEIPT_UNAVAILABLE'); }
  const expected = durable.revision;
  if (expected.revisionId !== revisionId || expected.environment !== scope.environment
    || expected.mappingGeneration !== scope.generation || expected.propertyId !== scope.propertyId
    || expected.roomTypeId !== scope.roomTypeId || expected.ratePlanId !== scope.ratePlanId) return result('INVALID_SCOPE');
  let raw: unknown;
  try { await client.inspect(scope); raw = await client.revision(revisionId); }
  catch { return result('PROVIDER_READ_FAILED'); }
  try {
    const again = parseAirbnbBookingReceipt(await store.receipt(revisionId));
    if (JSON.stringify(again) !== JSON.stringify(durable)) return result('RECEIPT_CHANGED');
  } catch { return result('RECEIPT_UNAVAILABLE'); }
  try {
    const acknowledged = compareAirbnbRevisionObservation(raw, expected, scope);
    return result(acknowledged ? 'PROVIDER_ACKNOWLEDGED' : 'PROVIDER_NOT_CONFIRMED');
  } catch { return result('REVISION_MISMATCH'); }
}

/** Explicit credential and fixed host. GET only; no feed scanning or retries. */
export function createAirbnbAcknowledgmentReader(config: { mapping: AirbnbBookingMapping; apiKey: string },
  fetcher: typeof fetch = fetch): AirbnbAcknowledgmentReader {
  const mapping = Object.freeze(airbnbMappingSchema.parse(config.mapping));
  const inspection = createAirbnbRevisionReader({ mapping, apiKey: config.apiKey }, fetcher);
  const key = config.apiKey.trim();
  const base = mapping.environment === 'staging' ? 'https://staging.channex.io/api/v1' : 'https://app.channex.io/api/v1';
  return {
    inspect: inspection.inspect,
    async revision(id) {
      z.uuid().parse(id);
      try {
        const response = await fetcher(base + '/booking_revisions/' + id, { method: 'GET', redirect: 'error',
          cache: 'no-store', signal: AbortSignal.timeout(20_000), headers: { 'user-api-key': key, Accept: 'application/json' } });
        if (!response.ok || response.redirected) throw Error();
        const body = record(await response.json()), warnings = body.meta === undefined ? undefined : record(body.meta).warnings;
        if (body.errors || (warnings !== undefined && (!Array.isArray(warnings) || warnings.length))) throw Error();
        if (record(body.data).type !== 'booking_revision' || record(body.data).id !== id) throw Error();
        return body.data;
      } catch { throw Error('Channex acknowledgment observation unavailable; details withheld'); }
    },
  };
}
