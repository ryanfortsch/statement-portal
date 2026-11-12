'use server';

import { revalidatePath } from 'next/cache';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { declineBookingRequest, markHostTold, withdrawBookingRequest } from '@/lib/booking-requests-db';

/**
 * The owner verbs on /guests/requests. Each returns a result the buttons
 * read back, never a throw, so "this request is already closed" lands in a
 * notice rather than an error boundary. Owners only: the path is gated, and
 * a server action posts to whatever page rendered it, so each checks too.
 *
 * There is no accept here. Accepting charges the guest on the host's own
 * Stripe account through Stripe Connect, which is not built.
 */
export type RequestActionResult = { ok: true; note?: string } | { ok: false; error: string };

export async function declineRequestAction(id: string, reason: string): Promise<RequestActionResult> {
  const by = await requireOwnerEmail();
  const r = await declineBookingRequest(id, by, reason);
  revalidatePath('/guests/requests');
  if (!r.ok) return { ok: false, error: r.reason };
  return r.emailed ? { ok: true } : { ok: true, note: 'Declined. The email to the guest did not go; it is retried every hour.' };
}

export async function withdrawRequestAction(id: string): Promise<RequestActionResult> {
  const by = await requireOwnerEmail();
  const r = await withdrawBookingRequest(id, by);
  revalidatePath('/guests/requests');
  return r.ok ? { ok: true } : { ok: false, error: r.reason };
}

export async function markHostToldAction(id: string): Promise<RequestActionResult> {
  const by = await requireOwnerEmail();
  const r = await markHostTold(id, by);
  revalidatePath('/guests/requests');
  return r.ok ? { ok: true } : { ok: false, error: r.reason ?? 'Could not mark it.' };
}
