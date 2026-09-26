'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { BOOKING_STATUSES, type BookingStatus } from '@/lib/channels-types';
import {
  cancelBooking,
  conflictToSearchParams,
  deleteOrCancelBooking,
  getBooking,
  isBookingOverlapError,
  moveBooking,
  updateBookingMoney,
  updateGuestFields,
} from '@/lib/bookings-write';
import { isYmd } from '@/lib/bookings-write-core';
import { writeDirectBookingFinance } from '@/lib/booking-finance-write';

/**
 * The booking record page. Save = updateGuestFields (who is staying) +
 * updateBookingMoney (what they paid) + moveBooking (dates and status
 * through the locked RPC). A status of cancelled is a soft cancel with a
 * reason. `channel` is provenance now and is not editable here.
 *
 * A refused move redirects back to the record with the conflicting stay in
 * the query string; the page reads it with conflictFromSearchParams.
 */

const DIRECT_CHANNELS: ReadonlySet<string> = new Set(['direct', 'manual']);

async function actorEmail(): Promise<string> {
  const session = await auth();
  return session?.user?.email ?? 'helm@helm.system';
}

function revalidateBooking(id: string, propertyId?: string) {
  revalidatePath('/channels');
  revalidatePath('/channels/bookings');
  revalidatePath('/channels/calendar');
  revalidatePath(`/channels/bookings/${id}`);
  if (propertyId) revalidatePath(`/channels/${propertyId}`);
}

export async function updateBooking(formData: FormData) {
  const id = String(formData.get('id') || '').trim();
  if (!id) throw new Error('Missing booking id');

  const before = await getBooking(id);
  if (!before) throw new Error('Booking not found.');

  const status = String(formData.get('status') || before.status) as BookingStatus;
  const checkIn = String(formData.get('check_in') || before.check_in).trim();
  const checkOut = String(formData.get('check_out') || before.check_out).trim();
  if (!BOOKING_STATUSES.includes(status)) throw new Error('Invalid status.');
  if (!isYmd(checkIn) || !isYmd(checkOut)) throw new Error('Dates must be YYYY-MM-DD.');
  if (checkOut <= checkIn) throw new Error('Check-out must be after check-in.');

  const actor = await actorEmail();

  // 1. who is staying
  const guestPatch: Record<string, unknown> = {};
  for (const k of ['guest_name', 'guest_email', 'guest_phone', 'num_guests', 'notes'] as const) {
    if (formData.has(k)) guestPatch[k] = nullableStr(formData.get(k));
  }
  await updateGuestFields(id, guestPatch, actor);

  // 2. what they paid (the bookings columns, plus booking_finance on a direct stay)
  const moneyPatch: Record<string, number | null> = {};
  for (const k of ['gross_amount', 'cleaning_fee', 'taxes', 'payout'] as const) {
    if (formData.has(k)) moneyPatch[k] = parseMoney(formData.get(k));
  }
  if (Object.keys(moneyPatch).length > 0) {
    await updateBookingMoney(id, moneyPatch, actor);
    const hasMoney = Object.values(moneyPatch).some((v) => v !== null);
    if (hasMoney && DIRECT_CHANNELS.has(before.channel)) {
      await writeDirectBookingFinance(id, {
        ...moneyPatch,
        money_source: 'manual',
        confidence: 'low',
        notes: 'Edited on the booking record',
      }).catch((err: unknown) => console.warn('[bookings/[id]] booking_finance write failed', err instanceof Error ? err.message : err));
    }
  }

  // 3. dates and status, through the RPC
  const datesMoved = checkIn !== before.check_in.slice(0, 10) || checkOut !== before.check_out.slice(0, 10);
  let conflictRedirect: string | null = null;
  try {
    if (status === 'cancelled' && before.status !== 'cancelled') {
      const reason = nullableStr(formData.get('cancel_reason')) ?? 'operator';
      await cancelBooking(id, { reason, actor });
      if (datesMoved) await moveBooking(id, { checkIn, checkOut, status: 'cancelled' }, actor);
    } else if (datesMoved || status !== before.status) {
      await moveBooking(id, { checkIn, checkOut, status }, actor);
    }
  } catch (err) {
    if (!isBookingOverlapError(err)) throw err;
    conflictRedirect = `/channels/bookings/${id}?${conflictToSearchParams(err.conflict, { check_in: checkIn, check_out: checkOut })}`;
  }

  revalidateBooking(id, before.property_id);
  if (conflictRedirect) redirect(conflictRedirect);
}

/** Soft cancel with a typed reason. Fields: id, reason. */
export async function cancelBookingWithReason(formData: FormData) {
  const id = String(formData.get('id') || '').trim();
  if (!id) throw new Error('Missing booking id');
  const reason = nullableStr(formData.get('reason')) ?? nullableStr(formData.get('cancel_reason')) ?? 'operator';
  const actor = await actorEmail();
  const row = await cancelBooking(id, { reason, actor });
  revalidateBooking(id, row.property_id);
}

/**
 * The Delete button. Only a block, or an inquiry nothing downstream has
 * touched, is actually deleted; anything else is kept as a soft cancel and
 * the record page is told why (?kept=cancelled).
 */
export async function deleteBooking(formData: FormData) {
  const id = String(formData.get('id') || '').trim();
  if (!id) throw new Error('Missing booking id');
  const actor = await actorEmail();
  const result = await deleteOrCancelBooking(id, actor);
  revalidateBooking(id, result.booking.property_id);
  if (result.outcome === 'deleted') redirect('/channels/bookings?deleted=1');
  redirect(`/channels/bookings/${id}?kept=cancelled`);
}

function nullableStr(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function parseMoney(v: FormDataEntryValue | null): number | null {
  if (v === null) return null;
  const s = String(v).trim().replace(/[$,]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
