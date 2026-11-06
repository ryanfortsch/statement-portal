import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { isOwnerSession } from '@/lib/helm-access-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { inspectProductionRuntime, ChannexRuntimeError } from '@/lib/channex-production-runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Configuration health only. No feed reads, ACK, calendar, price or message writes. */
export async function GET(request: Request) {
  const denied = await authorizeCron(request);
  if (denied) return denied;
  const cron = process.env.CRON_SECRET;
  if (!(cron && request.headers.get('authorization') === `Bearer ${cron}`) && !await isOwnerSession()) {
    return NextResponse.json({ error: 'Owners only' }, { status: 403 });
  }
  try {
    const result = await inspectProductionRuntime(process.env, async (name, args) => {
      const { data, error } = await supabaseAdmin.rpc(name, args);
      return { data, error };
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof ChannexRuntimeError ? error.code : 'RUNTIME_CHECK_FAILED';
    // Never log exception bodies, provider responses, database details or keys.
    return NextResponse.json({ ok: false, code, readyForCutover: false },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
