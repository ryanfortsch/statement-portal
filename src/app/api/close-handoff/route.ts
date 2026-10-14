import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isDay, isHandoffKind, isMonth, kindMeta } from '@/lib/close-handoff';
import {
  HANDOFF_ALLOWED_TYPES,
  HANDOFF_MAX_FILE_BYTES,
  insertHandoffItem,
  loadHandoffItems,
  markHandoffMonthSent,
  propertyExists,
  uploadHandoffFile,
} from '@/lib/close-handoff-db';

/**
 * The month-close handoff, for anyone signed in (staff included: this is
 * the operations manager's page). Nothing here writes a statement.
 *
 * GET  /api/close-handoff?month=YYYY-MM[&property_id=]  -> { items }
 * POST /api/close-handoff  (multipart)
 *      property_id, month, kind (repair|card_charge|cleaning_issue),
 *      description, vendor?, amount? (required for the money kinds),
 *      charge_date? (YYYY-MM-DD), file? (photo or PDF, 25MB)
 *      -> { ok, item, upload_warning }
 * PATCH /api/close-handoff  { month }  -> marks every open item sent
 *      -> { ok, sent }
 *
 * Owner-only moves (file, dismiss) live on /api/close-handoff/[id].
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const month = (request.nextUrl.searchParams.get('month') || '').trim();
  const propertyId = (request.nextUrl.searchParams.get('property_id') || '').trim() || undefined;
  if (!isMonth(month)) return NextResponse.json({ error: 'month required (YYYY-MM)' }, { status: 400 });
  try {
    const items = await loadHandoffItems({ months: [month], propertyId });
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const form = await request.formData();
    const propertyId = String(form.get('property_id') || '').trim();
    const month = String(form.get('month') || '').trim();
    const kindRaw = String(form.get('kind') || '').trim();
    const description = String(form.get('description') || '').trim().slice(0, 300);
    const vendor = String(form.get('vendor') || '').trim().slice(0, 120) || null;
    const amountRaw = String(form.get('amount') || '').trim();
    const chargeDateRaw = String(form.get('charge_date') || '').trim();

    if (!isMonth(month)) return NextResponse.json({ error: "month must be 'YYYY-MM'" }, { status: 400 });
    if (!isHandoffKind(kindRaw)) return NextResponse.json({ error: 'kind must be repair, card_charge or cleaning_issue' }, { status: 400 });
    if (!description) return NextResponse.json({ error: 'Say what it was' }, { status: 400 });
    if (!propertyId || !(await propertyExists(propertyId))) {
      return NextResponse.json({ error: `Unknown property: ${propertyId || '(none)'}` }, { status: 400 });
    }
    const meta = kindMeta(kindRaw);
    let amount: number | null = null;
    if (amountRaw) {
      amount = round2(Number(amountRaw));
      if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
    } else if (meta.money) {
      return NextResponse.json({ error: `Enter the amount for a ${meta.label.toLowerCase()}` }, { status: 400 });
    }
    let chargeDate: string | null = null;
    if (chargeDateRaw) {
      if (!isDay(chargeDateRaw)) return NextResponse.json({ error: "charge_date must be 'YYYY-MM-DD'" }, { status: 400 });
      chargeDate = chargeDateRaw;
    }

    let filePath: string | null = null;
    let uploadWarning: string | null = null;
    const file = form.get('file');
    if (file instanceof File && file.size > 0) {
      if (file.size > HANDOFF_MAX_FILE_BYTES) return NextResponse.json({ error: 'The file is over 25MB' }, { status: 400 });
      const contentType = file.type || 'application/octet-stream';
      if (!HANDOFF_ALLOWED_TYPES.has(contentType)) {
        return NextResponse.json({ error: `Unsupported file type '${contentType}'. Use a JPEG, PNG, WebP or HEIC photo, or a PDF.` }, { status: 400 });
      }
      const up = await uploadHandoffFile(file, month, propertyId);
      filePath = up.path;
      uploadWarning = up.warning;
    }

    const item = await insertHandoffItem({
      month,
      property_id: propertyId,
      kind: kindRaw,
      description,
      vendor,
      amount,
      charge_date: chargeDate,
      file_path: filePath,
      created_by: email,
    });
    return NextResponse.json({ ok: true, item, upload_warning: uploadWarning });
  } catch (err) {
    console.error('close-handoff POST error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const month = String(body.month || '').trim();
  if (!isMonth(month)) return NextResponse.json({ error: 'month required (YYYY-MM)' }, { status: 400 });
  try {
    const sent = await markHandoffMonthSent(month);
    return NextResponse.json({ ok: true, sent });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
