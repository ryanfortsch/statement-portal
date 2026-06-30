import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { runReconcile } from '@/lib/quo-reconcile';

export const runtime = 'nodejs';
export const maxDuration = 120;

async function handle(request: Request) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  try {
    const result = await runReconcile();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[sync-quo-contacts]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
