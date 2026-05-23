import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/quo';
import { dispatchQuoEvent, type QuoEventEnvelope } from '@/lib/quo-ingest';

// Service role bypasses RLS so the raw-event audit insert works even with
// permissive public policies. The downstream cross-table writes happen in
// quo-ingest.ts (shared with /api/reprocess-quo).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';
const supabase = createClient(supabaseUrl, supabaseKey);

const WEBHOOK_SECRET = process.env.QUO_WEBHOOK_SECRET || '';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('openphone-signature');

  let parsedBody: QuoEventEnvelope;
  try {
    parsedBody = JSON.parse(rawBody) as QuoEventEnvelope;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const sig = verifyWebhookSignature(parsedBody, signature, WEBHOOK_SECRET);

  // Persist the event regardless of signature validity. Invalid events
  // are evidence of misconfiguration or attempted spoofing and we want a
  // record. Only valid events get dispatched.
  const eventInsert = await supabase
    .from('quo_events')
    .insert({
      quo_event_id: parsedBody.id,
      event_type: parsedBody.type,
      payload: parsedBody,
      signature_valid: sig.ok,
    })
    .select('id')
    .single();

  // Unique-violation on quo_event_id → already handled. Quo retries on
  // 5xx; idempotent 200 keeps it from spamming us with replays.
  if (eventInsert.error) {
    if (eventInsert.error.code === '23505') {
      return NextResponse.json({ ok: true, deduped: true });
    }
    console.error('Quo webhook: failed to persist event', eventInsert.error);
    return NextResponse.json({ error: eventInsert.error.message }, { status: 500 });
  }

  if (!sig.ok) {
    return NextResponse.json({ error: sig.reason }, { status: 401 });
  }

  const eventRowId = eventInsert.data!.id;
  let processError: string | null = null;

  try {
    await dispatchQuoEvent(parsedBody);
  } catch (err) {
    processError = err instanceof Error ? err.message : String(err);
    console.error('Quo webhook: dispatch failed', err);
  }

  await supabase
    .from('quo_events')
    .update({
      processed_at: new Date().toISOString(),
      process_error: processError,
    })
    .eq('id', eventRowId);

  return NextResponse.json({ ok: true, processed: !processError });
}
