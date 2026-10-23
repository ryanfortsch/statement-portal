import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { timeLabelOf } from '@/lib/vendor-visit-core';
import { etDateOf } from '@/lib/vendor-visit-dates';
import { checkOwnerWorkReport, ownerWorkKey, ownerWorkRow, type OwnerWorkReport } from '@/lib/owner-work-holds-core';

/**
 * Files an owner's work report as a pending hold card (2026-10-23). The write
 * is to vendor_visit_proposals ONLY: no Guesty hold, no bookings row, no slip.
 * The card's Approve, in the Team inbox, is the one thing that holds the
 * calendar (vendor-visit-approve.ts); vendor-visit-guard.test.ts keeps this
 * file away from that writer. See owner-work-holds-core.ts for why.
 */

export type OwnerWorkFileResult =
  | { ok: true; id: string | null; status: 'filed' | 'already_filed' | 'past' }
  | { ok: false; error: string; status: 400 | 404 | 500 };

export async function fileOwnerWorkHold(
  db: SupabaseClient,
  report: OwnerWorkReport,
  now: Date = new Date(),
): Promise<OwnerWorkFileResult> {
  const bad = checkOwnerWorkReport(report);
  if (bad) return { ok: false, error: bad, status: 400 };
  const today = etDateOf(now);
  // The work is over: nothing to hold, and nothing to ask.
  if (report.end < today) return { ok: true, id: null, status: 'past' };
  const holdFrom = report.start < today ? today : report.start;

  const { data: home, error: homeErr } = await db
    .from('properties')
    .select('id, is_active')
    .eq('id', report.propertyId)
    .maybeSingle();
  if (homeErr) return { ok: false, error: `properties: ${homeErr.message}`, status: 500 };
  if (!home || !(home as { is_active?: boolean }).is_active) {
    return { ok: false, error: `no active home ${report.propertyId}`, status: 404 };
  }

  const row = ownerWorkRow(report, holdFrom, timeLabelOf(report.startTime, report.endTime));
  const { data, error } = await db
    .from('vendor_visit_proposals')
    .upsert(row, { onConflict: 'quo_message_id', ignoreDuplicates: true })
    .select('id');
  if (error) return { ok: false, error: `vendor_visit_proposals: ${error.message}`, status: 500 };
  const filed = ((data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
  if (filed) return { ok: true, id: filed, status: 'filed' };

  // Already filed (approve and an auto-close can both reach here): one card.
  const { data: existing } = await db
    .from('vendor_visit_proposals')
    .select('id')
    .eq('quo_message_id', ownerWorkKey(report.cardId, report.start))
    .maybeSingle();
  return { ok: true, id: (existing as { id?: string } | null)?.id ?? null, status: 'already_filed' };
}
