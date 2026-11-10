/**
 * Reads for the Tuesday brief (weekly-brief.ts has the rules). The goals
 * come from the home page's own scorecard read, so the PDF and the band
 * never disagree; the work is the print sheet's read across every active
 * home (active slips, a snooze still running left out, linked reports
 * collapsed into one issue); the stays are canonical bookings; page two is
 * the Guesty reviews and the direct guests' testimonials that landed in the
 * week before the send. Nothing here reads money.
 *
 * The scorecard, the headlines and the reviews fail soft (a tile says
 * "Could not read"; a page prints without its headline; page two says the
 * reviews could not be read). The homes, slips, notes and stays
 * throw: a brief that silently drops a home's work is worse than none.
 */
import 'server-only';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { selectAllPaged, type PageResult } from '@/lib/paged-select';
import { collapseWorkIssues } from '@/lib/work-issues';
import { loadWorkIssueLinks } from '@/lib/work-issues-server';
import { loadWorkBriefHeadlines } from '@/lib/work-briefs';
import { loadOpsScorecard } from '@/lib/ops-scorecard-server';
import { operatingDate } from '@/lib/operating-date';
import { dropCsvTwins } from '@/lib/reviews';
import { ACTIVE_WORK_SLIP_STATUSES } from '@/lib/work-types';
import {
  addDays,
  briefWindow,
  buildWeeklyBrief,
  easternMidnightIso,
  feedbackWindow,
  type BriefHome,
  type BriefReview,
  type BriefNote,
  type BriefSlip,
  type BriefStay,
  type WeeklyBrief,
} from '@/lib/weekly-brief';

const SLIP_COLUMNS = [
  'id', 'property_id', 'title', 'description', 'action_summary', 'category', 'priority', 'status',
  'scheduled_date', 'follow_up_date', 'created_at', 'location', 'assigned_to_label', 'assigned_to_email',
  'coordinator_email', 'run_scope', 'owner_action_required', 'owner_status', 'from_supply_key',
  'from_guest_request_key', 'snoozed_until',
].join(', ');

type SlipRead = BriefSlip & { snoozed_until: string | null; assigned_to_email: string | null; coordinator_email: string | null };

const STAY_COLUMNS = 'property_id, check_in, check_out, guest_name, num_guests, channel';

const REVIEW_COLUMNS = [
  'id', 'property_id', 'guest_name', 'channel', 'source', 'overall_rating', 'public_review', 'private_feedback',
  'category_cleanliness', 'category_accuracy', 'category_checkin', 'category_communication', 'category_location',
  'category_value', 'review_created_at',
].join(', ');

type ReviewRead = Omit<BriefReview, 'slip_status'> & { source: string | null };

/**
 * Page two's reads: every Guesty review that landed between midnight
 * Eastern seven days back and midnight this morning (the CSV fallback's
 * twin dropped, as on the Reviews tab), the direct guests' testimonials
 * submitted in the same stretch, and the status of any work slip
 * reviews-to-slips filed from one. Null when a read fails.
 */
async function loadWeekReviews(today: string): Promise<BriefReview[] | null> {
  const { from } = feedbackWindow(today);
  const since = easternMidnightIso(from);
  const until = easternMidnightIso(today);
  try {
    const [reviewRows, testimonials] = await Promise.all([
      selectAllPaged<ReviewRead>((f, t) =>
        supabase
          .from('reviews')
          .select(REVIEW_COLUMNS)
          .gte('review_created_at', since)
          .lt('review_created_at', until)
          .order('review_created_at')
          .order('id')
          .range(f, t) as unknown as PromiseLike<PageResult<ReviewRead>>),
      supabase
        .from('guest_testimonials')
        .select('id, property_id, guest_name, guest_first, rating, body, submitted_at')
        .in('status', ['submitted', 'approved', 'hidden'])
        .gte('submitted_at', since)
        .lt('submitted_at', until)
        .limit(500),
    ]);
    if (testimonials.error) throw new Error(testimonials.error.message);
    const guesty = dropCsvTwins(reviewRows);
    const ids = guesty.map((r) => r.id);
    const slipStatus = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase
        .from('work_slips')
        .select('from_review_id, status')
        .in('from_review_id', ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as Array<{ from_review_id: string | null; status: string }>) {
        if (row.from_review_id) slipStatus.set(row.from_review_id, row.status);
      }
    }
    const direct: BriefReview[] = ((testimonials.data ?? []) as Array<{
      id: string; property_id: string; guest_name: string; guest_first: string; rating: number | null; body: string; submitted_at: string;
    }>).map((t) => ({
      id: `testimonial:${t.id}`,
      property_id: t.property_id,
      guest_name: t.guest_name?.trim() || t.guest_first?.trim() || null,
      channel: 'sca',
      overall_rating: t.rating,
      public_review: t.body,
      private_feedback: null,
      review_created_at: t.submitted_at,
    }));
    return [
      ...guesty.map((r): BriefReview => ({
        id: r.id,
        property_id: r.property_id,
        guest_name: r.guest_name,
        channel: r.channel,
        overall_rating: r.overall_rating,
        public_review: r.public_review,
        private_feedback: r.private_feedback,
        category_cleanliness: r.category_cleanliness,
        category_accuracy: r.category_accuracy,
        category_checkin: r.category_checkin,
        category_communication: r.category_communication,
        category_location: r.category_location,
        category_value: r.category_value,
        review_created_at: r.review_created_at,
        slip_status: slipStatus.get(r.id) ?? null,
      })),
      ...direct,
    ];
  } catch (err) {
    console.error('[weekly-brief] reviews', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function loadWeeklyBrief(today: string = operatingDate()): Promise<WeeklyBrief> {
  const { from, to } = briefWindow(today);

  const [scorecard, headlines, reviews, homesRes, slipRows, links, noteRows, arrivals, departures] = await Promise.all([
    loadOpsScorecard().catch(() => null),
    loadWorkBriefHeadlines(supabase).catch(() => ({}) as Record<string, { headline: string }>),
    loadWeekReviews(today),
    supabase.from('properties').select('id, name, address, owner_last').eq('is_active', true).limit(500),
    selectAllPaged<SlipRead>((f, t) =>
      supabase.from('work_slips').select(SLIP_COLUMNS).in('status', ACTIVE_WORK_SLIP_STATUSES).order('id').range(f, t) as unknown as PromiseLike<PageResult<SlipRead>>),
    loadWorkIssueLinks(supabase),
    selectAllPaged<BriefNote>((f, t) =>
      supabase
        .from('property_notes')
        .select('id, property_id, title, body, created_at')
        .eq('kind', 'issue')
        .is('resolved_at', null)
        .order('id')
        .range(f, t)),
    selectAllPaged<BriefStay>((f, t) =>
      supabase
        .from('bookings')
        .select(STAY_COLUMNS)
        .in('status', ['confirmed', 'completed'])
        .is('duplicate_of', null)
        .gte('check_in', from)
        .lte('check_in', to)
        .order('check_in')
        .order('id')
        .range(f, t)),
    // Departures only mark a same-day turn and keep a carried-on stay off
    // the arrivals; the day after the window is never needed.
    selectAllPaged<BriefStay>((f, t) =>
      supabase
        .from('bookings')
        .select(STAY_COLUMNS)
        .in('status', ['confirmed', 'completed'])
        .is('duplicate_of', null)
        .gte('check_out', from)
        .lt('check_out', addDays(to, 1))
        .order('check_out')
        .order('id')
        .range(f, t)),
  ]);
  if (homesRes.error) throw new Error(`properties: ${homesRes.error.message}`);

  // A snooze still running keeps a slip off the brief, as it does off the
  // print sheet; one ending today puts it back.
  const awake = slipRows.filter((s) => !s.snoozed_until || s.snoozed_until.slice(0, 10) <= today);
  const slips = collapseWorkIssues(awake, links);

  const headlineText: Record<string, string> = {};
  for (const [id, h] of Object.entries(headlines)) if (h?.headline) headlineText[id] = h.headline;

  return buildWeeklyBrief({
    today,
    scorecard,
    homes: (homesRes.data ?? []) as BriefHome[],
    slips,
    notes: noteRows,
    arrivals,
    departures,
    headlines: headlineText,
    reviews,
  });
}
