import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { authorizeCron } from '@/lib/cron-auth';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';
import { getStripeKeysMap } from '@/lib/stripe-sync';
import { CURRENT_2026 } from '@/lib/forecast-model';
import { knownFromRoster } from '@/lib/forecast-roster';
import { ACTIVE_WORK_SLIP_STATUSES } from '@/lib/work-types';
import {
  gapKeysFromActionSummary,
  isLive,
  readinessGaps,
  readinessRequestKey,
  readinessSlip,
  type ReadinessSource,
  type StayCounts,
} from '@/lib/launch-readiness';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Launch-readiness sweep: one work slip per earning home that is missing a
 * money-critical field (external title, tax certificate, bank last four,
 * fee, owner email, Stripe key, activation date). The Helm side of the
 * concierge's fleet watch, which covers the knowledge base and Stripe key
 * from its end.
 *
 * GET or POST /api/cron/launch-readiness
 *
 * Auth: Vercel Cron bearer or a signed-in Helm user (authorizeCron), or the
 * stay-concierge bridge key so the concierge can run it right after its own
 * fleet pass.
 *
 * Slip rules, mirroring /api/work-slips: one slip per home ever (request
 * key readiness:<id>); an open slip is updated in place as the gap set
 * changes; a done slip reopens only when a NEW field goes missing;
 * dismissed and blocked slips stay put; when nothing is missing any more
 * the open slip closes itself with a note.
 */

const BOT_EMAIL = 'concierge@helm.system';
const RECENT_DAYS = 90;
const CLOSED_FOR_GOOD = new Set(['dismissed', 'blocked']);

type SlipRow = { id: string; status: string; action_summary: string | null; description: string | null };

async function handle(request: NextRequest) {
  const cronDenied = await authorizeCron(request);
  if (cronDenied && authorizeStayConcierge(request)) return cronDenied;
  if (!isServiceConfigured) {
    return NextResponse.json({ error: 'helm db not configured' }, { status: 503 });
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - RECENT_DAYS * 86400_000).toISOString().slice(0, 10);

  const { data: props, error: propsError } = await supabase
    .from('properties')
    .select(
      'id, name, title, tax_cert_id, bank_last4, management_fee_pct, owner_emails, activated_at, created_at, is_active, is_rising_tide_owned',
    )
    .eq('is_active', true);
  if (propsError) {
    return NextResponse.json({ error: propsError.message }, { status: 500 });
  }

  // Stays that make a home "earning": anything checking out after the recent
  // window, cancelled and duplicate rows excluded (bookings carries twins;
  // never key on its id).
  const { data: stays, error: staysError } = await supabase
    .from('bookings')
    .select('property_id, check_in, check_out, status, cancelled_at, duplicate_of')
    .gte('check_out', since)
    .is('cancelled_at', null)
    .is('duplicate_of', null);
  if (staysError) {
    return NextResponse.json({ error: staysError.message }, { status: 500 });
  }
  const counts = new Map<string, StayCounts>();
  for (const s of (stays ?? []) as Array<{ property_id: string; check_in: string; status: string | null }>) {
    const st = (s.status ?? '').toLowerCase();
    if (st === 'cancelled' || st === 'canceled') continue;
    const c = counts.get(s.property_id) ?? { upcoming: 0, recent: 0 };
    if (s.check_in >= today) c.upcoming += 1;
    else c.recent += 1;
    counts.set(s.property_id, c);
  }

  const stripe = getStripeKeysMap();
  const known = knownFromRoster(CURRENT_2026);

  const summary = {
    checked: 0,
    opened: [] as string[],
    updated: [] as string[],
    reopened: [] as string[],
    closed: [] as string[],
    left: [] as string[],
    gaps: {} as Record<string, string[]>,
  };
  let touched = false;

  for (const p of (props ?? []) as ReadinessSource[]) {
    const stayCounts = counts.get(p.id) ?? { upcoming: 0, recent: 0 };
    if (!isLive(p, stayCounts)) continue;
    summary.checked += 1;

    const gaps = readinessGaps(p, { stripeKeyed: !!stripe[p.id], knownStart: !!known[p.id] });
    const requestKey = readinessRequestKey(p.id);
    const { data: rows } = await supabase
      .from('work_slips')
      .select('id, status, action_summary, description')
      .eq('from_guest_request_key', requestKey)
      .limit(1);
    const existing = (rows?.[0] as SlipRow | undefined) ?? null;
    const active = !!existing && (ACTIVE_WORK_SLIP_STATUSES as string[]).includes(existing.status);

    if (gaps.length === 0) {
      if (existing && active) {
        await supabase
          .from('work_slips')
          .update({
            status: 'done',
            completed_at: now.toISOString(),
            closed_at: now.toISOString(),
            closed_by_email: BOT_EMAIL,
            resolution_notes: `Every money-critical field was present on ${today}; closed by the launch-readiness sweep.`,
          })
          .eq('id', existing.id);
        summary.closed.push(p.id);
        touched = true;
      }
      continue;
    }

    summary.gaps[p.id] = gaps.map((g) => g.key);
    const slip = readinessSlip(p, gaps);

    if (!existing) {
      const insert = await supabase
        .from('work_slips')
        .insert({
          property_id: p.id,
          title: slip.title,
          description: slip.description,
          action_summary: slip.actionSummary,
          category: 'rising_tide',
          priority: 'high',
          status: 'open',
          from_guest_request_key: requestKey,
          created_by_email: BOT_EMAIL,
        })
        .select('id')
        .single();
      if (insert.error && insert.error.code !== '23505') {
        console.error('[cron/launch-readiness] insert failed', p.id, insert.error.message);
        continue;
      }
      summary.opened.push(p.id);
      touched = true;
      continue;
    }

    if (active) {
      if (existing.action_summary !== slip.actionSummary || existing.description !== slip.description) {
        await supabase
          .from('work_slips')
          .update({ title: slip.title, description: slip.description, action_summary: slip.actionSummary })
          .eq('id', existing.id);
        summary.updated.push(p.id);
        touched = true;
      } else {
        summary.left.push(p.id);
      }
      continue;
    }

    if (CLOSED_FOR_GOOD.has(existing.status)) {
      summary.left.push(p.id);
      continue;
    }

    // done: reopen only when a field is missing that was not missing before.
    const before = gapKeysFromActionSummary(existing.action_summary);
    const fresh = gaps.some((g) => !before.has(g.key));
    if (!fresh) {
      summary.left.push(p.id);
      continue;
    }
    await supabase
      .from('work_slips')
      .update({
        status: 'open',
        completed_at: null,
        closed_at: null,
        closed_by_email: null,
        snoozed_until: null,
        resolution_notes: null,
        title: slip.title,
        description: slip.description,
        action_summary: slip.actionSummary,
      })
      .eq('id', existing.id);
    summary.reopened.push(p.id);
    touched = true;
  }

  if (touched) {
    revalidatePath('/work');
  }
  return NextResponse.json({ ok: true, ...summary });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
