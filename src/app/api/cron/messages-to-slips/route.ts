import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeCron } from '@/lib/cron-auth';
import { createSlipsFromGuestMessages } from '@/lib/messages-to-slips';
import { planMaintenanceRuns } from '@/lib/maintenance-runs';

/**
 * Guest messages → work slips, then a maintenance-run planning pass.
 *
 * Scheduled every 6h in vercel.json. Mines recent guest conversation
 * threads (via the stay-concierge) for property issues the team must act
 * on, files them as work slips, then immediately classifies + plans so a
 * fresh "the side door lock never worked" report can land on a scheduled
 * maintenance run in the same pass.
 *
 * Query params for manual runs:
 *   ?hours=48        widen the guest-activity window (default 26)
 *   ?days=45         widen the conversation-list window (default 30)
 *   ?max=50          raise the thread-fetch cap (default 20)
 *   ?conversation=X  mine one conversation, recency bypassed (backfill)
 *   ?skip_plan=1     mine only, skip the planning pass
 *
 * Auth: Vercel Cron bearer or a signed-in Helm session (authorizeCron).
 * The thread fan-out is sequential live reads against the Mac Mini, so the
 * route gets the long function budget.
 */

export const maxDuration = 300;

async function handle(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'supabase env not configured' }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  const params = request.nextUrl.searchParams;
  const num = (name: string) => {
    const raw = params.get(name);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  try {
    const mined = await createSlipsFromGuestMessages(supabase, {
      sinceHours: num('hours'),
      days: num('days'),
      maxThreads: num('max'),
      conversationId: params.get('conversation') || undefined,
    });

    // Planning is best-effort: a planner hiccup must not fail the mining
    // report (the slips are already filed; the daily field-packets cron
    // replans anyway).
    let plan: Awaited<ReturnType<typeof planMaintenanceRuns>> | { error: string } | null = null;
    if (!params.get('skip_plan')) {
      plan = await planMaintenanceRuns().catch((err) => ({
        error: err instanceof Error ? err.message : String(err),
      }));
    }

    return NextResponse.json({ ok: true, mined, plan });
  } catch (err) {
    console.error('[cron/messages-to-slips]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
