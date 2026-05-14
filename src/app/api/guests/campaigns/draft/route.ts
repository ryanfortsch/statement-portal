/**
 * Thin HTTP wrapper around draftCampaign() for external callers (a
 * future chat panel, programmatic clients, etc.). The new-campaign
 * server action calls the underlying function directly, no self-fetch.
 *
 * POST { brief, tone, segment_id? } -> { ok, draft: { subject, preheader, body, rationale } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { draftCampaign } from '@/lib/ai/draft-campaign';

export const runtime = 'nodejs';
export const maxDuration = 60;

const RequestBody = z.object({
  brief: z.string().min(3).max(2000),
  tone: z.enum(['editorial', 'insider', 'warm']),
  segment_id: z.string().nullish(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let parsed: z.infer<typeof RequestBody>;
  try {
    parsed = RequestBody.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_body', detail: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  try {
    const draft = await draftCampaign({
      brief: parsed.brief,
      tone: parsed.tone,
      segmentId: parsed.segment_id ?? null,
    });
    return NextResponse.json({ ok: true, draft });
  } catch (err) {
    console.error('[guests/campaigns/draft] generation failed', err);
    return NextResponse.json(
      { error: 'generation_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
