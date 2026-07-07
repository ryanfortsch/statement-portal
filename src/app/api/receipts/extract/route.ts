import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { extractReceipt, type ReceiptExtract } from '@/lib/ai/receipt-extract';

/**
 * POST /api/receipts/extract -- AI prefill for the receipt capture form.
 * multipart/form-data: file (receipt photo).
 *
 * ZERO WRITES. This route only reads the image and returns suggested
 * fields; the operator edits + explicitly Confirms before POST /api/receipts
 * commits anything (the QuickCapture propose-review-apply convention).
 *
 * GRACEFUL-DEGRADE CONTRACT: returns 200 { ok:false, extracted:null,
 * reason } on ANY failure -- missing AI_GATEWAY_API_KEY (local dev; the key
 * lives only in Vercel), gateway/billing errors, an unreadable image, a
 * HEIC the model rejects, or PDF input (v1 skips PDF vision; PDFs go
 * straight to manual entry). The client falls back to blank manual fields;
 * the operator never sees a hard error here.
 */

export const maxDuration = 60;

const MAX_FILE_BYTES = 25 * 1024 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ ok: false, extracted: null, reason: 'no_file' });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ ok: false, extracted: null, reason: 'file_too_large' });
    }
    const mime = file.type || '';
    if (mime === 'application/pdf') {
      // v1 skips PDF vision -- the image content part wants an image.
      return NextResponse.json({ ok: false, extracted: null, reason: 'pdf_not_supported' });
    }
    if (!mime.startsWith('image/')) {
      return NextResponse.json({ ok: false, extracted: null, reason: 'not_an_image' });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;

    let extracted: ReceiptExtract;
    try {
      extracted = await extractReceipt(dataUrl);
    } catch (err) {
      // Missing gateway key locally, billing/quota, model reject (HEIC),
      // transport -- all the same to the operator: type it in manually.
      console.warn('receipt extract failed:', err instanceof Error ? err.message : err);
      return NextResponse.json({ ok: false, extracted: null, reason: describeExtractFailure(err) });
    }

    const allNull = !extracted.vendor && extracted.amount == null && !extracted.expense_date && !extracted.note;
    if (allNull) {
      return NextResponse.json({ ok: false, extracted: null, reason: 'unreadable' });
    }
    return NextResponse.json({ ok: true, extracted });
  } catch (err) {
    console.warn('receipt extract route error:', err);
    return NextResponse.json({ ok: false, extracted: null, reason: 'error' });
  }
}

/**
 * Classify the failure for the client's quiet fallback note. The gateway
 * billing shape mirrors /api/ask's detectBillingError: statusCode 402/403
 * with a free-tier / credits message.
 */
function describeExtractFailure(err: unknown): string {
  if (!(err instanceof Error)) return 'error';
  const status = (err as unknown as { statusCode?: number }).statusCode;
  const msg = err.message || '';
  if ((status === 402 || status === 403) && /free tier|credits|upgrade|payment|quota/i.test(msg)) {
    return 'gateway_billing';
  }
  if (/api key|AI_LoadAPIKeyError|AI_GATEWAY_API_KEY/i.test(`${err.name} ${msg}`)) {
    return 'no_gateway_key';
  }
  return 'error';
}
