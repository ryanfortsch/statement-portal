import { z } from 'zod';
const id = z.uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);
export const templateReferenceSchema = z.object({ captureId: id, rulesSha256: digest }).strict();
export const templateWorkflowRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('capture') }).strict(),
  templateReferenceSchema.extend({ action: z.literal('review') }).strict(),
  templateReferenceSchema.extend({ action: z.literal('release'), releaseId: id,
    confirmation: z.literal('release_four_guest_templates_only') }).strict(),
]);
export const templateReviewSchema = templateReferenceSchema.extend({
  capturedAt: z.iso.datetime({ offset: true }), observedAt: z.iso.datetime({ offset: true }),
  authority: z.enum(['guesty', 'helm']), automationsEnabled: z.boolean(),
  configuration: z.enum(['prepared', 'released', 'changed']),
  workflows: z.array(z.object({ key: z.string().max(80), label: z.string().max(80),
    audience: z.enum(['guest', 'cleaner']), timing: z.string().max(100),
    characterCount: z.number().int().min(1).max(16000), bodySha256: digest,
  }).strict()).length(6), canSend: z.literal(false),
}).strict();
export type TemplateReview = z.infer<typeof templateReviewSchema>;
export type TemplateReference = z.infer<typeof templateReferenceSchema>;
