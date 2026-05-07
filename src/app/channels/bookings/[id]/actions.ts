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

export async function updateBooking(formData: FormData) {
  const id = String(formData.get('id') || '').trim();
  if (!id) throw new Error('Missing booking id');

  const channel = String(formData.get('channel') || '') as BookingChannel;
  const status = String(formData.get('status') || '') as BookingStatus;
  const checkIn = String(formData.get('check_in') || '').trim();
  const checkOut = String(formData.get('check_out') || '').trim();

  if (!BOOKING_CHANNELS.includes(channel)) throw new Error('Invalid channel.');
  if (!BOOKING_STATUSES.includes(status)) throw new Error('Invalid status.');
  if (!checkIn || !checkOut) throw new Error('Both dates are required.');
  if (checkOut <= checkIn) throw new Error('Check-out must be after check-in.');

  const update = {
    channel,
    status,
    check_in: checkIn,
    check_out: checkOut,
    nights: Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400_000),
    guest_name: nullableStr(formData.get('guest_name')),
    guest_email: nullableStr(formData.get('guest_email')),
    guest_phone: nullableStr(formData.get('guest_phone')),
    num_guests: nullableNum(formData.get('num_guests')),
    gross_amount: parseMoney(formData.get('gross_amount')),
    cleaning_fee: parseMoney(formData.get('cleaning_fee')),
    payout: parseMoney(formData.get('payout')),
    notes: nullableStr(formData.get('notes')),
    cancelled_at: status === 'cancelled' ? new Date().toISOString() : null,
  };

  const sb = getSb();
  const { error } = await sb.from('bookings').update(update).eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/channels');
  revalidatePath('/channels/bookings');
  revalidatePath('/channels/calendar');
  revalidatePath(`/channels/bookings/${id}`);
}

export async function deleteBooking(formData: FormData) {
  const id = String(formData.get('id') || '').trim();
  if (!id) throw new Error('Missing booking id');
  const sb = getSb();
  const { error } = await sb.from('bookings').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/channels');
  revalidatePath('/channels/bookings');
  revalidatePath('/channels/calendar');
  redirect('/channels/bookings');
}

function nullableStr(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function nullableNum(v: FormDataEntryValue | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseMoney(v: FormDataEntryValue | null): number | null {
  if (v === null) return null;
  const s = String(v).trim().replace(/[$,]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
