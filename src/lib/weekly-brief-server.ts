/**
 * Reads for the Tuesday brief (weekly-brief.ts has the rules). The goals
 * come from the home page's own scorecard read, so the PDF and the band
 * never disagree; the work is the print sheet's read across every active
 * home (active slips, a snooze still running left out, linked reports
 * collapsed into one issue); the stays are canonical bookings. Nothing here
 * reads money.
 *
 * The scorecard and the headlines fail soft (a tile says "Could not read";
 * a page prints without its headline). The homes, slips, notes and stays
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
import { ACTIVE_WORK_SLIP_STATUSES } from '@/lib/work-types';
import {
  addDays,
  briefWindow,
  buildWeeklyBrief,
  type BriefHome,
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

export async function loadWeeklyBrief(today: string = operatingDate()): Promise<WeeklyBrief> {
  const { from, to } = briefWindow(today);

  const [scorecard, headlines, homesRes, slipRows, links, noteRows, arrivals, departures] = await Promise.all([
    loadOpsScorecard().catch(() => null),
    loadWorkBriefHeadlines(supabase).catch(() => ({}) as Record<string, { headline: string }>),
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
  });
}
