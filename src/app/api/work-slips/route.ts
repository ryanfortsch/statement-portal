import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from '@/lib/supabase-admin';
import { ACTIVE_WORK_SLIP_STATUSES } from '@/lib/work-types';

/**
 * Service-created work slips — stay-concierge's write path into /work.
 *
 * When an operator approves a guest reply that commits to providing gear
 * (pack and play, high chair, travel crib...), stay-concierge POSTs here
 * and the promise becomes a dated prep slip on the property, surfaced on
 * the /work board, the property print sheet, and the Operations turnover
 * row for that exact reservation.
 *
 * Auth: STAY_CONCIERGE_KEY shared secret (query `key` or header
 * `x-stay-concierge-key`), same plane as /api/owners-sync. The path is
 * allowlisted in src/proxy.ts PUBLIC_API_PREFIXES; without that the SSO
 * middleware 401s a sessionless caller before this handler runs.
 *
 * Idempotency: `request_key` maps to work_slips.from_guest_request_key
 * (partial unique index). A replay or a second gear message on the same
 * reservation MERGES into the existing slip: appends the new ask to the
 * description, and reopens a DONE slip when the ask is genuinely new (the
 * guest asked again, so someone has to act again). Dismissed and blocked
 * slips keep their status; byte-identical replays change nothing. Never
 * duplicates.
 *
 *   POST /api/work-slips?key=K
 *   { property_id, title, request_key, description?, action_summary?,
 *     priority?, category?, scheduled_date?, guesty_reservation_id?,
 *     location? }
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CONCIERGE_BOT_EMAIL = 'concierge@helm.system';

const ALLOWED_CATEGORIES = new Set([
  'maintenance',
  'inventory',
  'owner',
  'vendor',
  'other',
  'rising_tide',
]);
const ALLOWED_PRIORITIES = new Set(['low', 'normal', 'high']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Payload = {
  property_id?: string;
  title?: string;
  request_key?: string;
  description?: string;
  action_summary?: string;
  priority?: string;
  category?: string;
  scheduled_date?: string;
  guesty_reservation_id?: string;
  location?: string;
};

export async function POST(req: Request) {
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

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const propertyId = (body.property_id ?? '').trim();
  const title = (body.title ?? '').trim();
  const requestKey = (body.request_key ?? '').trim();
  if (!propertyId || !title || !requestKey) {
    return NextResponse.json(
      { error: 'property_id, title, and request_key are required' },
      { status: 400 },
    );
  }
  const category = ALLOWED_CATEGORIES.has(body.category ?? '') ? body.category! : 'other';
  const priority = ALLOWED_PRIORITIES.has(body.priority ?? '') ? body.priority! : 'high';
  const scheduledDate =
    body.scheduled_date && DATE_RE.test(body.scheduled_date) ? body.scheduled_date : null;
  const description = (body.description ?? '').trim() || null;
  const actionSummary = (body.action_summary ?? '').trim() || null;

  // A prep slip scheduled well in the future (e.g. gear for an October
  // check-in approved in July) would otherwise sit on the active board for
  // months, in the way of work that needs doing now. Snooze it until a week
  // before its due date: it drops off the active board and the property
  // turnover count, still lives in the "Snoozed" bucket, and resurfaces with
  // a week of lead. Slips with no scheduled_date (e.g. cleaner-reported
  // issues, which are "now" work) are never snoozed. On the reopen path below
  // the snooze is cleared so a re-ask always surfaces immediately.
  const SLIP_SNOOZE_LEAD_DAYS = 7;
  const todayIso = new Date().toISOString().slice(0, 10);
  let snoozedUntil: string | null = null;
  if (scheduledDate) {
    const wakeMs = Date.parse(`${scheduledDate}T00:00:00Z`) - SLIP_SNOOZE_LEAD_DAYS * 86_400_000;
    const wakeIso = new Date(wakeMs).toISOString().slice(0, 10);
    if (wakeIso > todayIso) snoozedUntil = wakeIso;
  }

  // The FK would reject an unknown property anyway; checking first gives the
  // caller a clean "skipped" instead of a raw constraint error. Personal
  // properties (65 Calderwood, 3246 NE 27th) are filtered concierge-side but
  // this also catches slug drift between the two systems.
  const { data: prop } = await supabase
    .from('properties')
    .select('id, name')
    .eq('id', propertyId)
    .maybeSingle();
  if (!prop) {
    return NextResponse.json(
      { ok: false, skipped: true, error: `unknown property_id ${propertyId}` },
      { status: 200 },
    );
  }
  const propertyName = (prop.name as string | null) ?? propertyId;

  // Merge path: one slip per request_key, ever. A second ask on the same
  // stay lands as an update note; a closed slip reopens.
  const { data: existingRows } = await supabase
    .from('work_slips')
    .select('id, status, description')
    .eq('from_guest_request_key', requestKey)
    .limit(1);
  const existing = existingRows?.[0] as
    | { id: string; status: string; description: string | null }
    | undefined;

  if (existing) {
    const alreadyNoted =
      !!description && !!existing.description && existing.description.includes(description);
    // Reopen ONLY a completed slip, and only when the ask carries genuinely
    // new content — the gear needs doing again. 'dismissed' is an explicit
    // operator "we're not doing this" and must stick (StatusChanger:
    // "a dismissed slip stays dismissed"); 'blocked' is active work waiting
    // on something and must not be silently flipped. A byte-identical
    // replay never changes anything.
    const reopen = existing.status === 'done' && !alreadyNoted;
    if (alreadyNoted) {
      return NextResponse.json({ ok: true, id: existing.id, deduped: true });
    }
    const mergedDescription =
      [existing.description, description ? `--- Follow-up request ---\n${description}` : null]
        .filter(Boolean)
        .join('\n\n') || null;
    const update: Record<string, unknown> = { description: mergedDescription };
    if (reopen) {
      update.status = 'open';
      update.completed_at = null;
      update.closed_at = null;
      update.closed_by_email = null;
      update.snoozed_until = null;
    }
    const { error: updateError } = await supabase
      .from('work_slips')
      .update(update)
      .eq('id', existing.id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    revalidatePath('/work');
    revalidatePath('/operations');
    return NextResponse.json({ ok: true, id: existing.id, deduped: true, reopened: reopen });
  }

  const insert = await supabase
    .from('work_slips')
    .insert({
      property_id: propertyId,
      title: `${propertyName}: ${title}`,
      description,
      action_summary: actionSummary,
      location: (body.location ?? '').trim() || null,
      category,
      priority,
      status: 'open',
      scheduled_date: scheduledDate,
      snoozed_until: snoozedUntil,
      snoozed_by_email: snoozedUntil ? CONCIERGE_BOT_EMAIL : null,
      snoozed_at: snoozedUntil ? new Date().toISOString() : null,
      guesty_reservation_id: (body.guesty_reservation_id ?? '').trim() || null,
      from_guest_request_key: requestKey,
      created_by_email: CONCIERGE_BOT_EMAIL,
    })
    .select('id')
    .single();

  if (insert.error) {
    // Partial unique index race: a concurrent replay inserted first. Treat
    // as success and hand back the winner, mirroring seam.ts.
    if (insert.error.code === '23505') {
      const { data: winner } = await supabase
        .from('work_slips')
        .select('id')
        .eq('from_guest_request_key', requestKey)
        .limit(1);
      const id = (winner?.[0] as { id: string } | undefined)?.id ?? null;
      return NextResponse.json({ ok: true, id, deduped: true });
    }
    return NextResponse.json({ error: insert.error.message }, { status: 500 });
  }

  revalidatePath('/work');
  revalidatePath('/operations');
  return NextResponse.json({ ok: true, id: (insert.data as { id: string }).id, deduped: false });
}
