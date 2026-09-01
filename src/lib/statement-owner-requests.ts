/**
 * Owner requests: the asks that ride out with the monthly statement email.
 *
 * The point of this section is NOT a recap of what we handled. It is the
 * other direction -- the maintenance work, purchases and decisions that
 * need the owner's answer before we can move, plus anything we want on
 * their radar. The recap survives as an opt-in sub-section because it
 * reads well under the asks, but it is never the lead.
 *
 * Shape of the flow:
 *
 *   loadOwnerRequestCandidates()   every active slip on the property, each
 *                                  with a generated owner-facing paragraph
 *                                  and a suggested in/out
 *   <operator curates>             ticks, un-ticks, rewrites any line
 *   resolveOwnerRequests()         picks + overrides -> the rendered lists
 *
 * The generated copy is deterministic (framing + tidying, no AI) and the
 * operator's edits are stored, so the preview modal and the Gmail draft
 * always compose the exact same paragraphs. Nothing is written at render
 * time that could not be read back.
 *
 * Deliberately out of the candidate pool: category 'rising_tide' (internal,
 * on our dime), dismissed and done slips, snoozed slips, and asks the owner
 * has already answered (approved / declined) -- those are settled.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import type {
  OwnerRequestCandidate,
  OwnerRequestKind,
  PropertyRequestCandidates,
} from '@/lib/email-templates';
import type { WorkSlipOwnerActionType, WorkSlipPriority } from '@/lib/work-types';

type SlipRow = {
  id: string;
  title: string;
  description: string | null;
  action_summary: string | null;
  location: string | null;
  category: string;
  status: string;
  priority: WorkSlipPriority;
  scheduled_date: string | null;
  completed_at: string | null;
  closed_at: string | null;
  owner_action_required: boolean;
  owner_action_type: WorkSlipOwnerActionType | null;
  owner_action_notes: string | null;
  owner_status: string | null;
  owner_last_contacted_at: string | null;
  resolution_notes: string | null;
  snoozed_until: string | null;
  created_at: string;
};

type RepairRow = {
  id: string;
  vendor_name: string | null;
  description: string | null;
  bank_charge_amount: number | string | null;
  bank_charge_date: string | null;
};

const SLIP_COLUMNS =
  'id, title, description, action_summary, location, category, status, priority, ' +
  'scheduled_date, completed_at, closed_at, owner_action_required, owner_action_type, ' +
  'owner_action_notes, owner_status, owner_last_contacted_at, resolution_notes, ' +
  'snoozed_until, created_at';

/** Where a generated explanation stops being an explanation. */
const MAX_EXPLANATION = 400;

/** Collapse whitespace, drop trailing punctuation, capitalize the start. */
function tidy(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim().replace(/[.;,\s]+$/, '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/** Lowercase a leading word only when it isn't a proper noun / acronym
 *  ("Replaced the..." -> "replaced the...", but "Drometer's quote" and
 *  "HVAC filter" keep their case). Used when notes continue a title. */
function lowerLead(s: string): string {
  const firstWord = s.split(' ')[0];
  if (firstWord.length > 1 && firstWord.slice(1) !== firstWord.slice(1).toLowerCase()) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** "2026-09-12" / an ISO timestamp -> "September 12" */
function fmtDay(iso: string): string {
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

/** One sentence, ending in a period, from a fragment of operator notes.
 *  Long notes are internal play-by-play; cut at the last sentence that
 *  fits rather than trailing off mid-thought. */
function asSentence(raw: string): string {
  const t = tidy(raw);
  if (!t) return '';
  let body = t;
  if (body.length > MAX_EXPLANATION) {
    const window = body.slice(0, MAX_EXPLANATION);
    const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
    body = lastStop > 60 ? window.slice(0, lastStop) : window.slice(0, window.lastIndexOf(' '));
    body = body.replace(/[.;,\s]+$/, '');
  }
  return /[.!?]$/.test(body) ? body : body + '.';
}

/** What we are asking for, said plainly. Null type still gets an ask -- a
 *  slip in this list is in it because somebody wants an answer. */
const ASK_SENTENCE: Record<WorkSlipOwnerActionType, string> = {
  approve: 'We need your approval before we move ahead.',
  purchase: "We'd like your go-ahead on the purchase.",
  schedule: "Let us know a window that works and we'll get it booked.",
  decide: "Let us know how you'd like us to handle it.",
  reimburse: 'This one is a reimbursement to square up.',
};
const ASK_SENTENCE_DEFAULT = "Let us know how you'd like to proceed.";

const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

/**
 * The generated owner-facing paragraph for one slip: what it is, where it
 * is, what is going on, and what we need. Every clause is a real field --
 * nothing here invents a fact, which is why the operator can trust the
 * default and edit only where they want more color.
 */
function buildRequestText(slip: SlipRow, kind: OwnerRequestKind, monthStart: string): string {
  const title = tidy(slip.title);
  const loc = slip.location ? tidy(slip.location) : '';
  const head = loc && !title.toLowerCase().includes(loc.toLowerCase()) ? `${title} (${loc})` : title;

  // The ask's own notes are already addressed to the owner (the owner-action
  // workflow writes them that way), so they lead when present.
  const source = kind === 'ask'
    ? (slip.owner_action_notes || slip.description || slip.action_summary || '')
    : (slip.description || slip.action_summary || slip.resolution_notes || '');
  const explanation = source ? asSentence(source) : '';

  const parts = [`${head}.`];
  if (explanation) parts.push(explanation);

  // Asked before and still unanswered: say so rather than re-asking as if
  // it were new. Only when the last contact predates this statement month.
  if (kind === 'ask' && slip.owner_last_contacted_at && slip.owner_last_contacted_at < monthStart) {
    parts.push(`We first raised this on ${fmtDay(slip.owner_last_contacted_at)}.`);
  }

  if (kind === 'ask') {
    parts.push(slip.owner_action_type ? ASK_SENTENCE[slip.owner_action_type] : ASK_SENTENCE_DEFAULT);
  } else if (slip.status === 'scheduled' && slip.scheduled_date) {
    parts.push(`It's on the calendar for ${fmtDay(slip.scheduled_date)}.`);
  }

  return parts.join(' ');
}

/** The recap line for a slip we finished this month. */
function handledLine(slip: SlipRow): string {
  const title = tidy(slip.title);
  const notes = slip.resolution_notes ? tidy(slip.resolution_notes) : '';
  // Append the resolution when it's short and says something the title
  // doesn't. Long notes are usually internal play-by-play; leave them out.
  if (notes && notes.length <= 160 && notes.toLowerCase() !== title.toLowerCase()) {
    return `${title} - ${lowerLead(notes)}`;
  }
  return title;
}

/** "$75", "$75.50" -- cents only when there are cents, because a charge
 *  itemization has to tie to the number on the statement. */
function fmtCharge(n: number): string {
  return Number.isInteger(n) ? `$${n.toLocaleString('en-US')}`
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A raw bank descriptor is shouted and full of reference numbers; the
 *  vendor name reads better than it does. */
function looksLikeBankDescriptor(s: string): boolean {
  return s === s.toUpperCase() || /\d{5,}/.test(s);
}

/** One line of the maintenance charge, ready for the operator to rewrite. */
function repairCandidate(r: RepairRow): OwnerRequestCandidate {
  const desc = r.description ? tidy(r.description) : '';
  const vendor = r.vendor_name ? tidy(r.vendor_name) : '';
  const lead = (desc && !looksLikeBankDescriptor(desc)) ? desc : (vendor || desc || 'Maintenance visit');
  const amount = Number(r.bank_charge_amount) || 0;
  return {
    slipId: `repair:${r.id}`,
    title: lead,
    location: null,
    kind: 'handled',
    actionType: null,
    priority: 'normal',
    defaultText: amount > 0 ? `${lead} - ${fmtCharge(amount)}` : lead,
    // Never pre-ticked: when the work was slipped, the slip line says it
    // better, and listing both would bill the owner's attention twice.
    suggested: false,
    raisedOn: null,
  };
}

/** True when this slip is a settled ask: the owner already answered. */
function isAnswered(slip: SlipRow): boolean {
  return slip.owner_action_required
    && (slip.owner_status === 'approved' || slip.owner_status === 'declined');
}

function byPriorityThenAge(a: SlipRow, b: SlipRow): number {
  const p = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
  return p !== 0 ? p : a.created_at.localeCompare(b.created_at);
}

/**
 * Every slip on this property the operator could put in front of the owner
 * this month, each with its generated paragraph and a suggested in/out.
 * Asks (already flagged owner_action_required) come first and arrive
 * pre-ticked; everything else is available but out by default.
 */
export async function loadOwnerRequestCandidates(args: {
  propertyId: string;
  propertyName: string;
  /** "YYYY-MM" */
  month: string;
  /**
   * The property_statements row for this month, when the caller already
   * has it. Passing it pulls the statement's own repair charges in as
   * candidates so the itemization can be built from the rows the owner is
   * actually being billed for, not only from what happened to get slipped.
   */
  propertyStatementId?: string | null;
}): Promise<PropertyRequestCandidates> {
  const { propertyId, propertyName, month } = args;
  const start = `${month}-01`;
  const startDate = new Date(`${start}T00:00:00Z`);
  const end = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
  const nowIso = new Date().toISOString();

  // Two bounded queries instead of one broad one: the done backlog grows
  // forever (PostgREST would silently cap a bare select at 1000 rows), so
  // finished slips are filtered to the month window server-side. A slip
  // closed from the board may carry closed_at without completed_at; either
  // stamp inside the window counts.
  const [{ data: doneRows }, { data: activeRows }] = await Promise.all([
    supabaseAdmin
      .from('work_slips')
      .select(SLIP_COLUMNS)
      .eq('property_id', propertyId)
      .eq('status', 'done')
      .neq('category', 'rising_tide')
      .or([
        `and(completed_at.gte.${start},completed_at.lt.${end})`,
        `and(completed_at.is.null,closed_at.gte.${start},closed_at.lt.${end})`,
      ].join(',')),
    supabaseAdmin
      .from('work_slips')
      .select(SLIP_COLUMNS)
      .eq('property_id', propertyId)
      .neq('category', 'rising_tide')
      .in('status', ['open', 'in_progress', 'scheduled', 'blocked']),
  ]);

  // The charge's own rows. Bank-sourced descriptions are raw descriptors
  // ("ZELLE PAYMENT TO ..."), receipt-sourced ones are operator prose --
  // either way these arrive un-ticked, as material to build the itemization
  // from when the work was never slipped.
  const repairRows = args.propertyStatementId
    ? (await supabaseAdmin
        .from('repair_events')
        .select('id, vendor_name, description, bank_charge_amount, bank_charge_date')
        .eq('property_statement_id', args.propertyStatementId)
        .order('bank_charge_date')).data as RepairRow[] | null
    : null;

  const named = (rows: unknown): SlipRow[] =>
    ((rows || []) as unknown as SlipRow[]).filter(s => tidy(s.title).length > 0);

  const done = named(doneRows);
  const active = named(activeRows)
    // A snoozed slip is one somebody deliberately parked; it should not
    // resurface in an owner's inbox before it resurfaces on our own board.
    .filter(s => !(s.snoozed_until && s.snoozed_until > nowIso))
    .filter(s => !isAnswered(s));

  done.sort((a, b) => (a.completed_at || a.closed_at || '').localeCompare(b.completed_at || b.closed_at || ''));

  const asks = active.filter(s => s.owner_action_required).sort(byPriorityThenAge);
  const rest = active.filter(s => !s.owner_action_required).sort(byPriorityThenAge);

  const toCandidate = (slip: SlipRow, kind: OwnerRequestKind): OwnerRequestCandidate => ({
    slipId: slip.id,
    title: tidy(slip.title),
    location: slip.location ? tidy(slip.location) : null,
    kind,
    actionType: slip.owner_action_type,
    priority: slip.priority,
    // Finished work reads as a line item ("Repaired the AC unit"), not as a
    // request; when it is itemizing a charge, that is exactly the register
    // the owner is reading in.
    defaultText: kind === 'handled' ? handledLine(slip) : buildRequestText(slip, kind, start),
    // Asks are pre-ticked because somebody already decided the owner needs
    // to weigh in. Finished work is pre-ticked too but sits behind its own
    // master switch, so nothing lands in an inbox unreviewed.
    suggested: kind === 'ask' || kind === 'handled',
    raisedOn: slip.owner_last_contacted_at,
  });

  return {
    propertyId,
    propertyName,
    candidates: [
      ...asks.map(s => toCandidate(s, 'ask')),
      ...rest.map(s => toCandidate(s, 'flag')),
      ...done.map(s => toCandidate(s, 'handled')),
      ...(repairRows || []).map(repairCandidate),
    ],
  };
}
