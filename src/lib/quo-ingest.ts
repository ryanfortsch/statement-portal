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

type WebhookCallTranscript = {
  callId?: string;
  id?: string;
  dialogue?: Array<{ identifier?: string | null; content?: string | null }>;
  transcript?: string | null;
};

type WebhookCallRecording = {
  callId?: string;
  id?: string;
  url?: string | null;
  recordingUrl?: string | null;
  media?: Array<{ url?: string | null }>;
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
    case 'call.transcript.completed':
      await handleCallTranscript(ev.data.object as WebhookCallTranscript);
      return;
    case 'call.recording.completed':
      await handleCallRecording(ev.data.object as WebhookCallRecording);
      return;
    default:
      // call.ringing etc.: ignored
      return;
  }
}

/**
 * Replay every captured Quo event involving `phone` through the ingest.
 * Called after promoting an unknown number to a contact: the events now
 * match the new contact, so contact_touches backfill. Idempotent.
 */
export async function backfillTouchesForPhone(phone: string): Promise<{ dispatched: number }> {
  const target = normalizePhone(phone);
  if (!target) return { dispatched: 0 };

  const { data } = await supabase
    .from('quo_events')
    .select('payload')
    .eq('signature_valid', true)
    .order('received_at', { ascending: true });

  let dispatched = 0;
  for (const row of (data ?? []) as { payload: QuoEventEnvelope }[]) {
    const obj = row.payload?.data?.object as { from?: string | null; to?: string | string[] | null } | undefined;
    if (!obj) continue;
    const parties = [obj.from, ...(Array.isArray(obj.to) ? obj.to : [obj.to])].filter(Boolean) as string[];
    if (!parties.some((p) => normalizePhone(p) === target)) continue;
    try {
      await dispatchQuoEvent(row.payload);
      dispatched += 1;
    } catch {
      // skip non-attributable events
    }
  }
  return { dispatched };
}

// ── Handlers ───────────────────────────────────────────────────────

async function handleInboundMessage(msg: WebhookMessage): Promise<void> {
  if (!msg) return;
  const fromPhone = msg.from ?? '';
  const body = messageBody(msg);

  // 1. Cleaner path: a completion ping and/or a maintenance issue.
  const cleanerHit = await matchCleanerPhone(fromPhone);
  if (cleanerHit) {
    const propertyId = await attributeCleaningProperty(body, cleanerHit.property_ids);
    const issue = looksLikeIssue(body);
    const completion = looksLikeCompletion(body);

    if (propertyId) {
      // "the dishwasher at 53 is broken" / "found a phone" -> work slip.
      if (issue) {
        await createCleanerIssueSlip(propertyId, body, fromPhone, msg.id);
      }
      // Any attributable cleaner text that isn't purely an issue marks the
      // turnover done (preserves the original completion behavior). A
      // "done, but the faucet leaks" text logs both.
      if (completion || !issue) {
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
      }
      return;
    }

    // No property attributed. Surface only meaningful messages (a real
    // completion/issue we couldn't place) so an operator can fix it; plain
    // chatter ("OK I will") is a no-op so it stops polluting process_error.
    if (issue || completion) {
      throw new Error(
        `cleaner phone ${fromPhone} matched but property could not be attributed from body: ${body.slice(0, 80)}`,
      );
    }
    return;
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
    return;
  }

  // 3. Unknown-number path. Not a cleaner, not a contact — capture it in
  // the triage queue so prospect/owner/vendor texts aren't dropped.
  await captureUnknownInbound(fromPhone, msg.createdAt, body || null);
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

  const at = call.completedAt ?? call.createdAt;
  const contact = await findContactByPhone(otherParty);
  if (!contact) {
    // An inbound call from an unknown number is "reaching out" — but skip
    // cleaners, who are recognized vendors, not CRM leads to triage.
    if (call.direction === 'incoming') {
      const cleaner = await matchCleanerPhone(otherParty);
      if (!cleaner) await captureUnknownInbound(otherParty, at, 'Inbound call');
    }
    return;
  }

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

// call.transcript.completed lands separately, keyed by callId. Store the
// full transcript on the touch the earlier call.completed created.
async function handleCallTranscript(obj: WebhookCallTranscript): Promise<void> {
  const callId = obj?.callId ?? obj?.id;
  if (!callId) return;
  const text =
    obj.transcript ??
    (obj.dialogue?.length
      ? obj.dialogue
          .map(d => `${d.identifier ? `${d.identifier}: ` : ''}${d.content ?? ''}`.trim())
          .filter(Boolean)
          .join('\n')
      : '');
  if (!text) return;
  await supabase
    .from('contact_touches')
    .update({ quo_transcript: text })
    .eq('quo_call_id', callId);
}

// call.recording.completed lands separately, keyed by callId. Store the
// recording URL on the touch the earlier call.completed created.
async function handleCallRecording(obj: WebhookCallRecording): Promise<void> {
  const callId = obj?.callId ?? obj?.id;
  if (!callId) return;
  const url = obj.recordingUrl ?? obj.url ?? obj.media?.find(m => m.url)?.url ?? '';
  if (!url) return;
  await supabase
    .from('contact_touches')
    .update({ quo_recording_url: url })
    .eq('quo_call_id', callId);
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

// Upsert one row per unknown phone (last-write-wins on the latest message).
// status/contact_id/first_seen_at are intentionally omitted so a dismissed
// or promoted number keeps its state and its original first-seen time. Fails
// safe (no throw) if the table doesn't exist yet (migration not applied).
async function captureUnknownInbound(
  phone: string,
  at: string,
  body: string | null,
): Promise<void> {
  if (!phone) return;
  await supabase
    .from('quo_unknown_numbers')
    .upsert(
      { phone, last_message_at: at, last_body: body, last_direction: 'inbound', last_seen_at: at },
      { onConflict: 'phone' },
    )
    .then((r) => {
      // 42P01 = undefined_table (pre-migration); 23505 = race on unique.
      if (r.error && r.error.code !== '23505' && r.error.code !== '42P01') throw r.error;
    });
}

const COMPLETION_RE = /\b(done|all set|all good|ready|finished|complete|cleaned|clean|good to go|set)\b/i;
const ISSUE_RE = /\b(broke|broken|leak|leaking|not working|doesn'?t work|isn'?t working|won'?t|stuck|missing|ran out|run out|out of|low on|repair|repairs|damage|damaged|found|lost|clog|clogged|stain|mold|smell|smells|replace|cracked|jammed)\b/i;

function looksLikeCompletion(body: string): boolean {
  return COMPLETION_RE.test(body);
}

function looksLikeIssue(body: string): boolean {
  return ISSUE_RE.test(body);
}

// Auto-open a maintenance slip from a cleaner's issue text. Idempotent on
// from_quo_message_id so replays never duplicate. Fails safe if the column
// isn't migrated yet.
async function createCleanerIssueSlip(
  propertyId: string,
  body: string,
  fromPhone: string,
  messageId: string,
): Promise<void> {
  const { data: prop } = await supabase
    .from('properties')
    .select('name')
    .eq('id', propertyId)
    .maybeSingle();
  const propertyName = (prop?.name as string | undefined) ?? propertyId;

  await supabase
    .from('work_slips')
    .insert({
      property_id: propertyId,
      title: `${propertyName}: ${truncate(body, 60)}`,
      description: [
        'Reported by a cleaner via Quo text.',
        '',
        body,
        '',
        `From: ${fromPhone}`,
        'Auto-created from a cleaner SMS. Recategorize, assign, or close as needed.',
      ].join('\n'),
      action_summary: truncate(body, 120),
      category: 'maintenance',
      priority: 'normal',
      status: 'open',
      from_quo_message_id: messageId,
      created_by_email: 'quo@risingtidestr.com',
    })
    .then((r) => {
      // 23505 dup (replay); 42703 column missing (pre-migration); 42P01
      // table missing. All fail safe so the webhook never 500s.
      if (r.error && !['23505', '42703', '42P01'].includes(r.error.code)) throw r.error;
    });
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
