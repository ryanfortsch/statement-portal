'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  listReservationsForPicker,
  listRecurring,
  createRecurring,
  endRecurring,
  polishProactive,
  explainError,
  type ReservationPick,
  type RecurringMessage,
  type CreateRecurringInput,
} from '@/lib/stay-concierge';

async function requireSession(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  return { ok: true };
}

// Split from a single combined fetch. The recurring list is a fast local-DB
// read; the reservation picker hits Guesty and takes a few seconds. Loading
// them separately lets the section render its scheduled list immediately and
// fill the guest dropdown a moment later, instead of the whole panel sitting
// on "Loading..." until the slow Guesty call returns.
export async function fetchRecurringReminders(): Promise<
  { ok: true; recurring: RecurringMessage[] } | { ok: false; error: string }
> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const rec = await listRecurring();
  return { ok: true, recurring: rec.ok ? rec.data.recurring : [] };
}

export async function fetchReservationPicks(): Promise<
  { ok: true; reservations: ReservationPick[] } | { ok: false; error: string }
> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await listReservationsForPicker();
  return { ok: true, reservations: res.ok ? res.data.reservations : [] };
}

export async function createReminderAction(
  input: CreateRecurringInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  if (!input.conversation_id) return { ok: false, error: 'Pick a guest/reservation' };
  if (!input.body.trim()) return { ok: false, error: 'Write the reminder message' };
  // A one-time message needs a fire date, not weekdays; only the recurring
  // cadence needs a weekday set. (Mirrors the backend's create_reminder check.)
  if (input.kind === 'once') {
    if (!input.fire_date) return { ok: false, error: 'Pick a date to send' };
  } else if (!input.weekdays) {
    return { ok: false, error: 'Pick at least one day of the week' };
  }
  const res = await createRecurring(input);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/messaging');
  return { ok: true };
}

export async function endReminderAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await endRecurring(id);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/messaging');
  return { ok: true };
}

export async function polishProactiveAction(
  reservationId: string,
  roughText: string,
): Promise<{ ok: true; polished: string } | { ok: false; error: string }> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  if (!roughText.trim()) return { ok: false, error: 'Write a rough note first' };
  const res = await polishProactive(reservationId, roughText.trim());
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  return { ok: true, polished: res.data.polished };
}
