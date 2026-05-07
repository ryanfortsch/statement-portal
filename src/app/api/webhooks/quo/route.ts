import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import {
  verifyWebhookSignature,
  normalizePhone,
  type QuoMessage,
  type QuoCall,
  type QuoWebhookEvent,
  type QuoWebhookEventType,
} from '@/lib/quo';
import { propertyFromListing } from '@/lib/properties';

// Service role bypasses RLS so cross-table inserts (quo_events,
// cleaning_completions, contact_touches, properties stamp updates) all
// work even though our public policies are permissive. Same pattern as
// /api/sync-invoices.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';
const supabase = createClient(supabaseUrl, supabaseKey);

const WEBHOOK_SECRET = process.env.QUO_WEBHOOK_SECRET || '';

type QuoEventEnvelope = {
  id: string;
  type: QuoWebhookEventType;
  apiVersion?: string;
  createdAt?: string;
  data: { object: unknown };
};

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
    await dispatch(parsedBody);
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

// ── Dispatch ───────────────────────────────────────────────────────

async function dispatch(ev: QuoEventEnvelope): Promise<void> {
  switch (ev.type) {
    case 'message.received':
      await handleInboundMessage(ev as QuoWebhookEvent<QuoMessage>);
      return;
    case 'message.delivered':
      await handleOutboundMessage(ev as QuoWebhookEvent<QuoMessage>);
      return;
    case 'call.completed':
    case 'call.summary.completed':
      await handleCall(ev as QuoWebhookEvent<QuoCall>);
      return;
    default:
      // call.recording.completed, call.transcript.completed: ignored for v1
      return;
  }
}

// ── Handlers ───────────────────────────────────────────────────────

async function handleInboundMessage(ev: QuoWebhookEvent<QuoMessage>): Promise<void> {
  const msg = ev.data.object;
  const fromPhone = msg.from;
  const body = msg.text ?? '';

  // 1. Cleaner-completion path. Match the from-phone against
  // cleaner_phones; if hit, attribute to a property + checkout date.
  const cleanerHit = await matchCleanerPhone(fromPhone);
  if (cleanerHit) {
    const propertyId = await attributeCleaningProperty(body, cleanerHit.property_ids);
    if (propertyId) {
      const checkoutDate = await mostRecentCheckout(propertyId);
      await supabase
        .from('cleaning_completions')
        .insert({
          property_id: propertyId,
          checkout_date: checkoutDate,
          completed_at: msg.createdAt,
          source: 'quo',
          source_message_id: msg.id,
          source_phone: fromPhone,
          raw_body: body,
        })
        .select()
        .single()
        // Unique violation on source_message_id is fine; replay safety.
        .then((r) => {
          if (r.error && r.error.code !== '23505') throw r.error;
        });
      // Don't fall through to contact_touches. A cleaner ping isn't a
      // CRM touch unless the cleaner is also tracked as a contact, and
      // we'd rather not double-log.
      return;
    }
    // Cleaner phone matched but property couldn't be attributed (e.g.
    // generic "all done" with no property name and a multi-property
    // cleaner). Surface that so an operator can fix it.
    throw new Error(
      `cleaner phone ${fromPhone} matched but property could not be attributed from body: ${body.slice(0, 80)}`,
    );
  }

  // 2. Contact-touch path. Match against contacts.phone. If found, log
  // an inbound sms touch and stamp owner_last_contacted_at if applicable.
  const contact = await findContactByPhone(fromPhone);
  if (contact) {
    await supabase
      .from('contact_touches')
      .insert({
        contact_id: contact.id,
        touched_at: msg.createdAt,
        channel: 'sms',
        direction: 'inbound',
        summary: truncate(body, 140) || '(empty message)',
        notes: body || null,
        by_email: 'quo@risingtidestr.com',
        quo_message_id: msg.id,
      })
      .then((r) => {
        if (r.error && r.error.code !== '23505') throw r.error;
      });

    if (contact.type === 'owner' && contact.linked_property_ids?.length) {
      await stampOwnerContact(contact.linked_property_ids, msg.createdAt, 'sms');
    }
  }
}

async function handleOutboundMessage(ev: QuoWebhookEvent<QuoMessage>): Promise<void> {
  const msg = ev.data.object;
  // Outbound messages can have multiple recipients. For matching we use
  // the first; the common case is a 1:1 thread.
  const toPhone = msg.to[0] ?? '';
  if (!toPhone) return;

  const contact = await findContactByPhone(toPhone);
  if (!contact) return;

  await supabase
    .from('contact_touches')
    .insert({
      contact_id: contact.id,
      touched_at: msg.createdAt,
      channel: 'sms',
      direction: 'outbound',
      summary: truncate(msg.text ?? '', 140) || '(empty message)',
      notes: msg.text || null,
      by_email: 'quo@risingtidestr.com',
      quo_message_id: msg.id,
    })
    .then((r) => {
      if (r.error && r.error.code !== '23505') throw r.error;
    });

  if (contact.type === 'owner' && contact.linked_property_ids?.length) {
    await stampOwnerContact(contact.linked_property_ids, msg.createdAt, 'sms');
  }
}

async function handleCall(ev: QuoWebhookEvent<QuoCall>): Promise<void> {
  const call = ev.data.object;
  const otherParty = call.participants[0] ?? '';
  if (!otherParty) return;

  const contact = await findContactByPhone(otherParty);
  if (!contact) return;

  const summary = buildCallSummary(call, ev);

  await supabase
    .from('contact_touches')
    .insert({
      contact_id: contact.id,
      touched_at: call.completedAt ?? call.createdAt,
      channel: 'phone',
      direction: call.direction === 'incoming' ? 'inbound' : 'outbound',
      summary,
      notes: extractAiSummary(ev) || null,
      by_email: 'quo@risingtidestr.com',
      quo_call_id: call.id,
    })
    .then((r) => {
      if (r.error && r.error.code !== '23505') throw r.error;
    });

  if (contact.type === 'owner' && contact.linked_property_ids?.length) {
    await stampOwnerContact(
      contact.linked_property_ids,
      call.completedAt ?? call.createdAt,
      'phone',
    );
  }
}

// ── Matching helpers ───────────────────────────────────────────────

type CleanerRow = { phone: string; display_name: string; property_ids: string[] };

async function matchCleanerPhone(phone: string): Promise<CleanerRow | null> {
  const target = normalizePhone(phone);
  if (!target) return null;

  const { data } = await supabase
    .from('cleaner_phones')
    .select('phone, display_name, property_ids')
    .eq('active', true);

  for (const row of (data ?? []) as CleanerRow[]) {
    if (normalizePhone(row.phone) === target) return row;
  }
  return null;
}

type ContactRow = {
  id: string;
  type: 'owner' | 'vendor' | 'lead' | 'other';
  phone: string | null;
  linked_property_ids: string[] | null;
};

async function findContactByPhone(phone: string): Promise<ContactRow | null> {
  const target = normalizePhone(phone);
  if (!target) return null;

  // Phone normalization happens in app code, not in SQL. Fetch all
  // contacts with a phone number (~hundreds at most) and match in
  // memory. Indexing on a normalized column is a future optimization.
  const { data } = await supabase
    .from('contacts')
    .select('id, type, phone, linked_property_ids')
    .not('phone', 'is', null);

  for (const row of (data ?? []) as ContactRow[]) {
    if (normalizePhone(row.phone) === target) return row;
  }
  return null;
}

async function attributeCleaningProperty(
  body: string,
  cleanerWhitelist: string[],
): Promise<string | null> {
  const fromBody = propertyFromListing(body)?.id ?? null;
  if (fromBody) {
    if (cleanerWhitelist.length === 0 || cleanerWhitelist.includes(fromBody)) {
      return fromBody;
    }
  }
  if (cleanerWhitelist.length === 1) return cleanerWhitelist[0];
  return null;
}

async function mostRecentCheckout(propertyId: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('guesty_reservations')
    .select('check_out')
    .eq('property_id', propertyId)
    .lte('check_out', today)
    .order('check_out', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.check_out as string | undefined) ?? today;
}

async function stampOwnerContact(
  propertyIds: string[],
  at: string,
  via: 'sms' | 'phone' | 'email',
): Promise<void> {
  await supabase
    .from('properties')
    .update({ owner_last_contacted_at: at, owner_last_contacted_via: via })
    .in('id', propertyIds);
}

function buildCallSummary(call: QuoCall, ev: QuoWebhookEvent<QuoCall>): string {
  const aiSummary = extractAiSummary(ev);
  if (aiSummary) return truncate(aiSummary, 140);
  const dur = call.duration ? ` (${Math.round(call.duration / 60)}m)` : '';
  const dir = call.direction === 'incoming' ? 'Inbound call' : 'Outbound call';
  return `${dir}${dur}`;
}

function extractAiSummary(ev: QuoWebhookEvent<QuoCall>): string | null {
  if (ev.type !== 'call.summary.completed') return null;
  // call.summary.completed payloads embed the summary on the object;
  // the exact field is documented as `summary` (string) and `nextSteps`
  // (string[]). Fall back gracefully if the shape changes.
  const obj = ev.data.object as QuoCall & {
    summary?: string;
    nextSteps?: string[];
  };
  const parts: string[] = [];
  if (obj.summary) parts.push(obj.summary);
  if (obj.nextSteps?.length) parts.push(`Next: ${obj.nextSteps.join('; ')}`);
  return parts.join(' / ') || null;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
