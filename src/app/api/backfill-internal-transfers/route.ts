import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { buildRemittanceSheet } from '@/lib/remittance';
import {
  classifyInternalTransfers,
  remittanceMonthFor,
  isInternalSweepSource,
  type SweepExpectations,
  type TransferCandidate,
} from '@/lib/internal-transfers';
import { parseInternalTransfer, TAX_REMITTANCE_ACCOUNT, RT_OPERATING_ACCOUNT } from '@/lib/bank-charges';

/**
 * One-shot backfill: stamp `source` on internal sweeps already parked in the
 * bank review queue.
 *
 * /api/ingest now recognizes Rising Tide's own money movements -- occupancy
 * tax to *9928, the VRBO commission and management-fee settlements to *5130
 * -- and files them out of the Unattributed Charges queue. That only helps
 * rows ingested from here on: the debit upsert is
 * `{ onConflict: 'dedupe_key', ignoreDuplicates: true }`, so re-running an
 * ingest deliberately never disturbs a row an operator may have already
 * touched. This walks the existing backlog and applies the same
 * classification, using the SAME shipped classifier rather than a second
 * copy of the rules.
 *
 * SAFETY. The only column written is `source`. The filter is
 * `status='pending' AND direction='debit'`, so the three genuine
 * reimbursements already attributed against live statements (53 Rocky
 * Neck's $26.59 shower door, 17 Beach's $49.99 trash can, 20 Hammond's
 * $250.66 AC installation) are unreachable by construction. No status
 * changes, no money column is touched, and `owner_payout` cannot move: every
 * recompute site reads `status='attributed'` only. Nothing is dismissed --
 * dismissal is a one-way door in the UI, and these rows stay listed.
 *
 * Dry by default. GET reports what it would do; add `?apply=1` to write.
 * Idempotent either way: a row already carrying a sweep source is skipped.
 *
 * Session-gated by src/proxy.ts like any other /api route -- deliberately
 * NOT added to the public allowlist, since it writes.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type DebitRow = {
  id: string;
  property_id: string;
  month: string;
  deposit_date: string;
  amount: number | string;
  description: string | null;
  source: string | null;
};

export async function GET(request: NextRequest) {
  const apply = request.nextUrl.searchParams.get('apply') === '1';

  // Paged: this is an unbounded read over a table that grows every close,
  // and a bare .select() is silently capped at 1000 rows by PostgREST. A
  // short read here would not just miss rows -- it would defeat the
  // ambiguous-match guard, which refuses to claim a figure when TWO rows
  // tie it. Ordered by id so the offset windows are stable.
  let rows: DebitRow[];
  try {
    rows = await selectAllPaged<DebitRow>((from, to) => supabaseAdmin
      .from('bank_deposit_attributions')
      .select('id, property_id, month, deposit_date, amount, description, source')
      .eq('direction', 'debit')
      .eq('status', 'pending')
      .order('id')
      .range(from, to), { label: 'internal-transfer backfill' });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'read failed' }, { status: 500 });
  }

  // Group by the property-month the rows LANDED in. Each group is then
  // tested against the sheet for that month minus one.
  const groups = new Map<string, DebitRow[]>();
  for (const r of rows) {
    if (isInternalSweepSource(r.source)) continue;   // already stamped
    if (!parseInternalTransfer((r.description || '').toUpperCase())?.outbound) continue;
    const key = `${r.property_id}|${r.month}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  // One remittance sheet per distinct prior month, unscoped, rather than one
  // per property-month: the sheet is whole-portfolio anyway, so this is a
  // handful of reads instead of dozens.
  const prevMonths = [...new Set([...groups.keys()].map(k => remittanceMonthFor(k.split('|')[1])))];
  const sheetByMonth = new Map<string, Awaited<ReturnType<typeof buildRemittanceSheet>>>();
  const feeByKey = new Map<string, number>();
  for (const pm of prevMonths) {
    try {
      sheetByMonth.set(pm, await buildRemittanceSheet(supabaseAdmin, pm));
    } catch (err) {
      console.warn(`backfill: remittance sheet for ${pm} unavailable`, err);
    }
    const { data: fees } = await supabaseAdmin
      .from('property_statements')
      .select('property_id, management_fee, statement_periods!inner(month)')
      .eq('statement_periods.month', pm);
    for (const f of (fees || []) as Array<{ property_id: string; management_fee: number | string | null }>) {
      if (f.management_fee === null) continue;
      feeByKey.set(`${f.property_id}|${pm}`, Number(f.management_fee) || 0);
    }
  }

  const planned: Array<{
    id: string; property_id: string; month: string; date: string;
    amount: number; source: string; expected: number | null; reconciles: boolean;
  }> = [];
  const unreconciledTax: Array<{ property_id: string; month: string; moved: number; expected: number }> = [];

  for (const [key, groupRows] of groups) {
    const [propertyId, landingMonth] = key.split('|');
    const prevMonth = remittanceMonthFor(landingMonth);
    const sheet = sheetByMonth.get(prevMonth);
    const sheetRow = sheet?.rows.find(r => r.propertyId === propertyId);
    const fee = feeByKey.get(`${propertyId}|${prevMonth}`);
    const expected: SweepExpectations | null = sheetRow
      ? {
          taxToRemit: sheetRow.taxToRemit,
          vrboCommissionSweep: sheetRow.vrboCommissionSweep,
          managementFee: fee === undefined ? null : fee,
          sweepEstimated: sheetRow.sweepEstimated,
        }
      : null;

    const byId = new Map(groupRows.map(r => [r.id, r]));
    const candidates: TransferCandidate[] = groupRows.map(r => ({
      key: r.id,
      last4: parseInternalTransfer((r.description || '').toUpperCase())!.last4,
      amount: Math.round(Number(r.amount) * 100) / 100,
      date: r.deposit_date,
    }));

    const verdicts = classifyInternalTransfers(candidates, expected, {
      tax: TAX_REMITTANCE_ACCOUNT,
      operating: RT_OPERATING_ACCOUNT,
    });
    for (const v of verdicts) {
      const row = byId.get(v.key)!;
      planned.push({
        id: v.key,
        property_id: propertyId,
        month: landingMonth,
        date: row.deposit_date,
        amount: Math.round(Number(row.amount) * 100) / 100,
        source: v.source,
        expected: v.expected,
        reconciles: v.reconciles,
      });
    }
    const taxLeg = verdicts.filter(v => v.kind === 'tax-sweep');
    if (taxLeg.length > 0 && taxLeg[0].evaluated && !taxLeg[0].reconciles) {
      unreconciledTax.push({
        property_id: propertyId,
        month: prevMonth,
        moved: Math.round(taxLeg.reduce((s, v) => s + Number(byId.get(v.key)!.amount), 0) * 100) / 100,
        expected: taxLeg[0].expected ?? 0,
      });
    }
  }

  let updated = 0;
  const writeErrors: string[] = [];
  if (apply) {
    // One UPDATE per row. The status/direction predicates are repeated on
    // every write so a row an operator attributed between the read above and
    // this loop cannot be restamped.
    for (const p of planned) {
      const { error: upErr } = await supabaseAdmin
        .from('bank_deposit_attributions')
        .update({ source: p.source })
        .eq('id', p.id)
        .eq('status', 'pending')
        .eq('direction', 'debit');
      if (upErr) writeErrors.push(`${p.id}: ${upErr.message}`);
      else updated += 1;
    }
  }

  const bySource: Record<string, number> = {};
  for (const p of planned) bySource[p.source] = (bySource[p.source] || 0) + 1;

  return NextResponse.json({
    mode: apply ? 'applied' : 'dry-run (add ?apply=1 to write)',
    pending_debits_scanned: rows.length,
    transfer_rows_considered: [...groups.values()].reduce((s, g) => s + g.length, 0),
    recognized: planned.length,
    by_source: bySource,
    left_in_queue: [...groups.values()].reduce((s, g) => s + g.length, 0) - planned.length,
    updated,
    write_errors: writeErrors,
    // Tax wires Helm cannot reproduce. The money provably left for the tax
    // account, so a mismatch means reservations are missing for that month.
    unreconciled_tax_sweeps: unreconciledTax,
    planned,
  });
}
