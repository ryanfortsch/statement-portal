import { z } from 'zod';
// Add a home only once its corresponding status projection is implemented.
const STATUS_HREF: Readonly<Record<string, string>> = { '65_calderwood': '/channels/65_calderwood/sync-status' };
export function inventoryStatusHref(propertyId: string): string | null {
  return Object.prototype.hasOwnProperty.call(STATUS_HREF, propertyId) ? STATUS_HREF[propertyId] : null;
}
const int = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const state = z.enum(['leased', 'submitting', 'uncertain', 'accepted', 'rejected', 'expired']);
export const inventoryOperationsSchema = z.object({
  format: z.literal(1), propertyId: z.literal('65_calderwood'), observedAt: int,
  authority: z.enum(['guesty', 'helm']), publishingEnabled: z.boolean(), planningEnabled: z.boolean(),
  importEnabled: z.boolean(), captureEnabled: z.boolean(), headVersion: int, freshUntil: int,
  nextAttemptAt: int.nullable(), consecutiveRecoveries: int.max(3), recentClaims: int, credentialBlocked: z.boolean(),
  active: z.object({ state: z.enum(['leased', 'submitting', 'uncertain']), expiresAt: int,
    startedAt: int.nullable(), generationCurrent: z.boolean(), recoverAfter: int.nullable() }).strict().nullable(),
  counts: z.object({ total: int, accepted: int, historicalUnknown: int }).strict(),
  recent: z.array(z.object({ state, createdAt: int, recordedAt: int.nullable(), retired: z.boolean(),
    outcome: z.enum(['accepted', 'uncertain', 'rate-limited', 'unauthorized']).nullable() }).strict()).max(8),
}).strict();
export type InventoryOperations = z.infer<typeof inventoryOperationsSchema>;
export async function readInventoryOperations(rpc: (name: string, args: Record<string, never>) => Promise<{ data: unknown; error: unknown }>, clock = Date.now) {
  try {
    const response = await rpc('helm_channex_delivery_operations', {});
    if (response.error) throw Error();
    const report = inventoryOperationsSchema.parse(response.data), now = clock();
    if (!Number.isSafeInteger(now) || report.observedAt > now + 5000 || report.observedAt <= now - 60000 ||
      report.counts.accepted + report.counts.historicalUnknown > report.counts.total ||
      report.recent.length > report.counts.total || (report.active && report.counts.total === 0)) throw Error();
    return report;
  } catch { throw Error('Calendar sync status unavailable'); }
}
export function inventoryOperationsMessage(r: InventoryOperations): { title: string; detail: string; tone: 'quiet' | 'attention' | 'normal' } {
  if (!r.publishingEnabled) return { title: 'Helm sending is off', detail: r.authority === 'guesty'
    ? 'Guesty is managing the live calendar. This view monitors the prepared Channex connection.'
    : 'Availability publishing is disabled. Review the connection before enabling any worker.', tone: 'quiet' };
  if (r.authority !== 'helm' || !r.importEnabled || !r.captureEnabled || !r.planningEnabled) return {
    title: 'Calendar prerequisites incomplete', detail: 'The worker will not send until authority, booking import, change capture and planning are all verified.', tone: 'attention' };
  if (r.credentialBlocked) return { title: 'Connection needs attention', detail: 'Channex rejected the credentials. Further updates are blocked pending review.', tone: 'attention' };
  if (r.active?.state !== 'leased' && r.active && r.consecutiveRecoveries >= 3) return {
    title: 'Recovery limit reached', detail: 'Three replacement attempts have been used. Review the uncertain result before any further recovery.', tone: 'attention' };
  if (r.active && !r.active.generationCurrent) return { title: 'New information received', detail: 'A late response invalidated the prepared update. The next cycle must use the latest calendar state.', tone: 'attention' };
  if (r.active?.state === 'uncertain' || r.active?.state === 'submitting') return {
    title: r.active.state === 'submitting' && r.active.expiresAt > r.observedAt ? 'Update in progress' : 'Update outcome unknown',
    detail: 'The saved attempt remains tracked. Recovery waits for its send window to close, then rebuilds from the latest calendar.', tone: 'attention' };
  if (r.active?.state === 'leased' && r.active.expiresAt > r.observedAt) return {
    title: 'Update prepared', detail: 'The send checkpoint rechecks calendar changes and expiry before permitting an update.', tone: 'normal' };
  if ((r.nextAttemptAt ?? 0) > r.observedAt || r.recentClaims >= 5) return {
    title: 'Waiting between updates', detail: 'Persisted pacing limits prevent repeated sends. The next cycle will check again when allowed.', tone: 'quiet' };
  if (r.active) return { title: r.active.expiresAt > r.observedAt ? 'Update prepared' : 'Prepared update expired',
    detail: 'The send checkpoint rechecks calendar changes and expiry before permitting an update.', tone: 'normal' };
  if (!r.headVersion || r.freshUntil <= r.observedAt) return { title: 'Fresh calendar plan required',
    detail: 'The next cycle must read and validate current reservations and source coverage before sending.', tone: 'quiet' };
  return { title: 'No update in flight', detail: 'A worker cycle can compare the latest plan with saved acceptance history. This is not confirmation of channel delivery.', tone: 'normal' };
}
export function inventoryAttemptLabel(row: InventoryOperations['recent'][number]) {
  if (row.retired && row.state === 'uncertain') return 'Replaced · outcome still unknown';
  if (row.outcome === 'unauthorized') return 'Credentials rejected';
  if (row.outcome === 'rate-limited') return 'Rate limited';
  const labels = { leased: 'Prepared', submitting: 'Send started', uncertain: 'Outcome unknown', accepted: 'Accepted by Channex', rejected: 'Rejected', expired: 'Expired before sending' };
  return `${labels[row.state]}${row.retired ? ' · earlier attempt' : ''}`;
}
