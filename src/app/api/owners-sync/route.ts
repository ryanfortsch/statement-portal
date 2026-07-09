import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from '@/lib/supabase-admin';

/**
 * Outbound sync endpoint: returns the structured owners for every active
 * property, flattened to one row per owner. The stay-concierge service
 * pulls this on a schedule and merges into its local contacts.json so Quo
 * SMS handlers can identify owner senders by phone (and the email
 * watcher can do the same for inbound mail).
 *
 * Auth: same STAY_CONCIERGE_KEY shared secret that gates Helm → stay-
 * concierge calls in the other direction. One shared key, two-way trust.
 *
 *   GET /api/owners-sync?key=<STAY_CONCIERGE_KEY>
 *
 * Response shape:
 *   { owners: [{ property_id, property_name, first_name, last_name,
 *                email, phone, is_primary, role }, ...],
 *     count: N,
 *     generated_at: ISO }
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type OwnerCard = {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  is_primary?: boolean;
  role?: string;
  notes?: string;
};

type PropertyRow = {
  id: string;
  name: string;
  owners: OwnerCard[] | null;
};

export async function GET(req: Request) {
  const expected = process.env.STAY_CONCIERGE_KEY;
  if (!expected) {
    return NextResponse.json({ error: 'sync disabled (no key configured)' }, { status: 503 });
  }
  const { searchParams } = new URL(req.url);
  const provided = searchParams.get('key') ?? req.headers.get('x-stay-concierge-key');
  if (provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isConfigured) {
    return NextResponse.json({ error: 'helm db not configured' }, { status: 503 });
  }

  const { data, error } = await supabase
    .from('properties')
    .select('id, name, owners')
    .eq('is_active', true);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const flat: Array<{
    property_id: string;
    property_name: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    is_primary: boolean;
    role: string;
  }> = [];
  for (const row of (data ?? []) as PropertyRow[]) {
    const owners = Array.isArray(row.owners) ? row.owners : [];
    for (const o of owners) {
      flat.push({
        property_id: row.id,
        property_name: row.name,
        first_name: (o.first_name ?? '').trim(),
        last_name: (o.last_name ?? '').trim(),
        email: (o.email ?? '').trim().toLowerCase(),
        phone: (o.phone ?? '').trim(),
        is_primary: Boolean(o.is_primary),
        role: (o.role ?? 'owner').trim() || 'owner',
      });
    }
  }

  return NextResponse.json({
    owners: flat,
    count: flat.length,
    generated_at: new Date().toISOString(),
  });
}
