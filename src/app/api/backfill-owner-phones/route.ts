import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * One-shot backfill: copy phones from properties.owners[] into the
 * matching contacts.phone column, joined by email.
 *
 * Helm has two owner data shapes:
 *   - properties.owners JSONB: { first_name, last_name, email, phone, ... }
 *     populated via the Owners block on the /properties detail page.
 *   - contacts.{name, emails[], phone, type='owner'}: the CRM identity row.
 *
 * They're independent today — adding a phone in the Owners block doesn't
 * land on the CRM contact, so Quo SMS sync (which keys on contacts.phone)
 * doesn't link owner SMS exchanges to the owner contact. This endpoint
 * walks every owner card and updates the matching contact's phone where
 * (a) email matches and (b) phone is currently null/empty.
 *
 * Idempotent — running twice does nothing the second time. Auth via the
 * shared STAY_CONCIERGE_KEY so it can be hit from a one-line curl.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type OwnerCard = {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
};

type PropertyRow = {
  id: string;
  name: string;
  owners: OwnerCard[] | null;
};

type Update = {
  contact_id: string;
  contact_name: string;
  matched_email: string;
  phone: string;
};

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('service role not configured');
  return createClient(url, key);
}

export async function POST(req: Request) {
  const expected = process.env.STAY_CONCIERGE_KEY;
  if (!expected) {
    return NextResponse.json({ error: 'no auth key set' }, { status: 503 });
  }
  const url = new URL(req.url);
  const provided = url.searchParams.get('key') ?? req.headers.get('x-stay-concierge-key');
  if (provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'service init failed' },
      { status: 503 },
    );
  }

  const { data: props, error: propErr } = await sb
    .from('properties')
    .select('id, name, owners')
    .eq('is_active', true);
  if (propErr) return NextResponse.json({ error: propErr.message }, { status: 500 });

  // Flatten properties.owners into (email, phone) pairs.
  const pairs: Array<{ email: string; phone: string }> = [];
  for (const row of (props ?? []) as PropertyRow[]) {
    const owners = Array.isArray(row.owners) ? row.owners : [];
    for (const o of owners) {
      const email = (o.email ?? '').trim().toLowerCase();
      const phone = (o.phone ?? '').trim();
      if (email && phone) pairs.push({ email, phone });
    }
  }

  // Pull owner contacts with empty phones, scoped by emails we care about.
  const allEmails = [...new Set(pairs.map((p) => p.email))];
  if (allEmails.length === 0) {
    return NextResponse.json({ ok: true, updates: [], summary: 'no owner cards with email+phone' });
  }

  const { data: contacts, error: contactErr } = await sb
    .from('contacts')
    .select('id, name, phone, emails')
    .eq('type', 'owner')
    .overlaps('emails', allEmails);
  if (contactErr) return NextResponse.json({ error: contactErr.message }, { status: 500 });

  const updates: Update[] = [];
  for (const c of (contacts ?? []) as Array<{
    id: string;
    name: string | null;
    phone: string | null;
    emails: string[] | null;
  }>) {
    if (c.phone && c.phone.trim().length > 0) continue;
    const emails = (c.emails ?? []).map((e) => e.toLowerCase());
    const match = pairs.find((p) => emails.includes(p.email));
    if (!match) continue;
    const { error: updErr } = await sb
      .from('contacts')
      .update({ phone: match.phone })
      .eq('id', c.id);
    if (updErr) {
      updates.push({
        contact_id: c.id,
        contact_name: c.name ?? '',
        matched_email: match.email,
        phone: `ERROR: ${updErr.message}`,
      });
      continue;
    }
    updates.push({
      contact_id: c.id,
      contact_name: c.name ?? '',
      matched_email: match.email,
      phone: match.phone,
    });
  }

  return NextResponse.json({
    ok: true,
    candidates_seen: pairs.length,
    contacts_eligible: contacts?.length ?? 0,
    updated: updates.filter((u) => !u.phone.startsWith('ERROR:')).length,
    failed: updates.filter((u) => u.phone.startsWith('ERROR:')).length,
    updates,
  });
}
