import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { listHelmConversations, type HelmConversationSummary } from '@/lib/helm-inbox';

/**
 * GET /api/pms/threads?since=ISO&status=open
 *
 * The concierge reads Helm-native guest threads (guest_threads) to draft
 * on. Rows are the ConversationSummary wire shape /messaging already
 * renders, plus the rail Helm can answer on and the OTA deep link that
 * stands in for a send when there is none.
 *
 *   -> {threads:[ConversationSummary + {channel, rail:'sms'|'email'|'ota_manual'|'',
 *                external_thread_url, thread_status}], count}
 *
 * `since` bounds the lookback (default 60 days, at most 400); `status`
 * filters on the thread's operator state (open | snoozed | done).
 * Auth: x-stay-concierge-key header only.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type BridgeRail = 'sms' | 'email' | 'ota_manual' | '';

function railOf(row: Pick<HelmConversationSummary, 'module' | 'channel' | 'external_thread_url'>): BridgeRail {
  if (row.module) return 'sms';
  if (row.channel === 'Email') return 'email';
  if (row.external_thread_url) return 'ota_manual';
  return '';
}

function daysSince(since: string | null): number {
  if (!since) return 60;
  const t = Date.parse(since);
  if (!Number.isFinite(t)) return 60;
  const days = Math.ceil((Date.now() - t) / 86_400_000);
  return Math.min(400, Math.max(1, days));
}

export async function GET(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const since = url.searchParams.get('since');
  const status = (url.searchParams.get('status') ?? '').trim();
  const sinceMs = since ? Date.parse(since) : NaN;

  try {
    let rows = await listHelmConversations(daysSince(since));
    if (status) rows = rows.filter((r) => r.thread_status === status);
    if (Number.isFinite(sinceMs)) {
      rows = rows.filter((r) => {
        const t = Date.parse(r.last_activity_at || '');
        return !Number.isFinite(t) || t >= sinceMs;
      });
    }
    const threads = rows.map((r) => ({ ...r, rail: railOf(r) }));
    return NextResponse.json({ ok: true, threads, count: threads.length });
  } catch (err) {
    console.error('[pms/threads] GET failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
