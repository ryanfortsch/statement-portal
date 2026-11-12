import { NextResponse } from 'next/server';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { loadTimingReviewOverview, saveTimingReview } from '@/lib/channex-messaging/timing-review.server';
import { timingReviewRequestSchema } from '@/lib/channex-messaging/timing-review-contract';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
export async function GET() {
  try { await requireOwnerEmail(); } catch { return json({ error: 'Owners only' }, 403); }
  try { return json(await loadTimingReviewOverview()); }
  catch { return json({ error: 'Timing review unavailable' }, 503); }
}
export async function POST(request: Request) {
  try { await requireOwnerEmail(); } catch { return json({ error: 'Owners only' }, 403); }
  if (request.headers.get('origin') !== new URL(request.url).origin
    || request.headers.get('content-type') !== 'application/json') return json({ error: 'Invalid request' }, 403);
  let body;
  try {
    const reader = request.body?.getReader(); if (!reader) throw Error();
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const r = await reader.read(); if (r.done) break;
      if ((size += r.value.byteLength) > 300) throw Error(); chunks.push(r.value); }
    } finally { await reader.cancel(); reader.releaseLock(); }
    body = timingReviewRequestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
  } catch { return json({ error: 'Invalid request' }, 400); }
  try { return json(await saveTimingReview(body)); }
  catch { return json({ state: 'uncertain', bindingId: body.bindingId, jobsCreated: 0, messagesSent: 0, canSend: false }, 503); }
}
