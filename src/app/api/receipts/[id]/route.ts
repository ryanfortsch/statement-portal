import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

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
  const { data: period } = await supabase
    .from('statement_periods')
    .select('id')
    .eq('month', receipt.month)
    .maybeSingle();
  if (period) {
    const { data: stmt } = await supabase
      .from('property_statements')
      .select('id, rental_revenue, add_ons_revenue, management_fee, cleaning_total, repairs_total, attributed_debits_total, reserve_holdback')
      .eq('period_id', period.id)
      .eq('property_id', receipt.property_id)
      .maybeSingle();
    if (stmt) {
      // Delta off the stored column, clamped at zero (drift-safety; any
      // residue self-heals on the next ingest's from-scratch rebuild).
      const repairsTotal = round2(Math.max(0, (Number(stmt.repairs_total) || 0) - amount));
      const rental = Number(stmt.rental_revenue) || 0;
      const addOns = Number(stmt.add_ons_revenue) || 0;
      const mgmt = Number(stmt.management_fee) || 0;
      const cleaning = Number(stmt.cleaning_total) || 0;
      const attributedDebits = Number(stmt.attributed_debits_total) || 0;
      const reserveHoldback = Number((stmt as { reserve_holdback?: number }).reserve_holdback) || 0;
      const ownerPayout = round2(rental + addOns - mgmt - cleaning - repairsTotal - attributedDebits - reserveHoldback);
      const { error: updErr } = await supabase
        .from('property_statements')
        .update({ repairs_total: repairsTotal, owner_payout: ownerPayout })
        .eq('id', stmt.id);
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
      return NextResponse.json({ ok: true, repairs_total: repairsTotal, owner_payout: ownerPayout });
    }
  }

  return NextResponse.json({ ok: true });
}
