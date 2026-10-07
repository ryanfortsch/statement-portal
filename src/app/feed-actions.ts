'use server';

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { dismissConciergeAttention } from '@/lib/stay-concierge';

const DISMISSIBLE_TYPES = new Set(['slip', 'task', 'email', 'inbound', 'plink-paid', 'plink-unpaid', 'concierge']);

/**
 * Clear an item off the signed-in user's home "For Me" feed. Records a
 * per-user dismissal (view-only — it does NOT change the underlying slip,
 * task, or email) so the item stays cleared across reloads. The feed
 * excludes dismissals and backfills the next item from the pool.
 *
 * Writes via the service role (bypasses RLS); reads happen on the page with
 * the anon client. Reports failures if the table is missing or there is no
 * session. The caller displays failed dismissals and offers retry.
 */
export async function dismissFeedItem(itemType: string, itemId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!DISMISSIBLE_TYPES.has(itemType) || !itemId) return { ok: false, error: 'This item cannot be cleared.' };

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: 'Sign in again to clear this item.' };

  // A concierge alert (ConciergeAlerts) clears for everyone, on the
  // concierge: an alert somebody handled is handled. The rest of the feed is
  // per-user and view-only.
  if (itemType === 'concierge') {
    const result = await dismissConciergeAttention(itemId, email);
    if (!result.ok || !result.data.ok) return { ok: false, error: 'Could not clear this alert. Try again.' };
    revalidatePath('/');
    return { ok: true };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !serviceKey) return { ok: false, error: 'Feed clearing is unavailable. Try again later.' };

  try {
    const sb = createClient(url, serviceKey);
    const { error } = await sb
      .from('home_feed_dismissals')
      .upsert(
        { user_email: email, item_type: itemType, item_id: itemId },
        { onConflict: 'user_email,item_type,item_id' },
      );
    if (error) return { ok: false, error: 'Could not clear this item. Try again.' };
  } catch {
    return { ok: false, error: 'Could not clear this item. Try again.' };
  }

  revalidatePath('/');
  return { ok: true };
}
