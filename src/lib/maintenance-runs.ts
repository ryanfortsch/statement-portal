/**
 * Maintenance runs: scan open work slips + property calendars, and schedule
 * dedicated maintenance visits on days the house is empty.
 *
 * Field inspectors handle quick fixes during turnover stops (ride-along
 * attachments, restocks). The work that piles up is everything they can't
 * or won't do: jobs needing real tools, parts, and time. This module closes
 * that gap in three moves:
 *
 *   1. CLASSIFY (AI): every open maintenance slip gets a run_scope --
 *      'inspector' (knock it out during a routine stop), 'handyman' (needs
 *      a dedicated maintenance run), or 'pro' (licensed/specialty vendor:
 *      plumber, electrician, HVAC...) -- plus an effort_minutes estimate.
 *      Classified once; a slip keeps its scope until an operator changes it.
 *
 *   2. PLAN: per property, pool the open unassigned 'handyman' slips not
 *      already on a live packet. When the pool is substantive (any high
 *      priority, or 2+ jobs, or 60+ estimated minutes), find the next day
 *      the house is empty -- no occupied night, no check-in, not calendar
 *      blocked -- and lay a DRAFT trade='maintenance' packet on it through
 *      the existing createMaintenancePacket flow. The draft appears on the
 *      Work board's Maintenance Runs rail and in /operations/packets, where
 *      publishing it offers it to the maintenance-trade contractors.
 *
 *      Suggested drafts are ephemeral: keyed 'maintrun:<property>:<date>',
 *      auto_generated, and reconciled on every planning pass (kept when the
 *      plan is unchanged, replaced when the pool or calendar moved, removed
 *      when the pool no longer justifies a run). Published runs belong to
 *      the operator and are never touched; their slips are excluded from
 *      pooling by the live-packet filter.
 *
 *   3. SURFACE: loadMaintenanceRunsBoard() feeds the /work rail -- live
 *      runs, the 'pro' slips that need a vendor booked, and the backlog
 *      that hasn't earned a run yet.
 *
 * 'pro' slips are deliberately NOT bundled into runs: they need a vendor
 * appointment, which is an operator call. They surface on the rail as a
 * "book a vendor" list instead.
 *
 * Wired into /api/cron/field-packets (daily, after packet hygiene) and
 * /api/cron/messages-to-slips (every 6h, so freshly mined slips get
 * classified and planned in the same pass). Manual: "Plan runs now" on the
 * Work board.
 */

import 'server-only';
import { generateObject } from 'ai';
import { z } from 'zod';
import { fieldDb } from '@/lib/field-db';
import { createMaintenancePacket, loadFieldProperties } from '@/lib/field-packets';
import type {
  MaintenanceRunCard,
  RunsBoardData,
  RunScope,
  VendorNeededSlip,
  WorkSlipPriority,
} from '@/lib/work-types';

/** System sentinel for auto-planned packets. */
const RUNS_BOT_EMAIL = 'runs@helm.system';

const SUGGESTION_PREFIX = 'maintrun:';
/** Look this many days ahead for an empty day. */
const HORIZON_DAYS = 21;
/** "Substantive enough" gate: a run is worth a dedicated visit when the
 *  pool has a high-priority job, or this many jobs, or this much estimated
 *  on-site time. */
const RUN_MIN_SLIPS = 2;
const RUN_MIN_EFFORT_MINUTES = 60;
/** Classification batch cap per pass (the pass reruns until drained). */
const CLASSIFY_BATCH = 40;

const OCCUPANCY_STATUSES = ['confirmed', 'completed', 'block'];
const LIVE_PACKET_STATUSES = ['draft', 'published', 'claimed', 'in_progress', 'submitted', 'approved'];

// ─── date helpers (ET, matching field-packets) ────────────────────────

function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── classification ───────────────────────────────────────────────────

type ClassifiableSlip = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  priority: string;
};

export type ClassifyResult = { scanned: number; classified: number; error?: string };

const ClassifySchema = z.object({
  classifications: z.array(
    z.object({
      slip_id: z.string(),
      scope: z.enum(['inspector', 'handyman', 'pro']),
      effort_minutes: z
        .number()
        .describe('Honest on-site estimate in minutes, 10-480.'),
      note: z
        .string()
        .describe('One short line explaining the call; name any parts or trade needed.'),
    }),
  ),
});

/**
 * AI triage of open maintenance slips that have no run_scope yet. Writes
 * run_scope / run_scope_note / effort_minutes back onto each slip. Slips
 * the model drops stay NULL and get retried next pass. Fail-soft: a
 * gateway error classifies nothing and reports itself.
 */
export async function classifyOpenMaintenanceSlips(): Promise<ClassifyResult> {
  const { data } = await fieldDb()
    .from('work_slips')
    .select('id, title, description, location, priority')
    .eq('status', 'open')
    .eq('category', 'maintenance')
    .is('run_scope', null)
    .order('created_at', { ascending: true })
    .limit(CLASSIFY_BATCH);
  const slips = (data ?? []) as ClassifiableSlip[];
  if (slips.length === 0) return { scanned: 0, classified: 0 };

  let object: z.infer<typeof ClassifySchema>;
  try {
    ({ object } = await generateObject({
      model: 'anthropic/claude-sonnet-4.5',
      schema: ClassifySchema,
      system: `You triage open maintenance work slips for a vacation-rental operations team (Rising Tide STR, Cape Ann MA). For each slip decide who should do the work:

- 'inspector': a field inspector can knock it out during a routine turnover stop with common supplies and hand tools in under ~20 minutes: swap batteries, tighten a hinge, replace a bulb or shower curtain, reset a breaker, simple checks and verifications.
- 'handyman': needs a dedicated maintenance visit by a general handyman: real tools, parts to source, more than ~30 minutes, or moderate skill. Repairing a door or lock mechanism, patching drywall, fixing a deck board, re-caulking, TV/AV wiring, furniture repair, appliance troubleshooting short of licensed work.
- 'pro': needs a licensed or specialty trade, or is beyond handyman scope: plumber, electrician, HVAC, roofer, appliance technician, exterminator, tree work, major carpentry, anything permit-adjacent, or a clearly owner-decision-scale project.

When a slip is vague, judge from what the fix most likely involves; lean 'handyman' over 'inspector' when tools or parts are probably needed. Return exactly one entry per slip_id.`,
      prompt: `Classify each work slip.\n\n${slips
        .map((s) =>
          [
            `slip_id: ${s.id}`,
            `title: ${s.title}`,
            `location: ${s.location || '(none)'}`,
            `priority: ${s.priority}`,
            `description: ${(s.description || '').slice(0, 500) || '(none)'}`,
          ].join('\n'),
        )
        .join('\n\n---\n\n')}`,
    }));
  } catch (err) {
    return {
      scanned: slips.length,
      classified: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const valid = new Set(slips.map((s) => s.id));
  let classified = 0;
  for (const c of object.classifications) {
    if (!valid.has(c.slip_id)) continue;
    const minutes = Math.max(10, Math.min(480, Math.round(c.effort_minutes)));
    const { error } = await fieldDb()
      .from('work_slips')
      .update({
        run_scope: c.scope,
        run_scope_note: c.note.trim() || null,
        effort_minutes: minutes,
      })
      .eq('id', c.slip_id)
      .is('run_scope', null);
    if (!error) classified += 1;
  }
  return { scanned: slips.length, classified };
}

// ─── planning ─────────────────────────────────────────────────────────

type PoolSlip = {
  id: string;
  property_id: string;
  title: string;
  priority: string;
  effort_minutes: number | null;
  snoozed_until: string | null;
};

export type PlannedRun = {
  propertyId: string;
  visitDate: string;
  dayKind: 'full' | 'after_checkout';
  slipIds: string[];
  packetId: string | null;
  action: 'created' | 'kept' | 'failed';
};

export type PlanResult = {
  classify: ClassifyResult;
  runs: PlannedRun[];
  /** Properties whose pool passed the gate but had no empty day in the horizon. */
  noVacancy: string[];
  removedStale: number;
};

/** The open, unassigned 'handyman' slips whose only live holders (if any)
 *  are the planner's own suggested drafts, snooze respected. Suggested
 *  drafts must not hide their own slips from the pool — every pass would
 *  see an empty pool, judge the property unqualified, and delete the draft
 *  it created last pass (create/delete oscillation, 'kept' unreachable).
 *  But a slip ALSO held by a real live packet (e.g. the office attached it
 *  to a published inspection stop) stays out: keeping it would double-
 *  dispatch the job to two contractors. */
async function loadRunPool(): Promise<PoolSlip[]> {
  const today = todayET();
  const { data } = await fieldDb()
    .from('work_slips')
    .select('id, property_id, title, priority, effort_minutes, snoozed_until')
    .eq('status', 'open')
    .eq('category', 'maintenance')
    .eq('assigned_to_type', 'unassigned')
    .eq('run_scope', 'handyman')
    .or(`snoozed_until.is.null,snoozed_until.lte.${today}`)
    .order('created_at', { ascending: true });
  const rows = (data ?? []) as PoolSlip[];
  if (rows.length === 0) return [];
  const taken = await slipIdsOnLivePackets(false);
  return rows.filter((r) => !taken.has(r.id));
}

type PacketMeta = { status: string; auto_generated: boolean; suggestion_key: string | null };

function isSuggestedDraftMeta(p: PacketMeta | PacketMeta[] | null | undefined): boolean {
  const meta = Array.isArray(p) ? p[0] : p;
  return !!meta && meta.status === 'draft' && meta.auto_generated && !!meta.suggestion_key?.startsWith(SUGGESTION_PREFIX);
}

/** Slip ids held by a live packet, as a stop or an attachment. With
 *  `includeSuggestedDrafts` false, the planner's own suggested drafts
 *  don't count as holders (pooling); with true they do (board display —
 *  a slip on a suggested run shouldn't also show as backlog). */
async function slipIdsOnLivePackets(includeSuggestedDrafts: boolean): Promise<Set<string>> {
  const [{ data: stops }, { data: attached }] = await Promise.all([
    fieldDb()
      .from('packet_stops')
      .select('work_slip_id, inspection_packets!inner(status, auto_generated, suggestion_key)')
      .in('inspection_packets.status', LIVE_PACKET_STATUSES)
      .not('work_slip_id', 'is', null),
    fieldDb()
      .from('packet_stop_work_slips')
      .select('work_slip_id, packet_stops!inner(inspection_packets!inner(status, auto_generated, suggestion_key))')
      .in('packet_stops.inspection_packets.status', LIVE_PACKET_STATUSES),
  ]);
  const taken = new Set<string>();
  for (const s of (stops ?? []) as Array<{ work_slip_id: string | null; inspection_packets: PacketMeta | PacketMeta[] }>) {
    if (!s.work_slip_id) continue;
    if (!includeSuggestedDrafts && isSuggestedDraftMeta(s.inspection_packets)) continue;
    taken.add(s.work_slip_id);
  }
  for (const s of (attached ?? []) as Array<{
    work_slip_id: string | null;
    packet_stops: { inspection_packets: PacketMeta | PacketMeta[] } | Array<{ inspection_packets: PacketMeta | PacketMeta[] }>;
  }>) {
    if (!s.work_slip_id) continue;
    const stop = Array.isArray(s.packet_stops) ? s.packet_stops[0] : s.packet_stops;
    if (!includeSuggestedDrafts && isSuggestedDraftMeta(stop?.inspection_packets)) continue;
    taken.add(s.work_slip_id);
  }
  return taken;
}

type BookingLite = { property_id: string; check_in: string; check_out: string; status: string };

/**
 * Per property, the eligible maintenance days in [tomorrow, today+horizon]:
 * no occupied night (guest or hold), no same-day check-in, not calendar
 * blocked. 'full' = nobody slept there the night before either; a
 * checkout-morning day still works for interior jobs, it just starts after
 * the guest leaves.
 */
async function findVisitDays(
  propertyIds: string[],
): Promise<Map<string, { day: string; kind: 'full' | 'after_checkout' }>> {
  const out = new Map<string, { day: string; kind: 'full' | 'after_checkout' }>();
  if (propertyIds.length === 0) return out;

  const today = todayET();
  const start = addDays(today, 1);
  const end = addDays(today, HORIZON_DAYS);

  const [{ data: bData }, { data: blkData }] = await Promise.all([
    fieldDb()
      .from('bookings')
      .select('property_id, check_in, check_out, status')
      .in('status', OCCUPANCY_STATUSES)
      .is('duplicate_of', null)
      .in('property_id', propertyIds)
      .lte('check_in', addDays(end, 1))
      .gte('check_out', addDays(start, -1)),
    fieldDb()
      .from('property_calendar_blocks')
      .select('property_id, date')
      .in('property_id', propertyIds)
      .gte('date', start)
      .lte('date', end),
  ]);
  const bookings = ((bData ?? []) as BookingLite[]).filter((b) => b.check_in && b.check_out);
  const blocked = new Set(
    ((blkData ?? []) as Array<{ property_id: string; date: string }>).map((b) => `${b.property_id}:${b.date}`),
  );

  for (const pid of propertyIds) {
    const propBookings = bookings.filter((b) => b.property_id === pid);
    const occupiedOn = (d: string) => propBookings.some((b) => b.check_in <= d && d < b.check_out);
    const checkInOn = (d: string) =>
      propBookings.some((b) => b.status !== 'block' && b.check_in === d);

    const eligible: { day: string; kind: 'full' | 'after_checkout' }[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (blocked.has(`${pid}:${d}`)) continue;
      if (occupiedOn(d) || checkInOn(d)) continue;
      eligible.push({ day: d, kind: occupiedOn(addDays(d, -1)) ? 'after_checkout' : 'full' });
      if (eligible.length >= 4) break;
    }
    if (eligible.length === 0) continue;
    // Earliest day wins, but a fully empty day within 2 days of a
    // checkout-morning start is the better slot for a multi-job visit.
    let pick = eligible[0];
    if (pick.kind === 'after_checkout') {
      const fullSoon = eligible.find((e) => e.kind === 'full' && e.day <= addDays(pick.day, 2));
      if (fullSoon) pick = fullSoon;
    }
    out.set(pid, pick);
  }
  return out;
}

type ExistingSuggestion = {
  id: string;
  status: string;
  visit_date: string | null;
  suggestion_key: string;
  auto_generated: boolean;
  slipIds: Set<string>;
};

async function loadExistingSuggestions(): Promise<ExistingSuggestion[]> {
  const { data: packets } = await fieldDb()
    .from('inspection_packets')
    .select('id, status, visit_date, suggestion_key, auto_generated')
    .like('suggestion_key', `${SUGGESTION_PREFIX}%`)
    .eq('status', 'draft')
    .eq('auto_generated', true);
  const rows = (packets ?? []) as Array<Omit<ExistingSuggestion, 'slipIds'>>;
  if (rows.length === 0) return [];
  const { data: stops } = await fieldDb()
    .from('packet_stops')
    .select('packet_id, work_slip_id')
    .in('packet_id', rows.map((r) => r.id));
  const byPacket = new Map<string, Set<string>>();
  for (const s of (stops ?? []) as Array<{ packet_id: string; work_slip_id: string | null }>) {
    if (!s.work_slip_id) continue;
    if (!byPacket.has(s.packet_id)) byPacket.set(s.packet_id, new Set());
    byPacket.get(s.packet_id)!.add(s.work_slip_id);
  }
  return rows.map((r) => ({ ...r, slipIds: byPacket.get(r.id) ?? new Set() }));
}

/** Property id from a 'maintrun:<pid>:<date>' key. */
function propertyOfKey(key: string): string {
  return key.slice(SUGGESTION_PREFIX.length).split(':')[0] ?? '';
}

/** First unused 'maintrun:<pid>:<date>[-n]' key. suggestion_key is a
 *  global unique constraint and completed/cancelled runs keep theirs
 *  forever, so a same-property-same-day replan must not reuse a burned
 *  key. */
async function freeSuggestionKey(pid: string, day: string): Promise<string> {
  const base = `${SUGGESTION_PREFIX}${pid}:${day}`;
  const { data } = await fieldDb()
    .from('inspection_packets')
    .select('suggestion_key')
    .like('suggestion_key', `${base}%`);
  const used = new Set(
    ((data ?? []) as Array<{ suggestion_key: string | null }>).map((r) => r.suggestion_key),
  );
  if (!used.has(base)) return base;
  for (let n = 2; n < 50; n += 1) {
    if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

/**
 * The full planning pass: classify, pool, gate, pick days, reconcile
 * suggested drafts. Deterministic and idempotent -- an unchanged pool and
 * calendar keeps the same drafts.
 */
/** Run classification batches until the backlog drains, errors, or the
 *  batch cap is hit. Each batch is one Sonnet call over up to
 *  CLASSIFY_BATCH slips (~30-60s), so callers pick a cap that fits their
 *  time budget: crons use 4, the board's Plan button uses 0 synchronously
 *  and backgrounds the drain via after(). */
export async function drainClassificationBacklog(maxBatches: number): Promise<ClassifyResult> {
  const total: ClassifyResult = { scanned: 0, classified: 0 };
  for (let i = 0; i < maxBatches; i += 1) {
    const batch = await classifyOpenMaintenanceSlips();
    total.scanned += batch.scanned;
    total.classified += batch.classified;
    if (batch.error) {
      total.error = batch.error;
      break;
    }
    if (batch.scanned < CLASSIFY_BATCH) break;
  }
  return total;
}

export async function planMaintenanceRuns(opts?: { skipClassify?: boolean }): Promise<PlanResult> {
  // Drain (some of) the classification backlog first so brand-new slips
  // can make this pass's pools. Skipped by interactive callers: with a big
  // backlog (e.g. a fresh install classifying hundreds of imported slips)
  // the drain takes minutes, and a button can't sit on that.
  const classify = opts?.skipClassify
    ? { scanned: 0, classified: 0 }
    : await drainClassificationBacklog(4);

  const existing = await loadExistingSuggestions();
  const existingByProperty = new Map<string, ExistingSuggestion[]>();
  for (const e of existing) {
    const pid = propertyOfKey(e.suggestion_key);
    if (!existingByProperty.has(pid)) existingByProperty.set(pid, []);
    existingByProperty.get(pid)!.push(e);
  }

  const pool = await loadRunPool();
  // Only field-ops properties: createMaintenancePacket pools through
  // loadFieldProperties, so a slip on an excluded property would "fail"
  // packet creation on every pass forever.
  const fieldProps = new Set((await loadFieldProperties()).map((p) => p.id));
  const byProperty = new Map<string, PoolSlip[]>();
  for (const s of pool) {
    if (!fieldProps.has(s.property_id)) continue;
    if (!byProperty.has(s.property_id)) byProperty.set(s.property_id, []);
    byProperty.get(s.property_id)!.push(s);
  }

  // Substantive gate.
  const qualifying = new Map<string, PoolSlip[]>();
  for (const [pid, slips] of byProperty) {
    const highCount = slips.filter((s) => s.priority === 'high').length;
    const effort = slips.reduce((a, s) => a + (s.effort_minutes ?? 30), 0);
    if (highCount > 0 || slips.length >= RUN_MIN_SLIPS || effort >= RUN_MIN_EFFORT_MINUTES) {
      qualifying.set(pid, slips);
    }
  }

  const visitDays = await findVisitDays([...qualifying.keys()]);

  const runs: PlannedRun[] = [];
  const noVacancy: string[] = [];
  let removedStale = 0;
  const plannedProperties = new Set<string>();

  for (const [pid, slips] of qualifying) {
    const slot = visitDays.get(pid);
    if (!slot) {
      noVacancy.push(pid);
      continue;
    }
    plannedProperties.add(pid);
    const slipIds = slips.map((s) => s.id).sort();
    const prior = existingByProperty.get(pid) ?? [];

    // Unchanged plan: keep the existing draft (preserves any operator
    // edits like price or instructions).
    const match = prior.find(
      (e) =>
        e.visit_date === slot.day &&
        e.slipIds.size === slipIds.length &&
        slipIds.every((id) => e.slipIds.has(id)),
    );
    if (match) {
      // A concurrent pass can leave a second draft for the property; keep
      // exactly one.
      for (const e of prior) {
        if (e.id === match.id) continue;
        await fieldDb().from('inspection_packets').delete().eq('id', e.id).eq('status', 'draft');
        removedStale += 1;
      }
      runs.push({ propertyId: pid, visitDate: slot.day, dayKind: slot.kind, slipIds, packetId: match.id, action: 'kept' });
      continue;
    }

    // Plan moved: replace the property's suggested drafts.
    for (const e of prior) {
      await fieldDb().from('inspection_packets').delete().eq('id', e.id).eq('status', 'draft');
      removedStale += 1;
    }
    // suggestion_key is globally UNIQUE. A historical (published/cancelled)
    // run can already hold 'maintrun:<pid>:<day>'; suffix until free so the
    // insert never dies on the collision. The key rides the INSERT itself
    // (atomic) — a create-then-tag second write could be killed mid-pass
    // and leave an untracked draft holding its slips hostage.
    const suggestionKey = await freeSuggestionKey(pid, slot.day);
    const packetId = await createMaintenancePacket({
      workSlipIds: slipIds,
      visitDate: slot.day,
      createdByEmail: RUNS_BOT_EMAIL,
      publish: false,
      suggestionKey,
      autoGenerated: true,
    });
    runs.push({
      propertyId: pid,
      visitDate: slot.day,
      dayKind: slot.kind,
      slipIds,
      packetId,
      action: packetId ? 'created' : 'failed',
    });
  }

  // Suggested drafts for properties that no longer justify a run.
  for (const e of existing) {
    const pid = propertyOfKey(e.suggestion_key);
    if (plannedProperties.has(pid)) continue;
    await fieldDb().from('inspection_packets').delete().eq('id', e.id).eq('status', 'draft');
    removedStale += 1;
  }

  return { classify, runs, noVacancy, removedStale };
}

// ─── board loader ─────────────────────────────────────────────────────

/** Everything the /work Maintenance Runs rail renders. */
export async function loadMaintenanceRunsBoard(): Promise<RunsBoardData> {
  const [{ data: packets }, propNames] = await Promise.all([
    fieldDb()
      .from('inspection_packets')
      .select('id, title, status, visit_date, suggestion_key, auto_generated, posted_price_cents')
      .eq('trade', 'maintenance')
      .in('status', ['draft', 'published', 'claimed', 'in_progress'])
      .order('visit_date', { ascending: true }),
    loadPropertyNames(),
  ]);
  const packetRows = (packets ?? []) as Array<{
    id: string;
    title: string;
    status: string;
    visit_date: string | null;
    suggestion_key: string | null;
    auto_generated: boolean;
    posted_price_cents: number | null;
  }>;

  let runs: MaintenanceRunCard[] = [];
  if (packetRows.length > 0) {
    const { data: stops } = await fieldDb()
      .from('packet_stops')
      .select('packet_id, work_slip_id')
      .in('packet_id', packetRows.map((p) => p.id))
      .not('work_slip_id', 'is', null);
    const stopRows = (stops ?? []) as Array<{ packet_id: string; work_slip_id: string }>;
    const slipIds = [...new Set(stopRows.map((s) => s.work_slip_id))];
    const slipById = new Map<string, { id: string; title: string; priority: string; property_id: string }>();
    if (slipIds.length > 0) {
      const { data: slips } = await fieldDb()
        .from('work_slips')
        .select('id, title, priority, property_id')
        .in('id', slipIds);
      for (const s of (slips ?? []) as Array<{ id: string; title: string; priority: string; property_id: string }>) {
        slipById.set(s.id, s);
      }
    }
    runs = packetRows.map((p) => {
      const slips = stopRows
        .filter((s) => s.packet_id === p.id)
        .map((s) => slipById.get(s.work_slip_id))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => ({
          id: s.id,
          title: s.title,
          priority: s.priority as WorkSlipPriority,
          propertyName: propNames.get(s.property_id) ?? s.property_id,
        }));
      return {
        packetId: p.id,
        title: p.title,
        status: p.status,
        visitDate: p.visit_date,
        suggested: !!p.suggestion_key?.startsWith(SUGGESTION_PREFIX) && p.status === 'draft',
        postedPriceCents: p.posted_price_cents,
        slips,
      };
    });
  }

  const taken = await slipIdsOnLivePackets(true);
  const today = todayET();

  // 'pro' scope: needs a vendor booked -- an operator move, never a run.
  const { data: proData } = await fieldDb()
    .from('work_slips')
    .select('id, property_id, title, priority, run_scope_note')
    .eq('status', 'open')
    .eq('category', 'maintenance')
    .eq('run_scope', 'pro')
    .eq('assigned_to_type', 'unassigned')
    .or(`snoozed_until.is.null,snoozed_until.lte.${today}`)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true });
  const vendorNeeded: VendorNeededSlip[] = ((proData ?? []) as Array<{
    id: string;
    property_id: string;
    title: string;
    priority: string;
    run_scope_note: string | null;
  }>).map((s) => ({
    id: s.id,
    propertyId: s.property_id,
    propertyName: propNames.get(s.property_id) ?? s.property_id,
    title: s.title,
    priority: s.priority as WorkSlipPriority,
    note: s.run_scope_note,
  }));

  // Handyman backlog not yet on a run (below the gate, or no empty day).
  const { data: backlogData } = await fieldDb()
    .from('work_slips')
    .select('id, property_id, priority')
    .eq('status', 'open')
    .eq('category', 'maintenance')
    .eq('assigned_to_type', 'unassigned')
    .eq('run_scope', 'handyman')
    .or(`snoozed_until.is.null,snoozed_until.lte.${today}`);
  const backlogByProp = new Map<string, { count: number; highCount: number }>();
  for (const s of (backlogData ?? []) as Array<{ id: string; property_id: string; priority: string }>) {
    if (taken.has(s.id)) continue;
    const b = backlogByProp.get(s.property_id) ?? { count: 0, highCount: 0 };
    b.count += 1;
    if (s.priority === 'high') b.highCount += 1;
    backlogByProp.set(s.property_id, b);
  }
  const backlog = [...backlogByProp.entries()]
    .map(([pid, b]) => ({
      propertyId: pid,
      propertyName: propNames.get(pid) ?? pid,
      count: b.count,
      highCount: b.highCount,
    }))
    .sort((a, b) => b.highCount - a.highCount || b.count - a.count);

  const { count: unclassifiedCount } = await fieldDb()
    .from('work_slips')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open')
    .eq('category', 'maintenance')
    .is('run_scope', null);

  const { loadWorkOrderRoster } = await import('@/lib/work-order-email');
  const roster = await loadWorkOrderRoster().catch(() => []);

  return { runs, vendorNeeded, backlog, unclassifiedCount: unclassifiedCount ?? 0, roster };
}

async function loadPropertyNames(): Promise<Map<string, string>> {
  const { data } = await fieldDb().from('properties').select('id, name');
  return new Map(((data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]));
}
