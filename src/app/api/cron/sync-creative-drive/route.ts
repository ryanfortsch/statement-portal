import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { syncCreativeDrive } from '@/lib/creative-drive';

/**
 * Drive delivery watcher, every 2 hours.
 *
 * POST or GET /api/cron/sync-creative-drive
 *
 * Scans each open creative shoot's Drive folder ("Creative Assets - <name>" /
 * per-shoot subfolder), mirrors the files into creative_drive_files, and
 * auto-logs/links creative_assets — so the delivery base shows up as due on
 * /fieldwork/shoots the moment a contributor uploads, with no one checking
 * the folder by hand. Never pays anything; paying stays a click on the board.
 */
async function handle(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;
  try {
    const report = await syncCreativeDrive();
    return NextResponse.json(report, { status: report.ok ? 200 : 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/sync-creative-drive] failed:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
