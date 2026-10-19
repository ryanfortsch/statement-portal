import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { runReconcile } from '@/lib/quo-reconcile';
import { attachKnownNumbers } from '@/lib/known-numbers-sweep';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function handle(request: Request) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  try {
    const result = await runReconcile();
    // Then file the waiting numbers Helm can now name onto their contacts,
    // reading tonight's address book (src/lib/known-numbers-sweep.ts).
    const known = await attachKnownNumbers();
    return NextResponse.json({ ok: true, ...result, known });
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
