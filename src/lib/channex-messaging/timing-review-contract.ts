import { z } from 'zod';
const id = z.uuid(), instant = z.iso.datetime({ offset: true });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const timingReviewRequestSchema = z.object({ action: z.literal('review_timing'),
  bindingId: id, captureId: id, bookingId: id }).strict();
export const timingReviewOverviewSchema = z.object({ format: z.literal(1), observedAt: instant,
  authority: z.enum(['guesty', 'helm']), automationsEnabled: z.boolean(), handoverRecorded: z.boolean(),
  capture: z.object({ id, checkedAt: instant, savedAt: instant }).strict().nullable(),
  stays: z.array(z.object({ bookingId: id, start: z.iso.date(), end: z.iso.date(),
    arrival: time, departure: time, confirmedAt: instant,
    state: z.enum(['past', 'ready', 'waiting_handover', 'needs_matching']),
    review: z.object({ id, reviewedAt: instant, currentContext: z.boolean() }).strict().nullable(),
  }).strict()).max(12),
}).strict();
export type TimingReviewOverview = z.infer<typeof timingReviewOverviewSchema>;
