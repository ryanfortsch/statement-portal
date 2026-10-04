import { z } from 'zod';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const parsed = new Date(`${v}T12:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === v;
});
export const CheckoutCommitmentSchema = z.object({
  event_key: z.string().startsWith('checkout:').max(100),
  listing_id: z.string().min(1).max(100), reservation_id: z.string().min(1).max(100),
  conversation_id: z.string().max(150), check_in: day, check_out: day,
  sent_at: z.string().datetime({ offset: true }),
  time: z.union([z.literal(''), z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)]),
  date: z.union([z.literal(''), day]), evidence: z.string().min(1).max(6000),
  confidence: z.enum(['high', 'low']),
}).refine(v => !!(v.time || v.date) && v.check_out > v.check_in &&
  (!v.date || (v.date >= v.check_in && Math.abs(Date.parse(v.date) - Date.parse(v.check_out)) <= 30 * 86400000)));

export type ScheduleUpdate = { status: string; error: string; digest_status: string; date: string };
export function scheduleUpdateLabel(update: ScheduleUpdate): string {
  if (update.error) return update.error;
  if (update.status === 'active' && update.digest_status === 'skipped') return 'Checkout updated · daily schedule is skipped';
  if (update.status === 'active') return update.digest_status === 'sent'
    ? 'Schedule updated · cleaner correction ready for review'
    : 'Cleaner schedule updated';
  if (update.status === 'proposed') return 'Checkout change needs review on the cleaner schedule';
  if (update.status === 'dismissed' || update.status === 'superseded') return 'Checkout change was dismissed or replaced';
  if (update.status === 'review') return 'Checkout change needs review';
  return 'Updating cleaner schedule…';
}
