'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import type { BookingStatus } from '@/lib/channels-types';

function getSb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !key) throw new Error('Supabase env vars not configured');
  return createClient(url, key, { auth: { persistSession: false } });
}

const ALLOWED: BookingStatus[] = ['inquiry', 'pending', 'confirmed', 'cancelled', 'completed', 'block'];

export async function setBookingStatus(formData: FormData) {
  const id = String(formData.get('id') || '').trim();
  const status = String(formData.get('status') || '') as BookingStatus;
  if (!id) throw new Error('Missing booking id');
  if (!ALLOWED.includes(status)) throw new Error('Invalid status');

  const sb = getSb();

  const update: Record<string, unknown> = { status };
  if (status === 'cancelled') update.cancelled_at = new Date().toISOString();

  const { error } = await sb.from('bookings').update(update).eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/channels');
  revalidatePath('/channels/bookings');
  revalidatePath('/channels/calendar');
}
