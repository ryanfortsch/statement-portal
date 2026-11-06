import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { helmBaseUrl } from '@/lib/daily-brief';
import { dutyEmails } from '@/lib/team-recipients';
import { TEAM_MEMBERS } from '@/lib/team';
import { loadAllDisputes } from '@/lib/stripe-disputes';
import { disputeTask, planDisputeTasks } from '@/lib/stripe-disputes-core';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/cron/stripe-disputes (daily, 12:00 UTC)
 *
 * Reads every home's own Stripe account for disputes (read-only) and makes
 * each one that waits on our evidence an office to-do for whoever holds the
 * `disputes` duty, due the day Stripe stops taking evidence, linking the
 * packet. A to-do is filed once per dispute (tag `stripe-dispute:<id>`) and
 * marked done when Stripe no longer waits on us. Helm never submits evidence
 * and texts no one: the to-do lands on the assignee's home feed.
 *
 * `?dry=1` reports the plan without writing.
 */
export async function GET(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;
  const dry = new URL(request.url).searchParams.get('dry') === '1';

  const { disputes, unread } = await loadAllDisputes();

  const { data: existing, error } = await supabaseAdmin
    .from('tasks')
    .select('id, tags, status')
    .contains('tags', ['stripe-dispute']);
  if (error) return NextResponse.json({ ok: false, error: `Could not read existing to-dos: ${error.message}` }, { status: 500 });

  const plan = planDisputeTasks(disputes, (existing ?? []) as { id: string; tags: string[] | null; status: string }[]);
  const summary = {
    disputes: disputes.length,
    create: plan.create.map((d) => d.disputeId),
    close: plan.close,
    accounts_unread: unread.map((u) => u.propertyId),
  };
  if (dry) return NextResponse.json({ ok: true, dry: true, ...summary });

  const assignee =
    dutyEmails('disputes')[0] || TEAM_MEMBERS.find((m) => m.access === 'owner' && m.active)?.email || null;
  const { data: homes } = await supabaseAdmin.from('properties').select('id, name');
  const names = new Map(((homes ?? []) as { id: string; name: string | null }[]).map((h) => [h.id, h.name || h.id]));

  const errors: string[] = [];
  for (const d of plan.create) {
    const t = disputeTask(d, names.get(d.propertyId) || d.propertyId.replace(/_/g, ' '), helmBaseUrl());
    const { error: insErr } = await supabaseAdmin.from('tasks').insert({
      ...t,
      status: 'open',
      assigned_to_email: assignee,
      created_by_email: 'helm-auto',
    });
    if (insErr) errors.push(`${d.disputeId}: ${insErr.message}`);
  }
  if (plan.close.length > 0) {
    const { error: upErr } = await supabaseAdmin.from('tasks').update({ status: 'done' }).in('id', plan.close);
    if (upErr) errors.push(`closing: ${upErr.message}`);
  }

  return NextResponse.json({ ok: errors.length === 0, ...summary, errors }, { status: errors.length ? 500 : 200 });
}
