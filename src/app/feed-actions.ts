'use server';

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';

const DISMISSIBLE_TYPES = new Set(['slip', 'task', 'email', 'inbound']);

/**
 * Clear an item off the signed-in user's home "For Me" feed. Records a
 * per-user dismissal (view-only — it does NOT change the underlying slip,
 * task, or email) so the item stays cleared across reloads. The feed
 * excludes dismissals and backfills the next item from the pool.
 *
 * Writes via the service role (bypasses RLS); reads happen on the page with
 * the anon client. Fails quietly if the table isn't there yet or there's no
 * session, so a missing migration never crashes the home page.
 */
export async function dismissFeedItem(itemType: string, itemId: string): Promise<void> {
  if (!DISMISSIBLE_TYPES.has(itemType) || !itemId) return;

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !serviceKey) return;

  try {
    const sb = createClient(url, serviceKey);
    await sb
      .from('home_feed_dismissals')
      .upsert(
        { user_email: email, item_type: itemType, item_id: itemId },
        { onConflict: 'user_email,item_type,item_id' },
      );
  } catch {
    // Table may not exist yet (migration not applied). No-op rather than
    // surfacing an error to the click.
    return;
  }

  revalidatePath('/');
}
