import { z } from 'zod';
export const messageControlRequest = z.object({ sendId: z.uuid(), expected: z.string().regex(/^[a-f0-9]{32}$/), held: z.boolean() }).strict();
export const messageControlSchema = z.object({ sendId: z.uuid(), bookingId: z.uuid(), lane: z.enum(['guest','cleaner']),
  held: z.boolean(), token: z.string().regex(/^[a-f0-9]{32}$/), expiresAt: z.iso.datetime({ precision: 3 }),
  canHold: z.boolean(), canResume: z.boolean(),
}).strict().refine(v => !(v.canHold && v.canResume) && (!v.canHold || !v.held) && (!v.canResume || v.held));
export type MessageControl = z.infer<typeof messageControlSchema>;
export const messageControlResultSchema = z.object({ state: z.enum(['changed','conflict','unavailable']), control: messageControlSchema.nullable() }).strict();
export type MessageControlResult = z.infer<typeof messageControlResultSchema>;
