'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { getServiceClient } from '@/lib/supabase-admin';
import { confirmCleaningDone } from '@/lib/cleaning-sessions';

/**
 * Operator confirms an estimated clean is actually done (the dashed "Cleaned?"
 * node / chip). Writes a manual finish to cleaning_sessions. Wired into the
 * turnover rail in Phase 2.
 */
export async function confirmCleaningDoneAction(
  propertyId: string,
  checkoutDate: string,
): Promise<{ ok: boolean; message?: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, message: 'Not signed in' };

  const r = await confirmCleaningDone(getServiceClient(), propertyId, checkoutDate, session.user.email);
  revalidatePath('/operations');
  return r.ok ? { ok: true } : { ok: false, message: r.error };
}
