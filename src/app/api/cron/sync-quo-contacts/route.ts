import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { POST as syncPost } from '../../sync-quo-contacts/route';

export const runtime = 'nodejs';
export const maxDuration = 120;

async function handle(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  try {
    return await syncPost(request);
  } catch (err) {
    console.error('[cron/sync-quo-contacts]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
