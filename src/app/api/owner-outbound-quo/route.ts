import { NextResponse } from 'next/server';
import { supabase, isConfigured } from '@/lib/supabase';

/**
 * Owner touches feed for stay-concierge — both directions, both channels.
 *
 * Helm already captures every owner conversation Allie has outside the
 * /owner-messaging approval flow:
 *   - Quo SMS (in + out) → /api/sync-quo + /api/webhooks/quo
 *   - Gmail email (in + out) → /api/cron/sync-gmail-replies
 * Both land in `contact_touches` keyed by an `external_message_id`
 * (quo_message_id or gmail_message_id).
 *
 * stay-concierge polls this endpoint every 5 minutes and mirrors the
 * rows into `owner_messages_log`:
 *   - direction='outbound' → action='sent_direct'   → 'sent_outside' bubble
 *   - direction='inbound'  → action='inbound_synced' → 'inbound' bubble
 * Dedupe is by external_message_id. That backfills the entire history
 * feed for owners who've been talking to Allie before Phase 2 shipped.
 *
 * Path kept as `/api/owner-outbound-quo` for backward compatibility
 * with the existing stay-concierge sync; the scope just widened.
 *
 *   GET /api/owner-outbound-quo?since=2026-06-01T00:00:00Z&key=K
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type TouchRow = {
  quo_message_id: string | null;
  gmail_message_id: string | null;
  touched_at: string;
  channel: string;
  direction: 'inbound' | 'outbound';
  summary: string | null;
  notes: string | null;
  by_email: string | null;
  contacts: {
    id: string;
    name: string | null;
    phone: string | null;
    emails: string[] | null;
    linked_property_ids: string[] | null;
    type: string | null;
  } | null;
};

export async function GET(req: Request) {
  const expected = process.env.STAY_CONCIERGE_KEY;
  if (!expected) {
    return NextResponse.json({ error: 'sync disabled (no key configured)' }, { status: 503 });
  }
  const url = new URL(req.url);
  const provided = url.searchParams.get('key') ?? req.headers.get('x-stay-concierge-key');
  if (provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isConfigured) {
    return NextResponse.json({ error: 'helm db not configured' }, { status: 503 });
  }

  const sinceParam = url.searchParams.get('since');
  const since = sinceParam || new Date(Date.now() - 14 * 86400_000).toISOString();

  const { data, error } = await supabase
    .from('contact_touches')
    .select(
      'quo_message_id, gmail_message_id, touched_at, channel, direction, summary, notes, by_email, contacts!inner(id, name, phone, emails, linked_property_ids, type)',
    )
    .in('channel', ['sms', 'email'])
    .eq('contacts.type', 'owner')
    .gte('touched_at', since)
    .order('touched_at', { ascending: false })
    .limit(1000);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as TouchRow[];
  const touches = rows
    .map((r) => {
      const c = r.contacts;
      if (!c) return null;
      const externalId = r.quo_message_id || r.gmail_message_id || '';
      if (!externalId) return null;
      // The "owner contact" key the stay-concierge log uses: phone for
      // SMS, primary email for email. Falls back to whichever is present.
      const ownerContact =
        r.channel === 'email'
          ? (c.emails ?? [])[0] ?? c.phone ?? ''
          : c.phone ?? (c.emails ?? [])[0] ?? '';
      if (!ownerContact) return null;
      const propertyId = (c.linked_property_ids ?? [])[0] ?? '';
      return {
        external_message_id: externalId,
        quo_message_id: r.quo_message_id ?? '',
        gmail_message_id: r.gmail_message_id ?? '',
        channel: r.channel === 'email' ? 'email_gmail' : 'sms_quo',
        direction: r.direction,
        touched_at: r.touched_at,
        owner_contact: ownerContact,
        owner_name: c.name ?? '',
        property_id: propertyId,
        sender_email: r.by_email ?? '',
        text: r.notes ?? r.summary ?? '',
      };
    })
    .filter(Boolean);

  return NextResponse.json({
    touches,
    count: touches.length,
    since,
    generated_at: new Date().toISOString(),
  });
}
