import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { writeStatementTotals, type FreezeReceipt } from '@/lib/statement-totals-write';
import { assertStatementWritable, StatementFrozenError, frozenResponseBody } from '@/lib/statement-finality';

/**
 * DELETE /api/receipts/:id -- VOID a receipt (soft delete).
 *
 * Sets status='void' (the row and its storage object are retained for
 * audit), deletes the mirror repair_events row, and recomputes the linked
 * statement's repairs_total + owner_payout by DELTA arithmetic off the
 * stored column (never SUM(repair_events) -- pre-repair_events months have
 * repairs_total > 0 with zero audit rows, and a SUM would clobber them).
 *
 * Voided receipts stop folding everywhere because both ingest fold sites
 * and the POST /api/receipts recompute filter status='active'.
 *
 * There is no PATCH in v1 -- corrections are void + re-add, which kills the
 * dual-statement month-move resync logic entirely.
 */

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function isMissingSchemaError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === 'PGRST205'
    || /does not exist|relation|Could not find the table|Could not find the '.*' column/i.test(err.message || '');
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = getSupabase();

  const { data: receipt, error: loadErr } = await supabase
    .from('property_receipts')
    .select('id, property_id, month, amount, status')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!receipt) return NextResponse.json({ error: 'receipt not found' }, { status: 404 });
  if (receipt.status === 'void') {
    return NextResponse.json({ ok: true, already_void: true });
  }

  // Sent-statement freeze: voiding a receipt adds its amount back to the
  // payout. Force rides the query string (DELETE bodies are unreliable).
  let finalityGate: FreezeReceipt;
  try {
    finalityGate = await assertStatementWritable(supabase, { propertyId: receipt.property_id, month: receipt.month }, {
      force: request.nextUrl.searchParams.get('force') === 'true',
      action: 'Void receipt',
      detail: `receipt ${id} · $${(Number(receipt.amount) || 0).toFixed(2)}`,
    });
  } catch (e) {
    if (e instanceof StatementFrozenError) return NextResponse.json(frozenResponseBody(e), { status: 409 });
    throw e;
  }

  const amount = round2(Number(receipt.amount) || 0);

  const { error: voidErr } = await supabase
    .from('property_receipts')
    .update({ status: 'void', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (voidErr) return NextResponse.json({ error: voidErr.message }, { status: 500 });

  // Drop the mirror row. Best-effort: the mirror is display/audit only,
  // and the next ingest rebuilds mirrors from active receipts anyway.
  const { error: mirrorErr } = await supabase
    .from('repair_events')
    .delete()
    .eq('receipt_id', id)
    .eq('source', 'receipt');
  if (mirrorErr && !isMissingSchemaError(mirrorErr)) {
    return NextResponse.json({ error: mirrorErr.message }, { status: 500 });
  }
  if (mirrorErr) console.warn('receipt mirror delete skipped:', mirrorErr.message);

  // Recompute the linked statement, if one exists for (property, month).
  // Resolution fails closed: an unreadable period or statement is an error,
  // never "no statement to update".
  const { data: period, error: perErr } = await supabase
    .from('statement_periods')
    .select('id')
    .eq('month', receipt.month)
    .maybeSingle();
  if (perErr) return NextResponse.json({ error: `statement_periods read failed: ${perErr.message}` }, { status: 500 });
  if (period) {
    const { data: stmt, error: stmtErr } = await supabase
      .from('property_statements')
      .select('id, repairs_total')
      .eq('period_id', period.id)
      .eq('property_id', receipt.property_id)
      .maybeSingle();
    if (stmtErr) return NextResponse.json({ error: `property_statements read failed: ${stmtErr.message}` }, { status: 500 });
    if (stmt) {
      // Delta off the stored column, clamped at zero (drift-safety; any
      // residue self-heals on the next ingest's from-scratch rebuild).
      // repairs_total is OWNED: passed as an override to the single write
      // path, which recomputes every other column from rows.
      const repairsTotal = round2(Math.max(0, (Number(stmt.repairs_total) || 0) - amount));
      const totals = await writeStatementTotals(supabase, stmt.id as string, {
        action: 'Void receipt',
        detail: `receipt ${id} · $${amount.toFixed(2)}`,
        repairsTotal,
        assertedFreeze: finalityGate,
      });
      return NextResponse.json({ ok: true, repairs_total: repairsTotal, owner_payout: totals.after.owner_payout });
    }
  }

  return NextResponse.json({ ok: true });
}
