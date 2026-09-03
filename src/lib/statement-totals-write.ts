/**
 * The I/O half of the single write path. See statement-totals.ts for the
 * formula and the derived-vs-owned table; this file only loads inputs,
 * guards, and writes. It is the ONLY module permitted to update a money
 * column on property_statements.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAddOnTotals } from './statement-addons';
import { assertStatementWritable, type FreezeStatus } from './statement-finality';
import {
  computeStatementTotals,
  type StatementInputs, type StatementTotals, type ReservationInput, type CleaningEventInput,
} from './statement-totals';

const n = (v: number | null | undefined): number => Number(v) || 0;



export class StatementReadError extends Error {
  constructor(what: string, message: string) {
    super(`statement-totals: ${what} read failed (${message}). Refusing to write: a recompute over a failed read would rewrite the statement as if that data did not exist.`);
    this.name = 'StatementReadError';
  }
}

export type LoadedStatement = {
  statementId: string;
  propertyId: string;
  month: string;
  inputs: StatementInputs;
  /** The stored money columns BEFORE this recompute, for before/after reporting. */
  stored: StatementTotals;
};

/**
 * Load every canonical input for a statement. Fails CLOSED: any read error
 * throws StatementReadError. A missing table is NOT tolerated here -- every
 * table this reads has existed since the base schema, except
 * bank_deposit_attributions, which loadAddOnTotals already tolerates.
 */
export async function loadStatementInputs(
  supabase: SupabaseClient,
  statementId: string,
  overrides: { repairsTotal?: number; reserveHoldback?: number } = {},
): Promise<LoadedStatement> {
  const { data: stmt, error: stmtErr } = await supabase
    .from('property_statements')
    .select('id, property_id, period_id, management_fee_pct, rental_revenue, add_ons_revenue, attributed_debits_total, management_fee, cleaning_total, repairs_total, reserve_holdback, owner_payout, num_stays, nights_booked')
    .eq('id', statementId)
    .maybeSingle();
  if (stmtErr) throw new StatementReadError('property_statements', stmtErr.message);
  if (!stmt) throw new StatementReadError('property_statements', `no statement ${statementId}`);

  const { data: period, error: perErr } = await supabase
    .from('statement_periods').select('month').eq('id', stmt.period_id).maybeSingle();
  if (perErr) throw new StatementReadError('statement_periods', perErr.message);
  if (!period?.month) throw new StatementReadError('statement_periods', `no period for statement ${statementId}`);
  const month = period.month as string;

  const [resR, cleanR] = await Promise.all([
    supabase.from('reservations').select('adjusted_revenue, nights, check_out').eq('property_statement_id', statementId),
    supabase.from('cleaning_events').select('amount, credit_amount, source').eq('property_statement_id', statementId),
  ]);
  if (resR.error) throw new StatementReadError('reservations', resR.error.message);
  if (cleanR.error) throw new StatementReadError('cleaning_events', cleanR.error.message);

  // loadAddOnTotals throws on non-missing-table errors by design.
  const addOns = await loadAddOnTotals(supabase, stmt.property_id as string, month);

  const stored: StatementTotals = {
    rental_revenue: n(stmt.rental_revenue), add_ons_revenue: n(stmt.add_ons_revenue),
    attributed_debits_total: n(stmt.attributed_debits_total), management_fee: n(stmt.management_fee),
    cleaning_total: n(stmt.cleaning_total), repairs_total: n(stmt.repairs_total),
    reserve_holdback: n(stmt.reserve_holdback), owner_payout: n(stmt.owner_payout),
    num_stays: n(stmt.num_stays), nights_booked: n(stmt.nights_booked),
  };

  return {
    statementId,
    propertyId: stmt.property_id as string,
    month,
    stored,
    inputs: {
      month,
      managementFeePct: n(stmt.management_fee_pct),
      reservations: (resR.data || []) as ReservationInput[],
      cleaningEvents: (cleanR.data || []) as CleaningEventInput[],
      addOns,
      repairsTotal: overrides.repairsTotal ?? stored.repairs_total,
      reserveHoldback: overrides.reserveHoldback ?? stored.reserve_holdback,
    },
  };
}

export type FreezeReceipt = { forced: boolean; freeze: FreezeStatus };

export type WriteResult = {
  before: StatementTotals;
  after: StatementTotals;
  changed: boolean;
  forced: boolean;
  freeze: FreezeStatus;
};

/**
 * The one write. Load -> guard -> compute -> write all money columns.
 *
 * `action` names what the caller is doing, for the finality audit row.
 * `force` is the caller's explicit override of a frozen statement (the
 * client confirm-and-retry flow); every forced write files a
 * post_send_write gap via assertStatementWritable.
 *
 * `expectEmptyReservations` is the one delta guard: a reservations read that
 * comes back EMPTY while the stored row says num_stays > 0 has the exact
 * signature of the wipe-to-zero bug class (a filtered or failed read that
 * did not error). Only a caller that just deleted the last reservation may
 * assert it. Everyone else gets a refusal.
 */
export async function writeStatementTotals(
  supabase: SupabaseClient,
  statementId: string,
  opts: {
    action: string;
    force?: boolean;
    detail?: string;
    repairsTotal?: number;
    reserveHoldback?: number;
    expectEmptyReservations?: boolean;
    /**
     * Same signature for cleaning: an empty cleaning_events read against a
     * stored cleaning_total > 0 is refused unless asserted. No caller needs
     * it today -- a month with no cleaning charges stores 0 -- so it exists
     * only so the refusal has a documented override rather than none.
     */
    expectEmptyCleaning?: boolean;
    /**
     * The early guard's receipt. A caller that writes child rows BEFORE
     * recomputing (a credit, an attribution flip, a receipt, a deleted
     * reservation) must run assertStatementWritable before those writes so
     * a declined override leaves no partial state. Passing its result here
     * skips the second guard, so a forced write files ONE audit row rather
     * than two. It cannot be claimed without being held: the only way to
     * obtain the object is to have made the call.
     */
    assertedFreeze?: FreezeReceipt;
  },
): Promise<WriteResult> {
  const loaded = await loadStatementInputs(supabase, statementId, {
    repairsTotal: opts.repairsTotal, reserveHoldback: opts.reserveHoldback,
  });

  if (loaded.inputs.reservations.length === 0 && loaded.stored.num_stays > 0 && !opts.expectEmptyReservations) {
    throw new StatementReadError(
      'reservations',
      `read returned no rows for a statement that records ${loaded.stored.num_stays} stays; refusing to zero it`,
    );
  }
  if (loaded.inputs.cleaningEvents.length === 0 && loaded.stored.cleaning_total > 0 && !opts.expectEmptyCleaning) {
    throw new StatementReadError(
      'cleaning_events',
      `read returned no rows for a statement that bills $${loaded.stored.cleaning_total.toFixed(2)} of cleaning; refusing to zero it`,
    );
  }

  const { forced, freeze } = opts.assertedFreeze
    ?? await assertStatementWritable(supabase, { statementId }, {
      force: opts.force === true, action: opts.action, detail: opts.detail,
    });

  const after = computeStatementTotals(loaded.inputs);
  const before = loaded.stored;

  // Write the DERIVED columns always, and an OWNED column only when this
  // caller supplied it. The owned values were read at the top of the load,
  // several round trips ago; writing them back unconditionally would let a
  // sync silently overwrite a reserve the operator changed in the meantime
  // -- a clobber none of the old per-site writers could commit, since none
  // of them wrote a column it did not own.
  const payload: Partial<StatementTotals> = {
    rental_revenue: after.rental_revenue, add_ons_revenue: after.add_ons_revenue,
    attributed_debits_total: after.attributed_debits_total, management_fee: after.management_fee,
    cleaning_total: after.cleaning_total, owner_payout: after.owner_payout,
    num_stays: after.num_stays, nights_booked: after.nights_booked,
  };
  if (opts.repairsTotal !== undefined) payload.repairs_total = after.repairs_total;
  if (opts.reserveHoldback !== undefined) payload.reserve_holdback = after.reserve_holdback;
  const changed = (Object.keys(payload) as (keyof StatementTotals)[]).some(k => payload[k] !== before[k]);

  if (changed) {
    const { error } = await supabase.from('property_statements').update(payload).eq('id', statementId);
    if (error) throw new Error(`statement-totals: write failed (${error.message})`);
  }
  return { before, after, changed, forced, freeze };
}
