import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import {
  verifySeamWebhook,
  seamConfigured,
  getDevice,
  normalizeFromDevice,
  normalizeFromEvent,
  ingestDeviceBattery,
  type SeamWebhookEvent,
  type NormalizedDevice,
} from '@/lib/seam';
import { recordCleanerEntry, recordLockFinishEstimate } from '@/lib/cleaning-sessions';

// Service role bypasses RLS so the cross-table writes (lock_events,
// lock_devices, lock_battery_status, work_slips) all work. Same pattern
// as /api/webhooks/quo.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';
const supabase = createClient(supabaseUrl, supabaseKey);

const WEBHOOK_SECRET = process.env.SEAM_WEBHOOK_SECRET || '';

// Battery telemetry events carry the new level. Connection events get a
// fresh read so a lock that comes online with a low battery is caught
// even if the low-battery event was missed.
const BATTERY_EVENTS = new Set(['device.low_battery', 'device.battery_status_changed']);
const REFRESH_EVENTS = new Set(['device.connected', 'device.converted_to_managed']);
// Lock activity → cleaning lifecycle (src/lib/cleaning-sessions).
const LOCK_EVENTS = new Set(['lock.unlocked', 'lock.locked']);

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');

  let parsedBody: SeamWebhookEvent;
  try {
    parsedBody = JSON.parse(rawBody) as SeamWebhookEvent;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const sig = verifySeamWebhook(
    { svixId, svixTimestamp, svixSignature },
    rawBody,
    WEBHOOK_SECRET,
  );

  // Dedupe key: Seam's own event id, falling back to the Svix delivery id
  // and finally a body hash so we never insert a null key.
  const seamEventId =
    parsedBody.event_id ||
    svixId ||
    crypto.createHash('sha256').update(rawBody).digest('hex');

  // Persist regardless of signature validity: an invalid event is
  // evidence of misconfiguration or spoofing and worth a record. Only
  // valid events get dispatched.
  const eventInsert = await supabase
    .from('lock_events')
    .insert({
      seam_event_id: seamEventId,
      event_type: parsedBody.event_type ?? 'unknown',
      device_id: parsedBody.device_id ?? null,
      payload: parsedBody,
      signature_valid: sig.ok,
    })
    .select('id')
    .single();

  // Unique-violation on seam_event_id → already handled. Svix retries on
  // non-2xx; an idempotent 200 stops replay spam.
  if (eventInsert.error) {
    if (eventInsert.error.code === '23505') {
      return NextResponse.json({ ok: true, deduped: true });
    }
    console.error('Seam webhook: failed to persist event', eventInsert.error);
    return NextResponse.json({ error: eventInsert.error.message }, { status: 500 });
  }

  if (!sig.ok) {
    return NextResponse.json({ error: sig.reason }, { status: 401 });
  }

  const eventRowId = eventInsert.data!.id;
  let processError: string | null = null;

  try {
    await dispatch(parsedBody);
  } catch (err) {
    processError = err instanceof Error ? err.message : String(err);
    console.error('Seam webhook: dispatch failed', err);
  }

  await supabase
    .from('lock_events')
    .update({
      processed_at: new Date().toISOString(),
      process_error: processError,
    })
    .eq('id', eventRowId);

  return NextResponse.json({ ok: true, processed: !processError });
}

async function dispatch(ev: SeamWebhookEvent): Promise<void> {
  if (!ev.device_id) return;

  // Lock activity → cleaning lifecycle. lock.unlocked with the cleaner code is
  // a high-confidence "cleaner in"; lock.locked only seeds an estimated finish.
  if (LOCK_EVENTS.has(ev.event_type)) {
    const input = {
      deviceId: ev.device_id,
      occurredAt: ev.occurred_at ?? ev.created_at ?? new Date().toISOString(),
      method: ev.method ?? null,
      accessCodeId: ev.access_code_id ?? null,
    };
    if (ev.event_type === 'lock.unlocked') await recordCleanerEntry(supabase, input);
    else await recordLockFinishEstimate(supabase, input);
    return;
  }

  if (!BATTERY_EVENTS.has(ev.event_type) && !REFRESH_EVENTS.has(ev.event_type)) return;

  const nd = await snapshotDevice(ev);
  if (nd) await ingestDeviceBattery(supabase, nd);
}

// Prefer a fresh device read (authoritative battery + name/manufacturer);
// fall back to the event payload when the API key is absent or the read
// fails, so we still capture whatever the event carried.
async function snapshotDevice(ev: SeamWebhookEvent): Promise<NormalizedDevice | null> {
  if (seamConfigured() && ev.device_id) {
    try {
      const d = await getDevice(ev.device_id);
      if (d) return normalizeFromDevice(d);
    } catch (err) {
      console.error('Seam webhook: device read failed, using event payload', err);
    }
  }
  return normalizeFromEvent(ev);
}
