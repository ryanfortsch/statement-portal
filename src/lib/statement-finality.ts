/**
 * Statement finality: the single source of truth for "is this statement
 * frozen?", checked by every route that can move an owner payout.
 *
 * Before this module, the sent-statement freeze was enforced by exactly one
 * of the twelve payout writers (stripe-sync). Every operator-facing
 * recompute and adjust path (re-ingest, fill-gap, refresh, resolve-gap,
 * remove, bank-deposit attribution, cleaning credits, reserve, receipts)
 * silently moved payouts the owner already had in writing.
 *
 * A statement is frozen when either:
 *   - its close task carries email_sent_at (the operator marked it sent), or
 *   - its period's status is 'final' (the month was closed as a whole).
 *
 * Frozen is not immutable: a route passes force=true after the operator
 * explicitly confirms, and every forced write files a data_gaps audit row
 * (gap_type 'post_send_write') on the statement so the override is a matter
 * of record, not a silent drift.
 *
 * Scope: the FREEZE has none. It applies to every month, because its two
 * triggers are already explicit operator acts -- someone marked the
 * statement sent, or closed the month -- and there is no month for which
 * "the owner is holding this document" stops being true.
 *
 * It used to be gated to FINALITY_FROM_MONTH ('2026-08') forward, on the
 * reasoning that retro-freezing history turns every legacy correction into
 * a ceremony. That grandfather had teeth: on 2026-08-31 a re-ingest of
 * JULY 2026 for 16 Waterman walked straight past this guard because
 * '2026-07' < '2026-08', deleted a statement emailed four weeks earlier,
 * and rebuilt it from a different month's PDF -- no 409, no audit row,
 * nothing to see. The ceremony is one confirm click; the alternative is a
 * sent statement quietly becoming a different document.
 *
 * FINALITY_FROM_MONTH survives for the INTEGRITY check only, where the
 * cutover reasoning does still hold: statements built before it were
 * produced under formula rules statementSumsToPayout does not model, so
 * checking them would fail honest historical rows.
 *
 * Error posture: fail CLOSED. A guard that cannot read its inputs must not
 * silently allow the write (that is the exact fail-open convention this
 * audit cycle is retiring). Read failures throw.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Integrity-check scope ONLY -- months before this were built under formula
 * rules statementSumsToPayout does not model. NOT the freeze scope: the
 * freeze covers every month. See the header note.
 */
export const FINALITY_FROM_MONTH = '2026-08';

/**
 * Freeze scope: EVERY month. The empty string sorts before any real
 * `YYYY-MM`, so `month >= FREEZE_FROM_MONTH` is true for all of them.
 *
 * Kept as a named constant rather than deleting the comparisons at the four
 * call sites, for two reasons: re-scoping the freeze stays a one-line
 * change, and a reader can tell a freeze gate from an integrity gate by
 * which constant it names. Do not substitute FINALITY_FROM_MONTH here --
 * that is the integrity cutover and pointing the freeze at it is the exact
 * bug that let a sent July 2026 statement be overwritten.
 */
export const FREEZE_FROM_MONTH = '';

export type StatementRef = {
  /** property_statements.id -- preferred when the caller has it. */
  statementId?: string;
  /** Alternative: resolve via (property_id, month). */
  propertyId?: string;
  month?: string;
};

export type FreezeStatus = {
  frozen: boolean;
  reason: 'email_sent' | 'period_final' | null;
  emailSentAt: string | null;
  periodStatus: string | null;
  month: string | null;
  propertyId: string | null;
  statementId: string | null;
  periodId: string | null;
};

export class StatementFrozenError extends Error {
  status = 409 as const;
  freeze: FreezeStatus;
  constructor(action: string, freeze: FreezeStatus) {
    const when = freeze.emailSentAt ? ` on ${freeze.emailSentAt.slice(0, 10)}` : '';
    super(
      freeze.reason === 'period_final'
        ? `${action}: ${freeze.month} is finalized. Reopen the month (or pass force) to change it.`
        : `${action}: this statement was marked sent to the owner${when}. Its numbers are frozen; pass force to override (the override is recorded on the statement).`,
    );
    this.freeze = freeze;
  }
}

const notFrozen = (partial: Partial<FreezeStatus>): FreezeStatus => ({
  frozen: false, reason: null, emailSentAt: null, periodStatus: null,
  month: null, propertyId: null, statementId: null, periodId: null,
  ...partial,
});

/**
 * Resolve the freeze state for a statement. Throws on read errors (fail
 * closed).
 *
 * No month grandfather: EVERY month is in scope, because the two things
 * that freeze a statement -- a sent stamp and a finalized period -- are
 * explicit operator acts that mean the same thing in any month. The old
 * `month < FINALITY_FROM_MONTH` early return lived here and is what let a
 * sent July 2026 statement be silently rebuilt; see the file header. Do not
 * reintroduce it: FINALITY_FROM_MONTH now scopes the INTEGRITY check alone.
 */
export async function getFreezeStatus(
  supabase: SupabaseClient,
  ref: StatementRef,
): Promise<FreezeStatus> {
  let statementId = ref.statementId ?? null;
  let propertyId = ref.propertyId ?? null;
  let month = ref.month ?? null;
  let periodId: string | null = null;
  let periodStatus: string | null = null;

  if (statementId) {
    const { data: stmt, error } = await supabase
      .from('property_statements')
      .select('id, property_id, period_id')
      .eq('id', statementId)
      .maybeSingle();
    if (error) throw new Error(`finality: statement read failed: ${error.message}`);
    if (!stmt) return notFrozen({ statementId });
    propertyId = stmt.property_id as string;
    periodId = stmt.period_id as string;
    const { data: period, error: perErr } = await supabase
      .from('statement_periods')
      .select('id, month, status')
      .eq('id', periodId)
      .maybeSingle();
    if (perErr) throw new Error(`finality: period read failed: ${perErr.message}`);
    month = (period?.month as string) ?? null;
    periodStatus = (period?.status as string) ?? null;
  } else {
    if (!propertyId || !month) {
      throw new Error('finality: need statementId or (propertyId + month)');
    }
    const { data: period, error: perErr } = await supabase
      .from('statement_periods')
      .select('id, month, status')
      .eq('month', month)
      .maybeSingle();
    if (perErr) throw new Error(`finality: period read failed: ${perErr.message}`);
    // No period yet = first ingest of the month; nothing can be frozen.
    if (!period) return notFrozen({ propertyId, month });
    periodId = period.id as string;
    periodStatus = (period.status as string) ?? null;
    const { data: stmt, error: stmtErr } = await supabase
      .from('property_statements')
      .select('id')
      .eq('period_id', periodId)
      .eq('property_id', propertyId)
      .maybeSingle();
    if (stmtErr) throw new Error(`finality: statement read failed: ${stmtErr.message}`);
    statementId = (stmt?.id as string) ?? null;
  }

  const base = notFrozen({ statementId, propertyId, month, periodId, periodStatus });

  // No month cutoff. A statement the operator marked sent is frozen whatever
  // month it belongs to -- see the header note on 16 Waterman / July 2026,
  // which the old `month < FINALITY_FROM_MONTH` grandfather let through.
  // A month we cannot resolve is not a licence to write: fall through to the
  // period/close-task checks, which is the fail-closed direction.
  if (periodStatus === 'final') {
    return { ...base, frozen: true, reason: 'period_final' };
  }

  if (periodId && propertyId) {
    const { data: task, error: taskErr } = await supabase
      .from('close_tasks')
      .select('email_sent_at')
      .eq('period_id', periodId)
      .eq('property_id', propertyId)
      .maybeSingle();
    if (taskErr) throw new Error(`finality: close_tasks read failed: ${taskErr.message}`);
    if (task?.email_sent_at) {
      return { ...base, frozen: true, reason: 'email_sent', emailSentAt: task.email_sent_at as string };
    }
  }

  return base;
}

/**
 * Gate a payout-moving write. Not frozen: proceeds. Frozen without force:
 * throws StatementFrozenError (routes map it to a 409 with `frozen: true`
 * so the client can confirm and retry with force). Frozen with force:
 * files the audit gap and proceeds.
 *
 * `action` is the human phrase for what is being done ("Re-ingest",
 * "Attribute bank deposit"); `detail` adds specifics for the audit row.
 */
export async function assertStatementWritable(
  supabase: SupabaseClient,
  ref: StatementRef,
  opts: { force?: boolean; action: string; detail?: string },
): Promise<{ forced: boolean; freeze: FreezeStatus }> {
  const freeze = await getFreezeStatus(supabase, ref);
  if (!freeze.frozen) return { forced: false, freeze };
  if (!opts.force) throw new StatementFrozenError(opts.action, freeze);

  // Forced override: make it a matter of record on the statement itself.
  // When no statement row exists yet (period_final freeze on a property's
  // first ingest into the month), there is nowhere to hang the gap --
  // data_gaps requires a property_statement_id. /api/ingest re-files the
  // override on the statement it creates (its wipe would destroy this row
  // anyway); other callers without a statement row have nothing to move.
  if (freeze.statementId) {
    const sentNote = freeze.reason === 'period_final'
      ? `month finalized`
      : `statement marked sent ${freeze.emailSentAt ? freeze.emailSentAt.slice(0, 10) : ''}`.trim();
    const { error } = await supabase.from('data_gaps').insert({
      property_statement_id: freeze.statementId,
      gap_type: 'post_send_write',
      severity: 'warning',
      description: `${opts.action} after ${sentNote}. The owner's copy may no longer match Helm.`,
      expected_data: opts.detail
        ? `${opts.detail} · forced ${new Date().toISOString()}`
        : `forced ${new Date().toISOString()}`,
      resolved: false,
    });
    // The gap is the audit trail; if it cannot be written, the forced write
    // must not proceed invisibly.
    if (error) throw new Error(`finality: audit gap write failed: ${error.message}`);
  }
  return { forced: true, freeze };
}

/** Shape of the 409 payload every gated route returns, for client retry. */
export function frozenResponseBody(err: StatementFrozenError): {
  error: string; frozen: true; reason: string | null; email_sent_at: string | null; month: string | null;
} {
  return {
    error: err.message,
    frozen: true,
    reason: err.freeze.reason,
    email_sent_at: err.freeze.emailSentAt,
    month: err.freeze.month,
  };
}

/* ─────────────────────────── Integrity ─────────────────────────── */

export type IntegrityCheck = {
  ok: boolean;
  /** What the stored lines sum to under the canonical formula. */
  expected: number;
  /** The stored owner_payout. */
  actual: number;
  delta: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Does a statement's stored lines sum to its stored payout? The canonical
 * formula (statement-addons.ts):
 *
 *   owner_payout = rental_revenue + add_ons_revenue - management_fee
 *                  - cleaning_total - repairs_total - attributed_debits_total
 *                  - reserve_holdback
 *
 * Pure arithmetic over the stored columns; changes no value anywhere. A
 * statement that fails this check is internally inconsistent (some writer
 * updated one column without the others) and must not become a deliverable.
 */
export function statementSumsToPayout(row: {
  rental_revenue: number | null;
  add_ons_revenue?: number | null;
  management_fee: number | null;
  cleaning_total: number | null;
  repairs_total: number | null;
  attributed_debits_total?: number | null;
  reserve_holdback?: number | null;
  owner_payout: number | null;
}): IntegrityCheck {
  const n = (v: number | null | undefined) => Number(v) || 0;
  const expected = round2(
    n(row.rental_revenue) + n(row.add_ons_revenue)
    - n(row.management_fee) - n(row.cleaning_total) - n(row.repairs_total)
    - n(row.attributed_debits_total) - n(row.reserve_holdback),
  );
  const actual = round2(n(row.owner_payout));
  const delta = round2(actual - expected);
  return { ok: Math.abs(delta) <= 0.02, expected, actual, delta };
}

export type IntegrityResult =
  | { checked: false }
  | ({ checked: true; month: string | null; propertyName: string | null } & IntegrityCheck);

/**
 * Load-and-check by statement id. Months before FINALITY_FROM_MONTH return
 * checked:false (grandfathered; historical statements were built under
 * rules this check does not model). Read errors throw: a deliverable gate
 * that cannot read must not wave the document through.
 */
export async function verifyStatementIntegrity(
  supabase: SupabaseClient,
  statementId: string,
): Promise<IntegrityResult> {
  const { data: stmt, error } = await supabase
    .from('property_statements')
    .select('id, property_name, period_id, rental_revenue, add_ons_revenue, management_fee, cleaning_total, repairs_total, attributed_debits_total, reserve_holdback, owner_payout')
    .eq('id', statementId)
    .maybeSingle();
  if (error) throw new Error(`integrity: statement read failed: ${error.message}`);
  if (!stmt) return { checked: false };
  const { data: period, error: perErr } = await supabase
    .from('statement_periods')
    .select('month')
    .eq('id', stmt.period_id)
    .maybeSingle();
  if (perErr) throw new Error(`integrity: period read failed: ${perErr.message}`);
  const month = (period?.month as string) ?? null;
  if (!month || month < FINALITY_FROM_MONTH) return { checked: false };
  return {
    checked: true,
    month,
    propertyName: (stmt.property_name as string) ?? null,
    ...statementSumsToPayout(stmt),
  };
}
