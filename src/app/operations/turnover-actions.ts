'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';

/**
 * Mark / unmark a turnover as done by hand. This is the operator's "I've
 * handled this, get it out of my list" signal — independent of whether a
 * formal inspection was run. A row in turnover_completions sinks the
 * turnover to the bottom of the /operations pipeline (see TurnoverList).
 *
 * Keyed by the natural turnover identity (property_id, check_in) so the
 * mark survives an iCal re-sync. Both actions take a single FormData arg
 * to fit the `<form action={...}>` server-action contract the operations
 * page already uses for Start Inspection.
 */

export async function markTurnoverComplete(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const propertyId = String(formData.get('property_id') || '');
  const checkIn = String(formData.get('check_in') || '').slice(0, 10);
  if (!propertyId || !checkIn) throw new Error('Missing turnover identity');

  const reservationId = String(formData.get('reservation_id') || '') || null;
  const guestName = String(formData.get('guest_name') || '') || null;

  const { error } = await supabase.from('turnover_completions').upsert(
    {
      property_id: propertyId,
      check_in: checkIn,
      reservation_id: reservationId,
      guest_name: guestName,
      completed_at: new Date().toISOString(),
      completed_by_email: session.user.email,
    },
    { onConflict: 'property_id,check_in' },
  );
  if (error) throw new Error(error.message);

  revalidatePath('/operations');
}

export async function unmarkTurnoverComplete(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const propertyId = String(formData.get('property_id') || '');
  const checkIn = String(formData.get('check_in') || '').slice(0, 10);
  if (!propertyId || !checkIn) throw new Error('Missing turnover identity');

  const { error } = await supabase
    .from('turnover_completions')
    .delete()
    .eq('property_id', propertyId)
    .eq('check_in', checkIn);
  if (error) throw new Error(error.message);

  revalidatePath('/operations');
}
