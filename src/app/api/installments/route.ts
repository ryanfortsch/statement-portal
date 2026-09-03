import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertStatementWritable, getFreezeStatus, StatementFrozenError, frozenResponseBody } from '@/lib/statement-finality';

/**
 * Cross-month booking installment splits.
 *
 * GET  /api/installments?confirmation_code=GY-fCdhbUYC
 *   -> { installments: [...] }  (empty array if not split)
 *
 * POST /api/installments
 *   body: { confirmation_code, property_id, installments: [{month, installment_revenue, installment_nights, is_final_month, note?}, ...] }
 *   -> Atomically replaces the full set of installment rows for this
 *      confirmation_code. Validates that exactly one row has
 *      is_final_month=true and that all installment_revenue values are
 *      non-negative numbers. Returns the persisted rows.
 *
 * DELETE /api/installments?confirmation_code=GY-fCdhbUYC
 *   -> Removes all installment rows for the code. The next /api/ingest
 *      run for any affected month will revert to the existing
 *      single-month flow.
 */

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

type InstallmentInput = {
  month: string;
  installment_revenue: number;
  installment_nights?: number | null;
  is_final_month?: boolean;
  note?: string | null;
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = (request.nextUrl.searchParams.get('confirmation_code') || '').trim();
  if (!code) return NextResponse.json({ error: 'confirmation_code required' }, { status: 400 });
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('reservation_installments')
    .select('id, confirmation_code, property_id, month, installment_revenue, installment_nights, is_final_month, note, created_at, updated_at')
    .eq('confirmation_code', code)
    .order('month', { ascending: true });
  if (error) {
    // Tolerate the table not existing yet (PR 1 migration unrun in some env).
    if (error.code === 'PGRST205' || /does not exist|relation|Could not find the table/i.test(error.message || '')) {
      return NextResponse.json({ installments: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ installments: data || [] });
}

/**
 * Slice-month gate. A split decides which month recognizes which share of
 * a stay, and each of those months may already have been ingested -- or
 * sent. Editing or clearing the split after that silently changes what
 * those statements SHOULD have paid while their stored numbers stay put:
 * the audit's "double-pay" critical (a slice moved out of a sent month
 * whose statement still carried it, then recognized again in the new one).
 *
 * Without `force`: refuses with a 409 naming every affected month, so the
 * editor can confirm. With `force`: sent or finalized months go through
 * assertStatementWritable (files the post_send_write audit row); merely
 * ingested months get an `installment_split_changed` warning gap so the
 * statements page shows them as needing a Refresh Statement / re-ingest
 * before they are sent. Read failures throw: an unreadable gate is not an
 * open gate.
 */
type SliceMonthGate = { month: string; statementId: string; frozen: boolean; reason: string | null };

class SliceMonthsNeedConfirm extends Error {
  constructor(public readonly gates: SliceMonthGate[], propertyId: string, action: string) {
    const list = gates.map(g => `${g.month}${g.frozen ? (g.reason === 'period_final' ? ' (finalized)' : ' (sent)') : ''}`).join(', ');
    super(
      `${propertyId} already has a statement for ${list}. ${action} changes what ${gates.length === 1 ? 'that month' : 'those months'} should pay: `
      + 'each will be flagged and must be re-run (Refresh Statement or re-ingest) before it is sent again. Proceed?',
    );
  }
}

async function loadExistingSlices(
  supabase: SupabaseClient,
  code: string,
): Promise<{ months: string[]; propertyId: string | null }> {
  const { data, error } = await supabase
    .from('reservation_installments')
    .select('month, property_id')
    .eq('confirmation_code', code);
  if (error) {
    // Only the table itself being absent is tolerable (migration not run).
    // The message must say BOTH that something is missing AND name this
    // table: a permission error that mentions the table is a real error.
    const msg = error.message || '';
    const tableMissing = error.code === 'PGRST205'
      || (/reservation_installments/i.test(msg) && /could not find the table|does not exist/i.test(msg));
    if (tableMissing) return { months: [], propertyId: null };
    throw error;
  }
  const rows = (data || []) as { month: string; property_id: string }[];
  return { months: [...new Set(rows.map(r => r.month))].sort(), propertyId: rows[0]?.property_id ?? null };
}

async function gateSliceMonths(
  supabase: SupabaseClient,
  args: { code: string; propertyId: string; months: string[]; force: boolean; action: string },
): Promise<SliceMonthGate[]> {
  const months = [...new Set(args.months)].sort();
  if (months.length === 0) return [];
  const { data: periods, error: perErr } = await supabase
    .from('statement_periods')
    .select('id, month')
    .in('month', months);
  if (perErr) throw perErr;
  const periodMonth = new Map((periods || []).map(p => [p.id as string, p.month as string]));
  if (periodMonth.size === 0) return [];
  const { data: stmts, error: stErr } = await supabase
    .from('property_statements')
    .select('id, period_id')
    .eq('property_id', args.propertyId)
    .in('period_id', [...periodMonth.keys()]);
  if (stErr) throw stErr;

  const gates: SliceMonthGate[] = [];
  for (const st of stmts || []) {
    const freeze = await getFreezeStatus(supabase, { statementId: st.id as string });
    gates.push({
      month: periodMonth.get(st.period_id as string) || '',
      statementId: st.id as string,
      frozen: freeze.frozen,
      reason: freeze.reason ?? null,
    });
  }
  gates.sort((a, b) => a.month.localeCompare(b.month));
  if (gates.length === 0) return [];
  if (!args.force) throw new SliceMonthsNeedConfirm(gates, args.propertyId, args.action);

  for (const g of gates) {
    if (g.frozen) {
      await assertStatementWritable(supabase, { statementId: g.statementId }, {
        force: true,
        action: args.action,
        detail: `${args.code}: slice month ${g.month}`,
      });
      continue;
    }
    const { error } = await supabase.from('data_gaps').insert({
      property_statement_id: g.statementId,
      gap_type: 'installment_split_changed',
      severity: 'warning',
      description: `${args.action} for ${args.code} after ${g.month} was ingested. The share this statement recognizes may no longer match the split: re-run Refresh Statement or re-ingest ${g.month}, then resolve.`,
      expected_data: `Re-ingest ${g.month}`,
    });
    if (error) throw error;
  }
  return gates;
}

function gateErrorResponse(e: unknown): NextResponse | null {
  if (e instanceof SliceMonthsNeedConfirm) {
    return NextResponse.json({ needs_confirm: true, error: e.message, months: e.gates }, { status: 409 });
  }
  if (e instanceof StatementFrozenError) return NextResponse.json(frozenResponseBody(e), { status: 409 });
  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const code = String(body.confirmation_code || '').trim();
  const propertyId = String(body.property_id || '').trim();
  const installments = Array.isArray(body.installments) ? (body.installments as InstallmentInput[]) : [];

  if (!code) return NextResponse.json({ error: 'confirmation_code required' }, { status: 400 });
  if (!propertyId) return NextResponse.json({ error: 'property_id required' }, { status: 400 });
  if (installments.length < 2) {
    return NextResponse.json({ error: 'a split must have at least 2 month installments' }, { status: 400 });
  }

  // Validate each row.
  const seenMonths = new Set<string>();
  let finalCount = 0;
  for (const i of installments) {
    if (!/^\d{4}-\d{2}$/.test(i.month || '')) {
      return NextResponse.json({ error: `bad month value: ${i.month}` }, { status: 400 });
    }
    if (seenMonths.has(i.month)) {
      return NextResponse.json({ error: `duplicate month in split: ${i.month}` }, { status: 400 });
    }
    seenMonths.add(i.month);
    const rev = Number(i.installment_revenue);
    if (!Number.isFinite(rev) || rev < 0) {
      return NextResponse.json({ error: `installment_revenue must be a non-negative number (${i.month})` }, { status: 400 });
    }
    if (i.is_final_month) finalCount += 1;
  }
  if (finalCount !== 1) {
    return NextResponse.json({ error: 'exactly one installment must be marked is_final_month' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Gate on every month the split touches: the months it used to cover and
  // the months it will cover (a checkout month ingested un-split holds the
  // whole stay, so it is stale the moment a split appears). Nothing is
  // written until the gate passes.
  let staleMonths: SliceMonthGate[] = [];
  try {
    const existing = await loadExistingSlices(supabase, code);
    const byProperty = new Map<string, string[]>();
    byProperty.set(propertyId, installments.map(i => i.month));
    const oldOwner = existing.propertyId || propertyId;
    byProperty.set(oldOwner, [...(byProperty.get(oldOwner) || []), ...existing.months]);
    for (const [pid, months] of byProperty) {
      staleMonths = staleMonths.concat(await gateSliceMonths(supabase, {
        code, propertyId: pid, months, force: body.force === true, action: 'Edit installment split',
      }));
    }
  } catch (e) {
    const handled = gateErrorResponse(e);
    if (handled) return handled;
    return NextResponse.json({ error: `Could not check the months this split touches (${e instanceof Error ? e.message : String(e)}). Nothing was changed.` }, { status: 502 });
  }

  // Atomic replace: delete all existing rows for this code, then insert
  // the new set. Same-transaction safety isn't a thing in PostgREST, so
  // we accept a brief window where the table is empty for this code --
  // a concurrent ingest reading installments would just see the old or
  // the new full set. The penny-exactness invariant is preserved either
  // way because we never partial-update.
  {
    const { error: delErr } = await supabase
      .from('reservation_installments')
      .delete()
      .eq('confirmation_code', code);
    if (delErr) {
      // Tolerate missing table -- caller likely hasn't run the migration.
      if (!(delErr.code === 'PGRST205' || /does not exist|relation|Could not find the table/i.test(delErr.message || ''))) {
        return NextResponse.json({ error: `delete failed: ${delErr.message}` }, { status: 500 });
      }
      return NextResponse.json({ error: 'reservation_installments table missing -- run supabase-schema-reservation-installments.sql' }, { status: 500 });
    }
  }

  const rows = installments.map(i => ({
    confirmation_code: code,
    property_id: propertyId,
    month: i.month,
    installment_revenue: round2(Number(i.installment_revenue) || 0),
    installment_nights: i.installment_nights != null ? Number(i.installment_nights) : null,
    is_final_month: !!i.is_final_month,
    note: i.note ? String(i.note).slice(0, 200) : null,
    dedupe_key: `${code}|${i.month}`,
    updated_at: new Date().toISOString(),
  }));

  const { data: inserted, error: insErr } = await supabase
    .from('reservation_installments')
    .insert(rows)
    .select('id, confirmation_code, property_id, month, installment_revenue, installment_nights, is_final_month, note, created_at, updated_at');
  if (insErr) return NextResponse.json({ error: `insert failed: ${insErr.message}` }, { status: 500 });

  return NextResponse.json({ installments: inserted || [], stale_months: staleMonths.map(g => g.month) });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const code = (request.nextUrl.searchParams.get('confirmation_code') || '').trim();
  if (!code) return NextResponse.json({ error: 'confirmation_code required' }, { status: 400 });
  const supabase = getSupabase();
  let staleMonths: SliceMonthGate[] = [];
  try {
    const existing = await loadExistingSlices(supabase, code);
    if (existing.propertyId) {
      staleMonths = await gateSliceMonths(supabase, {
        code,
        propertyId: existing.propertyId,
        months: existing.months,
        force: request.nextUrl.searchParams.get('force') === 'true',
        action: 'Clear installment split',
      });
    }
  } catch (e) {
    const handled = gateErrorResponse(e);
    if (handled) return handled;
    return NextResponse.json({ error: `Could not check the months this split touches (${e instanceof Error ? e.message : String(e)}). Nothing was changed.` }, { status: 502 });
  }
  const { error } = await supabase.from('reservation_installments').delete().eq('confirmation_code', code);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, stale_months: staleMonths.map(g => g.month) });
}
