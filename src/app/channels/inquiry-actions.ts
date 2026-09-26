'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { BOOKING_STATUSES, type BookingStatus } from '@/lib/channels-types';
import {
  cancelBooking,
  confirmInquiry,
  conflictToSearchParams,
  getBooking,
  isBookingOverlapError,
  moveBooking,
} from '@/lib/bookings-write';

/**
 * The Confirm / Decline chips on the /channels inquiries list. Every status
 * change goes through the locked writer: Confirm is confirmInquiry (the
 * database refuses it, with the conflicting stay, if the nights were taken
 * while the inquiry sat), Decline is a soft cancel with reason 'declined'.
 * A refused confirm redirects back to /channels with the conflict in the
 * query string (conflictFromSearchParams reads it).
 */

async function actorEmail(): Promise<string> {
  const session = await auth();
  return session?.user?.email ?? 'helm@helm.system';
}

export async function setBookingStatus(formData: FormData) {
  const id = String(formData.get('id') || '').trim();
  const status = String(formData.get('status') || '') as BookingStatus;
  if (!id) throw new Error('Missing booking id');
  if (!BOOKING_STATUSES.includes(status)) throw new Error('Invalid status');

  const actor = await actorEmail();
  let conflictRedirect: string | null = null;

  try {
    if (status === 'cancelled') {
      await cancelBooking(id, { reason: 'declined', actor });
    } else {
      const row = await getBooking(id);
      if (!row) throw new Error('Booking not found.');
      if (status === 'confirmed' && (row.status === 'inquiry' || row.status === 'pending')) {
        await confirmInquiry(id, actor);
      } else if (row.status !== status) {
        await moveBooking(id, { checkIn: row.check_in, checkOut: row.check_out, status }, actor);
      }
    }
  } catch (err) {
    if (!isBookingOverlapError(err)) throw err;
    conflictRedirect = `/channels?${conflictToSearchParams(err.conflict, { booking: id })}`;
  }

  revalidatePath('/channels');
  revalidatePath('/channels/bookings');
  revalidatePath('/channels/calendar');
  revalidatePath(`/channels/bookings/${id}`);
  if (conflictRedirect) redirect(conflictRedirect);
}
