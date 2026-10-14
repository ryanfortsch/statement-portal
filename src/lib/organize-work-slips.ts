/**
 * The nightly organize pass: file every NEW open work slip into a lane.
 *
 * Slips reach the board from six directions (field inspectors, guest
 * reviews, guest messages, inspections, cleaner and owner emails, the
 * office) and almost all of them land as category 'maintenance', the
 * creation default. By 2026-10-14 that meant 253 of 307 open slips read as
 * maintenance, one slip in the whole fleet was filed under Owner, and the
 * owner-action rail (Draft Owner Email, the daily brief, the OWNER badges)
 * had nothing to show while nine "Suggested Owner Purchases" slips sat on
 * inspectors' checklists. Review slips pasted the whole review into the
 * description, so the printed sheet ran a page per guest.
 *
 * This pass reads each new slip's language ONCE (per home, so it can see
 * the whole list) and writes only columns the app already understands:
 *
 *   lane      category (+ run_scope when untriaged, + the owner flag and
 *             ask when the owner must act). The lane itself is derived by
 *             lib/work-slip-lanes.ts from those columns; nothing new is
 *             stored for it.
 *   summary   action_summary, ONLY where it is empty and the description
 *             is a pasted source or long. One imperative line with the
 *             specifics, so the sheet carries the synthesis and the slip
 *             page keeps the full text.
 *   group     organize_group / _label for slips plainly about the same
 *             object (one door's lock and handle, one shopping list), so
 *             the board and sheet keep them together.
 *   stamp     organized_at + organize_note (the one line of why).
 *
 * It never writes title or description. It never revisits a slip:
 * organized_at IS NULL is the whole sweep, and every operator lane edit
 * (category, scope, owner flag) stamps the same column, so a human decision
 * is never re-filed. Concierge-keyed slips (gear, stay notes, readiness,
 * payment links), supplies-check restocks and prep-rule slips are skipped:
 * each has its own lifecycle and its own lane already. Slips backing a
 * Field packet (setup and one-off jobs) are skipped so the robot can never
 * move one into the maintenance pool.
 *
 * Fail-soft: a gateway error at one home skips that home and reports it;
 * the slips stay NULL and are retried next pass.
 *
 * Runs from /api/cron/organize-work (nightly, before the field-packets
 * cron plans maintenance runs) and from the Work board's Organize button.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { z } from 'zod';
import { selectAllPaged, type PageResult } from './paged-select';
import { slipDisplayTitle, slipLane, slipSourceLabel, type WorkLane } from './work-slip-lanes';
import {
  ORGANIZE_SLIP_COLS,
  planOrganizeWrites,
  resolveGroups,
  type OrganizeProperty,
  type OrganizeResult,
  type OrganizeSlip,
} from './organize-work-slips-rules';

export {
  ORGANIZE_SLIP_COLS,
  planOrganizeWrites,
  resolveGroups,
  sanitizeGroupKey,
  wantsSummary,
  type DecisionLane,
  type GroupProposal,
  type LaneDecision,
  type OrganizeProperty,
  type OrganizeResult,
  type OrganizeSlip,
} from './organize-work-slips-rules';

/** Same gateway model string the sibling miners use (reviews-to-slips,
 *  messages-to-slips, maintenance-runs). One place to bump. */
const MODEL = 'anthropic/claude-sonnet-4.5';

/** Homes per run. The first pass on a 300-slip backlog spans two or three
 *  runs; the nightly cadence (and the board button) drains the rest. */
const DEFAULT_MAX_PROPERTIES = 12;
/** Wall-clock budget: the cron route has 300s and one home is one model
 *  call of a few seconds. */
const RUN_BUDGET_MS = 230_000;
/** Already-organized slips shown to the model as context per home. */
const CONTEXT_CAP = 60;
/** A review slip's private feedback sits at the END of its pasted
 *  description, after the public review; a short clip cut it off and the
 *  model filed a hardware repair as desk work (73 Rocky Neck, 2026-10-14). */
const DESCRIPTION_CHARS = 2000;

const ELIGIBLE_STATUSES = ['open', 'in_progress'];
const CONTEXT_STATUSES = ['open', 'in_progress', 'scheduled', 'blocked'];

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

// ─── the model ─────────────────────────────────────────────────────────

const DecisionSchema = z.object({
  decisions: z.array(
    z.object({
      slip_id: z.string(),
      lane: z.enum(['visit', 'handyman', 'pro', 'owner', 'supply', 'office']),
      owner_ask: z
        .enum(['purchase', 'approve', 'decide', 'schedule', 'none'])
        .describe("What the owner must do when lane is 'owner'; 'none' otherwise."),
      summary: z
        .string()
        .describe('One imperative line (max 140 characters) with the specifics, or an empty string when the title and description already say it in one short line.'),
      note: z.string().describe('One short line (max 120 characters) on why this lane, naming the deciding detail.'),
      group_key: z
        .string()
        .describe('Stable kebab-case key for the object or system this slip shares with at least one other slip at this home, e.g. "back-door-hardware". Empty string when standalone.'),
      group_label: z.string().describe('Short label for group_key (max 40 characters). Empty string when standalone.'),
    }),
  ),
});

const SYSTEM_PROMPT = `You organize open work slips for Rising Tide STR, a vacation-rental manager on Cape Ann, MA. The slips at one home are a mix: field inspectors flag things after visits, guests report problems in reviews and messages, inspections open issues, the office files notes. Your job is to say whose hands each slip goes to, so the printed checklist for a visit carries only the visit's work. You never rewrite a slip; you file it.

Lanes:
- visit: a field inspector does it during a routine turnover stop in under ~20 minutes with common supplies and hand tools: swap a bulb or battery, tighten a hinge, replace a shower curtain or switch plate, spot-clean a rug, test detectors, reset a breaker, locate a shutoff, drop off a stock item, check or verify something, set up guest gear.
- handyman: a dedicated maintenance visit by a general handyman: real tools, parts to source, more than ~30 minutes, moderate skill. Doors and locks needing adjustment, drywall patch and paint, re-caulking, screens to measure and install, dryer vent cleaning, furniture repair, appliance troubleshooting short of licensed work.
- pro: a licensed or specialty trade: plumber, electrician, HVAC, gas fireplace, roofer, appliance technician, exterminator, tree work, anything permit-adjacent. Also an outside vendor the office must book for the job.
- owner: the OWNER has to buy, approve or decide before anyone can act. Rising Tide stocks consumables and small replaceables from its own closet: paper goods, coffee pods, soap, trash bags, batteries, bulbs, filters, cleaning supplies, basic hardware such as a switch plate. The owner buys durable furnishings, housewares and equipment: cookware, small appliances, lamps, rugs, pillows and throws, furniture, grills, umbrellas, bins, window coverings, towel and linen sets, decor. A slip titled "Owner Purchases" or "Suggested Owner Purchases" is owner lane with owner_ask purchase. A replacement or project the owner must sign off on (a new lamp, a new fixture, anything beyond a routine fix) is owner with owner_ask approve. If the home is owned by Rising Tide itself there is no owner; file purchases as supply instead.
- supply: Rising Tide's own restock or small purchase: a consumable running low, a missing stock item the closet carries, something the office orders without the owner.
- office: desk work with nothing to do in the house: listing or knowledge-base text, notes to write for guests or cleaners, message automations, receipts and payment links, owner or vendor correspondence (including an owner's email asking whether work is scheduled: the reply is the job), confirming a vendor appointment already arranged, process questions for the office, inspection checklist suggestions.

Rules:
- Judge the thing itself, not who filed it. An inspector's "Suggested Owner Purchases" is owner lane even though an inspector wrote it.
- A guest review or message that reports something broken, worn or missing is house work (visit, handyman or pro by what the fix needs) even when the specifics are thin. Office is only for a slip with no work in the house at all.
- A slip already sitting on a scheduled maintenance run is spoken for: keep its lane unless it plainly is not house work at all (correspondence, a purchase the owner must make first).
- A slip already triaged as handyman or pro stays in that lane unless it plainly is not maintenance at all (an owner purchase, a supply, desk work). Do not re-argue inspector versus handyman on a triaged slip.
- A slip that mixes an owner purchase with a fix goes by its blocking step: if nothing can happen until the owner buys or approves, it is owner.
- summary: when the description is a pasted review, message or email, or is long, write ONE imperative line (max 140 characters) that says exactly what to do and keeps the specifics: which room or fixture, what the guest or inspector said that matters, a date or a contractor's name when it changes the job. Never a guest's name: the line prints on a sheet a contractor carries. Say "a guest" or "the Oct 11 review". Leave summary empty when the title and description already say it in one short line. Never restate the title.
- note: one short line (max 120 characters) on why this lane, naming the deciding detail. No guest names here either.
- group: when two or more slips at this home are plainly about the same object or system (the same door's lock and handle, the same shower's temperature and pressure, one shopping list, a recycling bin asked for twice), give them the same group_key (kebab-case, derived from the object, stable across runs) and the same short group_label. Reuse a key from the already-organized list when a new slip belongs with it. Never group by room or by lane alone. Leave both empty for standalone slips.
- Return exactly one decision per slip_id in the "To organize" list, no more, no fewer.`;

type Decision = z.infer<typeof DecisionSchema>['decisions'][number];

function ageDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function filedBy(slip: OrganizeSlip): string {
  const who = slipSourceLabel(slip);
  const d = ageDays(slip.created_at);
  return `${who}, ${d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`}`;
}

function describeSlip(slip: OrganizeSlip, property: OrganizeProperty, onRun: boolean): string {
  const lines = [
    `slip_id: ${slip.id}`,
    `title: ${slipDisplayTitle(slip.title, property.name)}`,
    `filed by: ${filedBy(slip)}`,
    `status: ${slip.status}${slip.scheduled_date ? `, scheduled ${slip.scheduled_date}` : ''}${onRun ? ', on a scheduled maintenance run' : ''}`,
    `category now: ${slip.category}${
      slip.category === 'maintenance'
        ? slip.run_scope
          ? `, triaged ${slip.run_scope}${slip.run_scope_note ? ` ("${clip(slip.run_scope_note, 120)}")` : ''}`
          : ', not yet triaged'
        : ''
    }${slip.owner_action_required ? ', flagged for owner input' : ''}`,
    `priority: ${slip.priority}`,
  ];
  if (slip.last_verified_open_at) lines.push(`still open as of: ${slip.last_verified_open_at.slice(0, 10)}`);
  if (slip.location) lines.push(`location: ${slip.location}`);
  if (slip.action_summary?.trim()) lines.push(`action summary: ${clip(slip.action_summary, 300)}`);
  const desc = (slip.description ?? '').trim();
  lines.push(`description: ${desc ? (desc.length > DESCRIPTION_CHARS ? `${desc.slice(0, DESCRIPTION_CHARS)} [...]` : desc) : '(none)'}`);
  return lines.join('\n');
}

function contextLine(slip: OrganizeSlip, property: OrganizeProperty): string {
  const lane = slipLane(slip);
  const group = slip.organize_group ? ` [group ${slip.organize_group} "${slip.organize_group_label ?? ''}"]` : '';
  return `- [${lane}]${group} ${clip(slipDisplayTitle(slip.title, property.name), 120)} (${slip.priority}, ${slip.status})`;
}

async function decideForProperty(
  property: OrganizeProperty,
  toOrganize: OrganizeSlip[],
  context: OrganizeSlip[],
  onRun: Set<string>,
): Promise<Decision[]> {
  const { object } = await generateObject({
    model: MODEL,
    schema: DecisionSchema,
    maxOutputTokens: 12_000,
    system: SYSTEM_PROMPT,
    prompt: `Home: ${property.name} (${property.isRisingTideOwned ? 'owned by Rising Tide itself: no owner, file purchases as supply' : 'owned by a client; Rising Tide manages it'})

Already organized at this home (context only; return no decision for these; reuse a group key when a new slip belongs with it):
${context.length ? context.map((s) => contextLine(s, property)).join('\n') : '(none)'}

To organize (one decision each):

${toOrganize.map((s) => describeSlip(s, property, onRun.has(s.id))).join('\n\n---\n\n')}`,
  });
  const valid = new Set(toOrganize.map((s) => s.id));
  return object.decisions.filter((d) => valid.has(d.slip_id));
}

// ─── orchestration ─────────────────────────────────────────────────────

/** The sweep: active, never organized, and not owned by another rail. The
 *  three provenance keys each carry their own lifecycle and lane (concierge
 *  gear and stay notes, supplies-check restocks, prep rules); ad_hoc slips
 *  back one-off Field packets. */
function applyEligibleFilters(supabase: SupabaseClient, cols: string, countOnly: boolean) {
  const base = countOnly
    ? supabase.from('work_slips').select(cols, { count: 'exact', head: true })
    : supabase.from('work_slips').select(cols);
  return base
    .in('status', ELIGIBLE_STATUSES)
    .is('organized_at', null)
    .is('from_guest_request_key', null)
    .is('from_supply_key', null)
    .is('from_prep_rule_key', null)
    .neq('category', 'ad_hoc');
}

/** Slip ids a Field packet stop points at. For a setup or one-off packet
 *  (category rising_tide / ad_hoc) the slip IS the job and is never
 *  re-laned; an ordinary maintenance slip bundled onto a run is organized
 *  like any other, with the run named in what the model reads. */
async function packetBackedSlipIds(supabase: SupabaseClient): Promise<Set<string>> {
  const rows = await selectAllPaged<{ work_slip_id: string | null }>(
    (from, to) =>
      supabase
        .from('packet_stops')
        .select('work_slip_id')
        .not('work_slip_id', 'is', null)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PageResult<{ work_slip_id: string | null }>>,
    { label: 'organize packet stops' },
  );
  return new Set(rows.map((r) => r.work_slip_id).filter((v): v is string => !!v));
}

/** How many active slips the pass has not seen yet (the board's button
 *  reports this before kicking the pass off in the background). */
export async function countUnorganizedSlips(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await applyEligibleFilters(supabase, 'id', true);
  if (error) throw new Error(`organize count failed: ${error.message}`);
  return count ?? 0;
}

export type OrganizePreview = {
  slipId: string;
  title: string;
  lane: WorkLane;
  patch: Record<string, unknown>;
};

export async function organizeOpenWorkSlips(
  supabase: SupabaseClient,
  opts: {
    maxProperties?: number;
    propertyId?: string;
    budgetMs?: number;
    /** Decide and report, write nothing. The cron route's ?dry=1, and the
     *  way a prompt change gets read against real slips before it lands. */
    dryRun?: boolean;
  } = {},
): Promise<OrganizeResult & { preview?: OrganizePreview[] }> {
  const startMs = Date.now();
  const budgetMs = opts.budgetMs ?? RUN_BUDGET_MS;
  const preview: OrganizePreview[] = [];
  const result: OrganizeResult & { preview?: OrganizePreview[] } = {
    properties: 0,
    scanned: 0,
    organized: 0,
    lanes: { supply: 0, visit: 0, handyman: 0, pro: 0, owner: 0, office: 0 },
    summaries: 0,
    grouped: 0,
    remaining: 0,
    truncated: false,
    errors: [],
  };

  const pending = await selectAllPaged<OrganizeSlip>(
    (from, to) => {
      let q = applyEligibleFilters(supabase, ORGANIZE_SLIP_COLS, false);
      if (opts.propertyId) q = q.eq('property_id', opts.propertyId);
      return q
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PageResult<OrganizeSlip>>;
    },
    { label: 'organize pending' },
  );
  if (pending.length === 0) return result;

  const backed = await packetBackedSlipIds(supabase).catch(() => new Set<string>());
  const eligible = pending.filter((s) => !(backed.has(s.id) && (s.category === 'rising_tide' || s.category === 'ad_hoc')));

  const { data: propRows, error: propErr } = await supabase.from('properties').select('id, name, is_rising_tide_owned');
  if (propErr) throw new Error(`organize properties read failed: ${propErr.message}`);
  const properties = new Map<string, OrganizeProperty>();
  for (const p of (propRows ?? []) as Array<{ id: string; name: string | null; is_rising_tide_owned: boolean | null }>) {
    properties.set(p.id, { id: p.id, name: p.name || p.id, isRisingTideOwned: !!p.is_rising_tide_owned });
  }

  const byProperty = new Map<string, OrganizeSlip[]>();
  for (const s of eligible) {
    if (!properties.has(s.property_id)) continue;
    const list = byProperty.get(s.property_id) ?? [];
    list.push(s);
    byProperty.set(s.property_id, list);
  }
  // Worst lists first, so the homes that need it most get organized in the
  // first run even when the cap or the budget ends the pass early.
  const queue = [...byProperty.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const cap = Math.max(1, opts.maxProperties ?? DEFAULT_MAX_PROPERTIES);

  let processed = 0;
  for (const [propertyId, slips] of queue) {
    if (processed >= cap || Date.now() - startMs > budgetMs) {
      result.truncated = true;
      result.remaining += slips.length;
      continue;
    }
    processed += 1;
    result.properties += 1;
    result.scanned += slips.length;
    const property = properties.get(propertyId)!;

    const { data: ctxRows } = await supabase
      .from('work_slips')
      .select(ORGANIZE_SLIP_COLS)
      .eq('property_id', propertyId)
      .in('status', CONTEXT_STATUSES)
      .not('id', 'in', `(${slips.map((s) => s.id).join(',')})`)
      .order('created_at', { ascending: false })
      .limit(CONTEXT_CAP);
    const context = (ctxRows ?? []) as unknown as OrganizeSlip[];

    let decisions: Decision[];
    try {
      decisions = await decideForProperty(property, slips, context, backed);
    } catch (err) {
      result.errors.push(`${property.name}: ${err instanceof Error ? err.message : String(err)}`);
      result.remaining += slips.length;
      continue;
    }

    const byId = new Map(slips.map((s) => [s.id, s]));
    const groups = resolveGroups(
      decisions.map((d) => ({ slipId: d.slip_id, key: d.group_key, label: d.group_label })),
      context,
    );
    const nowIso = new Date().toISOString();
    const seen = new Set<string>();
    for (const d of decisions) {
      const slip = byId.get(d.slip_id);
      if (!slip || seen.has(slip.id)) continue;
      seen.add(slip.id);
      const { patch, lane } = planOrganizeWrites(
        slip,
        { lane: d.lane, ownerAsk: d.owner_ask === 'none' ? null : d.owner_ask, summary: d.summary, note: d.note },
        property,
        nowIso,
      );
      const group = groups.get(slip.id);
      if (group) {
        patch.organize_group = group.key;
        patch.organize_group_label = group.label;
      }
      if (opts.dryRun) {
        preview.push({ slipId: slip.id, title: slipDisplayTitle(slip.title, property.name), lane, patch });
        result.organized += 1;
        result.lanes[lane] += 1;
        if (patch.action_summary) result.summaries += 1;
        if (group) result.grouped += 1;
        continue;
      }
      // organized_at IS NULL on the write too: a slip an operator filed
      // while this run was thinking keeps the human's call.
      const { data: written, error } = await supabase
        .from('work_slips')
        .update(patch)
        .eq('id', slip.id)
        .is('organized_at', null)
        .select('id');
      if (error) {
        result.errors.push(`${property.name} / ${slip.id.slice(0, 8)}: ${error.message}`);
        continue;
      }
      if (!written || written.length === 0) continue;
      result.organized += 1;
      result.lanes[lane] += 1;
      if (patch.action_summary) result.summaries += 1;
      if (group) result.grouped += 1;
    }
    // Decisions the model dropped stay NULL and are retried next pass.
    result.remaining += slips.length - seen.size;
  }

  if (opts.dryRun) result.preview = preview;
  return result;
}
