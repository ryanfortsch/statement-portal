/**
 * The Helm-native guest record (public.guests) and its link to bookings.
 *
 * A booking arrives with a name, an email and a phone, or some subset. This
 * module finds the person behind it by lower(email) first, then E.164
 * phone, creates the record when nobody matches, folds in whatever the
 * booking knows that the record did not (fill blanks only), and stamps
 * bookings.guest_id. The rules are pure in guests-identity-core.ts; this
 * file is the database edge.
 *
 * Two things it never does:
 *   - invent a placeholder email. A phone-only guest stays email-less; the
 *     unique index on email_normalized is partial, so nulls are fine.
 *   - promote to audience_contacts. That is the phase-2 promoter's job,
 *     which reuses isProxyEmail (guests-types.ts) and decideGuest
 *     (guest-sync-policy.ts), the paths the campaign audience already
 *     trusts.
 *
 * Service role only: guests is RLS-locked with no anon policy.
 */
import 'server-only';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { isProxyEmail } from '@/lib/guests-types';
import type { Booking } from '@/lib/channels-types';
import {
  pickMatchStrategy,
  mergeGuestFields,
  newGuestFields,
  normalizeEmail,
  toE164Phone,
  type GuestLike,
  type GuestRecordFields,
} from '@/lib/guests-identity-core';

export type GuestRow = GuestRecordFields & {
  id: string;
  email_normalized: string | null;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

export const GUEST_COLS =
  'id, first_name, last_name, full_name, email, email_normalized, phone, phone_e164, notes, source, created_at, updated_at';

const UNIQUE_VIOLATION = '23505';

export async function getGuest(id: string): Promise<GuestRow | null> {
  if (!isServiceConfigured || !id) return null;
  const { data, error } = await supabaseAdmin.from('guests').select(GUEST_COLS).eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data as GuestRow;
}

/** Match on lower(trim(email)). Accepts any casing or padding. */
export async function findGuestByEmail(email: string | null | undefined): Promise<GuestRow | null> {
  const normalized = normalizeEmail(email);
  if (!isServiceConfigured || !normalized) return null;
  const { data, error } = await supabaseAdmin
    .from('guests')
    .select(GUEST_COLS)
    .eq('email_normalized', normalized)
    .maybeSingle();
  if (error || !data) return null;
  return data as GuestRow;
}

/** Match on E.164. Accepts a raw phone and normalizes it first. */
export async function findGuestByPhone(phone: string | null | undefined): Promise<GuestRow | null> {
  const e164 = toE164Phone(phone);
  if (!isServiceConfigured || !e164) return null;
  const { data, error } = await supabaseAdmin.from('guests').select(GUEST_COLS).eq('phone_e164', e164).maybeSingle();
  if (error || !data) return null;
  return data as GuestRow;
}

export type GuestBookingInput = GuestLike & {
  /** The bookings.id to stamp guest_id on. Omit to resolve without linking. */
  id?: string | null;
  /** helm | direct_booking | sca | seed | sms; recorded on a NEW guest only. */
  source?: string | null;
};

async function findByStrategies(input: GuestLike): Promise<GuestRow | null> {
  for (const s of pickMatchStrategy(input, { isProxyEmail })) {
    const hit = s.kind === 'email' ? await findGuestByEmail(s.email) : await findGuestByPhone(s.phone);
    if (hit) return hit;
  }
  return null;
}

async function linkBooking(bookingId: string, guestId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('bookings').update({ guest_id: guestId }).eq('id', bookingId);
  if (error) console.warn('[guests-identity] link failed', bookingId, error.message);
}

/**
 * Resolve the guest behind a booking, creating the record when absent,
 * and stamp bookings.guest_id. Returns the guest id, or null when the
 * booking carries no identity at all (an iCal "Reserved" row has none, and
 * no record is made for it).
 */
export async function upsertGuestForBooking(booking: GuestBookingInput): Promise<string | null> {
  if (!isServiceConfigured) return null;
  const strategies = pickMatchStrategy(booking, { isProxyEmail });
  if (strategies.length === 0) return null;

  let guest = await findByStrategies(booking);

  if (guest) {
    const { patch, changed } = mergeGuestFields(guest, booking, { isProxyEmail });
    if (changed) {
      const { error } = await supabaseAdmin
        .from('guests')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', guest.id);
      // A second guest already owns the email or phone we tried to fill in:
      // keep the record as it was rather than merge two people by accident.
      if (error && error.code !== UNIQUE_VIOLATION) {
        console.warn('[guests-identity] merge failed', guest.id, error.message);
      }
    }
  } else {
    const fields = newGuestFields(booking);
    const { data, error } = await supabaseAdmin
      .from('guests')
      .insert({ ...fields, source: booking.source?.trim() || 'helm' })
      .select(GUEST_COLS)
      .maybeSingle();
    if (error) {
      // Two bookings for the same new guest landing together: the loser of
      // the unique index re-reads the winner's row.
      if (error.code !== UNIQUE_VIOLATION) throw new Error(`create guest: ${error.message}`);
      guest = await findByStrategies(booking);
      if (!guest) throw new Error(`create guest: unique violation but no matching record for the same identity`);
    } else {
      guest = (data ?? null) as GuestRow | null;
      if (!guest) throw new Error('create guest: insert returned no row');
    }
  }

  if (booking.id) await linkBooking(booking.id, guest.id);
  return guest.id;
}

/** Every canonical booking linked to a guest, most recent first. */
export async function listGuestStays(guestId: string): Promise<Booking[]> {
  if (!isServiceConfigured || !guestId) return [];
  return selectAllPaged<Booking>(
    (from, to) =>
      supabaseAdmin
        .from('bookings')
        .select('*')
        .eq('guest_id', guestId)
        .is('duplicate_of', null)
        .order('check_in', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'guest stays' },
  );
}
