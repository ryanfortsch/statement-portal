'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { auth } from '@/auth';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { countUnorganizedSlips, organizeOpenWorkSlips } from '@/lib/organize-work-slips';
import { refreshWorkBriefs } from '@/lib/work-briefs';

/** Organize on demand from the Work board.
 *
 *  Same shape as planRunsNow: the response is instant (a count of slips the
 *  nightly pass has not seen yet) and the model calls run AFTER the response
 *  via after(). A whole backlog is a few minutes of per-home calls; the board
 *  is force-dynamic, so the next refresh shows whatever landed. The nightly
 *  cron catches anything the budget left behind. */
export async function organizeWorkNow(): Promise<{ ok: true; pending: number } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!isServiceConfigured) return { ok: false, error: 'Helm database is not configured' };
  try {
    const pending = await countUnorganizedSlips(supabaseAdmin);
    // Briefs are rewritten for every home whose slip set moved, whether or
    // not any slip needed organizing: closing three slips changes the brief.
    after(async () => {
      try {
        if (pending > 0) {
          const res = await organizeOpenWorkSlips(supabaseAdmin, { maxProperties: 30 });
          if (res.errors.length) console.warn('[organizeWorkNow] errors', res.errors);
        }
        const briefs = await refreshWorkBriefs(supabaseAdmin, { maxProperties: 30 });
        if (briefs.errors.length) console.warn('[organizeWorkNow] brief errors', briefs.errors);
      } catch (err) {
        console.error('[organizeWorkNow] background pass failed', err);
      }
    });
    revalidatePath('/work');
    return { ok: true, pending };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** How many slips the background pass still has to file. The board's
 *  Organize button polls this after a click until it reaches zero (or the
 *  pass's budget is spent) and then says what was done, instead of asking
 *  the operator to check back. */
export async function organizePendingCount(): Promise<{ ok: true; pending: number } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!isServiceConfigured) return { ok: false, error: 'Helm database is not configured' };
  try {
    return { ok: true, pending: await countUnorganizedSlips(supabaseAdmin) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
