import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { normalizePhone, quoLineFor, quoLineOfInbound, type QuoLine } from '@/lib/quo';
import { matchPropertyFromCleanerText, PROPERTIES, type CleanerTextRosterEntry } from '@/lib/properties';
import { mirrorQuoFinish } from '@/lib/cleaning-sessions';
import { ingestVendorAppointments, isVendorReminderSender } from '@/lib/vendor-schedule';
import { recordInboundSms, recordOutboundSms } from '@/lib/helm-inbox';
import { cachedNumberIndex, fillContactPhone } from '@/lib/known-numbers-server';
import { selectAllPaged } from '@/lib/paged-select';
import { proposeVendorVisit } from '@/lib/vendor-visits';
import { unfiledTextError, worthFiling } from '@/lib/cleaner-unplaced';

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

// Service role only (contacts, contact_touches, bookings, guest_threads and
// guest_messages are all RLS-locked). The old anon-key fallback made a
// missing service key look like an empty database.

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

  // The database narrows to events naming these ten digits (`to` is a
  // string or an array; its text form holds the digits either way) and
  // the loop below checks each party exactly. This was a bare select of
  // every event, which PostgREST stops at 1000 rows: with 5,462 on file
  // (2026-10-19) a promoted number replayed nothing after 2026-08-13.
  const rows = await selectAllPaged<{ payload: QuoEventEnvelope }>((from, to) =>
    supabase
      .from('quo_events')
      .select('payload')
      .eq('signature_valid', true)
      .or(`payload->data->object->>from.ilike.*${target}*,payload->data->object->>to.ilike.*${target}*`)
      .order('received_at', { ascending: true })
      .order('id')
      .range(from, to),
  );

  let dispatched = 0;
  for (const row of rows) {
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

  // 1b. The Helm inbox. A text on the GUESTS line is a guest; file it on
  // the (sms, E.164) thread for the stay it belongs to (in-house first)
  // when the number matches a booking, an existing thread or a guest
  // record. This runs BEFORE the cleaner / contact / unknown paths and
  // never short-circuits them: the unknown-number capture below still
  // happens so /crm triage keeps working, and a failure here (table not
  // migrated, transient read error) must never cost the webhook the rest
  // of its work.
  if (quoLineOfInbound(msg) === 'guests') {
    try {
      await recordInboundSms({
        phone: fromPhone,
        body,
        at: msg.createdAt,
        quoMessageId: msg.id,
        raw: { phoneNumberId: msg.phoneNumberId ?? null, to: msg.to ?? null },
        helmRunOnly: true,
      });
    } catch (err) {
      console.warn('[quo-ingest] helm inbox inbound skipped', err instanceof Error ? err.message : err);
    }
  }

  // 1c. A trade vendor naming a visit day ("Tuesday 10/27 at 1 works"), on
  // any line. Files a PROPOSAL for the Team inbox and nothing else: the
  // calendar hold and the slips wait for the operator's approve
  // (docs/vendor-visit-holds.md). Fail-soft and never short-circuits, like
  // the inbox hook above, so the contact touch and the unknown-number
  // capture below behave exactly as before.
  try {
    await proposeVendorVisit(supabase, {
      messageId: msg.id,
      from: fromPhone,
      body,
      at: msg.createdAt,
      line: quoLineOfInbound(msg),
    });
  } catch (err) {
    console.warn('[quo-ingest] vendor visit skipped', err instanceof Error ? err.message : err);
  }

  // 1. Cleaner path: a completion ping and/or a maintenance issue.
  const cleanerHit = await matchCleanerPhone(fromPhone);
  if (cleanerHit) {
    const propertyId = await attributeCleaningProperty(body, cleanerHit.property_ids);
    if (propertyId) {
      await recordCleanerText({ propertyId, messageId: msg.id, at: msg.createdAt, phone: fromPhone, body });
      return;
    }

    // No house. A real completion or issue goes to the home feed's
    // "Cleanings to check" for a person to place (cleaner_unplaced_texts);
    // plain chatter ("OK I will") is a no-op. This used to throw into
    // quo_events.process_error, which no page reads, and the turnover never
    // got its completion.
    await fileUnplacedCleanerText({ messageId: msg.id, from: fromPhone, at: msg.createdAt, body, cleaner: cleanerHit });
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
  const body = messageBody(msg);

  // A reply typed in the Quo app on the GUESTS line belongs on the guest's
  // Helm thread as a human host message. A send Helm made itself already
  // recorded the Quo message id (sendHelmThreadMessage), and recordOutboundSms
  // skips those, so the webhook echo never doubles it. Fail-soft, same as
  // the inbound hook: this must never cost the contact touch below.
  if (quoLineOutbound(msg) === 'guests') {
    try {
      await recordOutboundSms({
        phone: toPhone,
        body,
        at: msg.createdAt,
        quoMessageId: msg.id,
        senderKind: 'host_human',
        source: 'quo_app',
        deliveryStatus: 'delivered',
        raw: { phoneNumberId: msg.phoneNumberId ?? null, from: msg.from ?? null },
        helmRunOnly: true,
      });
    } catch (err) {
      console.warn('[quo-ingest] helm inbox outbound skipped', err instanceof Error ? err.message : err);
    }
  }

  const contact = await findContactByPhone(toPhone);
  if (!contact) return;

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

/** Which of our lines an OUTBOUND message left from. phoneNumberId first,
 *  then the `from` number (ours, on an outgoing message). */
function quoLineOutbound(msg: WebhookMessage): QuoLine | null {
  return quoLineFor(msg.phoneNumberId) ?? quoLineFor(msg.from);
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

/**
 * Who a number is: the contact carrying it, else the owner household Helm
 * can name it into (the owners registry, or a Quo address-book name, by
 * the strict rule in known-numbers.ts). Until 2026-10-19 the first half
 * was the whole lookup, so an owner whose contact held only an email
 * texted in as a new number.
 */
async function findContactByPhone(phone: string): Promise<ContactRow | null> {
  const target = normalizePhone(phone);
  if (!target) return null;

  const rows = await selectAllPaged<ContactRow>((from, to) =>
    supabase
      .from('contacts')
      .select('id, type, phone, linked_property_ids')
      .not('phone', 'is', null)
      .order('id')
      .range(from, to),
  );
  for (const row of rows) {
    if (normalizePhone(row.phone) === target) return row;
  }
  return householdForPhone(phone);
}

/**
 * A household with no phone yet takes this one (fill-empty only), so its
 * next text is found directly. A household that already has a number
 * keeps it, and this one's texts are still filed onto it. Fails soft to
 * null: the number then goes to the queue, as it did before.
 */
async function householdForPhone(phone: string): Promise<ContactRow | null> {
  let known;
  try {
    known = (await cachedNumberIndex()).resolve(phone);
  } catch {
    return null;
  }
  if (!known?.contact || known.source === 'contact') return null;

  const { data } = await supabase
    .from('contacts')
    .select('id, type, phone, linked_property_ids')
    .eq('id', known.contact.id)
    .maybeSingle();
  const contact = data as ContactRow | null;
  if (!contact) return null;
  if (!contact.phone) {
    try {
      await fillContactPhone(contact.id, phone);
    } catch (err) {
      console.warn('[quo-ingest] household phone not filled', err instanceof Error ? err.message : err);
    }
  }
  return contact;
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
// Exported so /api/sync-quo keys its backfilled completions the same way
// instead of carrying its own guesty_reservations copy.
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
  // Someone Helm keeps outside the CRM (the Field roster, a trade vendor)
  // is not a new number, however often they text the 24/7 line. A
  // resolver that cannot load captures, as before.
  try {
    if ((await cachedNumberIndex()).resolve(phone)?.settled) return;
  } catch {
    // capture
  }
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

/**
 * What a cleaner's text writes once it is on a house.
 *
 * "the dishwasher at 53 is broken" / "found a phone" opens a work slip. Any
 * text that isn't purely an issue marks the turnover done (the original
 * completion behavior), so "done, but the faucet leaks" logs both. The
 * completion is the cleaning_completions row plus the cleaning_sessions
 * finish, which mirrorQuoFinish moves forward only and never over an
 * operator's own confirm (estimate < quo < manual).
 *
 * Exported because an operator's Attach on a text Helm could not place
 * (cleaner-unplaced-server.ts) must write exactly this, never a second copy.
 * The finish is still the cleaner's: `at` is when the text was sent, and the
 * source stays 'quo'. Attach says which house, not when. Every write is
 * idempotent on the Quo message id, so a replay or a retry is a no-op.
 */
export async function recordCleanerText(args: {
  propertyId: string;
  messageId: string;
  /** When the cleaner sent it. The completion time, never "now". */
  at: string;
  phone: string;
  body: string;
}): Promise<void> {
  const { propertyId, messageId, at, phone, body } = args;
  const issue = looksLikeIssue(body);
  const completion = looksLikeCompletion(body);

  if (issue) {
    await createCleanerIssueSlip(propertyId, body, phone, messageId);
  }
  if (completion || !issue) {
    const checkoutDate = await mostRecentCheckout(propertyId, at);
    await supabase
      .from('cleaning_completions')
      .insert({
        property_id: propertyId,
        checkout_date: checkoutDate,
        completed_at: at,
        source: 'quo',
        source_message_id: messageId,
        source_phone: phone,
        raw_body: body,
      })
      .then((r) => {
        if (r.error && r.error.code !== '23505') throw r.error;
      });
    // Mirror the authoritative "done" into cleaning_sessions (re-derives
    // the checkout off bookings so it lands on the same row as the lock).
    await mirrorQuoFinish(supabase, { propertyId, completedAt: at });
  }
}

/**
 * File a known cleaner's text that matched no house, for the home feed to
 * ask about, when it is a completion or a reported problem; chatter ("OK I
 * will") is not filed. One row per Quo message: a replay, the six-hourly
 * sweep seeing it again, or the ingest running after someone attached it,
 * changes nothing.
 *
 * Exported because /api/sync-quo files into the same queue: the sweep is
 * the net for a missed webhook delivery, and an unplaced text it caught was
 * otherwise dropped a second time. Returns true when this call filed a new
 * row.
 *
 * When even this write fails it throws, so the webhook event's
 * process_error (or the sweep's errors) still holds it, with the message id
 * and no words or phone.
 */
export async function fileUnplacedCleanerText(args: {
  messageId: string;
  from: string;
  /** When the cleaner sent it: the completion time an Attach records. */
  at: string;
  body: string;
  cleaner: { display_name: string | null; property_ids: string[] | null };
}): Promise<boolean> {
  const { messageId, from, at, body, cleaner } = args;
  if (!worthFiling({ issue: looksLikeIssue(body), completion: looksLikeCompletion(body) })) return false;
  const { data, error } = await supabase
    .from('cleaner_unplaced_texts')
    .upsert(
      {
        quo_message_id: messageId,
        cleaner_phone: from,
        cleaner_name: cleaner.display_name || null,
        cleaner_property_ids: cleaner.property_ids ?? [],
        message_body: body,
        message_at: at,
      },
      { onConflict: 'quo_message_id', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw new Error(unfiledTextError(messageId, error.message));
  return (data ?? []).length > 0;
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
