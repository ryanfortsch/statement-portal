/**
 * The brief at the top of a home's work sheet: one line for the Work board
 * and a short paragraph for the property page and the print sheet, written
 * by the model from the home's open slips, grouped by lane.
 *
 * Lanes (lib/work-slip-lanes.ts) made the list sortable, not readable:
 * 17 Beach still rendered fifteen equal-weight rows, five of them a
 * shopping list. What a reader needs first is the paragraph a seasoned
 * operations manager would write: what is blocking, what needs a pro, what
 * a handyman run should cover, what the next visit knocks out, what to
 * bring, what the owner owes, what is for the office. The ledger of slips
 * sits under it, compact, as the receipts.
 *
 * Stable by construction: a brief is rewritten only when the slip set it
 * was written from changes (lib/work-brief-rules.ts briefFingerprint), so
 * the text does not drift night to night and the model runs only for the
 * homes that moved. Runs from /api/cron/work-briefs (05:05 UTC, after the
 * organize pass) and after the Work board's Organize button.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { z } from 'zod';
import { selectAllPaged, type PageResult } from './paged-select';
import type { WorkSlipRow } from './work-types';
import { ACTIVE_WORK_SLIP_STATUSES } from './work-types';
import { groupSlipsByLane, LANE_LABELS, slipDetailLine, slipDisplayTitle, supplyChipLabel } from './work-slip-lanes';
import { ageWords, briefFingerprint, trimHeadline, type WorkBriefRow } from './work-brief-rules';

export type { WorkBriefRow } from './work-brief-rules';

/** Same gateway model string the organize pass and the miners use. */
const MODEL = 'anthropic/claude-sonnet-4.5';
const DEFAULT_MAX_PROPERTIES = 30;
const RUN_BUDGET_MS = 230_000;

const BRIEF_COLS =
  'id, property_id, title, description, action_summary, category, priority, status, run_scope, ' +
  'owner_action_required, owner_action_type, owner_status, owner_last_contacted_at, organize_group, organize_group_label, ' +
  'scheduled_date, assigned_to_email, assigned_to_label, from_supply_key, from_guest_request_key, snoozed_until, created_at';

type BriefSlipRow = Pick<
  WorkSlipRow,
  | 'id'
  | 'property_id'
  | 'title'
  | 'description'
  | 'action_summary'
  | 'category'
  | 'priority'
  | 'status'
  | 'run_scope'
  | 'owner_action_required'
  | 'owner_action_type'
  | 'owner_status'
  | 'owner_last_contacted_at'
  | 'organize_group'
  | 'organize_group_label'
  | 'scheduled_date'
  | 'assigned_to_email'
  | 'assigned_to_label'
  | 'from_supply_key'
  | 'from_guest_request_key'
  | 'snoozed_until'
  | 'created_at'
>;

export type RefreshBriefsResult = {
  checked: number;
  refreshed: number;
  unchanged: number;
  emptied: number;
  truncated: boolean;
  errors: string[];
};

export async function loadWorkBrief(supabase: SupabaseClient, propertyId: string): Promise<WorkBriefRow | null> {
  const { data } = await supabase.from('property_work_briefs').select('*').eq('property_id', propertyId).maybeSingle();
  return (data as WorkBriefRow | null) ?? null;
}

/** property id -> headline, for the Work board's home headers. */
export async function loadWorkBriefHeadlines(supabase: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await supabase.from('property_work_briefs').select('property_id, headline, slip_count').gt('slip_count', 0);
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as Array<{ property_id: string; headline: string }>) {
    if (r.headline) out[r.property_id] = r.headline;
  }
  return out;
}

const BriefSchema = z.object({
  headline: z
    .string()
    .describe('One line under 90 characters, no trailing period: the three or four things that matter most at this home.'),
  brief: z
    .string()
    .describe('One paragraph, two to five plain sentences, under 110 words. No bullets, headings, markdown or em dashes.'),
});

const SYSTEM_PROMPT = `You write the brief at the top of a home's work sheet for Rising Tide STR, a vacation-rental manager on Cape Ann, MA. The reader is the operator deciding what to do about this home this week, or the field inspector about to walk it. Write like a seasoned operations manager: plain declarative sentences, specific, no filler, no hedging.

Order: whatever is blocking or urgent first (safety, security, a leak, anything that hits the next guest), then what needs a licensed pro, what a handyman run should cover, what the next routine visit knocks out, what to bring, what is waiting on the owner, and what is for the office. Skip a lane that is empty. Fold clustered slips into one item.

This is a brief, not an inventory. Do not enumerate every slip: name what matters (the urgent item, the pro jobs, the owner's items, the two or three biggest handyman jobs) and roll the rest up by count, for example "plus six smaller fixes on the next routine visit". The ledger under the brief lists everything; you do not have to.

Name rooms, fixtures, dates and contractor names when the slips give them. Never a guest's name, even when a slip's own text uses one: write "a guest", "the arriving guest" or "the Oct 11 review". Do not give day counts; mention age only for one item past 60 days, in words ("the kitchen sprayer has waited since July"). Do not restate counts the sheet already shows.

headline: one line under 90 characters, no trailing period, for example "Plumber for the kitchen sink; handyman for the blind and the guest-house counter; bring TP and pods".
brief: one paragraph, two to four sentences, under 90 words even for a long list. No bullets, no headings, no markdown, no em dashes.`;

/** The concierge's guest-gear and stay-note slips carry the guest's name in
 *  their own text by design. The model reads only their titles, which do
 *  not, so no name can reach the sheet by quotation. */
function namesAGuest(s: BriefSlipRow): boolean {
  const key = s.from_guest_request_key ?? '';
  return key.startsWith('gear:') || key.startsWith('staycontact:');
}

/** Two concierge rails name the guest in the TITLE itself (a 2027
 *  pre-release payment link, a far-future inquiry). The model reads a
 *  generic line for those instead; the slip page keeps the particulars. */
function genericTitle(s: BriefSlipRow): string | null {
  const key = s.from_guest_request_key ?? '';
  if (key.startsWith('prerelease-paylink:')) return 'Send a 2027 pre-release payment link to a guest (office)';
  if (key.startsWith('ffhold:')) return 'Follow up a far-future inquiry when the calendar opens (office)';
  return null;
}

function briefLine(s: BriefSlipRow, propertyName: string): string {
  const parts: string[] = [];
  const generic = genericTitle(s);
  const title = generic ?? slipDisplayTitle(s.title, propertyName);
  const detail = generic || namesAGuest(s)
    ? null
    : slipDetailLine({ title: s.title, action_summary: s.action_summary, description: s.description }, propertyName, 220);
  parts.push(detail ? `${title}: ${detail}` : title);
  const flags: string[] = [];
  if (s.priority === 'high') flags.push('HIGH priority');
  if (s.status === 'in_progress') flags.push('started');
  if (s.scheduled_date) flags.push(`for ${s.scheduled_date}`);
  if (s.assigned_to_label || s.assigned_to_email) flags.push(`assigned to ${s.assigned_to_label || s.assigned_to_email!.split('@')[0]}`);
  if (s.owner_action_required) {
    flags.push(
      `owner must ${s.owner_action_type ?? 'act'}${
        s.owner_status === 'approved' ? ', approved' : s.owner_status === 'declined' ? ', declined' : s.owner_status === 'questions' ? ', owner has questions' : s.owner_last_contacted_at ? ', asked' : ', not asked yet'
      }`,
    );
  }
  if (s.organize_group_label) flags.push(`cluster: ${s.organize_group_label}`);
  const age = ageWords(s.created_at);
  if (age) flags.push(age);
  return `- ${parts.join(' ')}${flags.length ? ` (${flags.join('; ')})` : ''}`;
}

function buildPrompt(propertyName: string, risingTideOwned: boolean, slips: BriefSlipRow[]): string {
  const lanes = groupSlipsByLane(slips);
  const sections = lanes.map(({ lane, slips: laneSlips }) => {
    if (lane === 'supply') {
      return `${LANE_LABELS[lane].toUpperCase()} (${laneSlips.length})\n- bring: ${laneSlips.map((s) => supplyChipLabel(s, propertyName)).join(', ')}`;
    }
    return `${LANE_LABELS[lane].toUpperCase()} (${laneSlips.length})\n${laneSlips.map((s) => briefLine(s, propertyName)).join('\n')}`;
  });
  return `Home: ${propertyName} (${risingTideOwned ? 'owned by Rising Tide itself: there is no owner to ask' : 'owned by a client; Rising Tide manages it'})

Open slips by lane:

${sections.join('\n\n')}`;
}

/** Past this, the brief has become the list it was meant to replace: one
 *  more call cuts it rather than clipping prose mid-sentence. */
const BRIEF_MAX_WORDS = 110;

const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

async function writeBrief(propertyName: string, risingTideOwned: boolean, slips: BriefSlipRow[]): Promise<{ headline: string; brief: string }> {
  const prompt = buildPrompt(propertyName, risingTideOwned, slips);
  const first = await generateObject({ model: MODEL, schema: BriefSchema, maxOutputTokens: 800, system: SYSTEM_PROMPT, prompt });
  let { headline, brief } = first.object;
  if (wordCount(brief) > BRIEF_MAX_WORDS) {
    const second = await generateObject({
      model: MODEL,
      schema: BriefSchema,
      maxOutputTokens: 800,
      system: SYSTEM_PROMPT,
      prompt: `${prompt}

Your previous draft ran to ${wordCount(brief)} words:
"${brief}"

Cut it to under 90 words. Keep the urgent item, the pro jobs, the owner's items and the biggest handyman jobs by name; roll everything else up by count. Keep the headline unless it names something you dropped.`,
    });
    headline = second.object.headline;
    brief = second.object.brief;
  }
  return {
    headline: trimHeadline(headline),
    brief: brief.replace(/\s+/g, ' ').trim().slice(0, 1200),
  };
}

/**
 * Rewrite the brief for every home whose open slip set changed since its
 * brief was written (or for one home, or all homes with `force`). A home
 * with no open slips gets an empty brief so nothing stale shows.
 */
export async function refreshWorkBriefs(
  supabase: SupabaseClient,
  opts: { propertyId?: string; force?: boolean; maxProperties?: number; budgetMs?: number } = {},
): Promise<RefreshBriefsResult> {
  const startMs = Date.now();
  const budgetMs = opts.budgetMs ?? RUN_BUDGET_MS;
  const result: RefreshBriefsResult = { checked: 0, refreshed: 0, unchanged: 0, emptied: 0, truncated: false, errors: [] };
  const todayIso = new Date().toISOString().slice(0, 10);

  const { data: propRows, error: propErr } = await supabase.from('properties').select('id, name, is_rising_tide_owned');
  if (propErr) throw new Error(`briefs properties read failed: ${propErr.message}`);
  const properties = ((propRows ?? []) as Array<{ id: string; name: string | null; is_rising_tide_owned: boolean | null }>)
    .filter((p) => !opts.propertyId || p.id === opts.propertyId)
    .map((p) => ({ id: p.id, name: p.name || p.id, risingTideOwned: !!p.is_rising_tide_owned }));

  const slips = await selectAllPaged<BriefSlipRow>(
    (from, to) => {
      let q = supabase
        .from('work_slips')
        .select(BRIEF_COLS)
        .in('status', ACTIVE_WORK_SLIP_STATUSES)
        .or(`snoozed_until.is.null,snoozed_until.lte.${todayIso}`);
      if (opts.propertyId) q = q.eq('property_id', opts.propertyId);
      return q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to) as unknown as PromiseLike<PageResult<BriefSlipRow>>;
    },
    { label: 'briefs slips' },
  );
  const byProperty = new Map<string, BriefSlipRow[]>();
  for (const s of slips) {
    const list = byProperty.get(s.property_id) ?? [];
    list.push(s);
    byProperty.set(s.property_id, list);
  }

  const { data: briefRows } = await supabase.from('property_work_briefs').select('*');
  const existing = new Map(((briefRows ?? []) as WorkBriefRow[]).map((b) => [b.property_id, b]));

  const cap = Math.max(1, opts.maxProperties ?? DEFAULT_MAX_PROPERTIES);
  let calls = 0;
  for (const property of properties) {
    const list = byProperty.get(property.id) ?? [];
    const current = existing.get(property.id);
    const fingerprint = briefFingerprint(list);
    result.checked += 1;

    if (list.length === 0) {
      if (current && current.slip_count === 0 && current.slip_fingerprint === fingerprint) {
        result.unchanged += 1;
        continue;
      }
      const { error } = await supabase.from('property_work_briefs').upsert({
        property_id: property.id,
        headline: '',
        brief: '',
        slip_fingerprint: fingerprint,
        slip_count: 0,
        model: null,
        generated_at: new Date().toISOString(),
      });
      if (error) result.errors.push(`${property.name}: ${error.message}`);
      else result.emptied += 1;
      continue;
    }

    if (!opts.force && current && current.slip_fingerprint === fingerprint && current.brief) {
      result.unchanged += 1;
      continue;
    }
    if (calls >= cap || Date.now() - startMs > budgetMs) {
      result.truncated = true;
      continue;
    }
    calls += 1;
    try {
      const text = await writeBrief(property.name, property.risingTideOwned, list);
      const { error } = await supabase.from('property_work_briefs').upsert({
        property_id: property.id,
        headline: text.headline,
        brief: text.brief,
        slip_fingerprint: fingerprint,
        slip_count: list.length,
        model: MODEL,
        generated_at: new Date().toISOString(),
      });
      if (error) result.errors.push(`${property.name}: ${error.message}`);
      else result.refreshed += 1;
    } catch (err) {
      result.errors.push(`${property.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
