import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from '@/lib/supabase-admin';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import {
  normalizeEmail,
  planRecipientChange,
  scopeProperties,
  type OwnerCardLike,
  type RecipientOp,
} from '@/lib/owner-recipients';

/**
 * Service-created statement recipient changes: stay-concierge's write path
 * into who receives an owner's statements.
 *
 * Dotti, 2026-10-02, on Alex Rosenstein asking that Laura be added to the 4
 * Middle statement emails: "shouldnt this trigger an action?" The reply said
 * "Done, Laura's added" and nothing made it true. The concierge now proposes
 * a `statement_recipient` action on the owner card; approving it lands here.
 *
 * Writes `properties.owner_emails` (the statement To list) AND a contact card
 * in `properties.owners`, so the new address is also recognised as an owner
 * when it writes in. See src/lib/owner-recipients.ts for why both move.
 *
 * Scope follows the REQUESTER: every property whose statement already goes to
 * `requester_email`, falling back to `property_id` alone. "Add Laura to these
 * communications" means everything the owner receives.
 *
 * Idempotent by construction: adding an address already present, or removing
 * one already gone, changes nothing and reports `changed: false`.
 *
 * Auth: STAY_CONCIERGE_KEY header, same plane as /api/turnover-notes. The
 * path is allowlisted in src/proxy.ts PUBLIC_API_PREFIXES.
 *
 *   POST /api/owner-recipients
 *   { property_id, email, op: 'add' | 'remove', requester_email?, name?,
 *     source_key?, evidence? }
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Payload = {
  property_id?: string;
  email?: string;
  op?: string;
  requester_email?: string;
  name?: string;
  source_key?: string;
  evidence?: string;
};

type Row = { id: string; name: string; owner_emails: string[] | null; owners: OwnerCardLike[] | null };

export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  if (!isConfigured) {
    return NextResponse.json({ error: 'helm db not configured' }, { status: 503 });
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const propertyId = (body.property_id || '').trim();
  const email = normalizeEmail(body.email);
  const op = (body.op || 'add').trim() as RecipientOp;
  if (!email) {
    return NextResponse.json({ error: 'a valid email is required' }, { status: 400 });
  }
  if (op !== 'add' && op !== 'remove') {
    return NextResponse.json({ error: "op must be 'add' or 'remove'" }, { status: 400 });
  }
  const requester = normalizeEmail(body.requester_email);
  if (!propertyId && !requester) {
    return NextResponse.json({ error: 'property_id or requester_email is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('properties')
    .select('id, name, owner_emails, owners, is_active');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const all = (data ?? []) as (Row & { is_active: boolean | null })[];
  // Requester matching only looks at the live fleet: an offboarded house that
  // still lists the owner should not start receiving a new copy.
  const candidates = all.filter((r) => r.is_active !== false || r.id === propertyId);
  const scope = scopeProperties(candidates, propertyId, requester);
  if (scope.length === 0) {
    return NextResponse.json({ ok: false, reason: 'no_property', property_id: propertyId });
  }

  const today = new Date().toISOString().slice(0, 10);
  const who = (body.evidence || '').trim();
  const note = `Added ${today} at the owner's request${who ? `: ${who}` : ''}`.slice(0, 400);

  const results: { id: string; name: string; changed: boolean; refused?: string }[] = [];
  for (const row of scope) {
    const plan = planRecipientChange(row, op, email, { name: body.name, note });
    if (!plan.changed) {
      results.push({ id: row.id, name: row.name, changed: false, refused: plan.refused });
      continue;
    }
    const { data: updated, error: upErr } = await supabase
      .from('properties')
      .update({ owner_emails: plan.owner_emails, owners: plan.owners })
      .eq('id', row.id)
      .select('id');
    if (upErr) return NextResponse.json({ error: upErr.message, done: results }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: `property ${row.id} not updated (0 rows)`, done: results }, { status: 500 });
    }
    results.push({ id: row.id, name: row.name, changed: true });
    revalidatePath(`/properties/${row.id}`);
  }
  revalidatePath('/statements');

  const refused = results.find((r) => r.refused)?.refused;
  return NextResponse.json({
    ok: !refused || results.some((r) => r.changed),
    reason: refused,
    op,
    email,
    properties: results,
  });
}
