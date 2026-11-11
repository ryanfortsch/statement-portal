/** Access contract for the Calderwood arrival report. No credentials, database
 * client, provider requests or send capability live in this module. */
import { z } from 'zod';
import type { CleanerStayReport } from './cleaner-stay-report.ts';

export const CLEANER_STAY_ACCESS_FIELDS = 'portal_token,enabled,property_ids,language';
export const isCleanerPortalToken = (token: unknown): token is string =>
  typeof token === 'string' && /^(?:[a-f0-9]{16}|[a-f0-9]{32})$/.test(token);

const recipientSchema = z.object({
  portal_token: z.string().refine(isCleanerPortalToken), enabled: z.literal(true),
  // This pilot is deliberately narrower than the existing regional checkout
  // schedule: no empty-list fallback and no multiple-property authorization.
  property_ids: z.tuple([z.literal('65_calderwood')]),
  language: z.enum(['en', 'pt']).nullable().transform(value => value ?? 'pt'),
});
export function canReadCalderwoodStays(row: unknown): boolean {
  return recipientSchema.safeParse(row).success;
}

export function calderwoodAccessUnchanged(before: unknown, after: unknown): boolean {
  const first = recipientSchema.safeParse(before), last = recipientSchema.safeParse(after);
  return first.success && last.success && JSON.stringify(first.data) === JSON.stringify(last.data);
}

const date = z.iso.date();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();
// Strip every unrecognized field before it reaches the public render tree.
const reportSchema = z.object({
  propertyName: z.string().min(1).max(200), from: date, through: date,
  stays: z.array(z.object({
    checkIn: date, checkOut: date, arrivalTime: time, checkoutTime: time,
    guests: z.number().int().nonnegative().nullable(), staying: z.boolean(),
    adjusted: z.boolean(), noCleaning: z.boolean(), needsReview: z.boolean(),
  }).refine(stay => stay.checkIn < stay.checkOut)).max(5000),
}).refine(report => {
  const days = (Date.parse(report.through) - Date.parse(report.from)) / 86400000;
  return days >= 0 && days <= 365 && report.stays.every(stay =>
    stay.checkIn <= report.through && stay.checkOut >= report.from);
});

export type CleanerStayAccessResult =
  | { status: 'not_found' }
  | { status: 'unavailable' }
  | { status: 'ready'; language: 'en' | 'pt'; report: CleanerStayReport };

export async function readAuthorizedCleanerStays(token: unknown, deps: {
  recipient: (token: string) => Promise<unknown>;
  report: () => Promise<unknown>;
}): Promise<CleanerStayAccessResult> {
  if (!isCleanerPortalToken(token)) return { status: 'not_found' };
  let first;
  try { first = recipientSchema.safeParse(await deps.recipient(token)); }
  catch { return { status: 'unavailable' }; }
  if (!first.success || first.data.portal_token !== token) return { status: 'not_found' };
  let report: CleanerStayReport | undefined;
  try { report = reportSchema.parse(await deps.report()); } catch { /* Never an empty successful schedule. */ }
  // Revocation, token rotation, language or scope changes during the read must
  // discard the result, even when the report itself failed.
  try {
    const after = recipientSchema.safeParse(await deps.recipient(token));
    if (!after.success || JSON.stringify(first.data) !== JSON.stringify(after.data)) return { status: 'not_found' };
  } catch { return { status: 'unavailable' }; }
  return report ? { status: 'ready', language: first.data.language, report } : { status: 'unavailable' };
}
