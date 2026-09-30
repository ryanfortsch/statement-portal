import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from '@/lib/supabase-admin';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';

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
 * description, and reopens a DONE slip only when the ASK itself changed
 * (a different title or action summary: the guest asked for something
 * more, so someone has to act again). The description alone is not the
 * test: the concierge rebuilds it from the latest thread on every approved
 * reply, so a done gear slip kept coming back to life each time we
 * answered that guest about anything else, carrying the inspector's
 * completion photos from the earlier trip (16 Waterman, 2026-09-14).
 * Dismissed and blocked slips keep their status; a replay of the same ask
 * against a closed slip changes nothing. Never duplicates.
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
  inspection_task?: boolean;
};

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

  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.entries(body).some(([key, value]) => key !== 'inspection_task' && value != null && typeof value !== 'string') ||
      (body.inspection_task != null && typeof body.inspection_task !== 'boolean')) {
    return NextResponse.json({ error: 'Invalid work slip fields' }, { status: 400 });
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
  const { data: prop, error: propertyError } = await supabase
    .from('properties')
    .select('id, name')
    .eq('id', propertyId)
    .maybeSingle();
  if (propertyError) return NextResponse.json({ error: 'Property lookup failed' }, { status: 503 });
  if (!prop) {
    return NextResponse.json(
      { ok: false, skipped: true, error: `unknown property_id ${propertyId}` },
      { status: 200 },
    );
  }
  const propertyName = (prop.name as string | null) ?? propertyId;

  async function confirmed(id: string, details: Record<string, unknown>) {
    let fieldDelivery: unknown = { status: 'office_queue' };
    if (body.inspection_task === true || category === 'inventory') {
      const { data, error } = await supabase.rpc('helm_route_message_work', { p_slip_id: id });
      if (error || !data) {
        // The slip exists. Return a retryable error until routing is confirmed;
        // the same request_key will recover it without making another slip.
        return NextResponse.json({ error: 'Work slip saved; field routing needs retry', id }, { status: 503 });
      }
      fieldDelivery = data;
    }
    revalidatePath('/work');
    revalidatePath('/turnovers');
    revalidatePath('/field', 'layout');
    revalidatePath('/fieldwork/packets');
    return NextResponse.json({ ok: true, id, ...details, field_delivery: fieldDelivery });
  }


  // Merge path: one slip per request_key, ever. A second ask on the same
  // stay lands as an update note; a closed slip reopens only for a changed ask.
  const fullTitle = `${propertyName}: ${title}`;
  const { data: existingRows, error: existingError } = await supabase
    .from('work_slips')
    .select('id, property_id, status, description, title, action_summary')
    .eq('from_guest_request_key', requestKey)
    .limit(1);
  if (existingError) return NextResponse.json({ error: 'Work slip lookup failed' }, { status: 503 });
  const existing = existingRows?.[0] as
    | { id: string; property_id: string; status: string; description: string | null; title: string; action_summary: string | null }
    | undefined;

  if (existing) {
    if (existing.property_id !== propertyId) {
      return NextResponse.json({ error: 'Request key belongs to another property' }, { status: 409 });
    }
    const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    // The ask is the title plus the action summary, not the description:
    // the description carries the guest's latest message and our reply,
    // which change every time the thread moves.
    const sameAsk =
      norm(existing.title) === norm(fullTitle) &&
      (!actionSummary || norm(existing.action_summary) === norm(actionSummary));
    const alreadyNoted =
      !!description && !!existing.description && existing.description.includes(description);
    if (alreadyNoted && sameAsk) {
      return confirmed(existing.id, { deduped: true });
    }
    // A closed slip (done, dismissed, or parked as blocked) only stirs for a
    // changed ask. The same promise arriving again because we answered the
    // guest about something else is a replay: nothing to do, and no note to
    // append to a slip nobody is working. 'dismissed' is an explicit
    // operator "we're not doing this" and must stick (SlipClosePanel: "a
    // dismissed slip stays dismissed"); 'blocked' is active work waiting on
    // something and must not be silently flipped.
    const closed = existing.status === 'done' || existing.status === 'dismissed' || existing.status === 'blocked';
    if (closed && sameAsk) {
      return confirmed(existing.id, { deduped: true, reopened: false });
    }
    // Reopen ONLY a completed slip, and only for a genuinely new ask — the
    // gear needs doing again.
    const reopen = existing.status === 'done' && !sameAsk;
    const mergedDescription =
      [existing.description, description ? `--- Follow-up request ---\n${description}` : null]
        .filter(Boolean)
        .join('\n\n') || null;
    const update: Record<string, unknown> = { description: mergedDescription };
    if (!sameAsk) {
      update.title = fullTitle;
      update.action_summary = actionSummary;
    }
    if (reopen) {
      update.status = 'open';
      update.completed_at = null;
      update.closed_at = null;
      update.closed_by_email = null;
      update.snoozed_until = null;
      // The earlier completion's write-up belongs to the earlier ask. The
      // photos stay: they are evidence of that setup, and the office's own
      // reopen keeps them too.
      update.resolution_notes = null;
    }
    const { error: updateError } = await supabase
      .from('work_slips')
      .update(update)
      .eq('id', existing.id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    revalidatePath('/work');
    revalidatePath('/turnovers');
    return confirmed(existing.id, { deduped: true, reopened: reopen });
  }

  const insert = await supabase
    .from('work_slips')
    .insert({
      property_id: propertyId,
      title: fullTitle,
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
      const { data: winner, error: winnerError } = await supabase
        .from('work_slips')
        .select('id')
        .eq('from_guest_request_key', requestKey)
        .eq('property_id', propertyId)
        .limit(1);
      const id = (winner?.[0] as { id: string } | undefined)?.id ?? null;
      if (winnerError || !id) return NextResponse.json({ error: 'Work slip confirmation failed' }, { status: 503 });
      return confirmed(id, { deduped: true });
    }
    return NextResponse.json({ error: insert.error.message }, { status: 500 });
  }

  revalidatePath('/work');
  revalidatePath('/turnovers');
  return confirmed((insert.data as { id: string }).id, { deduped: false });
}
