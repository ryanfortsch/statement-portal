import 'server-only';
import { requireProductionInspectionEnvironment, verifyDormantProductionStorage } from '../channex-production-runtime.ts';
import { inspectCalderwoodProduction } from '../channex-production-preflight.ts';
import { createProductionBookingCollectionReader } from './collection.ts';
import { BookingAuditError, compareBookingCollections, fingerprint, parseCanonicalSnapshot } from './reconciliation.ts';
import { todayInEastern, shiftIsoDay } from '../sca-quotes-types.ts';
import { buildExistingStayHandoff } from './handoff.ts';
type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

/** Owner-triggered diagnostics. No checkpoint writes, import, ACK, coverage setter
 * or publishing. The normal configuration cron does not call this function. */
export async function auditProductionBookings(env: Record<string, string | undefined>, rpc: Rpc,
  fetcher: typeof fetch = fetch, clock = Date.now) {
  requireProductionInspectionEnvironment(env);
  const started = clock(), deadline = started + 90_000;
  const read = async () => {
    const result = await rpc('helm_channex_booking_audit_snapshot', {});
    if (result.error) throw new BookingAuditError('CANONICAL_SNAPSHOT_INVALID');
    return parseCanonicalSnapshot(result.data);
  };
  try {
    await verifyDormantProductionStorage(rpc);
    await inspectCalderwoodProduction(env.CHANNEX_PRODUCTION_API_KEY!, fetcher);
    const before = await read();
    const scan = createProductionBookingCollectionReader(env.CHANNEX_PRODUCTION_API_KEY!, fetcher, clock);
    const first = await scan(deadline), second = await scan(deadline);
    const after = await read();
    await verifyDormantProductionStorage(rpc);
    if (fingerprint(before) !== fingerprint(after) || fingerprint(first.rows) !== fingerprint(second.rows)) {
      throw new BookingAuditError('SOURCES_CHANGED');
    }
    const finished = clock();
    if (finished < started || finished >= deadline || todayInEastern(new Date(started)) !== todayInEastern(new Date(finished))) {
      throw new BookingAuditError('AUDIT_LIMIT_REACHED');
    }
    const start = todayInEastern(new Date(started)), end = shiftIsoDay(start, 500);
    return { ok: true, mode: 'booking-comparison' as const, property: '65_calderwood',
      observedAt: new Date(finished).toISOString(), elapsedMs: finished - started,
      scans: 2, pages: first.pages + second.pages, paginationComplete: true, repeatedObservationsAgree: true,
      canonicalFingerprint: fingerprint(before), providerFingerprint: fingerprint(first.rows),
      availabilityWindow: { start, end },
      existingStayHandoff: buildExistingStayHandoff(before, first.rows, { start, end }),
      ...compareBookingCollections(before, first.rows, { start: shiftIsoDay(start, -30), end: shiftIsoDay(end, 30) }) };
  } catch (e) {
    if (e instanceof BookingAuditError) throw e;
    throw new BookingAuditError('AUDIT_FAILED');
  }
}
