/**
 * Auto-create work slips from guest message threads.
 *
 * Guests report real property problems in chat where nothing was mining
 * them: "the side door lock never worked, we've been coming in the front"
 * buried between a late-checkout ask and a parking question. Reviews and
 * private feedback already mint slips (reviews-to-slips); this closes the
 * same loop for the live conversation stream.
 *
 * Guest thread text lives on the stay-concierge (Mac Mini), not in
 * Supabase, so the miner pulls conversations through the same client the
 * /messaging module uses: listConversations for the roster, then
 * getConversationThread per candidate. Fan-out is bounded (maxThreads,
 * newest guest activity first) because each thread fetch is a live Guesty
 * read on the concierge side.
 *
 * An LLM pass per thread (anthropic/claude-sonnet-4.5, matching
 * reviews-to-slips) extracts SPECIFIC physical issues where work remains
 * after the conversation: repair, replacement, restock, or a follow-up
 * verification. Chat noise -- answered questions, fulfilled courtesy
 * requests, discount asks, gratitude -- never becomes a slip.
 *
 * Idempotent three ways:
 *   - hard: partial unique index on work_slips.from_guest_message_key,
 *     key "guestmsg:<conversation_id>:<issue_slug>". The slug is the
 *     model's stable kebab identifier for the UNDERLYING issue, not a
 *     message id: one guest message reporting three problems yields three
 *     distinct keys, and a thread re-fetch that renumbers message ids
 *     (the /posts vs /messages fallback) can't mint a new key;
 *   - soft: existing slips for the property AND this conversation's
 *     already-used slugs ride into the prompt as "already tracked, do not
 *     re-file" so re-mentions and re-runs don't re-file the same
 *     underlying problem under a fresh slug;
 *   - dismissed stays dismissed -- the key survives on the dismissed slip.
 *
 * Fail-soft: no concierge, a sleeping Mac Mini, or a gateway error skips
 * the affected threads and reports them in `errors`; there is no heuristic
 * fallback (guest chat is far too noisy for regexes).
 *
 * Called from /api/cron/messages-to-slips (every 6h + manual trigger).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { z } from 'zod';
import {
  isStayConciergeConfigured,
  listConversations,
  getConversationThread,
  type ConversationSummary,
  type ThreadMessage,
} from '@/lib/stay-concierge';

/** System sentinel for the NOT NULL created_by_email on auto-generated slips. */
const MESSAGES_BOT_EMAIL = 'messages@helm.system';

/** Look at conversations whose stay window touches the trailing N days. */
const DEFAULT_LIST_DAYS = 30;
/** Mine only threads with guest activity in this trailing window. The cron
 *  runs every 6h; 26h of slack means a missed run never drops a message. */
const DEFAULT_SINCE_HOURS = 26;
/** Per-run cap on live thread fetches against the concierge. */
const DEFAULT_MAX_THREADS = 20;
/** Wall-clock budget for the mining loop. The cron route's maxDuration is
 *  300s and the planning pass runs after us; a sleepy tunnel timing out
 *  13s per thread must not blow through it. Threads left on the table are
 *  reported and picked up next pass. */
const RUN_BUDGET_MS = 200_000;

/** Transcript budget per LLM call. */
const MAX_THREAD_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 1200;
const MAX_TRANSCRIPT_CHARS = 12000;

export type MessagesToSlipsResult = {
  conversationsListed: number;
  threadsScanned: number;
  skippedNoProperty: number;
  skippedNoRecentGuest: number;
  issuesFound: number;
  alreadyFiled: number;
  /** Issues whose anchor id didn't match a guest message (quote dropped,
   *  issue still filed). Observability only. */
  invalidAnchor: number;
  created: number;
  /** True when the wall-clock budget ended the pass early. */
  truncated: boolean;
  slipsCreated: { slipId: string; conversationId: string; title: string }[];
  errors: string[];
};

type MinedIssue = {
  slug: string;
  anchorMessageId: string;
  title: string;
  category: 'maintenance' | 'inventory';
  priority: 'low' | 'normal' | 'high';
  summary: string;
  guestQuote: string;
};

type ExistingSlipLite = {
  id: string;
  title: string;
  status: string;
  from_guest_message_key: string | null;
};

export async function createSlipsFromGuestMessages(
  supabase: SupabaseClient,
  opts?: {
    /** Conversation-list window passed to the concierge. */
    days?: number;
    /** Only mine threads whose latest GUEST message is within this window. */
    sinceHours?: number;
    /** Cap on thread fetches per run. */
    maxThreads?: number;
    /** Target one conversation (backfill / manual re-run); bypasses recency. */
    conversationId?: string;
  },
): Promise<MessagesToSlipsResult> {
  const startMs = Date.now();
  const result: MessagesToSlipsResult = {
    conversationsListed: 0,
    threadsScanned: 0,
    skippedNoProperty: 0,
    skippedNoRecentGuest: 0,
    issuesFound: 0,
    alreadyFiled: 0,
    invalidAnchor: 0,
    created: 0,
    truncated: false,
    slipsCreated: [],
    errors: [],
  };

  if (!isStayConciergeConfigured()) {
    result.errors.push('stay-concierge not configured (STAY_CONCIERGE_URL/KEY)');
    return result;
  }

  const days = opts?.days ?? DEFAULT_LIST_DAYS;
  const sinceHours = opts?.sinceHours ?? DEFAULT_SINCE_HOURS;
  const maxThreads = opts?.maxThreads ?? DEFAULT_MAX_THREADS;

  const listRes = await listConversations(days);
  if (!listRes.ok) {
    result.errors.push(`listConversations failed: ${listRes.error.kind}`);
    return result;
  }
  const conversations = listRes.data.conversations ?? [];
  result.conversationsListed = conversations.length;

  // Guesty listing id -> Helm property id. guesty_listings is the
  // sync-verified map (same source resolveGuestyListingId trusts first).
  const { data: listingRows } = await supabase
    .from('guesty_listings')
    .select('listing_id, property_id')
    .not('property_id', 'is', null);
  const propertyByListing = new Map<string, string>();
  for (const r of (listingRows ?? []) as Array<{ listing_id: string | null; property_id: string | null }>) {
    if (r.listing_id && r.property_id) propertyByListing.set(r.listing_id, r.property_id);
  }

  const { data: propRows } = await supabase.from('properties').select('id, name');
  const propertyNames = new Map<string, string>();
  const propertyIdByName = new Map<string, string>();
  for (const p of (propRows ?? []) as Array<{ id: string; name: string }>) {
    propertyNames.set(p.id, p.name);
    propertyIdByName.set(p.name.trim().toLowerCase(), p.id);
  }

  const cutoffMs = Date.now() - sinceHours * 3600_000;

  // Candidate order: newest activity first so the cap spends its budget on
  // the conversations most likely to carry fresh reports.
  const candidates = conversations
    .filter((c) => c.conversation_id)
    .filter((c) => (opts?.conversationId ? c.conversation_id === opts.conversationId : true))
    .sort((a, b) => (b.last_activity_at || '').localeCompare(a.last_activity_at || ''))
    .slice(0, opts?.conversationId ? 1 : maxThreads * 2);

  // Existing-slip context is per property; cache across conversations.
  const existingByProperty = new Map<string, ExistingSlipLite[]>();

  let threadBudget = maxThreads;
  for (const c of candidates) {
    if (threadBudget <= 0) break;
    if (Date.now() - startMs > RUN_BUDGET_MS) {
      result.truncated = true;
      break;
    }

    const propertyId =
      (c.listing_id && propertyByListing.get(c.listing_id)) ||
      propertyIdByName.get((c.property_name || '').trim().toLowerCase()) ||
      null;
    if (!propertyId || !propertyNames.has(propertyId)) {
      result.skippedNoProperty += 1;
      continue;
    }

    // Cheap recency pre-filter on the summary before paying for a live
    // thread fetch. last_activity_at can be host-only; the thread-level
    // guest check below is the real gate.
    if (!opts?.conversationId) {
      const lastAt = c.last_activity_at ? Date.parse(c.last_activity_at) : NaN;
      if (!Number.isFinite(lastAt) || lastAt < cutoffMs) {
        result.skippedNoRecentGuest += 1;
        continue;
      }
    }

    threadBudget -= 1;
    const threadRes = await getConversationThread(c.conversation_id);
    if (!threadRes.ok) {
      result.errors.push(`thread ${c.conversation_id}: ${threadRes.error.kind}`);
      continue;
    }
    const messages = threadRes.data.messages ?? [];
    const guestMessages = messages.filter((m) => m.who === 'guest' && (m.body || '').trim());
    if (guestMessages.length === 0) {
      result.skippedNoRecentGuest += 1;
      continue;
    }
    if (!opts?.conversationId) {
      const latestGuestAt = Math.max(
        ...guestMessages.map((m) => (m.at ? Date.parse(m.at) : 0)),
      );
      if (!Number.isFinite(latestGuestAt) || latestGuestAt < cutoffMs) {
        result.skippedNoRecentGuest += 1;
        continue;
      }
    }
    result.threadsScanned += 1;

    let existing = existingByProperty.get(propertyId);
    if (!existing) {
      existing = await loadExistingSlips(supabase, propertyId);
      existingByProperty.set(propertyId, existing);
    }
    // This conversation's already-used slugs, regardless of the property
    // list's recency/size caps -- the hard guard against slug drift on
    // re-runs. Small set, cheap query.
    const conversationSlips = await loadConversationSlips(supabase, c.conversation_id);
    const filedKeys = new Set(
      [...existing, ...conversationSlips]
        .map((s) => s.from_guest_message_key)
        .filter((k): k is string => !!k),
    );
    let issues: MinedIssue[];
    try {
      issues = await mineThread(c, messages, propertyNames.get(propertyId)!, existing, conversationSlips);
    } catch (err) {
      result.errors.push(
        `mine ${c.conversation_id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    result.issuesFound += issues.length;
    if (issues.length === 0) continue;

    const guestMessagesById = new Map(guestMessages.map((m) => [m.id, m]));
    const inserts = [];
    const batchKeys = new Set<string>();
    for (const issue of issues) {
      const slug = sanitizeSlug(issue.slug) || sanitizeSlug(issue.title);
      if (!slug) continue;
      const key = `guestmsg:${c.conversation_id}:${slug}`;
      // Dedupe against the DB (any status -- dismissed stays dismissed)
      // AND within this batch (the model can emit near-duplicate issues).
      if (filedKeys.has(key) || batchKeys.has(key)) {
        result.alreadyFiled += 1;
        continue;
      }
      batchKeys.add(key);
      // The anchor grounds the quote; a bad anchor drops the quote, not
      // the issue.
      const anchor = guestMessagesById.get(issue.anchorMessageId);
      if (!anchor) result.invalidAnchor += 1;
      const quote =
        anchor && issue.guestQuote && normalized(anchor.body).includes(normalized(issue.guestQuote))
          ? issue.guestQuote
          : '';
      const propertyName = propertyNames.get(propertyId)!;
      inserts.push({
        property_id: propertyId,
        title: `${propertyName}: ${issue.title}`,
        description: buildDescription(c, { ...issue, guestQuote: quote }),
        action_summary: issue.title,
        category: issue.category,
        priority: issue.priority,
        status: 'open' as const,
        guesty_reservation_id: c.reservation_id || null,
        from_guest_message_key: key,
        created_by_email: MESSAGES_BOT_EMAIL,
      });
    }
    if (inserts.length === 0) continue;

    const { data: inserted, error: insertErr } = await supabase
      .from('work_slips')
      .insert(inserts)
      .select('id, title, from_guest_message_key');
    if (insertErr) {
      // Unique-violation race (parallel run already filed one of the keys):
      // retry row-by-row so one duplicate doesn't sink the batch.
      if (insertErr.code === '23505') {
        for (const row of inserts) {
          const { data: one, error: oneErr } = await supabase
            .from('work_slips')
            .insert(row)
            .select('id, title')
            .single();
          if (oneErr) {
            if (oneErr.code === '23505') result.alreadyFiled += 1;
            else result.errors.push(`insert: ${oneErr.message}`);
            continue;
          }
          const created = one as { id: string; title: string };
          result.created += 1;
          result.slipsCreated.push({
            slipId: created.id,
            conversationId: c.conversation_id,
            title: created.title,
          });
        }
      } else {
        result.errors.push(`insert: ${insertErr.message}`);
      }
      continue;
    }
    for (const s of (inserted ?? []) as Array<{ id: string; title: string }>) {
      result.created += 1;
      result.slipsCreated.push({ slipId: s.id, conversationId: c.conversation_id, title: s.title });
    }
    // New slips are context for any later conversation on the same property
    // in this run.
    existingByProperty.set(propertyId, [
      ...existing,
      ...((inserted ?? []) as Array<{ id: string; title: string; from_guest_message_key: string | null }>).map(
        (s) => ({ id: s.id, title: s.title, status: 'open', from_guest_message_key: s.from_guest_message_key }),
      ),
    ]);
  }

  return result;
}

/** Active slips plus anything from the trailing 90 days, any status: the
 *  "already tracked" context the model must not re-file against, and the
 *  source of already-used from_guest_message_key values. */
async function loadExistingSlips(
  supabase: SupabaseClient,
  propertyId: string,
): Promise<ExistingSlipLite[]> {
  const since = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();
  const { data } = await supabase
    .from('work_slips')
    .select('id, title, status, from_guest_message_key')
    .eq('property_id', propertyId)
    .or(`status.in.(open,in_progress,scheduled,blocked),created_at.gte.${since}`)
    .order('created_at', { ascending: false })
    .limit(60);
  return (data ?? []) as ExistingSlipLite[];
}

/** Every slip ever mined from this conversation, no caps: the slug-reuse
 *  guard must see them all even when the property list truncates. */
async function loadConversationSlips(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<ExistingSlipLite[]> {
  const { data } = await supabase
    .from('work_slips')
    .select('id, title, status, from_guest_message_key')
    .like('from_guest_message_key', `guestmsg:${conversationId}:%`);
  return (data ?? []) as ExistingSlipLite[];
}

/** Kebab [a-z0-9-], length-capped; empty when nothing survives. */
function sanitizeSlug(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Whitespace-insensitive containment check for quote grounding. */
function normalized(t: string): string {
  return (t || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ─── mining ───────────────────────────────────────────────────────────

const MineSchema = z.object({
  issues: z.array(
    z.object({
      slug: z
        .string()
        .describe('Stable kebab-case identifier for the UNDERLYING issue, e.g. "side-door-lock" or "beach-towel-stock". If the issue matches one in the already-tracked list, reuse that exact slug. Never include message ids or dates.'),
      anchor_message_id: z
        .string()
        .describe('The id of the GUEST message that first reports this issue, copied exactly from the transcript.'),
      title: z
        .string()
        .describe('Imperative one-liner the team can act on, e.g. "Fix the side door smart lock". No property name prefix.'),
      category: z
        .enum(['maintenance', 'inventory'])
        .describe('maintenance = repair/malfunction/damage; inventory = missing or depleted supplies.'),
      priority: z.enum(['low', 'normal', 'high']),
      summary: z
        .string()
        .describe('One or two sentences: what is wrong and what remains to be done.'),
      guest_quote: z
        .string()
        .describe('Short verbatim quote from the guest message reporting the issue.'),
    }),
  ),
});

async function mineThread(
  c: ConversationSummary,
  messages: ThreadMessage[],
  propertyName: string,
  existing: ExistingSlipLite[],
  conversationSlips: ExistingSlipLite[],
): Promise<MinedIssue[]> {
  const transcript = buildTranscript(messages);
  // Conversation-mined slips first (with their slugs, which the model must
  // reuse on a re-mention), then the property's other slips. Active before
  // closed so the cap trims the least relevant.
  const convKeyPrefix = `guestmsg:${c.conversation_id}:`;
  const trackedLines = new Map<string, string>();
  for (const s of conversationSlips) {
    const slug = s.from_guest_message_key?.startsWith(convKeyPrefix)
      ? s.from_guest_message_key.slice(convKeyPrefix.length)
      : '';
    trackedLines.set(s.id, `- [${slug}] ${s.title} (${s.status})`);
  }
  const active = existing.filter((s) => s.status !== 'done' && s.status !== 'dismissed');
  const closed = existing.filter((s) => s.status === 'done' || s.status === 'dismissed');
  for (const s of [...active, ...closed]) {
    if (trackedLines.size >= 40) break;
    if (!trackedLines.has(s.id)) trackedLines.set(s.id, `- ${s.title} (${s.status})`);
  }
  const tracked = [...trackedLines.values()].join('\n');

  const { object } = await generateObject({
    model: 'anthropic/claude-sonnet-4.5',
    schema: MineSchema,
    system: `You mine guest message threads for Rising Tide STR, a vacation-rental manager on Cape Ann MA. Extract SPECIFIC physical property issues the operations team must still act on after this conversation: something broken, damaged, malfunctioning, unsafe, missing, or depleted at the house.

File an issue when work remains: a repair, a replacement, a restock, or a follow-up verification. Include problems a host reply promised to handle ("we'll fix that") unless the thread shows it was completed AND the guest confirmed it works with nothing left to verify.

Do NOT file: questions the host answered (directions, where amenities live), requests fulfilled with no underlying defect (late checkout, early check-in, discounts, extension offers, parking asks), pure gratitude, a guest apologizing for something they did, or ideas for new signage/process. A one-time courtesy delivery is not an issue by itself, BUT if it reveals the house's own stock was missing or depleted (e.g. one beach towel in the whole house), file an inventory verification for the turnover.

Priority: high = safety or security (locks, alarms, leaks, gas) or anything that will hit the current or next guest's stay; normal = routine repair or restock; low = nice-to-have.

The team already tracks some issues for this property (listed below). The same underlying problem is the same issue even when worded differently -- do not re-file those. Lines shown as "[slug] title" were mined from THIS conversation: if a guest re-mentions one of those issues, either skip it or reuse that exact slug.

slug identifies the UNDERLYING issue and must be stable across re-reads of this thread: derive it from the thing that is broken ("side-door-lock", "upstairs-tv-power"), never from message wording, ids, or dates. One guest message can report several issues -- give each its own slug and entry.

anchor_message_id MUST be copied exactly from a [id=...] GUEST line in the transcript: the guest message that first reports the issue. Return an empty issues array when the thread carries nothing actionable.`,
    prompt: `Property: ${propertyName}
Guest: ${c.guest_full || 'unknown'} (${c.check_in || '?'} to ${c.check_out || '?'}, ${c.channel || 'Direct'}, ${c.stay_status || 'unknown'})

Already tracked for this property (do not re-file):
${tracked || '(none)'}

Transcript (oldest first):
${transcript}`,
  });

  return object.issues.map((i) => ({
    slug: i.slug.trim(),
    anchorMessageId: i.anchor_message_id.trim(),
    title: i.title.trim(),
    category: i.category,
    priority: i.priority,
    summary: i.summary.trim(),
    guestQuote: i.guest_quote.trim(),
  }));
}

/** Last MAX_THREAD_MESSAGES messages, oldest first. Guest lines carry the
 *  [id=...] anchor; host lines carry their provenance so the model can see
 *  what was promised vs merely auto-sent. Oldest lines drop first when the
 *  total budget overflows. */
function buildTranscript(messages: ThreadMessage[]): string {
  const recent = messages.slice(-MAX_THREAD_MESSAGES);
  const lines: string[] = [];
  for (const m of recent) {
    const body = (m.body || '').trim();
    if (!body) continue;
    const clipped = body.length > MAX_MESSAGE_CHARS ? `${body.slice(0, MAX_MESSAGE_CHARS)} [...]` : body;
    const when = (m.at || '').slice(0, 10);
    if (m.who === 'guest') {
      lines.push(`[id=${m.id}] [${when}] GUEST: ${clipped}`);
    } else {
      lines.push(`[${when}] HOST${m.via ? ` (${m.via})` : ''}: ${clipped}`);
    }
  }
  let out = lines.join('\n\n');
  while (out.length > MAX_TRANSCRIPT_CHARS && lines.length > 4) {
    lines.shift();
    out = lines.join('\n\n');
  }
  return out;
}

// ─── helpers ──────────────────────────────────────────────────────────

function buildDescription(c: ConversationSummary, issue: MinedIssue): string {
  const lines: string[] = [issue.summary, ''];
  lines.push(
    `From guest messages: ${c.guest_full || 'guest'} (${c.check_in || '?'} to ${c.check_out || '?'}, ${c.channel || 'Direct'})`,
  );
  if (issue.guestQuote) {
    lines.push('');
    lines.push(`"${issue.guestQuote}"`);
  }
  lines.push('');
  lines.push(`Conversation: ${c.conversation_id}`);
  return lines.join('\n').trim();
}
