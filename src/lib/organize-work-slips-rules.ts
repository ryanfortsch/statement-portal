/**
 * The organize pass's pure rules: what one model decision is allowed to
 * write on one slip, and when a cluster counts. No database, no model, no
 * server-only import, so lib/__tests__/organize-work-slips.test.ts can pin
 * every guard rail. The orchestration that loads slips, calls the model and
 * writes the patches lives in lib/organize-work-slips.ts.
 */

import type { WorkSlipOwnerActionType, WorkSlipRow } from './work-types';
import { slipDisplayTitle, type WorkLane } from './work-slip-lanes.ts';

/** A description this long, or a pasted source, earns a synthesized line. */
const SUMMARY_MIN_DESCRIPTION = 200;
const SUMMARY_MAX = 180;
const NOTE_MAX = 160;
const GROUP_KEY_MAX = 40;
const GROUP_LABEL_MAX = 48;

export const ORGANIZE_SLIP_COLS =
  'id, property_id, title, description, action_summary, location, category, priority, status, ' +
  'run_scope, run_scope_note, owner_action_required, owner_action_type, owner_status, ' +
  'from_review_id, from_guest_message_key, from_guest_request_key, from_supply_key, ' +
  'from_quo_message_id, from_gmail_message_id, inspection_id, reported_by_contractor_id, ' +
  'last_verified_open_at, scheduled_date, created_by_email, created_at, organize_group, organize_group_label';

export type OrganizeSlip = Pick<
  WorkSlipRow,
  | 'id'
  | 'property_id'
  | 'title'
  | 'description'
  | 'action_summary'
  | 'location'
  | 'category'
  | 'priority'
  | 'status'
  | 'run_scope'
  | 'run_scope_note'
  | 'owner_action_required'
  | 'owner_action_type'
  | 'owner_status'
  | 'from_review_id'
  | 'from_guest_message_key'
  | 'from_guest_request_key'
  | 'from_supply_key'
  | 'inspection_id'
  | 'reported_by_contractor_id'
  | 'last_verified_open_at'
  | 'scheduled_date'
  | 'created_by_email'
  | 'created_at'
  | 'organize_group'
  | 'organize_group_label'
> & { from_quo_message_id: string | null; from_gmail_message_id: string | null };

export type OrganizeProperty = { id: string; name: string; isRisingTideOwned: boolean };

export type DecisionLane = 'visit' | 'handyman' | 'pro' | 'owner' | 'supply' | 'office';

export type LaneDecision = {
  lane: DecisionLane;
  ownerAsk: WorkSlipOwnerActionType | null;
  summary: string;
  note: string;
};

export type OrganizeResult = {
  properties: number;
  scanned: number;
  organized: number;
  lanes: Record<WorkLane, number>;
  summaries: number;
  grouped: number;
  /** Unorganized slips left for the next run (budget or cap). */
  remaining: number;
  truncated: boolean;
  errors: string[];
};

// ─── pure rules (tested without a database or a model) ─────────────────

function sameText(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return norm(a) === norm(b);
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Kebab [a-z0-9-], length-capped; empty when nothing survives. */
export function sanitizeGroupKey(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, GROUP_KEY_MAX);
}

/** True when the description is a pasted review, thread or email rather
 *  than someone's own note, or is long enough that a sheet needs one line. */
export function wantsSummary(slip: Pick<OrganizeSlip, 'description' | 'from_review_id' | 'from_guest_message_key' | 'from_quo_message_id' | 'from_gmail_message_id'>): boolean {
  const pasted = !!(slip.from_review_id || slip.from_guest_message_key || slip.from_quo_message_id || slip.from_gmail_message_id);
  return pasted || (slip.description ?? '').trim().length > SUMMARY_MIN_DESCRIPTION;
}

function scopeLane(scope: string | null): DecisionLane {
  return scope === 'pro' ? 'pro' : scope === 'handyman' ? 'handyman' : 'visit';
}

/**
 * Turn one decision into the column writes for one slip. Pure, so the
 * guard rails are testable:
 *   - an operator's owner flag beats the model (the slip stays owner lane);
 *   - a Rising Tide-owned home has no owner: a purchase there is a supply;
 *   - an internal or packet-backing slip (rising_tide / ad_hoc) never enters
 *     a maintenance lane by robot, it may only move to supply, owner or stay;
 *   - run_scope is written only when empty; an existing triage stands and
 *     decides the reported lane;
 *   - action_summary is written only when empty, only for pasted or long
 *     descriptions, and never when it merely restates the title.
 */
export function planOrganizeWrites(
  slip: OrganizeSlip,
  d: LaneDecision,
  property: Pick<OrganizeProperty, 'name' | 'isRisingTideOwned'>,
  nowIso: string,
): { patch: Record<string, unknown>; lane: WorkLane } {
  let lane: DecisionLane = d.lane;
  if (slip.owner_action_required) lane = 'owner';
  if (lane === 'owner' && property.isRisingTideOwned) lane = 'supply';
  const internal = slip.category === 'rising_tide' || slip.category === 'ad_hoc';
  const maintenanceLane = lane === 'visit' || lane === 'handyman' || lane === 'pro';
  if (maintenanceLane && internal) lane = 'office';

  const note = clip(d.note, NOTE_MAX) || null;
  const patch: Record<string, unknown> = { organized_at: nowIso, organize_note: note };

  if (lane === 'owner') {
    if (slip.category !== 'owner') patch.category = 'owner';
    if (!slip.owner_action_required) patch.owner_action_required = true;
    if (!slip.owner_action_type) patch.owner_action_type = d.ownerAsk ?? 'purchase';
    if (!slip.owner_status) patch.owner_status = 'not_sent';
  } else if (lane === 'supply') {
    if (slip.category !== 'inventory') patch.category = 'inventory';
  } else if (lane === 'office') {
    if (!internal) patch.category = 'rising_tide';
  } else {
    if (slip.category !== 'maintenance') patch.category = 'maintenance';
    if (!slip.run_scope) {
      patch.run_scope = lane === 'visit' ? 'inspector' : lane;
      patch.run_scope_note = note;
    } else {
      // An existing triage stands; the board reads the lane off it.
      lane = scopeLane(slip.run_scope);
    }
  }

  const summary = clip(d.summary, SUMMARY_MAX);
  if (
    !(slip.action_summary ?? '').trim() &&
    summary &&
    wantsSummary(slip) &&
    !sameText(summary, slip.title) &&
    !sameText(summary, slipDisplayTitle(slip.title, property.name))
  ) {
    patch.action_summary = summary;
  }

  return { patch, lane: lane as WorkLane };
}

export type GroupProposal = { slipId: string; key: string; label: string };

/**
 * Keep only clusters with at least two members, counting slips already
 * carrying the key at this home. One label per key: the first non-empty
 * proposal, else what the existing members carry.
 */
export function resolveGroups(
  proposals: GroupProposal[],
  existing: Array<Pick<OrganizeSlip, 'organize_group' | 'organize_group_label'>>,
): Map<string, { key: string; label: string }> {
  const count = new Map<string, number>();
  const label = new Map<string, string>();
  for (const e of existing) {
    if (!e.organize_group) continue;
    count.set(e.organize_group, (count.get(e.organize_group) ?? 0) + 1);
    if (e.organize_group_label && !label.has(e.organize_group)) label.set(e.organize_group, e.organize_group_label);
  }
  const clean = proposals
    .map((p) => ({ slipId: p.slipId, key: sanitizeGroupKey(p.key), label: clip(p.label, GROUP_LABEL_MAX) }))
    .filter((p) => p.key);
  for (const p of clean) {
    count.set(p.key, (count.get(p.key) ?? 0) + 1);
    if (p.label && !label.has(p.key)) label.set(p.key, p.label);
  }
  const out = new Map<string, { key: string; label: string }>();
  for (const p of clean) {
    if ((count.get(p.key) ?? 0) < 2) continue;
    out.set(p.slipId, { key: p.key, label: label.get(p.key) || p.key.replace(/-/g, ' ') });
  }
  return out;
}

