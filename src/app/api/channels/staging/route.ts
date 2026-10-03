import { auth } from '@/auth';
import { stagingBoardEnabled } from '@/lib/channex-staging/board';
import { loadStagingBoard } from '@/lib/channex-staging/board.server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function GET() {
  const session = await auth();
  if (!session?.user?.email?.endsWith('@risingtidestr.com')) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  if (!stagingBoardEnabled(process.env)) return Response.json({ error: 'staging_disabled' }, { status: 404, headers });
  try { return Response.json(await loadStagingBoard(), { headers }); }
  catch { return Response.json({ error: 'staging_unavailable' }, { status: 503, headers }); }
}
