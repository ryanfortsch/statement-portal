'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { sessionDispatches } from '@/lib/helm-access-server';
import { getTeamMember, walksHomes } from '@/lib/team';
import { changesSomeoneElse, isSomeoneElse, WALK_FOR_OTHERS, WALK_OFF_OTHERS } from '@/lib/walk-assignment';

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

  // Who walks it is the dispatcher's call (team.ts, `dispatch`). Anyone may
  // put themselves on a walk or take themselves off; naming someone else,
  // or taking someone else off, needs the duty (lib/walk-assignment.ts).
  const { data: current, error: curErr } = await supabase
    .from('inspection_plans')
    .select('assigned_to_email')
    .eq('guesty_reservation_id', args.guestyReservationId)
    .maybeSingle();
  if (curErr) return { ok: false, error: `Could not read the plan, so nothing changed (${curErr.message})` };
  const want = args.assignedToEmail?.trim() || null;
  const have = (current as { assigned_to_email: string | null } | null)?.assigned_to_email?.trim() || null;
  if (changesSomeoneElse(session.user.email, want, have) && !(await sessionDispatches())) {
    return { ok: false, error: WALK_FOR_OTHERS };
  }

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
        assigned_to_email: want,
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

  // Removing a walk someone else is down for is the dispatcher's call.
  const { data: row, error: readErr } = await supabase.from('inspection_plans').select('assigned_to_email').eq('id', planId).maybeSingle();
  if (readErr) return { ok: false, error: `Could not read the plan, so nothing changed (${readErr.message})` };
  const holder = (row as { assigned_to_email: string | null } | null)?.assigned_to_email ?? null;
  if (isSomeoneElse(session.user.email, holder) && !(await sessionDispatches())) return { ok: false, error: WALK_OFF_OTHERS };

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
  /** The dispatcher planning for a teammate; everyone else plans for themselves. */
  forEmail?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: 'Not signed in' };
  if (!DAY_RE.test(args.date)) return { ok: false, error: 'Pick a day' };
  if (!args.reservationId || !args.propertyId) return { ok: false, error: 'Nothing to walk' };

  // The mark is the tapper's unless the dispatcher is planning for a
  // teammate (team.ts, `dispatch`); nobody else names anyone but themselves.
  let assignee = email;
  if (isSomeoneElse(email, args.forEmail)) {
    const member = getTeamMember(args.forEmail);
    if (!member?.active) return { ok: false, error: 'Not on the team' };
    if (!walksHomes(member.email)) return { ok: false, error: `${member.short} is not on the walk list` };
    if (!(await sessionDispatches())) return { ok: false, error: WALK_FOR_OTHERS };
    assignee = member.email;
  }

  const { data: existing, error: readErr } = await supabase
    .from('inspection_plans')
    .select('id, notes, planned_by_email')
    .eq('guesty_reservation_id', args.reservationId)
    .maybeSingle();
  // A failed read must not become a blank write: the note and the planner
  // would be overwritten with nothing.
  if (readErr) return { ok: false, error: `Could not read the plan, so nothing changed (${readErr.message})` };
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
        assigned_to_email: assignee,
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

/**
 * The tap on your own mark: the walk goes back to needing someone. A plan
 * you made yourself with a tap (yours, no note) is removed. One somebody
 * else planned, or one carrying a note, keeps its day and its note and
 * loses only your name, so it reads "nobody named" and the day asks again.
 * `remove` (the dialog's Remove plan) deletes either way.
 */
export async function releaseWalk(
  planId: string,
  opts: { remove?: boolean } = {},
): Promise<{ ok: true; kept: boolean } | { ok: false; error: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: 'Not signed in' };
  if (!planId) return { ok: false, error: 'Nothing to release' };

  const { data: row, error: readErr } = await supabase
    .from('inspection_plans')
    .select('id, notes, planned_by_email, assigned_to_email')
    .eq('id', planId)
    .maybeSingle();
  if (readErr) return { ok: false, error: `Could not read the plan, so nothing changed (${readErr.message})` };
  const plan = (row ?? null) as { id: string; notes: string | null; planned_by_email: string | null; assigned_to_email: string | null } | null;
  if (!plan) return { ok: true, kept: false };
  // Taking someone else off a walk, plan kept or removed, is the
  // dispatcher's call; your own mark is yours to let go.
  if (isSomeoneElse(email, plan.assigned_to_email) && !(await sessionDispatches())) return { ok: false, error: WALK_OFF_OTHERS };

  const mine = (plan.planned_by_email ?? '').trim().toLowerCase() === email.trim().toLowerCase();
  const keep = !opts.remove && !(mine && !plan.notes?.trim());
  const { error } = keep
    ? await supabase.from('inspection_plans').update({ assigned_to_email: null }).eq('id', planId)
    : await supabase.from('inspection_plans').delete().eq('id', planId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/turnovers');
  revalidatePath('/');
  return { ok: true, kept: keep };
}
