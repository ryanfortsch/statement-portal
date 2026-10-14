'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { auth } from '@/auth';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { countUnorganizedSlips, organizeOpenWorkSlips } from '@/lib/organize-work-slips';

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
    if (pending > 0) {
      after(async () => {
        try {
          const res = await organizeOpenWorkSlips(supabaseAdmin, { maxProperties: 30 });
          if (res.errors.length) console.warn('[organizeWorkNow] errors', res.errors);
        } catch (err) {
          console.error('[organizeWorkNow] background pass failed', err);
        }
      });
    }
    revalidatePath('/work');
    return { ok: true, pending };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
