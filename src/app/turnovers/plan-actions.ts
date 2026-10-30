'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

/**
 * Create or update an inspection plan for a stay. Post-Guesty-cutover the stay
 * key is a `bookings.id` (passed in as `guestyReservationId` to keep the call
 * sites stable). We write it to both `guesty_reservation_id` (the unique key we
 * upsert on) and `booking_id` (the proper FK, for the eventual cleanup that
 * drops the legacy column).
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
        booking_id: args.guestyReservationId,
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

  revalidatePath('/turnovers');
  return { ok: true, id: (data as { id: string }).id };
}

/** Remove a plan entirely (e.g. operator changed their mind). */
export async function deleteInspectionPlan(planId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const { error } = await supabase.from('inspection_plans').delete().eq('id', planId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/turnovers');
  return { ok: true };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The week grid's tap: "I'll walk this one on <date>". It writes the same
 * row as the plan editor above, one per stay, so a tap shows on the board's
 * walk column, the home feed and the Field packet board at once. A second
 * tap on another day moves the plan; the person tapping becomes the one
 * who walks it; whoever first planned it, and any note they wrote, stay.
 */
export async function claimWalk(args: {
  reservationId: string;
  propertyId: string;
  checkIn: string;
  checkOut: string;
  date: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: 'Not signed in' };
  if (!DAY_RE.test(args.date)) return { ok: false, error: 'Pick a day' };
  if (!args.reservationId || !args.propertyId) return { ok: false, error: 'Nothing to walk' };

  const { data: existing } = await supabase
    .from('inspection_plans')
    .select('id, notes, planned_by_email')
    .eq('guesty_reservation_id', args.reservationId)
    .maybeSingle();
  const prior = (existing ?? null) as { id: string; notes: string | null; planned_by_email: string | null } | null;

  const { data, error } = await supabase
    .from('inspection_plans')
    .upsert(
      {
        guesty_reservation_id: args.reservationId,
        booking_id: args.reservationId,
        property_id: args.propertyId,
        checkin_date: args.checkIn,
        checkout_date: args.checkOut,
        planned_for_date: args.date,
        notes: prior?.notes ?? null,
        planned_by_email: prior?.planned_by_email || email,
        assigned_to_email: email,
      },
      { onConflict: 'guesty_reservation_id' },
    )
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'Could not save the walk' };

  revalidatePath('/turnovers');
  revalidatePath('/');
  return { ok: true, id: (data as { id: string }).id };
}

/** The tap on your own mark: the walk goes back to needing someone. */
export async function releaseWalk(planId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!planId) return { ok: false, error: 'Nothing to release' };

  const { error } = await supabase.from('inspection_plans').delete().eq('id', planId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/turnovers');
  revalidatePath('/');
  return { ok: true };
}
