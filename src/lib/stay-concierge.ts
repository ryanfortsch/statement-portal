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
  /** When the guest actually sent the message (from messages_log.created_at).
   * Distinct from created_at, which is when the AI drafted/regenerated. */
  guest_received_at: string | null;
  age_minutes: number | null;
  module: string;
  /** Human channel label derived from module: "Airbnb", "VRBO",
   * "Booking.com", "Email", "Direct". Empty when unknown. */
  channel: string;
  /** Stay dates (YYYY-MM-DD) for the reservation this conversation belongs
   * to. Empty when not resolvable. */
  check_in: string;
  check_out: string;
  /** UTC ISO fire time when status==='scheduled' (a queued delayed send).
   * Empty for a normal pending draft. */
  send_at: string;
  /** Mined add-on charge (Tesla charger, pet fee, early check-in fee) with
   * its Stripe payment link. Null/absent for ordinary cards. */
  addon?: AddonCharge | null;
};

/** An add-on fee the AI detected in the conversation, with the Stripe
 * Payment Link Helm minted in the property's own account. On approve, the
 * in-platform reply sends as usual AND (when a phone + link exist and the
 * operator leaves the box ticked) the sms_body texts the guest via Quo —
 * OTA platforms block links in-thread, so the link always travels by SMS. */
export type AddonCharge = {
  label: string;
  amount_usd: number;
  /** Empty when link creation failed; see link_error. */
  payment_link_url: string;
  /** '' | 'no_key' | 'stripe_permission' | 'stripe_error' | 'amount_out_of_range' */
  link_error: string;
  /** The exact SMS that will send on approve (already contains the link). */
  sms_body: string;
  /** Guest's phone in E.164, '' when none on file (SMS impossible). */
  guest_phone: string;
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

// A hung Cloudflare tunnel (sleepy Mac Mini) used to stall a render for the
// platform's full function timeout with no signal. Bound every call: 13s is
// well past a warm round-trip but short of the multi-second "is it frozen?"
// tail the messaging page was showing on mobile.
const STAY_CONCIERGE_TIMEOUT_MS = 13_000;
// Interactive LLM generations (polish, coach/regenerate, audit refresh) are an
// operator actively waiting on a model write that can run well past 13s on a
// cold upstream. Give those a roomier ceiling than the render-path fetches.
const STAY_CONCIERGE_LLM_TIMEOUT_MS = 60_000;

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
  init: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; timeoutMs?: number } = {
    method: 'GET',
  },
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
      signal: AbortSignal.timeout(init.timeoutMs ?? STAY_CONCIERGE_TIMEOUT_MS),
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
    // AbortSignal.timeout() rejects with a TimeoutError (a DOMException); map
    // it to a legible message. Everything else keeps its own error text.
    const message =
      e instanceof Error
        ? e.name === 'TimeoutError'
          ? 'Stay Concierge timed out'
          : e.message
        : 'fetch failed';
    return { ok: false, error: { kind: 'network', message } };
  }
}

// --- Fact-base weekly health audit --------------------------------------

/** Weekly recursive-learning health report shown on /messaging. Report-only:
 * surfaces duplicates / contradictions / sprawl the inline guard missed, plus
 * the coaching-load trend, so the loop can be kept honest from the dashboard
 * instead of a text. */
export type FactAudit = {
  as_of: string;
  markdown: string;
  action_items: string[];
  healthy: boolean;
  stale: boolean;
};

export async function getFactAudit() {
  return request<FactAudit>('/api/fact-audit');
}

export async function refreshFactAudit() {
  return request<FactAudit>('/api/fact-audit/refresh', {
    method: 'POST',
    timeoutMs: STAY_CONCIERGE_LLM_TIMEOUT_MS,
  });
}

// --- Proactive: reservations picker + recurring reminders ----------------

export type ReservationPick = {
  reservation_id: string;
  conversation_id: string;
  listing_id: string;
  property_name: string;
  guest_full: string;
  guest_first: string;
  check_in: string;
  check_out: string;
  /** True when the guest is currently in-house (checked in on/before today and
   * not yet checked out). The picker lists these first. */
  in_house: boolean;
  /** Earliest date this guest can be scheduled from: today if they're already
   * here (check-in in the past), otherwise their check-in. */
  effective_start: string;
  module: string;
  channel: string;
};

export type RecurringMessage = {
  id: string;
  label: string;
  conversation_id: string;
  listing_id: string;
  module: string;
  channel: string;
  guest_first: string;
  body: string;
  kind: string;
  weekdays: string;
  fire_date: string;
  at_local: string;
  start_date: string;
  end_date: string;
  send_mode: string;
  status: string;
  last_sent_date: string;
  /** Who this proactive message targets: 'guest' (default) | 'cleaner' |
   * 'owner'. Absent on older guest rows. */
  audience?: string;
  /** For cleaner/owner rows: the E.164 phone the message goes to. */
  target_contact?: string;
  /** For cleaner/owner rows: the recipient's display name. */
  target_name?: string;
};

/** A person the operator can send a proactive (self-initiated) message to.
 * Cleaner targets are the cleaner managers (Rosa/Nina, language 'pt'); owner
 * targets are phone-reachable owners (property fields populated for owners,
 * empty for cleaners). */
export type ProactiveTarget = {
  /** E.164 phone the message goes to. */
  contact: string;
  name: string;
  /** Delivery channel; currently always 'sms_quo'. */
  channel: string;
  /** Populated for owner targets; empty for cleaner managers. */
  property_id: string;
  property_name: string;
  /** Language the recipient reads ('pt' for the cleaner managers). */
  language: string;
};

export async function listProactiveTargets(audience: 'cleaner' | 'owner' | 'contractor') {
  return request<{ targets: ProactiveTarget[]; count: number }>(
    `/api/proactive-targets?audience=${audience}`,
  );
}

export async function listReservationsForPicker() {
  return request<{ reservations: ReservationPick[]; count: number }>(
    '/api/reservations?days=60',
  );
}

/** Without `audience`, returns guest rows only (the existing guest panel is
 * untouched). With it, rows filtered to that audience. */
export async function listRecurring(audience?: 'cleaner' | 'owner' | 'contractor') {
  const q = audience ? `?audience=${audience}` : '';
  return request<{ recurring: RecurringMessage[]; count: number }>(`/api/recurring${q}`);
}

export type CreateRecurringInput = {
  label: string;
  conversation_id: string;
  listing_id: string;
  module: string;
  guest_first: string;
  body: string;
  /** 'recurring' (weekday cadence) or 'once' (single fire_date). */
  kind: string;
  weekdays: string;
  fire_date: string;
  at_local: string;
  start_date: string;
  end_date: string;
  send_mode: string;
  /** 'guest' (default when omitted) | 'cleaner' | 'owner'. For cleaner/owner:
   * conversation_id/listing_id are '', module is 'sms_quo', and
   * target_contact is required. */
  audience?: string;
  target_contact?: string;
  target_name?: string;
};

export async function createRecurring(input: CreateRecurringInput) {
  return request<{ ok: true; id: string }>('/api/recurring', {
    method: 'POST',
    body: input,
  });
}

export async function polishProactive(reservationId: string, roughText: string) {
  return request<{ polished: string; guest_first: string }>(
    '/api/proactive/polish',
    {
      method: 'POST',
      body: { reservation_id: reservationId, rough_text: roughText },
      timeoutMs: STAY_CONCIERGE_LLM_TIMEOUT_MS,
    },
  );
}

/** Polish a rough proactive note for a cleaner or owner. For 'cleaner' the
 * response `polished` is Portuguese (what sends) and `english` carries the EN
 * translation for the operator; for 'owner' `english` is ''. */
export async function polishProactiveFor(
  audience: 'cleaner' | 'owner' | 'contractor',
  targetName: string,
  roughText: string,
) {
  return request<{ polished: string; english: string; guest_first: string }>(
    '/api/proactive/polish',
    {
      method: 'POST',
      body: { audience, target_name: targetName, rough_text: roughText, reservation_id: '' },
      timeoutMs: STAY_CONCIERGE_LLM_TIMEOUT_MS,
    },
  );
}

export async function endRecurring(id: string) {
  return request<{ ok: true }>(`/api/recurring/${encodeURIComponent(id)}/end`, {
    method: 'POST',
  });
}

export async function listApprovals() {
  return request<ApprovalsResponse>('/api/approvals');
}

export async function listRecentApprovals(hours = 24) {
  return request<ApprovalsResponse>(`/api/approvals/recent?hours=${hours}`);
}

export async function approveApproval(id: string, opts?: { sendAddonSms?: boolean }) {
  return request<{ status: string; id: string }>(`/api/approvals/${id}/approve`, {
    method: 'POST',
    // Only travels when the card carries an addon; JSON.stringify drops the
    // undefined so ordinary approvals keep their empty-body shape.
    body:
      opts && opts.sendAddonSms !== undefined
        ? JSON.stringify({ send_addon_sms: opts.sendAddonSms })
        : undefined,
  });
}

export async function rejectApproval(id: string) {
  return request<{ status: string; id: string }>(`/api/approvals/${id}/reject`, { method: 'POST' });
}

export async function markHandledApproval(id: string) {
  return request<{ status: string; id: string }>(`/api/approvals/${id}/mark_handled`, { method: 'POST' });
}

/** Queue an approved draft to send later. sendAtUtc is a UTC ISO string. */
export async function scheduleApproval(id: string, sendAtUtc: string) {
  return request<{ status: string; id: string; send_at: string }>(
    `/api/approvals/${id}/schedule`,
    { method: 'POST', body: { send_at: sendAtUtc } },
  );
}

/** Unschedule a queued send, returning it to the pending queue. */
export async function cancelScheduleApproval(id: string) {
  return request<{ status: string; id: string }>(
    `/api/approvals/${id}/cancel_schedule`,
    { method: 'POST' },
  );
}

/** Replace the draft text directly (operator edit, distinct from coaching). */
export async function editApproval(id: string, text: string) {
  return request<{ status: string; id: string; draft: string }>(
    `/api/approvals/${id}/draft`,
    { method: 'PUT', body: { text } },
  );
}

// ── Owner-messaging surface (mirrors the guest one) ──────────────────────

export type OwnerApproval = {
  id: string;
  short_id: string;
  channel: string;            // 'sms_quo' | 'email_gmail'
  owner_contact: string;      // E.164 phone or email
  owner_name: string;
  property_id: string;
  property_name: string;
  external_thread_id: string;
  external_message_id: string;
  owner_text: string;
  draft: string;
  topic: string;
  status: string;
  final_response: string;
  created_at: string;
  resolved_at: string | null;
  age_minutes: number | null;
};

export type OwnerApprovalsResponse = {
  approvals: OwnerApproval[];
  count: number;
};

export async function listOwnerApprovals() {
  return request<OwnerApprovalsResponse>('/api/owner-approvals');
}

export async function listRecentOwnerApprovals(hours = 24) {
  return request<OwnerApprovalsResponse>(`/api/owner-approvals/recent?hours=${hours}`);
}

export async function approveOwnerApproval(id: string, finalText?: string) {
  return request<{ status: string; id: string }>(`/api/owner-approvals/${id}/approve`, {
    method: 'POST',
    ...(finalText !== undefined ? { body: { final_text: finalText } } : {}),
  });
}

export async function rejectOwnerApproval(id: string) {
  return request<{ status: string; id: string }>(`/api/owner-approvals/${id}/reject`, { method: 'POST' });
}

export async function markHandledOwnerApproval(id: string) {
  return request<{ status: string; id: string }>(`/api/owner-approvals/${id}/mark_handled`, { method: 'POST' });
}

export async function coachOwnerApproval(id: string, feedback: string, base?: string) {
  return request<{ status: string; id: string }>(`/api/owner-approvals/${id}/coach`, {
    method: 'POST',
    body: { feedback, ...(base !== undefined ? { base } : {}) },
    timeoutMs: STAY_CONCIERGE_LLM_TIMEOUT_MS,
  });
}

export type OwnerHistoryEvent = {
  kind: 'inbound' | 'sent' | 'sent_outside' | 'draft_skipped' | 'escalated' | string;
  at: string;
  channel: string;
  text: string;
  topic?: string;
  approval_id?: string;
};

export type OwnerContactHistory = {
  owner_contact: string;
  owner_name: string;
  property_id: string;
  property_name: string;
  message_count: number;
  inbound_count: number;
  sent_count: number;
  last_at: string;
  messages: OwnerHistoryEvent[];
};

export type OwnerHistoryResponse = {
  contacts: OwnerContactHistory[];
  count: number;
};

export async function listOwnerHistory(days = 60) {
  return request<OwnerHistoryResponse>(`/api/owner-history?days=${days}`);
}

export type OwnerCuratedFacts = {
  content: string;
  path: string;
  bytes: number;
  // Loop-owned facts auto-distilled from owner-draft coaching (read-only).
  learned?: string;
};

export async function getOwnerCuratedFacts() {
  return request<OwnerCuratedFacts>('/api/owner-curated-facts');
}

export async function saveOwnerCuratedFacts(content: string) {
  return request<{ ok: true; bytes: number }>('/api/owner-curated-facts', {
    method: 'PUT',
    body: { content },
  });
}

// ── Proposed property updates ──────────────────────────────────────────
// Durable property facts an owner shared in a message (wifi, a code, trash
// day), detected by the stay-concierge owner-property extractor. Helm lists
// them, applies the chosen ones through its OWN safe routing (properties /
// property_access / property_notes), then marks them applied so they stop
// surfacing. The extractor never writes to Helm's DB.

export type ProposedPropertyUpdate = {
  id: string;
  property_id: string;
  property_name: string;
  owner_name: string;
  category: string;
  fact_text: string;
  raw_quote: string;
  confidence: 'high' | 'medium' | 'low' | string;
  source: string;
  created_at: string;
  status: 'pending' | 'applied' | 'dismissed' | string;
};

export type ProposedPropertyUpdatesResponse = {
  updates: ProposedPropertyUpdate[];
  count: number;
};

/** Without `audience`, only NON-cleaner (owner) candidates, which keeps the
 * existing owner card unchanged. With 'cleaner' or 'contractor', only the
 * candidates sourced from that audience. */
export async function listProposedPropertyUpdates(audience?: 'cleaner' | 'contractor') {
  const q = audience ? `?audience=${audience}` : '';
  return request<ProposedPropertyUpdatesResponse>(`/api/proposed-property-updates${q}`);
}

export async function dismissProposedPropertyUpdate(id: string) {
  return request<{ ok: true; id: string; status: string }>(
    `/api/proposed-property-updates/${id}/dismiss`,
    { method: 'POST' },
  );
}

export async function markProposedPropertyUpdateApplied(id: string) {
  return request<{ ok: true; id: string; status: string }>(
    `/api/proposed-property-updates/${id}/applied`,
    { method: 'POST' },
  );
}

// ── Cleaner-messaging surface (bilingual; Portuguese drafts) ───────────

/** An AI-mined work-slip proposal extracted from the cleaner's message
 * ("the dryer is broken at Rocky Neck" → a maintenance slip). The operator
 * confirms or unticks it on the approval card; nothing files until approve. */
export type ProposedWorkSlip = {
  title: string;
  category: 'maintenance' | 'inventory';
  priority: 'normal' | 'high';
  note: string;
};

export type CleanerApproval = {
  id: string;
  short_id: string;
  channel: string;                  // 'sms_quo'
  cleaner_contact: string;          // E.164 phone
  cleaner_name: string;
  property_id: string;
  property_name: string;
  external_thread_id: string;
  external_message_id: string;
  cleaner_text: string;             // verbatim — usually Portuguese
  cleaner_text_english: string;     // LLM translation; empty if input was already EN
  inbound_language: 'pt' | 'en' | 'mixed' | string;
  draft: string;                    // Portuguese — what gets sent on approve
  draft_english: string;            // English translation for operator audit
  topic: string;
  status: string;
  final_response: string;
  created_at: string;
  resolved_at: string | null;
  age_minutes: number | null;
  /** Work-slip proposal mined from the message; null when there is none.
   * property_id/property_name above may be non-empty (inferred) for these. */
  proposed_slip: ProposedWorkSlip | null;
};

export type CleanerApprovalsResponse = {
  approvals: CleanerApproval[];
  count: number;
};

export async function listCleanerApprovals() {
  return request<CleanerApprovalsResponse>('/api/cleaner-approvals');
}

export async function listRecentCleanerApprovals(hours = 24) {
  return request<CleanerApprovalsResponse>(`/api/cleaner-approvals/recent?hours=${hours}`);
}

/** Approve a cleaner draft. `opts` carries the operator's decision on the
 * card's proposed work slip; when omitted the backend uses the inferred
 * defaults. JSON.stringify drops undefined keys, so only the fields the
 * operator actually decided travel. */
export async function approveCleanerApproval(
  id: string,
  opts?: { fileSlip?: boolean; slipPropertyId?: string },
) {
  return request<{ status: string; id: string; slip?: { id: string; deduped: boolean } | null }>(
    `/api/cleaner-approvals/${id}/approve`,
    {
      method: 'POST',
      ...(opts !== undefined
        ? { body: { file_slip: opts.fileSlip, slip_property_id: opts.slipPropertyId } }
        : {}),
    },
  );
}

export async function rejectCleanerApproval(id: string) {
  return request<{ status: string; id: string }>(`/api/cleaner-approvals/${id}/reject`, { method: 'POST' });
}

export async function markHandledCleanerApproval(id: string) {
  return request<{ status: string; id: string }>(`/api/cleaner-approvals/${id}/mark_handled`, { method: 'POST' });
}

export async function coachCleanerApproval(id: string, feedback: string) {
  return request<{ status: string; id: string }>(`/api/cleaner-approvals/${id}/coach`, {
    method: 'POST',
    body: { feedback },
  });
}

export type CleanerCuratedFacts = {
  content: string;
  path: string;
  bytes: number;
};

export async function getCleanerCuratedFacts() {
  return request<CleanerCuratedFacts>('/api/cleaner-curated-facts');
}

export async function saveCleanerCuratedFacts(content: string) {
  return request<{ ok: true; bytes: number }>('/api/cleaner-curated-facts', {
    method: 'PUT',
    body: { content },
  });
}

// ── Contractor-messaging surface (English only) ────────────────────────
// Field contractors (Delaney and the like) text in about property visits.
// Mirrors the cleaner surface, but the pipeline is English end to end: there
// are no PT/EN translation fields, so ContractorApproval drops
// cleaner_text_english / inbound_language / draft_english.

export type ContractorApproval = {
  id: string;
  short_id: string;
  channel: string;                  // 'sms_quo'
  contractor_contact: string;       // E.164 phone
  contractor_name: string;
  property_id: string;
  property_name: string;
  external_thread_id: string;
  external_message_id: string;
  contractor_text: string;          // verbatim — English
  draft: string;                    // English — what gets sent on approve
  topic: string;
  status: string;
  final_response: string;
  created_at: string;
  resolved_at: string | null;
  age_minutes: number | null;
  /** Work-slip proposal mined from the message; null when there is none.
   * property_id/property_name above may be non-empty (inferred) for these. */
  proposed_slip: ProposedWorkSlip | null;
};

export type ContractorApprovalsResponse = {
  approvals: ContractorApproval[];
  count: number;
};

export async function listContractorApprovals() {
  return request<ContractorApprovalsResponse>('/api/contractor-approvals');
}

export async function listRecentContractorApprovals(hours = 24) {
  return request<ContractorApprovalsResponse>(`/api/contractor-approvals/recent?hours=${hours}`);
}

/** Approve a contractor draft. `opts` carries the operator's decision on the
 * card's proposed work slip; when omitted the backend uses the inferred
 * defaults. JSON.stringify drops undefined keys, so only the fields the
 * operator actually decided travel. */
export async function approveContractorApproval(
  id: string,
  opts?: { fileSlip?: boolean; slipPropertyId?: string },
) {
  return request<{ status: string; id: string; slip?: { id: string; deduped: boolean } | null }>(
    `/api/contractor-approvals/${id}/approve`,
    {
      method: 'POST',
      ...(opts !== undefined
        ? { body: { file_slip: opts.fileSlip, slip_property_id: opts.slipPropertyId } }
        : {}),
    },
  );
}

export async function rejectContractorApproval(id: string) {
  return request<{ status: string; id: string }>(`/api/contractor-approvals/${id}/reject`, { method: 'POST' });
}

export async function markHandledContractorApproval(id: string) {
  return request<{ status: string; id: string }>(`/api/contractor-approvals/${id}/mark_handled`, { method: 'POST' });
}

export async function coachContractorApproval(id: string, feedback: string) {
  return request<{ status: string; id: string }>(`/api/contractor-approvals/${id}/coach`, {
    method: 'POST',
    body: { feedback },
    timeoutMs: STAY_CONCIERGE_LLM_TIMEOUT_MS,
  });
}

export type ContractorCuratedFacts = {
  content: string;
  path: string;
  bytes: number;
};

export async function getContractorCuratedFacts() {
  return request<ContractorCuratedFacts>('/api/contractor-curated-facts');
}

export async function saveContractorCuratedFacts(content: string) {
  return request<{ ok: true; bytes: number }>('/api/contractor-curated-facts', {
    method: 'PUT',
    body: { content },
  });
}

export async function getStats(hours: number) {
  return request<MessagingStats>(`/api/stats?hours=${hours}`);
}

export type TimeseriesPoint = {
  date: string;
  first_pass_clean: number;
  approved: number;
  manual_sent: number;
  auto_expired: number;
  escalated: number;
  engaged: number;
  rolling_one_shot_rate: number | null;
  rolling_engaged: number;
  rolling_first_pass_clean: number;
};

export type TopicRollup = {
  topic: string;
  engaged: number;
  first_pass_clean: number;
  approved: number;
  escalated: number;
  rate: number | null;
};

export type TimeseriesResponse = {
  days: number;
  topic: string | null;
  series: TimeseriesPoint[];
  available_topics: TopicRollup[];
};

export async function getStatsTimeseries(days = 30, topic?: string) {
  const q = topic
    ? `?days=${days}&topic=${encodeURIComponent(topic)}`
    : `?days=${days}`;
  return request<TimeseriesResponse>(`/api/stats/timeseries${q}`);
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

export type Fact = {
  id: string;
  fact: string;
  scope: string;
  topic: string;
  confidence: 'high' | 'medium' | 'low';
  source_heading: string;
  source_date: string;
  source_title: string;
  source_body_short: string;
  is_edited: boolean;
  is_custom: boolean;
  is_deleted: boolean;
  edited_at: string | null;
  edited_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  original_fact: string;
};

export type FactsResponse = {
  facts: Fact[];
  count: number;
  total_facts: number;
};

export async function getFacts(limit = 20, scope?: string) {
  const q = scope ? `?limit=${limit}&scope=${encodeURIComponent(scope)}` : `?limit=${limit}`;
  return request<FactsResponse>(`/api/facts${q}`);
}

export async function editFact(
  id: string,
  patch: { fact?: string; scope?: string; topic?: string },
) {
  return request<{ ok: true; fact: Fact }>(`/api/facts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: patch,
  });
}

export async function softDeleteFact(id: string) {
  return request<{ ok: true }>(`/api/facts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function restoreFact(id: string) {
  return request<{ ok: true }>(`/api/facts/${encodeURIComponent(id)}/restore`, { method: 'POST' });
}

export async function createFact(
  body: { fact: string; scope: string; topic: string },
) {
  return request<{ ok: true; id: string }>(`/api/facts`, { method: 'POST', body });
}

export async function coachApproval(id: string, feedback: string) {
  return request<{ status: string; id: string }>(`/api/approvals/${id}/coach`, {
    method: 'POST',
    body: { feedback },
    timeoutMs: STAY_CONCIERGE_LLM_TIMEOUT_MS,
  });
}

export function explainError(error: StayConciergeError): string {
  if (error.kind === 'unconfigured') {
    return 'Stay Concierge service is not configured. Set STAY_CONCIERGE_URL and STAY_CONCIERGE_KEY in the environment.';
  }
  if (error.kind === 'network')
    return 'Messaging service is unreachable (it may be restarting). Try again in a moment.';
  if (error.status === 401) return 'Stay Concierge rejected the dashboard key.';
  if (error.status === 404) return 'That approval no longer exists.';
  if (error.status === 409) return `That approval is no longer pending (${error.detail}).`;
  if (error.status === 400 && error.detail === 'send_at_too_far') {
    return 'That time is too far out. Pick a time within the next 48 hours.';
  }
  if (error.status === 400 && error.detail === 'send_at_in_past') {
    return 'That time has already passed. Pick a time a little further out.';
  }
  if (error.status === 503) return 'Guesty is in OAuth cooldown. Try again in a minute.';
  // 502/504 from the Cloudflare Tunnel mean the stay-concierge origin is down or
  // mid-restart, NOT a send failure. This surfaces on plain list calls too, so
  // keep the message generic to the service rather than implying a draft action.
  if (error.status === 502 || error.status === 504)
    return 'Messaging service is unreachable (it may be restarting). Try again in a moment.';
  return `Service error (${error.status}): ${error.detail}`;
}
