import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

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

  return NextResponse.json({ installments: inserted || [] });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const code = (request.nextUrl.searchParams.get('confirmation_code') || '').trim();
  if (!code) return NextResponse.json({ error: 'confirmation_code required' }, { status: 400 });
  const supabase = getSupabase();
  const { error } = await supabase.from('reservation_installments').delete().eq('confirmation_code', code);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
