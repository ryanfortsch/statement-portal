/**
 * Mine guest message threads for AGREED checkout changes, and feed them
 * into `checkout_adjustments` so the cleaner schedule stays true.
 *
 * This is the mirror image of messages-to-slips: that miner is explicitly
 * told to IGNORE "requests fulfilled with no underlying defect (late
 * checkout, early check-in, ... extension offers)" because they are not
 * work. Here they are exactly the payload. Keep the two prompts'
 * boundaries aligned if either changes.
 *
 * What counts: a checkout TIME change (late checkout granted, "we'll be
 * out by 8") or a checkout DATE change (extension agreed and taken to
 * payment, early departure) that the thread shows is SETTLED - the host
 * or team confirmed it, or the guest stated a firm plan of their own
 * ("we're actually leaving Tuesday morning"). A guest ASK with no answer
 * yet is not an agreement and must not be extracted.
 *
 * Confidence drives what happens next (insertAdjustment):
 *   high   -> auto-applied (status active) unless an operator-written
 *             adjustment already stands for the stay; flagged on the
 *             digest card either way.
 *   medium/low -> proposed; a one-tap Apply on the digest card or the
 *             schedule page makes it real.
 *
 * Idempotent the same three ways as messages-to-slips:
 *   - hard: unique checkout_adjustments.miner_key,
 *     "coadj:<conversation_id>:<slug>" where the slug is derived from the
 *     agreed VALUES (date-2026-08-27, time-11-00) - a re-read of the same
 *     thread re-derives the same key; a NEW agreement (guest re-negotiates
 *     to noon) mints a new key and supersedes the old adjustment.
 *   - soft: the standing active adjustment's values are checked first, so
 *     an unchanged agreement is a no-op without burning an insert.
 *   - dismissed stays dismissed: the key survives on the dismissed row.
 *
 * Fail-soft like every concierge consumer: unreachable Mac Mini or a
 * gateway error skips the thread and reports it in `errors`.
 *
 * Called from /api/cron/cleaner-schedule (daily, before the digest draft
 * is composed) and from the digest card's "Re-scan messages" action.
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
import {
  insertAdjustment,
  normalizeTime,
  todayET,
  addDays,
  type CheckoutAdjustment,
} from '@/lib/checkout-schedule';

const MINER_BOT = 'miner';

const DEFAULT_LIST_DAYS = 21;
/** Daily cron + slack, so a missed run never drops an agreement. */
const DEFAULT_SINCE_HOURS = 30;
const DEFAULT_MAX_THREADS = 25;
/** The digest draft builds after the mine inside one 300s cron. */
const RUN_BUDGET_MS = 150_000;

const MAX_THREAD_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 800;
const MAX_TRANSCRIPT_CHARS = 10_000;

export type MineCheckoutChangesResult = {
  conversationsListed: number;
  threadsScanned: number;
  skippedNoProperty: number;
  skippedNotRecent: number;
  skippedStayOver: number;
  agreementsFound: number;
  applied: number;
  proposed: number;
  alreadyMined: number;
  unchanged: number;
  invalid: number;
  truncated: boolean;
  errors: string[];
};

const AgreementSchema = z.object({
  changes: z.array(
    z.object({
      new_checkout_time: z
        .string()
        .describe('The agreed checkout TIME in 24h HH:MM (e.g. "11:00" for an 11 AM late checkout), or empty string when the agreement is only about the date. Convert phrases: "noon" is 12:00, "by 9" in a checkout context is 09:00.'),
      new_checkout_date: z
        .string()
        .describe('The agreed checkout DATE as YYYY-MM-DD when the stay length changed (extension or early departure), or empty string when only the time changed. Derive the absolute date from the stay dates given in the prompt plus the thread ("one more night" from a checkout of 2026-08-26 is 2026-08-27).'),
      settled: z
        .boolean()
        .describe('true only when the thread shows this is SETTLED: the host/team explicitly confirmed it, or the guest stated a firm plan of their own. A pending ask, a "let me check", or an offer with no acceptance is NOT settled - do not include those at all.'),
      confidence: z
        .enum(['high', 'medium', 'low'])
        .describe('high = host explicitly confirmed the exact value ("11 works, see you then"). medium = agreed but wording is loose, or a firm guest-stated plan the host never answered. low = probable but ambiguous.'),
      quote: z
        .string()
        .describe('Short verbatim quote of the line that settles it - prefer the HOST confirmation line over the guest ask.'),
      summary: z
        .string()
        .describe('One sentence: what changed, e.g. "Late checkout at 11 AM agreed on Aug 24".'),
    }),
  ),
});

type MinedChange = z.infer<typeof AgreementSchema>['changes'][number];

export async function mineCheckoutChanges(
  supabase: SupabaseClient,
  opts?: {
    days?: number;
    sinceHours?: number;
    maxThreads?: number;
    /** Target one conversation (the card's Re-scan); bypasses recency. */
    conversationId?: string;
  },
): Promise<MineCheckoutChangesResult> {
  const startMs = Date.now();
  const result: MineCheckoutChangesResult = {
    conversationsListed: 0,
    threadsScanned: 0,
    skippedNoProperty: 0,
    skippedNotRecent: 0,
    skippedStayOver: 0,
    agreementsFound: 0,
    applied: 0,
    proposed: 0,
    alreadyMined: 0,
    unchanged: 0,
    invalid: 0,
    truncated: false,
    errors: [],
  };

  if (!isStayConciergeConfigured()) {
    result.errors.push('stay-concierge not configured (STAY_CONCIERGE_URL/KEY)');
    return result;
  }

  const listRes = await listConversations(opts?.days ?? DEFAULT_LIST_DAYS);
  if (!listRes.ok) {
    result.errors.push(`listConversations failed: ${listRes.error.kind}`);
    return result;
  }
  const conversations = listRes.data.conversations ?? [];
  result.conversationsListed = conversations.length;

  // Guesty listing id -> Helm property id, same two-step map the slip
  // miner uses (sync-verified table first, property-name fallback).
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

  const cutoffMs = Date.now() - (opts?.sinceHours ?? DEFAULT_SINCE_HOURS) * 3600_000;
  const today = todayET();

  const candidates = conversations
    .filter((c) => c.conversation_id)
    .filter((c) => (opts?.conversationId ? c.conversation_id === opts.conversationId : true))
    .sort((a, b) => (b.last_activity_at || '').localeCompare(a.last_activity_at || ''))
    .slice(0, opts?.conversationId ? 1 : (opts?.maxThreads ?? DEFAULT_MAX_THREADS) * 2);

  let threadBudget = opts?.maxThreads ?? DEFAULT_MAX_THREADS;
  for (const c of candidates) {
    if (threadBudget <= 0) break;
    if (Date.now() - startMs > RUN_BUDGET_MS) {
      result.truncated = true;
      break;
    }

    // A checkout change for a stay that already ended is useless to the
    // schedule. Yesterday stays in scope: a late checkout agreed for today
    // can be mined the morning after the cron drafted today's digest.
    if (!c.check_out || c.check_out < addDays(today, -1) || !c.check_in) {
      result.skippedStayOver += 1;
      continue;
    }

    const propertyId =
      (c.listing_id && propertyByListing.get(c.listing_id)) ||
      propertyIdByName.get((c.property_name || '').trim().toLowerCase()) ||
      null;
    if (!propertyId || !propertyNames.has(propertyId)) {
      result.skippedNoProperty += 1;
      continue;
    }

    // Recency on ANY side of the thread: the settling line is usually the
    // HOST's ("11 works"), so a guest-only gate would miss the agreement.
    if (!opts?.conversationId) {
      const lastAt = c.last_activity_at ? Date.parse(c.last_activity_at) : NaN;
      if (!Number.isFinite(lastAt) || lastAt < cutoffMs) {
        result.skippedNotRecent += 1;
        continue;
      }
    }

    threadBudget -= 1;
    const threadRes = await getConversationThread(c.conversation_id);
    if (!threadRes.ok) {
      result.errors.push(`thread ${c.conversation_id}: ${threadRes.error.kind}`);
      continue;
    }
    const messages = (threadRes.data.messages ?? []).filter((m) => (m.body || '').trim());
    if (messages.length === 0) continue;
    result.threadsScanned += 1;

    let changes: MinedChange[];
    try {
      changes = await mineThread(c, messages, propertyNames.get(propertyId)!);
    } catch (err) {
      result.errors.push(
        `mine ${c.conversation_id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    result.agreementsFound += changes.length;
    if (changes.length === 0) continue;

    // The standing active adjustment, to no-op unchanged agreements.
    const { data: standingRow } = await supabase
      .from('checkout_adjustments')
      .select('*')
      .eq('property_id', propertyId)
      .eq('stay_check_in', c.check_in)
      .eq('status', 'active')
      .maybeSingle();
    const standing = (standingRow ?? null) as CheckoutAdjustment | null;

    for (const change of changes) {
      if (!change.settled) continue;
      const time = normalizeTime(change.new_checkout_time || null);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(change.new_checkout_date)
        ? change.new_checkout_date
        : null;
      // Sanity: a real agreement has at least one value; a date must sit
      // inside a plausible window around the stay (checkout can only move
      // so far without being a different booking).
      const dateSane =
        !date || (date >= c.check_in && date <= addDays(c.check_out, 30));
      if ((!time && !date) || !dateSane) {
        result.invalid += 1;
        continue;
      }

      // A time-only agreement must not clobber a standing extension (and
      // vice versa): the new row carries the mined value plus whatever the
      // standing adjustment already established on the other axis.
      const mergedTime = time ?? standing?.adjusted_checkout_time ?? null;
      const mergedDate = date ?? standing?.adjusted_check_out ?? null;
      if (standing
        && mergedTime === (standing.adjusted_checkout_time ?? null)
        && mergedDate === (standing.adjusted_check_out ?? null)) {
        result.unchanged += 1;
        continue;
      }

      // Slug from the MINED values only, so a re-read of the same thread
      // re-derives the same key regardless of what it merged with.
      const slugParts = [];
      if (date) slugParts.push(`date-${date}`);
      if (time) slugParts.push(`time-${time.replace(':', '-')}`);
      const minerKey = `coadj:${c.conversation_id}:${slugParts.join('-')}`;

      try {
        const inserted = await insertAdjustment(supabase, {
          propertyId,
          stayCheckIn: c.check_in,
          originalCheckOut: c.check_out,
          adjustedCheckOut: mergedDate,
          adjustedCheckoutTime: mergedTime,
          note: change.summary.trim().slice(0, 300),
          source: 'miner',
          minerKey,
          evidence: change.quote.trim().slice(0, 500),
          confidence: change.confidence,
          createdBy: MINER_BOT,
        });
        if (!inserted) {
          result.alreadyMined += 1;
        } else if (inserted.status === 'active') {
          result.applied += 1;
        } else {
          result.proposed += 1;
        }
      } catch (err) {
        result.errors.push(
          `insert ${minerKey}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return result;
}

async function mineThread(
  c: ConversationSummary,
  messages: ThreadMessage[],
  propertyName: string,
): Promise<MinedChange[]> {
  const transcript = buildTranscript(messages);
  const { object } = await generateObject({
    model: 'anthropic/claude-sonnet-4.5',
    schema: AgreementSchema,
    system: `You read guest message threads for Rising Tide STR, a vacation-rental manager on Cape Ann MA, and extract SETTLED changes to when the guest leaves: checkout time changes (a late checkout granted, "we'll be out by 8") and checkout date changes (a stay extension agreed, an early departure). The cleaning crew's schedule is built from what you extract, so precision beats recall.

Extract a change ONLY when the thread shows it is settled: the host or team explicitly confirmed it ("11 works, no problem", "you're all set for the extra night"), or the guest stated a firm plan of their own that needs no permission ("we're actually heading out Tuesday morning"). Do NOT extract: a guest ask with no host answer, a host "let me check", an extension OFFER the guest never accepted, price discussion about a possible extension, or hypotheticals. If a change was agreed and later reverted or re-negotiated in the same thread, extract only the FINAL settled state.

The stay's booked dates are given below. Convert every relative phrase to absolutes against them: "one more night" extends the checkout date by one day; "checking out Sunday instead" is that calendar date. Times are 24h HH:MM. An 11 AM late checkout is a TIME change only (new_checkout_date stays empty). An extension is a DATE change (new_checkout_time stays empty unless a time was also agreed).

Return an empty changes array when the thread settles nothing about checkout. Most threads settle nothing.`,
    prompt: `Property: ${propertyName}
Guest: ${c.guest_full || 'unknown'}
Booked stay: check-in ${c.check_in || '?'}, checkout ${c.check_out || '?'} (${c.channel || 'Direct'}, ${c.stay_status || 'unknown'})

Transcript (oldest first):
${transcript}`,
  });
  return object.changes;
}

/** Oldest-first transcript with dates on every line. Host provenance is
 *  kept: an agreement confirmed by the AI concierge (via helm_ai) vs the
 *  team reads the same to the schedule, but the model should see who
 *  spoke. Oldest lines drop first when over budget. */
function buildTranscript(messages: ThreadMessage[]): string {
  const recent = messages.slice(-MAX_THREAD_MESSAGES);
  const lines: string[] = [];
  for (const m of recent) {
    const body = (m.body || '').trim();
    if (!body) continue;
    const clipped = body.length > MAX_MESSAGE_CHARS ? `${body.slice(0, MAX_MESSAGE_CHARS)} [...]` : body;
    const when = (m.at || '').slice(0, 10);
    lines.push(`[${when}] ${m.who === 'guest' ? 'GUEST' : `HOST${m.via ? ` (${m.via})` : ''}`}: ${clipped}`);
  }
  let out = lines.join('\n\n');
  while (out.length > MAX_TRANSCRIPT_CHARS && lines.length > 4) {
    lines.shift();
    out = lines.join('\n\n');
  }
  return out;
}
