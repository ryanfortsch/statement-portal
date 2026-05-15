'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';

/**
 * Dismiss an email from the daily brief.
 *
 * Flips `email_triage.is_unread` to false for the given Gmail message id,
 * which makes it drop off /today and out of the SMS body. Next time the
 * hourly cron runs, if the email is still actually unread in Gmail it
 * will get re-stamped is_unread=true and come back — but that's the
 * right behavior (the operator decided the email no longer needs their
 * attention; if Gmail still has it marked unread for a real reason, it
 * stays).
 *
 * No row deletion: keep the classification so we don't pay the LLM
 * again if Gmail re-flags it.
 */
export async function markEmailHandled(gmailMessageId: string): Promise<{ ok: boolean }> {
  if (!gmailMessageId) return { ok: false };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) return { ok: false };
  const sb = createClient(url, key);
  await sb
    .from('email_triage')
    .update({ is_unread: false, last_seen_at: new Date().toISOString() })
    .eq('gmail_message_id', gmailMessageId);
  revalidatePath('/today');
  return { ok: true };
}
