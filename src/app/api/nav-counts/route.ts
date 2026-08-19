import { NextResponse } from 'next/server';
import { fieldDb } from '@/lib/field-db';

/**
 * Lightweight count endpoint for the nav tab pills (NavTabCount), mirroring
 * /api/messaging/pending-count: polled every ~30s, cheap head-count selects,
 * and every failure path degrades to zeros with HTTP 200 so a config gap or
 * missing table never breaks the tab strips.
 *
 * The definitions mirror the pages' own filters (statementsReview is scoped
 * to the latest statement period, which is the dashboard's default month):
 *
 * - fieldPackets: /operations/packets' "awaiting approval" slice, i.e.
 *   inspection_packets with status='submitted'. That is the one packet state
 *   waiting on the OPERATOR; published/claimed/in_progress wait on the
 *   contractor and draft is the operator's own backlog, not an ask.
 *
 * - statementsReview: the /statements bank review queue for the most recent
 *   statement period -- unattributed deposits, unattributed debits, and
 *   parked vendor refunds all live in bank_deposit_attributions with
 *   status='pending' (same single-table query the dashboard's month review
 *   strip runs).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let fieldPackets = 0;
  let statementsReview = 0;
  try {
    const db = fieldDb();
    const [packetsRes, periodRes] = await Promise.all([
      db.from('inspection_packets').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
      db.from('statement_periods').select('month').order('month', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!packetsRes.error) fieldPackets = packetsRes.count ?? 0;
    const latestMonth = (periodRes.data as { month: string } | null)?.month;
    if (latestMonth) {
      const reviewRes = await db
        .from('bank_deposit_attributions')
        .select('id', { count: 'exact', head: true })
        .eq('month', latestMonth)
        .eq('status', 'pending');
      if (!reviewRes.error) statementsReview = reviewRes.count ?? 0;
    }
  } catch {
    // fieldDb throws when the service-role key is unset (local dev ships
    // empty secrets); the pills just stay quiet.
  }
  return NextResponse.json({ fieldPackets, statementsReview });
}
