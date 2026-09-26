/**
 * Writes to close_tasks, the per-property close-out checklist on /statements.
 *
 * One column there is not like the others. close_tasks.email_sent_at is the
 * sent-statement freeze: every payout writer decides whether it may move an
 * owner's numbers by reading it (src/lib/statement-finality.ts). Two rules
 * follow, and this module is where both live:
 *
 *   1. A close-out tick writes only the field it changed. PostgREST's upsert
 *      sets exactly the columns in the payload, and a first write takes the
 *      table defaults for the rest ('monthly', false, null: the same values
 *      the dashboard falls back to). The dashboard used to send its whole
 *      local copy of the row with every tick, so a click on any box in a tab
 *      loaded before the statement was marked sent wrote email_sent_at and
 *      statement_drive_url back as null. One "Owner paid" click in a stale
 *      tab unfroze a sent statement and dropped its Drive link, with no trace.
 *
 *   2. Clearing email_sent_at never goes through the bare upsert. Clearing it
 *      is unfreezing, and unmarkStatementSentAction is the one door for that:
 *      it files a post_send_write flag on the statement before it clears
 *      (#1439). upsertCloseTask refuses the clear, so no future caller can
 *      reopen the side door by accident.
 *
 * Pure, no imports: the dashboard (client) and the server action both use it.
 */

type Fields = Record<string, unknown>;

/**
 * The upsert payload for one close-out write: the row's keys plus the fields
 * being changed, and nothing else. An undefined field is dropped rather than
 * sent, so the payload is exactly what reaches the database.
 */
export function closeTaskPatchRow<P extends Fields>(
  periodId: string,
  propertyId: string,
  patch: P,
): Partial<P> & { period_id: string; property_id: string } {
  const fields: Fields = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) fields[key] = value;
  }
  // The keys go last, so a patch can never point the write at another row.
  return { ...(fields as Partial<P>), period_id: periodId, property_id: propertyId };
}

/**
 * Why upsertCloseTask must refuse this write, or null when it may proceed.
 * Stamping email_sent_at is an ordinary tick; clearing it is not.
 */
export function closeTaskWriteRefusal(row: Fields): string | null {
  if (Object.prototype.hasOwnProperty.call(row, 'email_sent_at') && !row.email_sent_at) {
    return '"Statement sent" can only be removed through its own confirm, which records the unfreeze on the statement.';
  }
  return null;
}
