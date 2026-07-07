import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { PROPERTIES } from '@/lib/properties';

/**
 * Receipt-backed property expenses.
 *
 * POST /api/receipts  (multipart/form-data)
 *   Fields: property_id, month (YYYY-MM), amount (>0), vendor_name?,
 *   description?, expense_date? (YYYY-MM-DD), category? (repairs|supplies|
 *   other, default repairs), file? (receipt photo / PDF),
 *   acknowledge_warnings? ('true' after the operator confirms past guards).
 *
 *   Creates a property_receipts row keyed (property_id, month) -- NOT the
 *   statement UUID -- so it survives /api/ingest's wipe-and-rebuild. If a
 *   statement already exists for that (property, month), a mirror
 *   repair_events row (source='receipt') is inserted and the statement's
 *   repairs_total + owner_payout recompute. If no statement exists yet, the
 *   row just waits; the next ingest folds it in.
 *
 *   RECOMPUTE IS DELTA ARITHMETIC off the stored repairs_total column --
 *   never SUM(repair_events). Months ingested before the repair_events
 *   table landed legally have repairs_total > 0 with zero audit rows; a SUM
 *   there would silently clobber the bank repairs and inflate the payout.
 *   Ingest / fill-gap re-derive from scratch on the next run, so any delta
 *   drift self-heals. management_fee is NEVER recomputed -- receipts do not
 *   enter the fee base.
 *
 *   Guards (both warn-and-override, never hard blocks). Unless
 *   acknowledge_warnings is set, the POST returns { ok:false,
 *   needs_confirm:true, warnings } with ZERO writes when:
 *     - double deduction: a bank debit in the review queue or a bank-sourced
 *       repair_events row on the same property+month matches the amount
 *       within $1 (the Home Depot reimbursement transfer that ingest already
 *       parked -- attributing THAT and also adding the receipt deducts twice);
 *     - sent statement: the month's close-out shows the statement was
 *       already emailed / archived to Drive, so this changes a payout the
 *       owner has in hand.
 *
 * GET /api/receipts?property_id=&month=
 *   Lists active receipts for that property-month.
 */

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const BUCKET = 'expense-receipts';
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);
const MAX_FILE_BYTES = 25 * 1024 * 1024; // matches the bucket's file_size_limit
const CATEGORIES = new Set(['repairs', 'supplies', 'other']);

// Missing-table / missing-column tolerance, matching the ingest precedent.
function isMissingSchemaError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === 'PGRST205'
    || /does not exist|relation|Could not find the table|Could not find the '.*' column/i.test(err.message || '');
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.length > 80 ? cleaned.slice(0, 80) : cleaned;
}

type StatementRow = {
  id: string;
  rental_revenue: number | null;
  add_ons_revenue: number | null;
  management_fee: number | null;
  cleaning_total: number | null;
  repairs_total: number | null;
  attributed_debits_total: number | null;
  reserve_holdback: number | null;
  owner_payout: number | null;
};

/** Locate the statement for (property, month), if one exists yet. */
async function findStatement(
  supabase: ReturnType<typeof getSupabase>,
  propertyId: string,
  month: string,
): Promise<{ stmt: StatementRow | null; periodId: string | null }> {
  const { data: period } = await supabase
    .from('statement_periods')
    .select('id')
    .eq('month', month)
    .maybeSingle();
  if (!period) return { stmt: null, periodId: null };
  const { data: stmt } = await supabase
    .from('property_statements')
    .select('id, rental_revenue, add_ons_revenue, management_fee, cleaning_total, repairs_total, attributed_debits_total, reserve_holdback, owner_payout')
    .eq('period_id', period.id)
    .eq('property_id', propertyId)
    .maybeSingle();
  return { stmt: (stmt as StatementRow | null) || null, periodId: period.id as string };
}

/**
 * Canonical owner-payout recompute after a repairs_total delta. Every term
 * except repairs_total is read straight off the statement row (the
 * cleaning-events/[id] pattern) so the two recompute paths stay independent.
 */
function recomputePayout(stmt: StatementRow, newRepairsTotal: number): number {
  const rental = Number(stmt.rental_revenue) || 0;
  const addOns = Number(stmt.add_ons_revenue) || 0;
  const mgmt = Number(stmt.management_fee) || 0;
  const cleaning = Number(stmt.cleaning_total) || 0;
  const attributedDebits = Number(stmt.attributed_debits_total) || 0;
  const reserveHoldback = Number(stmt.reserve_holdback) || 0;
  return round2(rental + addOns - mgmt - cleaning - newRepairsTotal - attributedDebits - reserveHoldback);
}

type Warning = {
  kind: 'possible_double_deduction' | 'statement_already_sent';
  message: string;
  owner_payout_before?: number;
  owner_payout_after?: number;
};

/** Best-effort guards. A guard READ failing must never block a save. */
async function collectWarnings(
  supabase: ReturnType<typeof getSupabase>,
  propertyId: string,
  month: string,
  amount: number,
  stmt: StatementRow | null,
  periodId: string | null,
): Promise<Warning[]> {
  const warnings: Warning[] = [];

  // (a) Double deduction: a same-amount bank debit already parked in the
  // review queue (would flow to attributed_debits_total if attributed) or a
  // bank-classified repair charge already counted in repairs_total.
  try {
    const { data: debits } = await supabase
      .from('bank_deposit_attributions')
      .select('id, amount, description, status')
      .eq('property_id', propertyId)
      .eq('month', month)
      .eq('direction', 'debit')
      .in('status', ['pending', 'attributed']);
    const debitHit = (debits || []).find(d => Math.abs((Number(d.amount) || 0) - amount) <= 1);
    if (debitHit) {
      warnings.push({
        kind: 'possible_double_deduction',
        message: `A bank charge for $${round2(Number(debitHit.amount) || 0).toFixed(2)} is already on ${month}${debitHit.status === 'attributed' ? ' (attributed as an expense)' : ' (pending in the review queue)'} -- attribute that instead, or add the receipt anyway.`,
      });
    }
  } catch { /* guard is best-effort */ }

  try {
    if (stmt) {
      const { data: repairRows } = await supabase
        .from('repair_events')
        .select('id, bank_charge_amount, vendor_name, source')
        .eq('property_statement_id', stmt.id)
        .neq('source', 'receipt');
      const repairHit = (repairRows || []).find(r => Math.abs((Number(r.bank_charge_amount) || 0) - amount) <= 1);
      if (repairHit) {
        warnings.push({
          kind: 'possible_double_deduction',
          message: `A ${repairHit.vendor_name || 'bank'} repair charge for $${round2(Number(repairHit.bank_charge_amount) || 0).toFixed(2)} is already deducted on ${month}'s statement. Adding this receipt would deduct it twice.`,
        });
      }
    }
  } catch { /* guard is best-effort */ }

  // (b) Sent statement: close-out shows the owner already has the PDF.
  try {
    if (stmt && periodId) {
      let sent = false;
      const { data: closeTask, error: ctErr } = await supabase
        .from('close_tasks')
        .select('email_sent_at, statement_drive_url')
        .eq('period_id', periodId)
        .eq('property_id', propertyId)
        .maybeSingle();
      if (!ctErr && closeTask && (closeTask.email_sent_at || (closeTask as { statement_drive_url?: string | null }).statement_drive_url)) {
        sent = true;
      }
      if (!sent) {
        const { data: periodRow } = await supabase
          .from('statement_periods')
          .select('funds_sent_date')
          .eq('id', periodId)
          .maybeSingle();
        const fsd = (periodRow as { funds_sent_date?: string | null } | null)?.funds_sent_date;
        if (fsd && new Date(fsd + 'T00:00:00') <= new Date()) sent = true;
      }
      if (sent) {
        const before = Number(stmt.owner_payout) || 0;
        const after = recomputePayout(stmt, round2((Number(stmt.repairs_total) || 0) + amount));
        warnings.push({
          kind: 'statement_already_sent',
          message: `${month}'s statement was already sent to the owner. This changes the payout from $${before.toFixed(2)} to $${after.toFixed(2)}.`,
          owner_payout_before: before,
          owner_payout_after: after,
        });
      }
    }
  } catch { /* guard is best-effort */ }

  return warnings;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const formData = await request.formData();
    const propertyId = ((formData.get('property_id') as string) || '').trim();
    const month = ((formData.get('month') as string) || '').trim();
    const amount = round2(Number(formData.get('amount')));
    const vendorName = ((formData.get('vendor_name') as string) || '').trim().slice(0, 120) || null;
    const description = ((formData.get('description') as string) || '').trim().slice(0, 200) || null;
    const expenseDateRaw = ((formData.get('expense_date') as string) || '').trim();
    const categoryRaw = ((formData.get('category') as string) || '').trim().toLowerCase();
    const acknowledgeWarnings = String(formData.get('acknowledge_warnings') || '') === 'true';

    if (!PROPERTIES[propertyId]) {
      return NextResponse.json({ error: `Unknown property_id: ${propertyId}` }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "month must be 'YYYY-MM'" }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
    }
    const category = CATEGORIES.has(categoryRaw) ? categoryRaw : 'repairs';
    let expenseDate: string | null = null;
    if (expenseDateRaw) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDateRaw)) {
        return NextResponse.json({ error: "expense_date must be 'YYYY-MM-DD'" }, { status: 400 });
      }
      expenseDate = expenseDateRaw;
    }

    const supabase = getSupabase();
    const { stmt, periodId } = await findStatement(supabase, propertyId, month);

    // Guards run BEFORE any write. The operator confirms past them from the
    // review step; a guard never hard-blocks.
    if (!acknowledgeWarnings) {
      const warnings = await collectWarnings(supabase, propertyId, month, amount, stmt, periodId);
      if (warnings.length > 0) {
        return NextResponse.json({ ok: false, needs_confirm: true, warnings });
      }
    }

    // Optional file upload to the PRIVATE bucket. Upload failure degrades to
    // a fileless row (notes/save precedent) -- never lose the expense over
    // a storage hiccup.
    let receiptPath: string | null = null;
    let uploadWarning: string | null = null;
    const file = formData.get('file');
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: 'Receipt file is over 25MB' }, { status: 400 });
      }
      const contentType = file.type || 'application/octet-stream';
      if (!ALLOWED_TYPES.has(contentType)) {
        return NextResponse.json(
          { error: `Unsupported file type '${contentType}'. Use a JPEG/PNG/WebP/HEIC photo or a PDF.` },
          { status: 400 },
        );
      }
      const safeName = sanitizeFilename(file.name || 'receipt');
      const path = `${propertyId}/${month}/${Date.now()}-${safeName}`;
      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType, upsert: false });
      if (uploadErr) {
        console.warn('receipt upload failed, saving fileless row:', uploadErr.message);
        uploadWarning = 'The photo upload failed; the expense was saved without it.';
      } else {
        receiptPath = path;
      }
    }

    const { data: receipt, error: insertErr } = await supabase
      .from('property_receipts')
      .insert({
        property_id: propertyId,
        month,
        expense_date: expenseDate,
        vendor_name: vendorName,
        description,
        category,
        amount,
        receipt_path: receiptPath,
        status: 'active',
        created_by: session.user.email,
      })
      .select()
      .single();
    if (insertErr) {
      if (isMissingSchemaError(insertErr)) {
        return NextResponse.json(
          { error: 'property_receipts table is missing. Apply supabase/migrations/20260707_property_receipts.sql first.' },
          { status: 500 },
        );
      }
      throw insertErr;
    }

    // Mid-month recompute: only when a statement already exists. Otherwise
    // the receipt just waits for the next ingest to fold it in.
    let repairsTotal: number | null = null;
    let ownerPayout: number | null = null;
    if (stmt) {
      // Mirror row for the dashboard's line-item display. Best-effort:
      // repairs_total is the money truth, the mirror is display/audit.
      const { error: mirrorErr } = await supabase
        .from('repair_events')
        .insert({
          property_statement_id: stmt.id,
          vendor_name: vendorName,
          description,
          bank_charge_date: expenseDate,
          bank_charge_amount: amount,
          source: 'receipt',
          receipt_id: receipt.id,
        });
      if (mirrorErr && !isMissingSchemaError(mirrorErr)) throw mirrorErr;
      if (mirrorErr) console.warn('receipt mirror repair_events insert skipped:', mirrorErr.message);

      // DELTA off the stored column -- never SUM(repair_events); see header.
      repairsTotal = round2((Number(stmt.repairs_total) || 0) + amount);
      ownerPayout = recomputePayout(stmt, repairsTotal);
      const { error: updErr } = await supabase
        .from('property_statements')
        .update({ repairs_total: repairsTotal, owner_payout: ownerPayout })
        .eq('id', stmt.id);
      if (updErr) throw updErr;
    }

    return NextResponse.json({
      ok: true,
      receipt,
      repairs_total: repairsTotal,
      owner_payout: ownerPayout,
      statement_found: !!stmt,
      upload_warning: uploadWarning,
    });
  } catch (err) {
    console.error('receipts POST error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const propertyId = (request.nextUrl.searchParams.get('property_id') || '').trim();
  const month = (request.nextUrl.searchParams.get('month') || '').trim();
  if (!propertyId) return NextResponse.json({ error: 'property_id required' }, { status: 400 });

  const supabase = getSupabase();
  let query = supabase
    .from('property_receipts')
    .select('*')
    .eq('property_id', propertyId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (month) query = query.eq('month', month);
  const { data, error } = await query;
  if (error) {
    if (isMissingSchemaError(error)) return NextResponse.json({ receipts: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ receipts: data || [] });
}
