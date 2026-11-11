'use server';

import { revalidatePath } from 'next/cache';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { todayET } from '@/lib/checkout-schedule';
import { readCleanerReport } from '@/lib/cleaner-stay-report.server';
import { loadCleanerCountSource, readCleanerCountToken } from '@/lib/cleaner-guest-counts.server';
import { readCleanerCountReservation } from '@/lib/cleaner-guest-counts';
import { saveMissingCleanerCounts } from '@/lib/cleaner-count-save';

export type CountSaveState = { status: 'idle' | 'saved' | 'error'; saved: number };

export async function saveGuestCounts(): Promise<CountSaveState> {
  const actor = await requireOwnerEmail();
  try {
    const from = todayET();
    const reloadContext = async () => {
      const [base, source] = await Promise.all([
        readCleanerReport(supabaseAdmin, from), loadCleanerCountSource(supabaseAdmin),
      ]);
      return { ...base, ...source };
    };
    const before = await reloadContext();
    const deadline = AbortSignal.timeout(20000);
    let token: Promise<string> | undefined;
    const saved = await saveMissingCleanerCounts(before, {
      reloadContext,
      readReservation: async id => readCleanerCountReservation(id,
        await (token ??= readCleanerCountToken(supabaseAdmin)), deadline),
      commit: async (rows, checkedAt) => {
        const result = await supabaseAdmin.rpc('helm_save_calderwood_guest_counts', {
          p_rows: rows, p_checked_at: checkedAt, p_actor: actor,
        });
        if (result.error || typeof result.data !== 'number') throw Error('Count save unavailable');
        return result.data;
      },
    });
    revalidatePath('/channels/65_calderwood/cleaner-schedule');
    revalidatePath('/channels/bookings');
    revalidatePath('/channels/bookings/[id]', 'page');
    revalidatePath('/c/[token]/stays', 'page');
    return { status: 'saved', saved };
  } catch {
    // Upstream/SQL failures can contain private IDs. Keep them off the page.
    return { status: 'error', saved: 0 };
  }
}
