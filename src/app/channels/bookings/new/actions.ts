'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import {
  BOOKING_CHANNELS,
  BOOKING_STATUSES,
  type BookingChannel,
  type BookingStatus,
} from '@/lib/channels-types';

function getSb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !key) throw new Error('Supabase env vars not configured');
  return createClient(url, key, { auth: { persistSession: false } });
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
  const payout = parseMoney(formData.get('payout'));
  const notes = String(formData.get('notes') || '').trim() || null;

  if (!propertyId) throw new Error('Pick a property.');
  if (!checkIn || !checkOut) throw new Error('Both check-in and check-out are required.');
  if (!isYmd(checkIn) || !isYmd(checkOut)) throw new Error('Dates must be YYYY-MM-DD.');
  if (checkOut <= checkIn) throw new Error('Check-out must be after check-in.');
  if (!BOOKING_CHANNELS.includes(channel)) throw new Error('Invalid channel.');
  if (!BOOKING_STATUSES.includes(status)) throw new Error('Invalid status.');

  const sb = getSb();
  const nights = nightsBetween(checkIn, checkOut);

  const { error } = await sb
    .from('bookings')
    .insert({
      property_id: propertyId,
      channel,
      source: 'manual',
      status,
      check_in: checkIn,
      check_out: checkOut,
      nights,
      guest_name: guestName,
      guest_email: guestEmail,
      guest_phone: guestPhone,
      num_guests: numGuests,
      gross_amount: grossAmount,
      cleaning_fee: cleaningFee,
      payout,
      notes,
    });

  if (error) throw new Error(error.message);

  revalidatePath('/channels');
  revalidatePath('/channels/bookings');
  revalidatePath('/channels/calendar');
  redirect(`/channels/bookings?property=${propertyId}`);
}

function parseMoney(value: FormDataEntryValue | null): number | null {
  if (value === null) return null;
  const s = String(value).trim().replace(/[$,]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  return Math.round((b - a) / 86400_000);
}
