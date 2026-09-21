'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { deleteDraft } from '@/lib/daily-brief';

/**
 * Dismiss an email from the daily brief.
 *
 * Stamps `email_triage.handled_at` (handled_via 'operator') and flips
 * is_unread to false for the given Gmail message id, which drops it off
 * /today, the home feed and the SMS body. handled_at is the same
 * retirement stamp the hourly sync sets when it detects a reply, so a
 * needs_reply row the operator has marked handled stays gone. (Before
 * this, the button only flipped is_unread, which since #454 no longer
 * removes a needs_reply row.)
 *
 * If we'd queued an AI reply draft for this email, delete that draft
 * too — the operator is saying "handled", so the unsent draft is just
 * clutter in their Gmail.
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

  const { data: row } = await sb
    .from('email_triage')
    .select('draft_id')
    .eq('gmail_message_id', gmailMessageId)
    .maybeSingle();
  const draftId = (row as { draft_id: string | null } | null)?.draft_id ?? null;
  if (draftId) {
    await deleteDraft(draftId);
  }

  const nowIso = new Date().toISOString();
  await sb
    .from('email_triage')
    .update({
      is_unread: false,
      draft_id: null,
      handled_at: nowIso,
      handled_via: 'operator',
      last_seen_at: nowIso,
    })
    .eq('gmail_message_id', gmailMessageId);
  revalidatePath('/today');
  revalidatePath('/');
  return { ok: true };
}
