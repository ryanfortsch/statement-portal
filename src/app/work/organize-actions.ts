'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { auth } from '@/auth';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { countUnorganizedSlips, organizeOpenWorkSlips } from '@/lib/organize-work-slips';
import { refreshWorkBriefs } from '@/lib/work-briefs';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { operatingDate } from '@/lib/operating-date';
import { selectAllPaged } from '@/lib/paged-select';
import { slipIdsOnLivePackets } from '@/lib/field-work-board';
import { groupStaleSlips, isSlipStale, STALE_SLIP_DAYS, type StaleCandidate } from '@/lib/work-stale';

/** Organize on demand from the Work board.
 *
 *  Same shape as planRunsNow: the response is instant (a count of slips the
 *  nightly pass has not seen yet) and the model calls run AFTER the response
 *  via after(). A whole backlog is a few minutes of per-home calls; the board
 *  is force-dynamic, so the next refresh shows whatever landed. The nightly
 *  cron catches anything the budget left behind. */
export async function organizeWorkNow(): Promise<{ ok: true; pending: number } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!isServiceConfigured) return { ok: false, error: 'Helm database is not configured' };
  try {
    const pending = await countUnorganizedSlips(supabaseAdmin);
    // Briefs are rewritten for every home whose slip set moved, whether or
    // not any slip needed organizing: closing three slips changes the brief.
    after(async () => {
      try {
        if (pending > 0) {
          const res = await organizeOpenWorkSlips(supabaseAdmin, { maxProperties: 30 });
          if (res.errors.length) console.warn('[organizeWorkNow] errors', res.errors);
        }
        const briefs = await refreshWorkBriefs(supabaseAdmin, { maxProperties: 30 });
        if (briefs.errors.length) console.warn('[organizeWorkNow] brief errors', briefs.errors);
      } catch (err) {
        console.error('[organizeWorkNow] background pass failed', err);
      }
    });
    revalidatePath('/work');
    return { ok: true, pending };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** How many slips the background pass still has to file. The board's
 *  Organize button polls this after a click until it reaches zero (or the
 *  pass's budget is spent) and then says what was done, instead of asking
 *  the operator to check back. */
export async function organizePendingCount(): Promise<{ ok: true; pending: number } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!isServiceConfigured) return { ok: false, error: 'Helm database is not configured' };
  try {
    return { ok: true, pending: await countUnorganizedSlips(supabaseAdmin) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Review stale slips (owners) ──────────────────────────────────────

/**
 * The board's "Review stale slips": open slips nobody has touched in 90 days,
 * grouped by home (src/lib/work-stale.ts). An owner decision, never a cron:
 * listing changes nothing, and each Dismiss is a tap. Both actions are owner
 * only, because a server action is reachable by anyone signed in.
 */

const STALE_COLUMNS =
  'id, property_id, title, status, created_at, claimed_at, snoozed_at, snoozed_until, owner_last_contacted_at, last_verified_open_at, scheduled_date';

type StaleRow = StaleCandidate & { title: string };

export type StaleSlipView = { id: string; title: string; lastTouchDay: string };
export type StaleHomeView = { propertyId: string; propertyName: string; slips: StaleSlipView[] };

/** Latest comment per slip, read in chunks so a long id list stays inside a URL. */
async function lastCommentAtBySlip(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabaseAdmin
      .from('work_slip_comments')
      .select('work_slip_id, created_at')
      .in('work_slip_id', ids.slice(i, i + 100));
    if (error) throw new Error(`slip comments: ${error.message}`);
    for (const c of (data ?? []) as Array<{ work_slip_id: string; created_at: string }>) {
      const prior = out.get(c.work_slip_id);
      if (!prior || c.created_at > prior) out.set(c.work_slip_id, c.created_at);
    }
  }
  return out;
}

async function ownerOrError(): Promise<{ email: string } | { error: string }> {
  try {
    return { email: await requireOwnerEmail() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Owners only' };
  }
}

export async function loadStaleSlips(): Promise<
  { ok: true; homes: StaleHomeView[]; total: number; days: number } | { ok: false; error: string }
> {
  const who = await ownerOrError();
  if ('error' in who) return { ok: false, error: who.error };
  if (!isServiceConfigured) return { ok: false, error: 'Helm database is not configured' };
  try {
    const today = operatingDate();
    const slips = await selectAllPaged<StaleRow>((from, to) =>
      supabaseAdmin.from('work_slips').select(STALE_COLUMNS).eq('status', 'open').order('id').range(from, to),
    );
    const [comments, onPackets, { data: props }] = await Promise.all([
      lastCommentAtBySlip(slips.map((s) => s.id)),
      slipIdsOnLivePackets(),
      supabaseAdmin.from('properties').select('id, name'),
    ]);
    const nameOf = new Map(((props ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]));
    const name = (id: string) => nameOf.get(id) ?? id;
    const groups = groupStaleSlips(
      slips,
      today,
      { lastCommentAt: (id) => comments.get(id), onLivePacket: (id) => onPackets.has(id) },
      (a, b) => name(a).localeCompare(name(b)),
    );
    const homes = groups.map((g) => ({
      propertyId: g.propertyId,
      propertyName: name(g.propertyId),
      slips: g.slips.map((s) => ({ id: s.id, title: s.title, lastTouchDay: s.lastTouchDay })),
    }));
    return { ok: true, homes, total: homes.reduce((n, h) => n + h.slips.length, 0), days: STALE_SLIP_DAYS };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Dismiss the slips an owner tapped. The rule is applied again here, against
 * the rows as they are now: a slip someone commented on, claimed or put on a
 * packet since the list loaded stays open and comes back as skipped.
 * Dismissed is closed without work (closed_at, never completed_at), the same
 * stamp the slip page's Dismiss writes, and Reopen on the slip undoes it.
 */
export async function dismissStaleSlips(
  ids: string[],
): Promise<{ ok: true; dismissedIds: string[]; skipped: number } | { ok: false; error: string }> {
  const who = await ownerOrError();
  if ('error' in who) return { ok: false, error: who.error };
  if (!isServiceConfigured) return { ok: false, error: 'Helm database is not configured' };
  const wanted = [...new Set((ids ?? []).filter((id) => typeof id === 'string' && id))].slice(0, 500);
  if (wanted.length === 0) return { ok: true, dismissedIds: [], skipped: 0 };
  try {
    const today = operatingDate();
    const rows: StaleRow[] = [];
    for (let i = 0; i < wanted.length; i += 100) {
      const { data, error } = await supabaseAdmin.from('work_slips').select(STALE_COLUMNS).in('id', wanted.slice(i, i + 100));
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as StaleRow[]));
    }
    const [comments, onPackets] = await Promise.all([lastCommentAtBySlip(rows.map((r) => r.id)), slipIdsOnLivePackets()]);
    const stale = rows
      .filter((r) => isSlipStale(r, today, { lastCommentAt: comments.get(r.id), onLivePacket: onPackets.has(r.id) }))
      .map((r) => r.id);
    const dismissedIds: string[] = [];
    const now = new Date().toISOString();
    for (let i = 0; i < stale.length; i += 100) {
      const { data, error } = await supabaseAdmin
        .from('work_slips')
        .update({ status: 'dismissed', closed_at: now, closed_by_email: who.email })
        .in('id', stale.slice(i, i + 100))
        .eq('status', 'open')
        .select('id');
      if (error) throw new Error(error.message);
      dismissedIds.push(...((data ?? []) as Array<{ id: string }>).map((r) => r.id));
    }
    revalidatePath('/work');
    revalidatePath('/properties');
    return { ok: true, dismissedIds, skipped: wanted.length - dismissedIds.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
