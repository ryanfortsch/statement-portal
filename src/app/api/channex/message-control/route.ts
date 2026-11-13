import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { readMessageControl, changeMessageControl } from '@/lib/channex-messaging/message-control.server';
import { messageControlRequest } from '@/lib/channex-messaging/message-control';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(request: Request) {
  try { await requireOwnerEmail(); } catch { return json({ error: 'Owners only' }, 403); }
  const query = new URL(request.url).searchParams;
  const parsed = z.uuid().safeParse(query.get('sendId'));
  if (!parsed.success || [...query.keys()].length !== 1) return json({ error: 'Invalid request' }, 400);
  try { return json({ control: await readMessageControl(parsed.data) }); }
  catch { return json({ error: 'Hold status unavailable' }, 503); }
}
export async function POST(request: Request) {
  try { await requireOwnerEmail(); } catch { return json({ error: 'Owners only' }, 403); }
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('content-type') !== 'application/json') return json({ error: 'Invalid request' }, 403);
  let body;
  try {
    const reader = request.body?.getReader(); if (!reader) throw Error();
    const chunks: Uint8Array[] = []; let bytes = 0;
    try { for (;;) { const r = await reader.read(); if (r.done) break;
      if ((bytes += r.value.byteLength) > 512) throw Error(); chunks.push(r.value); } }
    finally { await reader.cancel(); reader.releaseLock(); }
    body = messageControlRequest.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
  } catch { return json({ error: 'Invalid request' }, 400); }
  try { return json(await changeMessageControl(body)); }
  catch { return json({ error: 'Hold outcome uncertain. Refresh its status before another decision.' }, 503); }
}
