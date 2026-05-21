/**
 * Auto-create work slips from Guesty review feedback.
 *
 * A review is "actionable" if any of these hold:
 *   - overall_rating < 5  (below-five star rating)
 *   - private_feedback is non-empty  (anything they didn't say publicly)
 *
 * For each actionable review that doesn't already have a slip linked
 * (work_slips.from_review_id), a new slip is created on the review's
 * property. Idempotent: the unique partial index on from_review_id
 * stops the cron from creating duplicates on subsequent runs.
 *
 * Priority:
 *   - rating <= 3:  high
 *   - rating == 4:  normal
 *   - rating null but private_feedback present:  normal
 *
 * Category:
 *   - 'maintenance' as the default. Most actionable review feedback is
 *     a physical fix at the property (skillet, temperature, cleanliness,
 *     etc.). The team can re-categorize per slip if it's actually
 *     "owner" or "vendor."
 *
 * Called from:
 *   - /api/cron/sync-guesty (after the reviews upsert)
 *   - /api/cron/reviews-to-slips (manual / backfill trigger)
 */

import type { SupabaseClient } from '@supabase/supabase-js';

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
export async function createSlipsFromActionableReviews(
  supabase: SupabaseClient,
): Promise<ReviewsToSlipsResult> {
  // 1. Pull every potentially-actionable review (rating below 5 OR
  //    private_feedback present). Empty-string private_feedback gets
  //    filtered in JS since PostgREST can't express "non-empty trimmed."
  const { data: candidates, error: readErr } = await supabase
    .from('reviews')
    .select(
      'id, property_id, guest_name, channel, overall_rating, public_review, private_feedback, review_created_at',
    )
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

  // 4. Build slip rows and bulk-insert. Skip reviews without property_id
  //    (can't FK to properties) and reviews already linked.
  let alreadyHadSlip = 0;
  let skippedNoProperty = 0;
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
  const toInsert: SlipInsert[] = [];
  for (const r of actionable) {
    if (alreadyLinked.has(r.id)) {
      alreadyHadSlip += 1;
      continue;
    }
    if (!r.property_id) {
      skippedNoProperty += 1;
      continue;
    }
    const propertyName = propertyNames.get(r.property_id) ?? r.property_id;
    toInsert.push({
      property_id: r.property_id,
      title: buildTitle(r, propertyName),
      description: buildDescription(r),
      category: 'maintenance',
      priority: priorityForRating(r.overall_rating),
      status: 'open',
      from_review_id: r.id,
      // work_slips.created_by_email is NOT NULL. These slips have no human
      // author — they're auto-generated from review feedback. Use a system
      // sentinel, matching the existing 'imported@perfection.legacy'
      // convention so they're filterable/identifiable.
      created_by_email: REVIEWS_BOT_EMAIL,
    });
  }

  if (toInsert.length === 0) {
    return {
      scanned: actionable.length,
      alreadyHadSlip,
      skippedNoProperty,
      created: 0,
      slipsCreated: [],
    };
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('work_slips')
    .insert(toInsert)
    .select('id, title, from_review_id');
  if (insertErr) {
    // Race with another caller hitting the same review: the unique index
    // will reject one. Surface but don't crash — re-running picks up
    // where we left off.
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
    created: slipsCreated.length,
    slipsCreated,
  };
}

// ─── helpers ──────────────────────────────────────────────────────────

function priorityForRating(rating: number | null): 'low' | 'normal' | 'high' {
  if (rating != null && rating <= 3) return 'high';
  return 'normal';
}

function buildTitle(r: ActionableReviewRow, propertyName: string): string {
  const guestFirst = (r.guest_name || '').trim().split(/\s+/)[0] || 'Guest';
  const star = r.overall_rating != null ? `${r.overall_rating}★ ` : '';
  return `Review · ${propertyName} · ${star}${guestFirst}`;
}

function buildDescription(r: ActionableReviewRow): string {
  const lines: string[] = [];
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
