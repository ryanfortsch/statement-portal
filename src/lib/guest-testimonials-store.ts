/**
 * Database and env side of guest testimonials (see guest-testimonials.ts for
 * the rules). Service-role reads and writes only: `guest_testimonials` is
 * RLS-locked with no policies, and every caller here is a server route, a
 * server action or a server component.
 */
import { randomBytes } from 'node:crypto';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { SCA_PUBLIC_ORIGIN } from '@/lib/sca-quotes';
import {
  type PublicTestimonial,
  type TestimonialInvite,
  type TestimonialStatus,
  type TestimonialSubmission,
  type TestimonialView,
  toPublicTestimonial,
} from '@/lib/guest-testimonials';

/** The Google Business Profile review link the form's thank-you page offers.
 *  Unset until Dotti creates the profile; the page then offers nothing. */
export const GOOGLE_REVIEW_URL = (process.env.GOOGLE_REVIEW_URL || '').trim();

/**
 * What a failed read or write actually said. supabase-js rejects with a plain
 * PostgrestError object, not an Error, so `String(err)` logs "[object Object]"
 * and the first production 503 had to be diagnosed blind (2026-10-31). The
 * code names the cause: 42P01 no such table, 42501 no grant, PGRST205 a
 * stale schema cache after a hand-applied migration.
 */
export function dbErrorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
    const parts = [e.code, e.message, e.details, e.hint].filter((v) => typeof v === 'string' && v.trim()) as string[];
    if (parts.length) return parts.join(' · ');
    try {
      return JSON.stringify(err);
    } catch {
      return '[unprintable error]';
    }
  }
  return String(err);
}

/** The error's code alone, for a bridge answer the caller can act on. */
export function dbErrorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

export type TestimonialRow = {
  id: string;
  token: string;
  reservation_id: string;
  property_id: string;
  guest_first: string;
  guest_name: string;
  show_name: boolean;
  check_in: string | null;
  check_out: string | null;
  channel: string;
  status: TestimonialStatus;
  rating: number | null;
  body: string;
  invited_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
};

const COLUMNS =
  'id, token, reservation_id, property_id, guest_first, guest_name, show_name, check_in, check_out, channel, status, rating, body, invited_at, submitted_at, decided_at, decided_by';

export function testimonialFormUrl(token: string): string {
  return `${SCA_PUBLIC_ORIGIN}/review/${token}`;
}

export async function propertyExists(propertyId: string): Promise<boolean> {
  const { data, error } = await supabase.from('properties').select('id').eq('id', propertyId).maybeSingle();
  if (error) throw error;
  return !!data;
}

/**
 * One row per stay. A second mint for the same reservation returns the row
 * that exists, whatever its status, so a sweep that re-evaluates a stay
 * never hands the guest a second link.
 */
export async function inviteTestimonial(invite: TestimonialInvite): Promise<TestimonialRow> {
  const existing = await supabase
    .from('guest_testimonials')
    .select(COLUMNS)
    .eq('reservation_id', invite.reservation_id)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as TestimonialRow;
  const { data, error } = await supabase
    .from('guest_testimonials')
    .insert({
      token: randomBytes(16).toString('hex'),
      reservation_id: invite.reservation_id,
      property_id: invite.property_id,
      guest_first: invite.guest_first,
      check_in: invite.check_in,
      check_out: invite.check_out,
      channel: invite.channel,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    // Two sweeps minting the same stay at once: the unique index refuses the
    // second insert, and the first row is the answer.
    if (error.code === '23505') {
      const again = await supabase
        .from('guest_testimonials')
        .select(COLUMNS)
        .eq('reservation_id', invite.reservation_id)
        .single();
      if (again.error) throw again.error;
      return again.data as TestimonialRow;
    }
    throw error;
  }
  return data as TestimonialRow;
}

export async function testimonialByToken(token: string): Promise<TestimonialRow | null> {
  const { data, error } = await supabase.from('guest_testimonials').select(COLUMNS).eq('token', token).maybeSingle();
  if (error) throw error;
  return (data as TestimonialRow | null) ?? null;
}

export async function propertyTitle(propertyId: string): Promise<string> {
  const { data, error } = await supabase.from('properties').select('title, name').eq('id', propertyId).maybeSingle();
  if (error) throw error;
  return (data?.title as string | null) || (data?.name as string | null) || '';
}

export function toView(row: TestimonialRow, title: string): TestimonialView {
  return {
    token: row.token,
    status: row.status,
    guest_first: row.guest_first,
    property_id: row.property_id,
    property_title: title,
    check_in: row.check_in,
    check_out: row.check_out,
    rating: row.rating,
    body: row.body,
    guest_name: row.guest_name,
    show_name: row.show_name,
    submitted_at: row.submitted_at,
  };
}

/**
 * The guest's submission. Only an invited row takes one: a submitted,
 * approved or hidden testimonial is final from the guest's side, so a reload
 * of the form after submitting reads as the thank-you page, never a second
 * form that would overwrite what the operator may already have approved.
 */
export async function submitTestimonial(
  token: string,
  sub: TestimonialSubmission,
): Promise<'ok' | 'not_found' | 'already_submitted'> {
  const row = await testimonialByToken(token);
  if (!row) return 'not_found';
  if (row.status !== 'invited') return 'already_submitted';
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('guest_testimonials')
    .update({
      rating: sub.rating,
      body: sub.body,
      guest_name: sub.guest_name,
      show_name: sub.show_name,
      status: 'submitted',
      submitted_at: now,
      updated_at: now,
    })
    .eq('token', token)
    .eq('status', 'invited')
    .select('id');
  if (error) throw error;
  return (data ?? []).length === 1 ? 'ok' : 'already_submitted';
}

/** A Guesty listing id to the Helm property it belongs to, or null. */
export async function propertyForGuestyListing(listingId: string): Promise<string | null> {
  const map = await supabase.from('guesty_listings').select('property_id').eq('listing_id', listingId).maybeSingle();
  if (map.error) throw map.error;
  if (map.data?.property_id) return map.data.property_id as string;
  const prop = await supabase
    .from('properties')
    .select('id')
    .or(`guesty_listing_id.eq.${listingId},former_guesty_listing_id.eq.${listingId}`)
    .limit(1)
    .maybeSingle();
  if (prop.error) throw prop.error;
  return (prop.data?.id as string | undefined) ?? null;
}

/** Approved testimonials for a home, newest stay first, as the site renders them. */
export async function approvedTestimonials(propertyId: string): Promise<PublicTestimonial[]> {
  const { data, error } = await supabase
    .from('guest_testimonials')
    .select(COLUMNS)
    .eq('property_id', propertyId)
    .eq('status', 'approved')
    .order('check_out', { ascending: false, nullsFirst: false })
    .order('submitted_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return ((data ?? []) as TestimonialRow[]).map(toPublicTestimonial);
}

/** For the Reviews tab: every testimonial a person may still act on, plus
 *  the approved and hidden ones, newest first. */
export async function listTestimonials(): Promise<TestimonialRow[]> {
  const { data, error } = await supabase
    .from('guest_testimonials')
    .select(COLUMNS)
    .in('status', ['submitted', 'approved', 'hidden'])
    .order('submitted_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as TestimonialRow[];
}

/** For Recent stays: the testimonial each listed stay has, if any. */
export async function testimonialsForReservations(
  reservationIds: string[],
): Promise<Map<string, { status: TestimonialStatus; rating: number | null }>> {
  const out = new Map<string, { status: TestimonialStatus; rating: number | null }>();
  for (let i = 0; i < reservationIds.length; i += 100) {
    const chunk = reservationIds.slice(i, i + 100);
    const { data, error } = await supabase
      .from('guest_testimonials')
      .select('reservation_id, status, rating')
      .in('reservation_id', chunk);
    if (error) throw error;
    for (const r of (data ?? []) as Array<{ reservation_id: string; status: TestimonialStatus; rating: number | null }>) {
      out.set(r.reservation_id, { status: r.status, rating: r.rating });
    }
  }
  return out;
}

/** The operator's decision: show it on the site, or keep it off. */
export async function decideTestimonial(id: string, status: 'approved' | 'hidden', by: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('guest_testimonials')
    .update({ status, decided_at: now, decided_by: by, updated_at: now })
    .eq('id', id)
    .in('status', ['submitted', 'approved', 'hidden']);
  if (error) throw error;
}
