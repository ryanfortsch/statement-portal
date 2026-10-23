import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { fileOwnerWorkHold } from '@/lib/owner-work-holds';
import type { OwnerWorkReport } from '@/lib/owner-work-holds-core';

/**
 * Stay-concierge bridge: work an owner told us about becomes a hold card.
 *
 * Claudia Kittredge's "Plan to have roof done next week (mon - thurs)" at 21
 * Horton (2026-10-23). The concierge reads the days off the owner's message
 * and files them here when the owner card is approved, handled or answered by
 * hand; the Team inbox shows the hold card, and only its Approve blocks the
 * calendar. This route writes the proposal and nothing else.
 *
 * Auth: STAY_CONCIERGE_KEY header, allowlisted in src/proxy.ts. Idempotent:
 * one card per owner card and start day.
 *
 *   POST /api/owner-work-holds
 *   { card_id, property_id, start, end, start_time?, end_time?, who, what?,
 *     owner_name?, owner_contact?, channel?, message, message_at }
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Payload = Partial<Record<
  'card_id' | 'property_id' | 'start' | 'end' | 'start_time' | 'end_time' | 'who' | 'what' |
  'owner_name' | 'owner_contact' | 'channel' | 'message' | 'message_at',
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
  const report: OwnerWorkReport = {
    cardId: str(body.card_id),
    propertyId: str(body.property_id),
    start: str(body.start),
    end: str(body.end) || str(body.start),
    startTime: str(body.start_time) || null,
    endTime: str(body.end_time) || null,
    who: str(body.who),
    what: str(body.what),
    ownerName: str(body.owner_name),
    ownerContact: str(body.owner_contact),
    channel: channel === 'sms' || channel === 'email' ? channel : null,
    message: str(body.message),
    messageAt: str(body.message_at) || new Date().toISOString(),
  };

  const res = await fileOwnerWorkHold(supabaseAdmin, report);
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status });
  if (res.status === 'filed') revalidatePath('/messaging/team');
  return NextResponse.json(res);
}
