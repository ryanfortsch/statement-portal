import { auth } from '@/auth';
import { stagingBoardEnabled } from '@/lib/channex-staging/board';
import { createClosureStore } from '@/lib/channex-staging/closure-store';
import { runClosure } from '@/lib/channex-staging/closure-worker';
import { ChannexStagingClient } from '@/lib/channex-staging/client';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store' };
async function allowed() {
  const session = await auth();
  return session?.user?.email?.endsWith('@risingtidestr.com') && stagingBoardEnabled(process.env)
    && process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'codex/channex-staging-pilot';
}
function store() {
  if (process.env.CHANNEX_STAGING_DB_PROJECT_REF !== 'jgkblfozftcvymvwhhii') throw new Error('Wrong staging project');
  return createClosureStore(process.env.CHANNEX_STAGING_DB_URL ?? '', process.env.CHANNEX_STAGING_DB_SERVICE_KEY ?? '', 'jgkblfozftcvymvwhhii');
}
export async function GET() {
  if (!await allowed()) return Response.json({ error: 'unavailable' }, { status: 403, headers });
  try { const db = store(); return Response.json({ history: await db.history() }, { headers }); }
  catch { return Response.json({ error: 'Storage unavailable' }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  if (!await allowed()) return Response.json({ error: 'unavailable' }, { status: 403, headers });
  if (!process.env.AUTH_URL || request.headers.get('origin') !== new URL(process.env.AUTH_URL).origin) return Response.json({ error: 'origin' }, { status: 403, headers });
  try {
    const body = await request.json();
    if (body.action !== 'run' && body.action !== 'reconcile') return Response.json({ error: 'Invalid action' }, { status: 400, headers });
    const db = store();
    if (body.action === 'run') await db.initialize();
    const result = await runClosure(db, new ChannexStagingClient(process.env.CHANNEX_STAGING_API_KEY ?? ''), body.action === 'reconcile');
    return Response.json({ result, history: await db.history() }, { headers });
  } catch { return Response.json({ error: 'Operation not confirmed. Read history and reconcile before retrying.' }, { status: 503, headers }); }
}
