'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';

/**
 * Create or update an inspection plan for a Guesty reservation. There's
 * a unique constraint on guesty_reservation_id so we upsert.
 */
export async function setInspectionPlan(args: {
  guestyReservationId: string;
  propertyId: string;
  checkinDate: string;
  checkoutDate: string;
  plannedForDate: string;
  notes?: string;
  assignedToEmail?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  if (!args.plannedForDate) return { ok: false, error: 'Pick a date' };

  const { data, error } = await supabase
    .from('inspection_plans')
    .upsert(
      {
        guesty_reservation_id: args.guestyReservationId,
        property_id: args.propertyId,
        checkin_date: args.checkinDate,
        checkout_date: args.checkoutDate,
        planned_for_date: args.plannedForDate,
        notes: args.notes?.trim() || null,
        planned_by_email: session.user.email,
        assigned_to_email: args.assignedToEmail?.trim() || null,
      },
      { onConflict: 'guesty_reservation_id' }
    )
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message || 'Failed to save plan' };

  revalidatePath('/operations');
  return { ok: true, id: (data as { id: string }).id };
}

/** Remove a plan entirely (e.g. operator changed their mind). */
export async function deleteInspectionPlan(planId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const { error } = await supabase.from('inspection_plans').delete().eq('id', planId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/operations');
  return { ok: true };
}
