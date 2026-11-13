import { z } from 'zod';
const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const cleanerReferenceSchema = z.object({ captureId: id, templateDigest: hash }).strict();
export const cleanerClearanceSchema = z.object({ sourceEvidenceId: id,
  sourceStoppedAt: z.iso.datetime({ precision: 3 }), sourceDrainedAt: z.iso.datetime({ precision: 3 }),
}).strict().refine(v => Date.parse(v.sourceStoppedAt) <= Date.parse(v.sourceDrainedAt));
export const cleanerEnrollmentRequestSchema = z.discriminatedUnion('action', [
  cleanerReferenceSchema.extend({ action: z.literal('review') }).strict(),
  cleanerReferenceSchema.extend({ action: z.literal('enroll'), releaseId: id,
    clearance: cleanerClearanceSchema, reviewedRecipient: hash, reviewedRoute: id }).strict(),
]);
export const cleanerEnrollmentOverviewSchema = cleanerReferenceSchema.extend({
  observedAt: z.iso.datetime({ offset: true }), authority: z.enum(['guesty','helm']), automationsEnabled: z.boolean(),
  scopeEnabled: z.boolean(), routeGeneration: id.nullable(), recipientReady: z.boolean(), templatesReady: z.boolean(),
  recipientReview: hash.nullable(), releaseId: id.nullable(), configurationReady: z.boolean(),
  canEnroll: z.boolean(), canSend: z.literal(false),
}).strict();
export type CleanerEnrollmentOverview = z.infer<typeof cleanerEnrollmentOverviewSchema>;
