import { createClient } from '@supabase/supabase-js';
import { normalizePhone, quoLineOfInbound, type QuoLine } from '@/lib/quo';
import { matchPropertyFromCleanerText, PROPERTIES, type CleanerTextRosterEntry } from '@/lib/properties';
import { mirrorQuoFinish } from '@/lib/cleaning-sessions';
import { ingestVendorAppointments, isVendorReminderSender } from '@/lib/vendor-schedule';

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
  /** Which of our numbers the text arrived on. Names the line. */
  phoneNumberId?: string | null;
  body?: string | null;
  text?: string | null; // tolerate REST-shaped payloads too
  direction?: 'incoming' | 'outgoing';
  createdAt: string;
};

type WebhookCall = {
  id: string;
  from?: string | null;
  to?: string | string[] | null;
  phoneNumberId?: string | null;
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

  // 0. The cleaning vendor's dispatch. Jobber texts A-1's appointment
  // reminders from a relay number that is neither a cleaner nor a
  // contact, so they fell through to the unknown-number queue and waited
  // for the afternoon cleaner-schedule sweep to be parsed. Parse on
  // arrival instead: the event is already in quo_events (the webhook
  // persists before it dispatches), so a short re-scan through the one
  // shared parser lands it in vendor_appointments within seconds, and the
  // day-after-tomorrow column is right at 09:31 instead of 16:00.
  if (isVendorReminderSender(fromPhone)) {
    const r = await ingestVendorAppointments(supabase, { days: 4 });
    if (r.errors.length > 0) throw new Error(`vendor reminder: ${r.errors.join('; ')}`);
    return;
  }

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
        // Mirror the authoritative "done" into cleaning_sessions (re-derives
        // the checkout off bookings so it lands on the same row as the lock).
        await mirrorQuoFinish(supabase, { propertyId, completedAt: msg.createdAt });
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
  // the triage queue so prospect/owner/vendor texts aren't dropped. The
  // line it arrived on rides along: a number texting the GUESTS line is a
  // guest, the 24/7 line is a vendor or crew, OWNERS is an owner or a
  // prospect. That is the whole point of having three numbers.
  await captureUnknownInbound(fromPhone, msg.createdAt, body || null, quoLineOfInbound(msg));
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
      if (!cleaner) await captureUnknownInbound(otherParty, at, 'Inbound call', quoLineOfInbound(call));
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

/**
 * The roster cleaner texts are matched against: every active property in
 * the live table, so a home promoted in Helm attributes "4 middle all set"
 * the day it exists. Falls back to the code-side PROPERTIES map when the
 * read fails or comes back empty (a read that returned nothing is not an
 * empty fleet).
 */
async function loadCleanerTextRoster(): Promise<ReadonlyArray<CleanerTextRosterEntry>> {
  const fallback = Object.values(PROPERTIES);
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('id, name, listing_match')
      .eq('is_active', true)
      .limit(500);
    if (error || !data || data.length === 0) return fallback;
    return (data as Array<{ id: string; name: string | null; listing_match: string | null }>).map((r) => ({
      id: r.id,
      name: r.name ?? '',
      listing_match: (r.listing_match ?? '').toLowerCase(),
    }));
  } catch {
    return fallback;
  }
}

async function attributeCleaningProperty(
  body: string,
  cleanerWhitelist: string[],
): Promise<string | null> {
  const roster = await loadCleanerTextRoster();
  const fromBody = matchPropertyFromCleanerText(body, roster)?.id ?? null;
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
// whatever is most recent today. Reads bookings (the Helm-native turnover
// source operations.ts uses post Guesty wind-down), with the same
// confirmed/completed + non-duplicate filters, so a cleaner text keys to the
// exact checkout the turnover row joins on. (Was guesty_reservations, which is
// wound down and could miss a checkout that only lives in bookings.)
export async function mostRecentCheckout(propertyId: string, asOf?: string): Promise<string> {
  const cutoff = (asOf ? new Date(asOf) : new Date()).toISOString().slice(0, 10);
  const { data } = await supabase
    .from('bookings')
    .select('check_out')
    .eq('property_id', propertyId)
    .in('status', ['confirmed', 'completed'])
    .is('duplicate_of', null)
    .lte('check_out', cutoff)
    .order('check_out', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.check_out as string | undefined) ?? cutoff;
}

/**
 * Stamp owner last-contacted, forward only.
 *
 * This was a blind update, which reads as harmless on a live feed and is
 * not: Quo can deliver out of order, `backfillTouchesForPhone` replays
 * captured events after an unknown number is promoted, and /api/sync-quo
 * walks history every six hours. Any of those could set the stamp to an
 * OLDER message than the one already recorded, and the column is what the
 * property page and the owner-messaging queue read to decide whether an
 * owner has been heard from lately.
 *
 * The `or` filter rides on the UPDATE's where clause, so the write simply
 * matches no rows when the stored value is newer. Monotonic by construction
 * rather than by the caller remembering to check. `is.null` covers a
 * property nobody has contacted yet.
 *
 * Exported because the backfill sweep needs it too, and needed this guard
 * before it could have it.
 */
export async function stampOwnerContact(
  propertyIds: string[],
  at: string,
  via: 'sms' | 'phone' | 'email',
): Promise<void> {
  if (propertyIds.length === 0) return;
  await supabase
    .from('properties')
    .update({ owner_last_contacted_at: at, owner_last_contacted_via: via })
    .in('id', propertyIds)
    .or(`owner_last_contacted_at.is.null,owner_last_contacted_at.lt.${at}`);
}

// Upsert one row per unknown phone (last-write-wins on the latest message).
// status/contact_id/first_seen_at are intentionally omitted so a dismissed
// or promoted number keeps its state and its original first-seen time. Fails
// safe (no throw) if the table doesn't exist yet (migration not applied).
/**
 * Record an inbound message from a number we do not know, forward only.
 *
 * This was a plain upsert, so the newest values always won by recency of
 * WRITE rather than of MESSAGE. The file already guarded `quo_line` against
 * that ("a replay of an old event never blanks a line a later message
 * already set") and left the timestamp and body unguarded, which is the
 * half that shows: the /crm triage card renders `last_body` as what this
 * number said, and an event replay or the six-hourly history sweep could
 * replace it with something older.
 *
 * Two writes, both idempotent. The insert creates the row when the number
 * is new and does nothing when it is not; the update carries an `lt` filter
 * on the UPDATE's where clause, so a stale message matches no rows. Same
 * guard shape as stampOwnerContact, and in the writer for the same reason.
 *
 * Exported so the /api/sync-quo backfill can capture unknown numbers too.
 */
export async function captureUnknownInbound(
  phone: string,
  at: string,
  body: string | null,
  line: QuoLine | null = null,
): Promise<void> {
  if (!phone) return;
  const tolerated = ['23505', '42P01', '42703'];

  // 1. Create the row if this number is new. status / contact_id /
  //    first_seen_at stay unset so a dismissed or promoted number keeps its
  //    state and its original first-seen time.
  await supabase
    .from('quo_unknown_numbers')
    .upsert({ phone, last_seen_at: at }, { onConflict: 'phone', ignoreDuplicates: true })
    .then((r) => {
      if (r.error && !tolerated.includes(r.error.code)) throw r.error;
    });

  // 2. Move it forward, never back.
  const patch: Record<string, unknown> = {
    last_message_at: at,
    last_body: body,
    last_direction: 'inbound',
    last_seen_at: at,
  };
  if (line) patch.quo_line = line;
  await supabase
    .from('quo_unknown_numbers')
    .update(patch)
    .eq('phone', phone)
    .or(`last_message_at.is.null,last_message_at.lt.${at}`)
    .then((r) => {
      if (r.error && !tolerated.includes(r.error.code)) throw r.error;
    });
}

const COMPLETION_RE = /\b(done|all set|all good|ready|finished|complete|cleaned|clean|good to go|set)\b/i;
const ISSUE_RE = /\b(broke|broken|leak|leaking|not working|doesn'?t work|isn'?t working|won'?t|stuck|missing|ran out|run out|out of|low on|repair|repairs|damage|damaged|found|lost|clog|clogged|stain|mold|smell|smells|replace|cracked|jammed)\b/i;

function looksLikeCompletion(body: string): boolean {
  return COMPLETION_RE.test(body);
}

export function looksLikeIssue(body: string): boolean {
  return ISSUE_RE.test(body);
}

// Auto-open a maintenance slip from a cleaner's issue text. Idempotent on
// from_quo_message_id so replays never duplicate. Fails safe if the column
// isn't migrated yet.
/**
 * A cleaner reporting a problem becomes a work slip.
 *
 * Exported so the /api/sync-quo backfill can do it too. Idempotent on
 * `from_quo_message_id`, which carries a unique index in production, so a
 * message the webhook already handled is swallowed as a 23505 replay rather
 * than filed twice.
 */
export async function createCleanerIssueSlip(
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
