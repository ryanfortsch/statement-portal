import { NextResponse } from 'next/server';
import { hasMessageCronCredential } from '@/lib/channex-messaging/runtime-config';
import { executeRetainedMessageTick } from '@/lib/channex-messaging/pilot-runtime.server';
import { executeNewStayScheduleTick } from '@/lib/channex-messaging/new-stay-schedule.server';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  if (!hasMessageCronCredential(request, process.env.CRON_SECRET))
    return NextResponse.json({ state: 'unauthorized' }, { status: 401, headers });
  if (new URL(request.url).search || request.body !== null)
    return NextResponse.json({ state: 'invalid_request' }, { status: 400, headers });
  try {
    // Independent lanes: a new-stay preparation failure must not prevent
    // retained-stay dispatch or receipt reconciliation from running.
    const unavailable = () => ({ state: 'unavailable', ok: false, stays: [] });
    const [retained, newStays] = await Promise.all([
      executeRetainedMessageTick().catch(unavailable), executeNewStayScheduleTick().catch(unavailable),
    ]);
    const result = { ...retained, newStays, ok: retained.ok && newStays.ok };
    // Only fixed states/counters leave the DAL; no stay IDs, bodies or provider errors.
    return NextResponse.json(result, { status: result.ok ? 200 : 503, headers });
  } catch {
    return NextResponse.json({ state: 'unavailable', ok: false, stays: [] }, { status: 503, headers });
  }
}

// Next synthesizes HEAD from GET unless it is explicit. A probe must not execute.
export async function HEAD() { return new Response(null, { status: 405, headers }); }
