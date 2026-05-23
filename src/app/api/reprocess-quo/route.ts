import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { dispatchQuoEvent, type QuoEventEnvelope } from '@/lib/quo-ingest';

// Replay captured quo_events through the current ingest handlers. The live
// webhook only dispatches once, at receive time — so events captured while
// the handlers were buggy (reading the wrong payload fields) produced
// nothing downstream. This route re-runs them through the fixed handlers.
//
// Idempotent: every downstream insert dedupes on its unique external id
// (source_message_id / quo_message_id / quo_call_id), so running it twice
// is safe. Processed oldest-first so call.summary.completed merges into the
// touch its earlier call.completed created.
//
// Body (all optional):
//   { "types": ["message.received"], "includeInvalid": false }

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';
const supabase = createClient(supabaseUrl, supabaseKey);

type EventRow = {
  id: string;
  event_type: string;
  payload: QuoEventEnvelope;
  signature_valid: boolean;
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const includeInvalid: boolean = body.includeInvalid === true;
  const types: string[] | undefined = Array.isArray(body.types) ? body.types : undefined;

  let query = supabase
    .from('quo_events')
    .select('id, event_type, payload, signature_valid')
    .order('received_at', { ascending: true });

  if (!includeInvalid) query = query.eq('signature_valid', true);
  if (types && types.length) query = query.in('event_type', types);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as EventRow[];
  const summary = {
    total: rows.length,
    dispatched: 0,
    failed: 0,
    by_type: {} as Record<string, number>,
    errors: [] as { id: string; type: string; error: string }[],
  };

  for (const row of rows) {
    summary.by_type[row.event_type] = (summary.by_type[row.event_type] ?? 0) + 1;
    let processError: string | null = null;
    try {
      await dispatchQuoEvent(row.payload);
      summary.dispatched++;
    } catch (err) {
      processError = err instanceof Error ? err.message : String(err);
      summary.failed++;
      summary.errors.push({ id: row.id, type: row.event_type, error: processError });
    }
    await supabase
      .from('quo_events')
      .update({ processed_at: new Date().toISOString(), process_error: processError })
      .eq('id', row.id);
  }

  return NextResponse.json({ ok: true, summary });
}
