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
  owner_full: string | null;
  owner_phone: string | null;
  owner_emails: string[] | null;
};

type ExistingContact = {
  id: string;
  name: string | null;
  phone: string | null;
  emails: string[] | null;
  linked_property_ids: string[] | null;
};

type Action = {
  action: 'created' | 'updated_phone' | 'linked_property' | 'noop' | 'error';
  name: string;
  phone: string;
  property_id: string;
  detail?: string;
};

/** Best-effort E.164. Accepts "(978) 771-5630", "9787715630", "+1978...". */
function toE164(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (raw.trim().startsWith('+') && d) return `+${d}`;
  return '';
}

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
    .select('id, name, owners, owner_full, owner_phone, owner_emails')
    .eq('is_active', true);
  if (propErr) return NextResponse.json({ error: propErr.message }, { status: 500 });

  // Build one owner record per E.164 phone across all property cards. Read
  // the owners JSONB first; fall back to the Owner block (owner_full /
  // owner_phone / owner_emails) for cards that predate the JSONB. Merge
  // emails + linked properties when the same phone appears on multiple
  // cards (a person who owns more than one home).
  type Rec = { name: string; emails: Set<string>; phone: string; propertyIds: Set<string> };
  const recs = new Map<string, Rec>();
  const addRec = (name: string, email: string, phoneRaw: string, propertyId: string) => {
    const phone = toE164(phoneRaw);
    if (!phone) return;
    const r = recs.get(phone) ?? { name: '', emails: new Set<string>(), phone, propertyIds: new Set<string>() };
    if (!r.name && name) r.name = name;
    const e = email.trim().toLowerCase();
    if (e) r.emails.add(e);
    if (propertyId) r.propertyIds.add(propertyId);
    recs.set(phone, r);
  };

  for (const row of (props ?? []) as PropertyRow[]) {
    const cards = Array.isArray(row.owners) ? row.owners : [];
    if (cards.length > 0) {
      for (const o of cards) {
        const name = [o.first_name, o.last_name].filter(Boolean).join(' ').trim();
        addRec(name, o.email ?? '', o.phone ?? '', row.id);
      }
    } else if (row.owner_phone) {
      addRec(row.owner_full ?? '', (row.owner_emails ?? [])[0] ?? '', row.owner_phone, row.id);
    }
  }

  // All existing owner contacts, matched by normalized phone or email.
  const { data: existingRows, error: contactErr } = await sb
    .from('contacts')
    .select('id, name, phone, emails, linked_property_ids')
    .eq('type', 'owner');
  if (contactErr) return NextResponse.json({ error: contactErr.message }, { status: 500 });
  const existing = (existingRows ?? []) as ExistingContact[];

  const actions: Action[] = [];

  for (const rec of recs.values()) {
    const recEmails = [...rec.emails];
    const propId = [...rec.propertyIds][0] ?? '';
    let match =
      existing.find((c) => toE164(c.phone) === rec.phone) ??
      existing.find((c) =>
        (c.emails ?? []).some((e) => recEmails.includes(e.toLowerCase())),
      );

    if (match) {
      const patch: Record<string, unknown> = {};
      if (!toE164(match.phone)) patch.phone = rec.phone;
      const linked = new Set([...(match.linked_property_ids ?? []), ...rec.propertyIds]);
      if (linked.size !== (match.linked_property_ids ?? []).length) {
        patch.linked_property_ids = [...linked];
      }
      if (Object.keys(patch).length === 0) {
        actions.push({ action: 'noop', name: match.name ?? rec.name, phone: rec.phone, property_id: propId });
        continue;
      }
      const { error } = await sb.from('contacts').update(patch).eq('id', match.id);
      actions.push({
        action: error ? 'error' : patch.phone ? 'updated_phone' : 'linked_property',
        name: match.name ?? rec.name,
        phone: rec.phone,
        property_id: propId,
        detail: error?.message,
      });
    } else {
      const { error } = await sb.from('contacts').insert({
        type: 'owner',
        name: rec.name || '(owner)',
        emails: recEmails,
        phone: rec.phone,
        linked_property_ids: [...rec.propertyIds],
        created_by_email: 'system@backfill',
      });
      actions.push({
        action: error ? 'error' : 'created',
        name: rec.name || '(owner)',
        phone: rec.phone,
        property_id: propId,
        detail: error?.message,
      });
    }
  }

  const tally = (a: Action['action']) => actions.filter((x) => x.action === a).length;
  return NextResponse.json({
    ok: true,
    cards_with_phone: recs.size,
    existing_owner_contacts: existing.length,
    created: tally('created'),
    updated_phone: tally('updated_phone'),
    linked_property: tally('linked_property'),
    noop: tally('noop'),
    errors: tally('error'),
    actions,
  });
}
