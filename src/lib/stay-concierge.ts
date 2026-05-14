/**
 * Typed client for the Stay Concierge HTTP JSON API.
 *
 * The guest messaging service lives outside Helm. It's a FastAPI process on
 * a Mac Mini behind a Cloudflare Tunnel (see /Users/maguire/Developer/stay-
 * concierge). Helm calls it server-side from /messaging to drive the same
 * approve / reject / coach surface the SMS handler uses.
 *
 * Env:
 *   STAY_CONCIERGE_URL  Base URL of the service (e.g. https://conciergestaycollections.com)
 *   STAY_CONCIERGE_KEY  Same secret as the FastAPI DASHBOARD_KEY env var
 *
 * If either is unset, the lib returns an `unconfigured` error and callers
 * should render a setup hint instead of crashing the page.
 */
export type Approval = {
  id: string;
  short_id: string;
  conversation_id: string;
  guesty_message_id: string;
  listing_id: string;
  listing_name: string;
  guest_first: string;
  reservation_id: string;
  guest_text: string;
  draft: string;
  topic: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  age_minutes: number | null;
  module: string;
};

export type ApprovalsResponse = {
  approvals: Approval[];
  count: number;
};

export type MessagingStats = {
  window_hours: number;
  as_of: string;
  one_shot_rate: number | null;
  first_pass_clean: number;
  approved_after_coaching: number;
  approved_total: number;
  rejected: number;
  manual_sent: number;
  superseded_total: number;
  auto_rejected_stale: number;
  pending_in_window: number;
  pending_now: number;
  drafted: number;
  escalated: number;
  auto_sent: number;
  no_reply_needed: number;
  tier_breakdown: { '1': number; '2': number; '3': number };
  learning: {
    qa_pairs_total: number;
    qa_pairs_in_window: number;
    qa_latest_captured_at: string | null;
    qa_latest_property: string | null;
  };
  coaching: {
    coaching_notes_total: number;
    coaching_notes_in_window: number | null;
  };
};

export type StayConciergeError =
  | { kind: 'unconfigured' }
  | { kind: 'http'; status: number; detail: string }
  | { kind: 'network'; message: string };

function readEnv(): { url: string; key: string } | null {
  const url = (process.env.STAY_CONCIERGE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.STAY_CONCIERGE_KEY || '').trim();
  if (!url || !key) return null;
  return { url, key };
}

export function isStayConciergeConfigured(): boolean {
  return readEnv() !== null;
}

async function request<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' },
): Promise<{ ok: true; data: T } | { ok: false; error: StayConciergeError }> {
  const env = readEnv();
  if (!env) return { ok: false, error: { kind: 'unconfigured' } };

  const url = `${env.url}${path}`;
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: {
        'X-Dashboard-Key': env.key,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
    if (!res.ok) {
      let detail = '';
      try {
        const j = (await res.json()) as { detail?: string };
        detail = j?.detail || '';
      } catch {
        detail = await res.text().catch(() => '');
      }
      return { ok: false, error: { kind: 'http', status: res.status, detail: detail || res.statusText } };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'fetch failed';
    return { ok: false, error: { kind: 'network', message } };
  }
}

export async function listApprovals() {
  return request<ApprovalsResponse>('/api/approvals');
}

export async function listRecentApprovals(hours = 24) {
  return request<ApprovalsResponse>(`/api/approvals/recent?hours=${hours}`);
}

export async function approveApproval(id: string) {
  return request<{ status: string; id: string }>(`/api/approvals/${id}/approve`, { method: 'POST' });
}

export async function rejectApproval(id: string) {
  return request<{ status: string; id: string }>(`/api/approvals/${id}/reject`, { method: 'POST' });
}

export async function markHandledApproval(id: string) {
  return request<{ status: string; id: string }>(`/api/approvals/${id}/mark_handled`, { method: 'POST' });
}

export async function getStats(hours: number) {
  return request<MessagingStats>(`/api/stats?hours=${hours}`);
}

export type LearningEntry = {
  heading: string;
  date: string;
  title: string;
  body: string;
};

export type LearningsResponse = {
  learnings: LearningEntry[];
  count: number;
};

export async function getLearnings(limit = 12) {
  return request<LearningsResponse>(`/api/learnings?limit=${limit}`);
}

export async function coachApproval(id: string, feedback: string) {
  return request<{ status: string; id: string }>(`/api/approvals/${id}/coach`, {
    method: 'POST',
    body: { feedback },
  });
}

export function explainError(error: StayConciergeError): string {
  if (error.kind === 'unconfigured') {
    return 'Stay Concierge service is not configured. Set STAY_CONCIERGE_URL and STAY_CONCIERGE_KEY in the environment.';
  }
  if (error.kind === 'network') return `Network error: ${error.message}`;
  if (error.status === 401) return 'Stay Concierge rejected the dashboard key.';
  if (error.status === 404) return 'That approval no longer exists.';
  if (error.status === 409) return `That approval is no longer pending (${error.detail}).`;
  if (error.status === 503) return 'Guesty is in OAuth cooldown. Try again in a minute.';
  if (error.status === 502) return 'Guesty refused the send. The draft is still pending.';
  return `Service error (${error.status}): ${error.detail}`;
}
