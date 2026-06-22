import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import {
  listMessages,
  listCalls,
  listPhoneNumbers,
  normalizePhone,
  type QuoMessage,
  type QuoCall,
  type QuoPhoneNumber,
} from '@/lib/quo';
import { matchPropertyFromCleanerText } from '@/lib/properties';
import { recordSyncFailure, recordSyncResult } from '@/lib/sync-status';

// Backfill route. The webhook is the live path; this is for cold start
// (filling history) and gap-fill if a webhook delivery is missed.
//
// Quo's REST API requires `phoneNumberId` + `participants` on every
// list call, so backfill is necessarily per-thread. We iterate over
// every known contact phone + cleaner phone, pull the last N days for
// each phone-number-of-ours, and pipe results through the same
// in-memory dispatcher the webhook uses.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';
const supabase = createClient(supabaseUrl, supabaseKey);

type ContactRow = {
  id: string;
  type: 'owner' | 'vendor' | 'lead' | 'other';
  phone: string | null;
  linked_property_ids: string[] | null;
};

type CleanerRow = { phone: string; display_name: string; property_ids: string[] };

type SyncSummary = {
  phones_pulled: number;
  messages_seen: number;
  messages_inserted: number;
  cleaning_completions_inserted: number;
  calls_seen: number;
  calls_inserted: number;
  errors: string[];
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const days: number = typeof body.days === 'number' ? body.days : 14;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const summary: SyncSummary = {
      phones_pulled: 0,
      messages_seen: 0,
      messages_inserted: 0,
      cleaning_completions_inserted: 0,
      calls_seen: 0,
      calls_inserted: 0,
      errors: [],
    };

    const ourNumbers = await listPhoneNumbers();
    if (ourNumbers.length === 0) {
      return NextResponse.json({ error: 'no Quo phone numbers found on workspace' }, { status: 400 });
    }

    const targets = await loadTargetPhones();
    summary.phones_pulled = targets.size;

    for (const [participantPhone, target] of targets.entries()) {
      for (const ourNum of ourNumbers) {
        try {
          await pullMessages(ourNum, participantPhone, target, since, summary);
          await pullCalls(ourNum, participantPhone, target, since, summary);
        } catch (err) {
          summary.errors.push(
            `${ourNum.formattedNumber} <-> ${participantPhone}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // Record sync_status here (innermost) so the manual /api/sync-quo button
    // and the cron wrapper at /api/cron/sync-quo both stamp the same source
    // key from the same code path. Any per-phone failure surfaces as a sync
    // failure on the daily brief instead of being buried in summary.errors.
    await recordSyncResult('quo', {
      processed: targets.size,
      failed: summary.errors.length,
      firstError: summary.errors[0],
      result: { since, ...summary },
    });

    return NextResponse.json({ ok: true, since, summary });
  } catch (err) {
    console.error('sync-quo failed', err);
    await recordSyncFailure('quo', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// ── Target phone collection ────────────────────────────────────────

type Target = {
  phone: string;
  contact?: ContactRow;
  cleaner?: CleanerRow;
};

async function loadTargetPhones(): Promise<Map<string, Target>> {
  const targets = new Map<string, Target>();

  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, type, phone, linked_property_ids')
    .not('phone', 'is', null);

  for (const c of (contacts ?? []) as ContactRow[]) {
    if (!c.phone) continue;
    const normalized = normalizePhone(c.phone);
    if (!normalized) continue;
    const e164 = `+1${normalized}`;
    targets.set(e164, { phone: e164, contact: c });
  }

  const { data: cleaners } = await supabase
    .from('cleaner_phones')
    .select('phone, display_name, property_ids')
    .eq('active', true);

  for (const c of (cleaners ?? []) as CleanerRow[]) {
    const normalized = normalizePhone(c.phone);
    if (!normalized) continue;
    const e164 = `+1${normalized}`;
    const existing = targets.get(e164);
    if (existing) {
      existing.cleaner = c;
    } else {
      targets.set(e164, { phone: e164, cleaner: c });
    }
  }

  return targets;
}

// ── Pull + persist ─────────────────────────────────────────────────

async function pullMessages(
  ourNum: QuoPhoneNumber,
  participant: string,
  target: Target,
  since: string,
  summary: SyncSummary,
): Promise<void> {
  const res = await listMessages({
    phoneNumberId: ourNum.id,
    participants: [participant],
    createdAfter: since,
    maxResults: 100,
  });
  for (const msg of res.data) {
    summary.messages_seen++;
    if (msg.direction === 'incoming') {
      const inserted = await ingestInboundMessage(msg, target);
      if (inserted.touch) summary.messages_inserted++;
      if (inserted.cleaning) summary.cleaning_completions_inserted++;
    } else {
      const inserted = await ingestOutboundMessage(msg, target);
      if (inserted) summary.messages_inserted++;
    }
  }
}

async function pullCalls(
  ourNum: QuoPhoneNumber,
  participant: string,
  target: Target,
  since: string,
  summary: SyncSummary,
): Promise<void> {
  const res = await listCalls({
    phoneNumberId: ourNum.id,
    participants: [participant],
    createdAfter: since,
    maxResults: 100,
  });
  for (const call of res.data) {
    summary.calls_seen++;
    const inserted = await ingestCall(call, target);
    if (inserted) summary.calls_inserted++;
  }
}

async function ingestInboundMessage(
  msg: QuoMessage,
  target: Target,
): Promise<{ touch: boolean; cleaning: boolean }> {
  if (target.cleaner) {
    const propertyId = attributeCleaningProperty(msg.text ?? '', target.cleaner.property_ids);
    if (propertyId) {
      const checkoutDate = await mostRecentCheckout(propertyId);
      const r = await supabase
        .from('cleaning_completions')
        .insert({
          property_id: propertyId,
          checkout_date: checkoutDate,
          completed_at: msg.createdAt,
          source: 'quo',
          source_message_id: msg.id,
          source_phone: msg.from,
          raw_body: msg.text,
        });
      if (r.error && r.error.code !== '23505') throw r.error;
      return { touch: false, cleaning: !r.error };
    }
  }
  if (target.contact) {
    const r = await supabase
      .from('contact_touches')
      .insert({
        contact_id: target.contact.id,
        touched_at: msg.createdAt,
        channel: 'sms',
        direction: 'inbound',
        summary: truncate(msg.text ?? '', 140) || '(empty message)',
        notes: msg.text,
        by_email: 'quo@risingtidestr.com',
        quo_message_id: msg.id,
      });
    if (r.error && r.error.code !== '23505') throw r.error;
    return { touch: !r.error, cleaning: false };
  }
  return { touch: false, cleaning: false };
}

async function ingestOutboundMessage(msg: QuoMessage, target: Target): Promise<boolean> {
  if (!target.contact) return false;
  const r = await supabase
    .from('contact_touches')
    .insert({
      contact_id: target.contact.id,
      touched_at: msg.createdAt,
      channel: 'sms',
      direction: 'outbound',
      summary: truncate(msg.text ?? '', 140) || '(empty message)',
      notes: msg.text,
      by_email: 'quo@risingtidestr.com',
      quo_message_id: msg.id,
    });
  if (r.error && r.error.code !== '23505') throw r.error;
  return !r.error;
}

async function ingestCall(call: QuoCall, target: Target): Promise<boolean> {
  if (!target.contact) return false;
  const dur = call.duration ? ` (${Math.round(call.duration / 60)}m)` : '';
  const dir = call.direction === 'incoming' ? 'Inbound call' : 'Outbound call';
  const r = await supabase
    .from('contact_touches')
    .insert({
      contact_id: target.contact.id,
      touched_at: call.completedAt ?? call.createdAt,
      channel: 'phone',
      direction: call.direction === 'incoming' ? 'inbound' : 'outbound',
      summary: `${dir}${dur}`,
      notes: null,
      by_email: 'quo@risingtidestr.com',
      quo_call_id: call.id,
    });
  if (r.error && r.error.code !== '23505') throw r.error;
  return !r.error;
}

// ── Helpers shared with webhook (kept inline to avoid coupling the
//    webhook handlers to a sync-only persistence path). ─────────────

function attributeCleaningProperty(body: string, whitelist: string[]): string | null {
  const fromBody = matchPropertyFromCleanerText(body)?.id ?? null;
  if (fromBody) {
    if (whitelist.length === 0 || whitelist.includes(fromBody)) return fromBody;
  }
  if (whitelist.length === 1) return whitelist[0];
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

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
