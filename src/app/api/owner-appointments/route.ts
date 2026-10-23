import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { fileOwnerAppointment } from '@/lib/owner-appointments';
import type { OwnerAppointment } from '@/lib/owner-appointments-core';

/**
 * Stay-concierge bridge: an appointment the owner booked at the house.
 *
 * Laila Rocha / 3 Windward (2026-10-22): the city safety inspection on
 * November 6, 9:30 to 12, with a call-ahead window and a reference number.
 * The concierge reads it off the owner's message and files it here when the
 * owner card is approved, handled or answered by hand. It lands as an
 * important appointment on the owner's CRM contact, so the evening-before
 * text (/api/cron/meeting-reminders) and the home feed's Meetings card carry
 * it; the work slip filed beside it takes the same date.
 *
 * Auth: STAY_CONCIERGE_KEY header, allowlisted in src/proxy.ts. Idempotent:
 * one appointment per owner card and day.
 *
 *   POST /api/owner-appointments
 *   { card_id, property_id, date, start_time?, end_time?, what, who?,
 *     instructions?, owner_name?, owner_contact?, channel?, message,
 *     message_at?, slip_request_key? }
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Payload = Partial<Record<
  'card_id' | 'property_id' | 'date' | 'start_time' | 'end_time' | 'what' | 'who' | 'instructions' |
  'owner_name' | 'owner_contact' | 'channel' | 'message' | 'message_at' | 'slip_request_key',
  string | null
>>;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  if (!isServiceConfigured) return NextResponse.json({ ok: false, error: 'database not configured' }, { status: 503 });

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const channel = str(body.channel);
  const appointment: OwnerAppointment = {
    cardId: str(body.card_id),
    propertyId: str(body.property_id),
    date: str(body.date),
    startTime: str(body.start_time) || null,
    endTime: str(body.end_time) || null,
    what: str(body.what),
    who: str(body.who),
    instructions: str(body.instructions),
    ownerName: str(body.owner_name),
    ownerContact: str(body.owner_contact),
    channel: channel === 'sms' || channel === 'email' ? channel : null,
    message: str(body.message),
    messageAt: str(body.message_at) || new Date().toISOString(),
    slipRequestKey: str(body.slip_request_key) || null,
  };

  const res = await fileOwnerAppointment(supabaseAdmin, appointment);
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status });
  if (res.status === 'filed') {
    revalidatePath('/');
    if (res.contact_id) revalidatePath(`/crm/${res.contact_id}`);
  }
  if (res.slip_dated) revalidatePath('/work');
  return NextResponse.json(res);
}
