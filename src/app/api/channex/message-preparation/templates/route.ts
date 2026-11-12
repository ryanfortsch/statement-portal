import { NextResponse } from 'next/server';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { ownerTemplateWorkflow } from '@/lib/channex-messaging/template-workflow.server';
import { templateWorkflowRequestSchema } from '@/lib/channex-messaging/template-workflow-contract';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function POST(request: Request) {
  try { await requireOwnerEmail(); } catch { return json({ error: 'Owners only' }, 403); }
  if (request.headers.get('origin') !== new URL(request.url).origin
    || request.headers.get('content-type') !== 'application/json') return json({ error: 'Invalid request' }, 403);
  let body;
  try {
    const reader = request.body?.getReader(); if (!reader) throw Error();
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const r = await reader.read(); if (r.done) break;
      if ((size += r.value.byteLength) > 600) throw Error(); chunks.push(r.value); }
    } finally { await reader.cancel(); reader.releaseLock(); }
    body = templateWorkflowRequestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
  } catch { return json({ error: 'Invalid request' }, 400); }
  try { return json(await ownerTemplateWorkflow(body)); }
  catch { return json({ state: 'unavailable', canSend: false }, 503); }
}
