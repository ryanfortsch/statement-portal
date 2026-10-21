/** Fixed classifications only; database/provider error text never becomes telemetry. */
import { z } from 'zod';
import type { CanonicalRevision } from './canonical-revisions.ts';
const reason = z.enum(['booking_overlap', 'revision_identity_conflict', 'booking_identity_changed',
  'ambiguous_revision_order', 'canonical_booking_ownership_changed', 'unmapped_canonical_booking']);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identity = z.object({ revisionId: z.string().uuid(), bookingId: z.string().uuid(), reason }).strict();
const refusal = z.object({ committed: z.literal(false), conflict: identity }).strict();
export class CanonicalRevisionConflict extends Error {
  readonly reason: z.infer<typeof reason>;
  constructor(code: z.infer<typeof reason>) { super('Canonical revision needs review'); this.reason = reason.parse(code); }
}
export function assertNoCanonicalConflict(raw: unknown, revision: CanonicalRevision) {
  if (!raw || typeof raw !== 'object' || !('conflict' in raw)) return;
  const saved = refusal.parse(raw);
  if (saved.conflict.revisionId !== revision.id || saved.conflict.bookingId !== revision.bookingId) {
    throw Error('Conflict identity mismatch');
  }
  throw new CanonicalRevisionConflict(saved.conflict.reason);
}
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v);
const report = z.object({ openCount: count, resolvedCount: count, open: z.array(identity.extend({
  checkIn: day, checkOut: day, observations: count.min(1), firstSeenAt: count, lastSeenAt: count,
}).strict()).max(100) }).strict();
export function parseCanonicalConflictReport(raw: unknown) {
  const value = report.parse(raw);
  if (value.open.length !== Math.min(value.openCount, 100) || new Set(value.open.map(v => v.revisionId)).size !== value.open.length ||
      value.open.some(v => v.checkOut <= v.checkIn || v.lastSeenAt < v.firstSeenAt)) throw Error('Incomplete conflict report');
  return { ...value, truncated: value.openCount > value.open.length };
}
