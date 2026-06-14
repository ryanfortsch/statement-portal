import { NextResponse } from 'next/server';
import { supabase, isConfigured } from '@/lib/supabase';

/**
 * Outbound owner Quo touches feed for stay-concierge.
 *
 * Helm's CRM already persists every outbound Quo SMS to `contact_touches`
 * (see /api/sync-quo + /api/webhooks/quo). When Allie texts an owner
 * directly via Quo — outside Helm's owner-messaging approval flow —
 * those messages land here with direction='outbound', channel='sms', and
 * a contact_id pointing at a row whose type='owner'.
 *
 * stay-concierge polls this endpoint every 5 minutes, dedupes by
 * quo_message_id, and writes the rows into owner_messages_log as
 * `sent_direct` so the per-contact history view on /owner-messaging
 * shows both sides of the conversation, not just owner-inbound.
 *
 * Auth: same STAY_CONCIERGE_KEY pattern as /api/owners-sync.
 *
 *   GET /api/owner-outbound-quo?since=2026-06-01T00:00:00Z&key=K
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type TouchRow = {
  quo_message_id: string | null;
  touched_at: string;
  summary: string | null;
  notes: string | null;
  by_email: string | null;
  contacts: {
    id: string;
    name: string | null;
    phone: string | null;
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

  // Default to 14 days back if no `since` provided. Cold-start sync from
  // stay-concierge will use this; subsequent polls pass the last seen
  // `touched_at` from owner_messages_log so the window stays minimal.
  const sinceParam = url.searchParams.get('since');
  const since = sinceParam || new Date(Date.now() - 14 * 86400_000).toISOString();

  const { data, error } = await supabase
    .from('contact_touches')
    .select(
      'quo_message_id, touched_at, summary, notes, by_email, contacts!inner(id, name, phone, linked_property_ids, type)',
    )
    .eq('channel', 'sms')
    .eq('direction', 'outbound')
    .eq('contacts.type', 'owner')
    .not('quo_message_id', 'is', null)
    .gte('touched_at', since)
    .order('touched_at', { ascending: false })
    .limit(500);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as TouchRow[];
  const touches = rows
    .map((r) => {
      const c = r.contacts;
      if (!c || !c.phone) return null;
      const propertyId = (c.linked_property_ids ?? [])[0] ?? '';
      return {
        quo_message_id: r.quo_message_id ?? '',
        touched_at: r.touched_at,
        owner_contact: c.phone,
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
