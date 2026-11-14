import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { hasMessageCronCredential } from '@/lib/channex-messaging/runtime-config';
import { executeProductionBookingTick } from '@/lib/channex-bookings/runtime.server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  if (!hasMessageCronCredential(request, process.env.CRON_SECRET))
    return NextResponse.json({ state: 'unauthorized' }, { status: 401, headers });
  // Shared guard remains in place, but a session alone cannot reach it.
  const denied = await authorizeCron(request);
  if (denied) return denied;
  if (new URL(request.url).search || request.body !== null)
    return NextResponse.json({ state: 'invalid_request' }, { status: 400, headers });
  try {
    const result = await executeProductionBookingTick();
    return NextResponse.json(result, { status: result.ok ? 200 : 503, headers });
  } catch {
    return NextResponse.json({ state: 'incomplete', ok: false, partialEffectsPossible: true }, { status: 503, headers });
  }
}

// Probes must never invoke the GET worker through Next's synthesized HEAD.
export async function HEAD() { return new Response(null, { status: 405, headers }); }
