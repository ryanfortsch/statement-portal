'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import {
  BOOKING_CHANNELS,
  BOOKING_STATUSES,
  type BookingChannel,
  type BookingStatus,
} from '@/lib/channels-types';
import { getFleetProperty } from '@/lib/fleet';
import { createBlock, createBooking, conflictToSearchParams, isBookingOverlapError } from '@/lib/bookings-write';
import { isYmd } from '@/lib/bookings-write-core';
import { writeDirectBookingFinance } from '@/lib/booking-finance-write';

/**
 * The /channels/bookings/new form. A block goes through createBlock, a
 * stay through createBooking; both run the advisory-locked RPC, so a
 * double-booking is refused at the database with the conflicting stay,
 * which this action hands back to the form in the query string
 * (conflictFromSearchParams on the page reads it; check_in / check_out /
 * property / type ride along so the form re-fills).
 *
 * Money typed on a direct or manual stay is also recorded on
 * booking_finance as money_source 'manual', low confidence, so the record
 * page's money sub-record is not blank until Stripe settles.
 */

const HOLD_KINDS = ['owner', 'maintenance', 'ota', 'other'] as const;
type HoldKind = (typeof HOLD_KINDS)[number];

const DIRECT_CHANNELS: ReadonlySet<BookingChannel> = new Set(['direct', 'manual']);

async function actorEmail(): Promise<string> {
  const session = await auth();
  return session?.user?.email ?? 'helm@helm.system';
}

export async function createManualBooking(formData: FormData) {
  const propertyId = String(formData.get('property_id') || '').trim();
  const channel = String(formData.get('channel') || 'manual') as BookingChannel;
  const status = String(formData.get('status') || 'confirmed') as BookingStatus;
  const checkIn = String(formData.get('check_in') || '').trim();
  const checkOut = String(formData.get('check_out') || '').trim();
  const guestName = String(formData.get('guest_name') || '').trim() || null;
  const guestEmail = String(formData.get('guest_email') || '').trim() || null;
  const guestPhone = String(formData.get('guest_phone') || '').trim() || null;
  const numGuests = Number(formData.get('num_guests') || 0) || null;
  const grossAmount = parseMoney(formData.get('gross_amount'));
  const cleaningFee = parseMoney(formData.get('cleaning_fee'));
  const taxes = parseMoney(formData.get('taxes'));
  const payout = parseMoney(formData.get('payout'));
  const notes = String(formData.get('notes') || '').trim() || null;
  const holdKindRaw = String(formData.get('hold_kind') || '').trim();
  const isBlock = status === 'block' || channel === 'block' || String(formData.get('type') || '') === 'block';

  if (!propertyId) throw new Error('Pick a property.');
  if (!checkIn || !checkOut) throw new Error('Both check-in and check-out are required.');
  if (!isYmd(checkIn) || !isYmd(checkOut)) throw new Error('Dates must be YYYY-MM-DD.');
  if (checkOut <= checkIn) throw new Error('Check-out must be after check-in.');
  if (!BOOKING_CHANNELS.includes(channel)) throw new Error('Invalid channel.');
  if (!BOOKING_STATUSES.includes(status)) throw new Error('Invalid status.');
  if (channel === 'guesty') throw new Error('A booking is never stored on the Guesty aggregate channel.');
  if (holdKindRaw && !(HOLD_KINDS as readonly string[]).includes(holdKindRaw)) throw new Error('Invalid hold kind.');

  const property = await getFleetProperty(propertyId);
  if (!property || !property.is_active) throw new Error('Property not found or inactive.');

  const actor = await actorEmail();
  let bookingId: string | null = null;
  let conflictRedirect: string | null = null;

  try {
    if (isBlock) {
      const row = await createBlock({
        propertyId,
        checkIn,
        checkOut,
        holdKind: (holdKindRaw || 'other') as HoldKind,
        note: notes,
        createdBy: actor,
      });
      bookingId = row.id;
    } else {
      const row = await createBooking({
        propertyId,
        channel,
        source: 'manual',
        status,
        checkIn,
        checkOut,
        guestName,
        guestEmail,
        guestPhone,
        numGuests,
        grossAmount,
        cleaningFee,
        taxes,
        payout,
        notes,
        actor,
      });
      bookingId = row.id;

      const hasMoney = [grossAmount, cleaningFee, taxes, payout].some((v) => v !== null);
      if (hasMoney && DIRECT_CHANNELS.has(channel)) {
        await writeDirectBookingFinance(row.id, {
          gross_amount: grossAmount,
          cleaning_fee: cleaningFee,
          taxes,
          payout,
          money_source: 'manual',
          confidence: 'low',
          notes: 'Typed on /channels/bookings/new',
        }).catch((err: unknown) => console.warn('[bookings/new] booking_finance write failed', err instanceof Error ? err.message : err));
      }
    }
  } catch (err) {
    if (!isBookingOverlapError(err)) throw err;
    conflictRedirect = `/channels/bookings/new?${conflictToSearchParams(err.conflict, {
      property: propertyId,
      type: isBlock ? 'block' : null,
      check_in: checkIn,
      check_out: checkOut,
    })}`;
  }

  revalidatePath('/channels');
  revalidatePath('/channels/bookings');
  revalidatePath('/channels/calendar');
  revalidatePath(`/channels/${propertyId}`);

  if (conflictRedirect) redirect(conflictRedirect);
  redirect(`/channels/bookings/${bookingId}`);
}

function parseMoney(value: FormDataEntryValue | null): number | null {
  if (value === null) return null;
  const s = String(value).trim().replace(/[$,]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
