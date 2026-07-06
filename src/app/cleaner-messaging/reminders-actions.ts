'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  listRecurring,
  listProactiveTargets,
  createRecurring,
  endRecurring,
  polishProactiveFor,
  explainError,
  type ProactiveTarget,
  type RecurringMessage,
  type CreateRecurringInput,
} from '@/lib/stay-concierge';

/**
 * Server actions behind the cleaner ProactiveRemindersPanel. This file
 * hardcodes the audience ('cleaner') and its own revalidate path, so the
 * shared client panel just receives these via its `actions` prop and never
 * needs to know which page it lives on. Mirrors the guest
 * src/app/messaging/reminders-actions.ts split: the two fetches degrade
 * failures to empty arrays so the panel renders instead of erroring.
 */

const AUDIENCE = 'cleaner';
const PAGE = '/cleaner-messaging';

async function requireSession(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  return { ok: true };
}

export async function fetchProactiveReminders(): Promise<
  { ok: true; recurring: RecurringMessage[] } | { ok: false; error: string }
> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const rec = await listRecurring(AUDIENCE);
  return { ok: true, recurring: rec.ok ? rec.data.recurring : [] };
}

export async function fetchProactiveTargets(): Promise<
  { ok: true; targets: ProactiveTarget[] } | { ok: false; error: string }
> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await listProactiveTargets(AUDIENCE);
  return { ok: true, targets: res.ok ? res.data.targets : [] };
}

export async function createProactiveReminder(
  input: CreateRecurringInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  if (!input.target_contact) return { ok: false, error: 'Pick who this goes to' };
  if (!input.body.trim()) return { ok: false, error: 'Write the message' };
  // A one-time message needs a fire date, not weekdays; only the recurring
  // cadence needs a weekday set. (Mirrors the backend's create check.)
  if (input.kind === 'once') {
    if (!input.fire_date) return { ok: false, error: 'Pick a date to send' };
  } else if (!input.weekdays) {
    return { ok: false, error: 'Pick at least one day of the week' };
  }
  // Force this page's audience regardless of what the client sent.
  const res = await createRecurring({ ...input, audience: AUDIENCE });
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath(PAGE);
  return { ok: true };
}

export async function endProactiveReminder(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await endRecurring(id);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath(PAGE);
  return { ok: true };
}

export async function polishProactiveForAction(
  targetName: string,
  roughText: string,
): Promise<{ ok: true; polished: string; english: string } | { ok: false; error: string }> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  if (!roughText.trim()) return { ok: false, error: 'Write a rough note first' };
  const res = await polishProactiveFor(AUDIENCE, targetName, roughText.trim());
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  return { ok: true, polished: res.data.polished, english: res.data.english ?? '' };
}
