import type { ScheduleRecipient } from './cleaner-digest-core.ts';
import { RECIPIENT_COLS, shapeRecipient } from './cleaner-digest-core.ts';

/** Apply the additive migration before deploying. Missing columns, stale schema
 * caches and unreadable rows never grant daily enrollment. */
export async function readDigestEnrollment(query: (fields: string) => PromiseLike<{
  data: unknown; error: { code?: string } | null;
}>): Promise<ScheduleRecipient[]> {
  const result = await query(`${RECIPIENT_COLS},daily_digest_enabled`);
  if (result.error || !Array.isArray(result.data)) throw Error('Cleaner recipients unavailable');
  if (result.data.some(row => !row || typeof row !== 'object'
    || typeof row.daily_digest_enabled !== 'boolean')) throw Error('Cleaner recipients unavailable');
  return (result.data as Array<Parameters<typeof shapeRecipient>[0]>).map(shapeRecipient);
}

/** Portal access and booking reminders do not enroll anyone in the daily text. */
export function receivesDailyDigest(recipient: ScheduleRecipient): boolean {
  return recipient.enabled === true && recipient.daily_digest_enabled === true;
}

/** A rendered text is valid only for the same, still-enrolled destination and
 * scope. A failed read never means consent. Recheck immediately before Quo. */
export async function authorizeDigestDelivery(
  prepared: ScheduleRecipient,
  readCurrent: () => Promise<ScheduleRecipient | null>,
): Promise<boolean> {
  if (!receivesDailyDigest(prepared)) return false;
  try {
    const current = await readCurrent();
    if (!current || !receivesDailyDigest(current)) return false;
    const identity = (row: ScheduleRecipient) => JSON.stringify([
      row.phone, row.portal_token, row.region, [...row.property_ids].sort(), row.language,
    ]);
    return identity(current) === identity(prepared);
  } catch { return false; }
}
