import { NextResponse } from 'next/server';
import { messagePreparationDeps } from '@/lib/channex-messaging/preparation.server';
import { isOwnerSession } from '@/lib/helm-access-server';
import { ChannexRuntimeError } from '@/lib/channex-production-runtime';
import { MessageHandoffError } from '@/lib/channex-bookings/message-identity';
import { MessagePreparationError, reviewMessagePreparation } from '@/lib/channex-messaging/preparation';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'private, no-store' };
/** Explicit owner read. No cron or proxy allowlist entry. */
export async function GET() {
  if (!await isOwnerSession()) return NextResponse.json({ error: 'Owners only' }, { status: 403, headers });
  try {
    const review = await reviewMessagePreparation(process.env, messagePreparationDeps());
    return NextResponse.json(review, { headers });
  } catch (e) {
    const code = e instanceof MessagePreparationError || e instanceof MessageHandoffError || e instanceof ChannexRuntimeError
      ? e.code : 'PREPARATION_READ_FAILED';
    return NextResponse.json({ ok: false, code, readyForAutomaticMessaging: false, jobsCreated: 0, messagesSent: 0 }, { status: 503, headers });
  }
}
