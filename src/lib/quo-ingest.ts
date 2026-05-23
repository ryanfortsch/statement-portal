import { createClient } from '@supabase/supabase-js';
import { normalizePhone } from '@/lib/quo';
import { matchPropertyFromCleanerText } from '@/lib/properties';

/**
 * Quo (OpenPhone) WEBHOOK ingest. Shared by the live webhook
 * (/api/webhooks/quo) and the replay route (/api/reprocess-quo).
 *
 * IMPORTANT: webhook payload objects are NOT the same shape as the REST
 * API objects modeled in src/lib/quo.ts. The differences are why this
 * integration silently captured raw events but populated nothing
 * downstream until now:
 *   - message text lives on `body` (REST uses `text`)
 *   - `to` is a single string (REST uses string[])
 *   - a call's AI summary arrives as a SEPARATE `call.summary.completed`
 *     event keyed only by `callId` (no from/to), so it has to be merged
 *     into the touch created by the earlier `call.completed` event.
 * We model the real webhook shape here so attribution actually works.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';
const supabase = createClient(supabaseUrl, supabaseKey);

export type QuoEventEnvelope = {
  id: string;
  type: string;
  apiVersion?: string;
  createdAt?: string;
  data: { object: unknown };
};

type WebhookMessage = {
  id: string;
  from?: string | null;
  to?: string | string[] | null;
  body?: string | null;
  text?: string | null; // tolerate REST-shaped payloads too
  direction?: 'incoming' | 'outgoing';
  createdAt: string;
};

type WebhookCall = {
  id: string;
  from?: string | null;
  to?: string | string[] | null;
  participants?: string[];
  direction?: 'incoming' | 'outgoing';
  duration?: number | null;
  createdAt: string;
  completedAt?: string | null;
};

type WebhookCallSummary = {
  callId: string;
  summary?: string | null;
  nextSteps?: string[] | null;
};

export async function dispatchQuoEvent(ev: QuoEventEnvelope): Promise<void> {
  switch (ev.type) {
    case 'message.received':
      await handleInboundMessage(ev.data.object as WebhookMessage);
      return;
    case 'message.delivered':
      await handleOutboundMessage(ev.data.object as WebhookMessage);
      return;
    case 'call.completed':
      await handleCall(ev.data.object as WebhookCall);
      return;
    case 'call.summary.completed':
      await handleCallSummary(ev.data.object as WebhookCallSummary);
      return;
    default:
      // call.recording.completed, call.transcript.completed, call.ringing: ignored
      return;
  }
}

// ── Handlers ───────────────────────────────────────────────────────

async function handleInboundMessage(msg: WebhookMessage): Promise<void> {
  if (!msg) return;
  const fromPhone = msg.from ?? '';
  const body = messageBody(msg);

  // 1. Cleaner-completion path.
  const cleanerHit = await matchCleanerPhone(fromPhone);
  if (cleanerHit) {
    const propertyId = await attributeCleaningProperty(body, cleanerHit.property_ids);
    if (propertyId) {
      const checkoutDate = await mostRecentCheckout(propertyId, msg.createdAt);
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
        .then((r) => {
          if (r.error && r.error.code !== '23505') throw r.error;
        });
      return;
    }
    // Cleaner phone matched but property couldn't be attributed (generic
    // "all done" with no property name from a multi-property cleaner, or
    // non-completion chatter). Surface it so an operator can fix it.
    throw new Error(
      `cleaner phone ${fromPhone} matched but property could not be attributed from body: ${body.slice(0, 80)}`,
    );
  }

  // 2. Contact-touch path.
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

async function handleOutboundMessage(msg: WebhookMessage): Promise<void> {
  if (!msg) return;
  const toPhone = firstPhone(msg.to);
  if (!toPhone) return;

  const contact = await findContactByPhone(toPhone);
  if (!contact) return;

  const body = messageBody(msg);
  await supabase
    .from('contact_touches')
    .insert({
      contact_id: contact.id,
      touched_at: msg.createdAt,
      channel: 'sms',
      direction: 'outbound',
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

async function handleCall(call: WebhookCall): Promise<void> {
  if (!call) return;
  const otherParty = callOtherParty(call);
  if (!otherParty) return;

  const contact = await findContactByPhone(otherParty);
  if (!contact) return;

  const at = call.completedAt ?? call.createdAt;
  const dur = call.duration ? ` (${Math.round(call.duration / 60)}m)` : '';
  const dir = call.direction === 'incoming' ? 'Inbound call' : 'Outbound call';

  await supabase
    .from('contact_touches')
    .insert({
      contact_id: contact.id,
      touched_at: at,
      channel: 'phone',
      direction: call.direction === 'incoming' ? 'inbound' : 'outbound',
      summary: `${dir}${dur}`,
      notes: null,
      by_email: 'quo@risingtidestr.com',
      quo_call_id: call.id,
    })
    .then((r) => {
      if (r.error && r.error.code !== '23505') throw r.error;
    });

  if (contact.type === 'owner' && contact.linked_property_ids?.length) {
    await stampOwnerContact(contact.linked_property_ids, at, 'phone');
  }
}

// call.summary.completed lands separately, keyed only by callId. Merge the
// AI summary + next steps into the touch created by call.completed.
async function handleCallSummary(obj: WebhookCallSummary): Promise<void> {
  if (!obj?.callId) return;
  const parts: string[] = [];
  if (obj.summary) parts.push(obj.summary);
  if (obj.nextSteps?.length) parts.push(`Next: ${obj.nextSteps.join('; ')}`);
  const note = parts.join(' / ');
  if (!note) return;

  await supabase
    .from('contact_touches')
    .update({ notes: note, summary: truncate(obj.summary || note, 140) })
    .eq('quo_call_id', obj.callId);
}

// ── Matching helpers ───────────────────────────────────────────────

function messageBody(msg: WebhookMessage): string {
  return (msg.body ?? msg.text ?? '') || '';
}

function firstPhone(to: string | string[] | null | undefined): string {
  if (Array.isArray(to)) return to[0] ?? '';
  return to ?? '';
}

function callOtherParty(call: WebhookCall): string {
  const party = call.direction === 'incoming' ? call.from ?? '' : firstPhone(call.to);
  return party || (call.participants?.[0] ?? '');
}

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
  const fromBody = matchPropertyFromCleanerText(body)?.id ?? null;
  if (fromBody) {
    if (cleanerWhitelist.length === 0 || cleanerWhitelist.includes(fromBody)) {
      return fromBody;
    }
  }
  if (cleanerWhitelist.length === 1) return cleanerWhitelist[0];
  return null;
}

// Attribute to the most recent checkout at or before the message time, so
// backfilled completions land on the turnover they actually finished, not
// whatever is most recent today.
async function mostRecentCheckout(propertyId: string, asOf?: string): Promise<string> {
  const cutoff = (asOf ? new Date(asOf) : new Date()).toISOString().slice(0, 10);
  const { data } = await supabase
    .from('guesty_reservations')
    .select('check_out')
    .eq('property_id', propertyId)
    .lte('check_out', cutoff)
    .order('check_out', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.check_out as string | undefined) ?? cutoff;
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

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
