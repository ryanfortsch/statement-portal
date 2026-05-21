/**
 * Auto-create work slips from Guesty review feedback.
 *
 * Candidate selection (cheap, in SQL): a review in the trailing window
 * with either a below-five rating OR any private_feedback. But "has
 * private feedback" is far too broad on its own: half of 5★ reviews
 * carry private feedback that's pure gratitude ("Thank you so much,
 * Allie!"), and turning those into work slips floods the queue.
 *
 * So candidates are then passed through an LLM classifier
 * (anthropic/claude-sonnet-4.5 via the Vercel AI Gateway, matching
 * notes/extract) that decides, per review, whether the feedback
 * contains a specific actionable issue or improvement, and if so writes
 * a one-line action summary. Only the actionable ones become slips.
 *
 * Fallback: if the LLM is unavailable (no gateway key, network error),
 * we degrade to below-five ratings only (the unambiguous signal) and
 * skip the private-feedback-only candidates rather than flood or fail.
 *
 * Idempotent: the unique partial index on work_slips.from_review_id
 * stops the cron from creating duplicates on subsequent runs.
 *
 * Category: 'maintenance' default. Most actionable feedback is a
 * physical fix; the team re-categorizes per slip if it's owner/vendor.
 *
 * Called from:
 *   - /api/cron/sync-guesty (after the reviews upsert)
 *   - /api/cron/reviews-to-slips (manual / backfill trigger)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { z } from 'zod';

/** System sentinel for the NOT NULL created_by_email on auto-generated slips. */
const REVIEWS_BOT_EMAIL = 'reviews@helm.system';

export type ActionableReviewRow = {
  id: string;
  property_id: string | null;
  guest_name: string | null;
  channel: string | null;
  overall_rating: number | null;
  public_review: string | null;
  private_feedback: string | null;
  review_created_at: string | null;
};

export type ReviewsToSlipsResult = {
  scanned: number;
  alreadyHadSlip: number;
  skippedNoProperty: number;
  skippedNotActionable: number;
  created: number;
  slipsCreated: { slipId: string; reviewId: string; title: string }[];
};

/**
 * Walk every actionable review in public.reviews and create a slip for
 * any that don't already have one. Returns a summary suitable for
 * logging or rendering in a manual-trigger response.
 *
 * The supabase client passed in must be authorized to insert into
 * public.work_slips. In production that's the service-role client used
 * by the sync routes; in dev with anon it works because work_slips RLS
 * is permissive.
 */
/**
 * Only consider reviews from the trailing window. Without this, the first
 * successful run would generate a slip for every below-five / feedback
 * review in all of history (~years), flooding the work queue with stale
 * items. The daily cron keeps the window covered going forward, so a
 * review is always seen within its first WINDOW_DAYS. The dedup index
 * means re-checking already-slipped reviews on each run is harmless.
 */
const WINDOW_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function createSlipsFromActionableReviews(
  supabase: SupabaseClient,
  windowDays = WINDOW_DAYS,
): Promise<ReviewsToSlipsResult> {
  // 1. Pull potentially-actionable reviews in the trailing window
  //    (rating below 5 OR private_feedback present). Empty-string
  //    private_feedback gets filtered in JS since PostgREST can't
  //    express "non-empty trimmed."
  const sinceISO = new Date(Date.now() - windowDays * DAY_MS).toISOString();
  const { data: candidates, error: readErr } = await supabase
    .from('reviews')
    .select(
      'id, property_id, guest_name, channel, overall_rating, public_review, private_feedback, review_created_at',
    )
    .gte('review_created_at', sinceISO)
    .or('overall_rating.lt.5,private_feedback.not.is.null');
  if (readErr) {
    throw new Error(`reviews read failed: ${readErr.message}`);
  }

  const actionable = (candidates ?? []).filter((r) => {
    const row = r as ActionableReviewRow;
    const below5 = row.overall_rating != null && row.overall_rating < 5;
    const hasFeedback = !!(row.private_feedback && row.private_feedback.trim());
    return below5 || hasFeedback;
  }) as ActionableReviewRow[];

  if (actionable.length === 0) {
    return {
      scanned: 0,
      alreadyHadSlip: 0,
      skippedNoProperty: 0,
      skippedNotActionable: 0,
      created: 0,
      slipsCreated: [],
    };
  }

  // 2. Find which actionable reviews already have a slip linked. One
  //    query against work_slips, build a Set for O(1) lookup.
  const reviewIds = actionable.map((r) => r.id);
  const { data: existing, error: existingErr } = await supabase
    .from('work_slips')
    .select('from_review_id')
    .in('from_review_id', reviewIds);
  if (existingErr) {
    throw new Error(`work_slips read failed: ${existingErr.message}`);
  }
  const alreadyLinked = new Set<string>(
    ((existing ?? []) as Array<{ from_review_id: string | null }>)
      .map((r) => r.from_review_id)
      .filter((id): id is string => !!id),
  );

  // 3. Resolve property names so slip titles read as "20 Hammond" not
  //    "20_hammond." Pulls only the property_ids we need.
  const propertyIds = Array.from(
    new Set(actionable.map((r) => r.property_id).filter((id): id is string => !!id)),
  );
  const propertyNames = new Map<string, string>();
  if (propertyIds.length > 0) {
    const { data: props } = await supabase
      .from('properties')
      .select('id, name')
      .in('id', propertyIds);
    for (const p of (props ?? []) as Array<{ id: string; name: string }>) {
      propertyNames.set(p.id, p.name);
    }
  }

  // 4. Narrow to eligible: not already slipped, and on a Helm-tracked
  //    property. Some reviews sync from Guesty for Ryan's personal units
  //    (3246_ne_27th, 65_calderwood) that are intentionally excluded from
  //    public.properties; work_slips.property_id FKs to properties, so a
  //    slip for those would violate it and take down the bulk insert.
  let alreadyHadSlip = 0;
  let skippedNoProperty = 0;
  const eligible: ActionableReviewRow[] = [];
  for (const r of actionable) {
    if (alreadyLinked.has(r.id)) {
      alreadyHadSlip += 1;
      continue;
    }
    if (!r.property_id || !propertyNames.has(r.property_id)) {
      skippedNoProperty += 1;
      continue;
    }
    eligible.push(r);
  }

  // 5. Classify eligible reviews: which actually contain an action item?
  //    "Thank you so much!" is eligible (it's private feedback) but not
  //    actionable. The LLM separates real issues/improvements from
  //    gratitude and writes the action summary.
  const classified = await classifyReviews(eligible);

  type SlipInsert = {
    property_id: string;
    title: string;
    description: string;
    category: 'maintenance';
    priority: 'low' | 'normal' | 'high';
    status: 'open';
    from_review_id: string;
    created_by_email: string;
  };
  let skippedNotActionable = 0;
  const toInsert: SlipInsert[] = [];
  for (const r of eligible) {
    const c = classified.get(r.id);
    if (!c || !c.actionable) {
      skippedNotActionable += 1;
      continue;
    }
    const propertyName = propertyNames.get(r.property_id!) ?? r.property_id!;
    toInsert.push({
      property_id: r.property_id!,
      title: `${propertyName}: ${c.actionSummary}`,
      description: buildDescription(r, c.actionSummary),
      category: 'maintenance',
      priority: c.priority,
      status: 'open',
      from_review_id: r.id,
      // work_slips.created_by_email is NOT NULL. These slips have no human
      // author; auto-generated from review feedback. System sentinel,
      // matching the existing 'imported@perfection.legacy' convention so
      // they're filterable/identifiable.
      created_by_email: REVIEWS_BOT_EMAIL,
    });
  }

  if (toInsert.length === 0) {
    return {
      scanned: actionable.length,
      alreadyHadSlip,
      skippedNoProperty,
      skippedNotActionable,
      created: 0,
      slipsCreated: [],
    };
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('work_slips')
    .insert(toInsert)
    .select('id, title, from_review_id');
  if (insertErr) {
    throw new Error(`work_slips insert failed: ${insertErr.message}`);
  }

  const slipsCreated = ((inserted ?? []) as Array<{
    id: string;
    title: string;
    from_review_id: string;
  }>).map((s) => ({ slipId: s.id, reviewId: s.from_review_id, title: s.title }));

  return {
    scanned: actionable.length,
    alreadyHadSlip,
    skippedNoProperty,
    skippedNotActionable,
    created: slipsCreated.length,
    slipsCreated,
  };
}

// ─── classification ────────────────────────────────────────────────────

type Classification = {
  actionable: boolean;
  actionSummary: string;
  priority: 'low' | 'normal' | 'high';
};

/**
 * LLM pass over eligible reviews. Returns a map of review id →
 * classification. A review is actionable only if it names a specific
 * issue or improvement the team could do something about (broken/worn
 * item, missing supply, comfort/temperature problem, listing-accuracy
 * gap, etc.). Pure gratitude or vague praise is not actionable.
 *
 * The model occasionally drops a row from a batch response. Rather than
 * let those fall straight to the generic below-five fallback (a slip
 * with no specific action summary), we re-query the dropped rows once
 * in a smaller batch. Only rows still missing after the retry, or a
 * total gateway failure, hit the fallback.
 */
async function classifyReviews(
  reviews: ActionableReviewRow[],
): Promise<Map<string, Classification>> {
  const out = new Map<string, Classification>();
  if (reviews.length === 0) return out;

  try {
    // Pass 1: all eligible reviews.
    const first = await classifyBatch(reviews);
    for (const [id, c] of first) out.set(id, c);

    // Pass 2: re-query any the model dropped. A smaller batch usually
    // comes back complete; this recovers the specific action summary
    // instead of settling for the generic fallback.
    const missing = reviews.filter((r) => !out.has(r.id));
    if (missing.length > 0) {
      const retry = await classifyBatch(missing);
      for (const [id, c] of retry) out.set(id, c);
    }

    // Anything still absent after the retry: conservative fallback.
    for (const r of reviews) {
      if (!out.has(r.id)) out.set(r.id, fallbackClassification(r));
    }
    return out;
  } catch (err) {
    console.error('[reviews-to-slips] LLM classify failed, falling back to below-five only:', err);
    for (const r of reviews) out.set(r.id, fallbackClassification(r));
    return out;
  }
}

/** One generateObject call. Returns only the rows the model returned. */
async function classifyBatch(
  reviews: ActionableReviewRow[],
): Promise<Map<string, Classification>> {
  const out = new Map<string, Classification>();
  if (reviews.length === 0) return out;

  const { object } = await generateObject({
    model: 'anthropic/claude-sonnet-4.5',
    schema: z.object({
      classifications: z.array(
        z.object({
          review_id: z.string(),
          actionable: z.boolean(),
          action_summary: z
            .string()
            .describe('Imperative one-liner, e.g. "Replace uncomfortable master bedroom mattress". Empty string when not actionable.'),
          priority: z.enum(['low', 'normal', 'high']),
        }),
      ),
    }),
    system: `You triage guest reviews for a vacation-rental manager (Rising Tide STR, Cape Ann MA). For each review decide whether it contains a SPECIFIC, ACTIONABLE issue or improvement the operations team could act on at the property.

Actionable examples: a worn or uncomfortable furnishing, a broken or missing item, a supply that ran out, a temperature/comfort problem, a cleanliness miss, a listing-photo/description inaccuracy, mail piling up, a safety concern.

NOT actionable: pure gratitude ("Thank you so much!"), generic praise ("Loved it, beautiful place!"), or comments with no concrete thing to do.

A 5-star rating does NOT mean not-actionable: guests often rate 5 and still note a fix in private feedback. Judge the text, not the stars.

You MUST return exactly one entry for every review_id given, even when not actionable. When actionable, write action_summary as a short imperative the team can drop straight onto a work slip. Set priority high for safety issues or anything affecting the next stay, normal for routine fixes/restocks, low for nice-to-haves. When not actionable, set actionable=false, action_summary="", priority="low".`,
    prompt: `Classify each review. Return one entry per review_id, no more, no fewer.\n\n${reviews
      .map((r) =>
        [
          `review_id: ${r.id}`,
          `rating: ${r.overall_rating ?? 'none'}`,
          `public_review: ${(r.public_review || '').trim() || '(none)'}`,
          `private_feedback: ${(r.private_feedback || '').trim() || '(none)'}`,
        ].join('\n'),
      )
      .join('\n\n---\n\n')}`,
  });

  const valid = new Set(reviews.map((r) => r.id));
  for (const c of object.classifications) {
    // Guard against the model echoing an id that wasn't in this batch.
    if (!valid.has(c.review_id)) continue;
    out.set(c.review_id, {
      actionable: c.actionable,
      actionSummary: c.action_summary.trim(),
      priority: c.priority,
    });
  }
  return out;
}

/** No-LLM fallback: below-five ratings are actionable, nothing else. */
function fallbackClassification(r: ActionableReviewRow): Classification {
  const below5 = r.overall_rating != null && r.overall_rating < 5;
  return {
    actionable: below5,
    actionSummary: below5
      ? `Follow up on ${r.overall_rating}★ review from ${(r.guest_name || 'guest').trim()}`
      : '',
    priority: r.overall_rating != null && r.overall_rating <= 3 ? 'high' : 'normal',
  };
}

// ─── helpers ──────────────────────────────────────────────────────────

function buildDescription(r: ActionableReviewRow, actionSummary: string): string {
  const lines: string[] = [];
  if (actionSummary) {
    lines.push(actionSummary);
    lines.push('');
  }
  lines.push('From a guest review:');
  if (r.overall_rating != null) lines.push(`${r.overall_rating}★ overall`);
  if (r.guest_name) lines.push(`Guest: ${r.guest_name}`);
  if (r.channel) lines.push(`Channel: ${r.channel}`);
  if (r.review_created_at) {
    try {
      const d = new Date(r.review_created_at);
      lines.push(`Received: ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
    } catch {
      /* skip */
    }
  }
  if (r.public_review && r.public_review.trim()) {
    lines.push('');
    lines.push('Public review:');
    lines.push(r.public_review.trim());
  }
  if (r.private_feedback && r.private_feedback.trim()) {
    lines.push('');
    lines.push('Private feedback:');
    lines.push(r.private_feedback.trim());
  }
  return lines.join('\n').trim();
}
