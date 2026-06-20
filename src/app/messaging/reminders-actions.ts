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

export async function fetchReminderData(): Promise<{
  ok: true;
  reservations: ReservationPick[];
  recurring: RecurringMessage[];
} | { ok: false; error: string }> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const [res, rec] = await Promise.all([
    listReservationsForPicker(),
    listRecurring(),
  ]);
  return {
    ok: true,
    reservations: res.ok ? res.data.reservations : [],
    recurring: rec.ok ? rec.data.recurring : [],
  };
}

export async function createReminderAction(
  input: CreateRecurringInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  if (!input.conversation_id) return { ok: false, error: 'Pick a guest/reservation' };
  if (!input.body.trim()) return { ok: false, error: 'Write the reminder message' };
  if (!input.weekdays) return { ok: false, error: 'Pick at least one day of the week' };
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
