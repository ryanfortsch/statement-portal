import { NextResponse } from 'next/server';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { messagePreparationDeps } from '@/lib/channex-messaging/preparation.server';
import { captureSourceTiming } from '@/lib/channex-messaging/source-timing-capture';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'private, no-store' };
/** Explicit same-origin owner POST; accepts no customer data, clocks or IDs. */
export async function POST(request: Request) {
  let actor: string;
  try { actor = await requireOwnerEmail(); }
  catch { return NextResponse.json({ error: 'Owners only' }, { status: 403, headers }); }
  if (request.headers.get('origin') !== new URL(request.url).origin
    || request.headers.get('content-type') !== 'application/json')
    return NextResponse.json({ error: 'Invalid request' }, { status: 403, headers });
  // Fixed action marker, with a byte bound before decoding. No form/no-body CSRF.
  try {
    const reader = request.body?.getReader(); if (!reader) throw Error();
    let body = ''; let size = 0;
    try { while (true) { const r = await reader.read(); if (r.done) break;
      if ((size += r.value.byteLength) > 80) throw Error(); body += new TextDecoder().decode(r.value); } }
    finally { await reader.cancel(); }
    const data = JSON.parse(body);
    if (!data || Object.keys(data).length !== 1 || data.action !== 'capture_source_timing') throw Error();
  } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers }); }
  try {
    const result = await captureSourceTiming(process.env, { ...messagePreparationDeps(), commit: async capture => {
      const result = await supabaseAdmin.rpc('helm_channex_capture_source_timing', {
        p_rows: capture.rows, p_started_at: capture.startedAt, p_checked_at: capture.checkedAt, p_actor: actor,
      });
      if (result.error) throw Error('Capture unavailable');
      return result.data;
    } });
    return NextResponse.json(result, { headers });
  } catch {
    // A lost commit response is uncertain. Do not retry or report a definite zero write.
    return NextResponse.json({ ok: false, code: 'SOURCE_TIMING_CAPTURE_UNAVAILABLE',
      captureStatus: 'unconfirmed', jobsCreated: 0, messagesSent: 0 }, { status: 503, headers });
  }
}
