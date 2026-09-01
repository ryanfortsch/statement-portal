'use server';

import { supabaseAdmin } from '@/lib/supabase-admin';
import { PROPERTIES } from '@/lib/properties';
import { getCachedPlatformCSV } from '@/lib/platform-csv-cache';
import { REVENUE_SIGNAL_COLUMNS, REVENUE_SIGNAL_OR } from '@/lib/guesty-revenue-signal';
import { buildRemittanceSheet, type RemittanceSheet } from '@/lib/remittance';
import { loadOwnerRequestCandidates } from '@/lib/statement-owner-requests';
import type { OwnerRequestSelections, PropertyRequestCandidates } from '@/lib/email-templates';
import { auth } from '@/auth';
import type { WorkSlipOwnerActionType } from '@/lib/work-types';

export type OwnerConfigRow = {
  name: string;
  owner_greeting: string;
  owner_full: string;
  owner_emails: string[];
  /**
   * The key /api/draft-email groups combined owner emails on (Prudenzi,
   * Moynahan). Selected so the dashboard's "Combined owner" banner can
   * predict what the draft route will actually do instead of guessing from
   * shared owner_emails, which is a different key and could disagree.
   * null on any property whose row has no owner_id -- those never group.
   */
  owner_id: string | null;
};

/**
 * Owner name/email config per property, keyed by property_id. Was a
 * client-side read of `properties` via the anon key; moved server-side
 * (service role) since `properties` carries owner PII (emails, names) that
 * shouldn't be reachable through the public anon key. Same columns, same
 * shape -- the dashboard's live owner-profile hydration is unchanged.
 */
export async function loadOwnerConfig(): Promise<Record<string, OwnerConfigRow>> {
  const { data } = await supabaseAdmin
    .from('properties')
    .select('id, name, owner_greeting, owner_full, owner_emails, owner_id');
  const map: Record<string, OwnerConfigRow> = {};
  (data || []).forEach((r: { id: string; name: string | null; owner_greeting: string | null; owner_full: string | null; owner_emails: string[] | null; owner_id: string | null }) => {
    map[r.id] = {
      name: r.name || '',
      owner_greeting: r.owner_greeting || '',
      owner_full: r.owner_full || '',
      owner_emails: Array.isArray(r.owner_emails) ? r.owner_emails : [],
      owner_id: r.owner_id || null,
    };
  });
  return map;
}

/**
 * MassTaxConnect occupancy-tax cert IDs for the given properties, keyed by
 * property_id. Same reasoning as loadOwnerConfig -- was an anon-key client
 * read; tax_cert_id is business/financial data, moved server-side.
 */
export async function loadTaxCerts(propIds: string[]): Promise<Record<string, string | null>> {
  if (propIds.length === 0) return {};
  const { data } = await supabaseAdmin.from('properties').select('id, tax_cert_id').in('id', propIds);
  const map: Record<string, string | null> = {};
  (data || []).forEach((r: { id: string; tax_cert_id: string | null }) => {
    map[r.id] = r.tax_cert_id;
  });
  return map;
}

/**
 * Open owner-action work slips, counted per LEGACY statement property id.
 * Was a client-side embedded-join read (`work_slips.select('property_id,
 * properties!inner(name)')`) -- PostgREST embedded resource expansion still
 * requires SELECT on `properties` even though the literal `.from()` target is
 * `work_slips`, so this was a real anon-key properties read that a plain
 * `.from('properties')` grep doesn't catch. Moved the whole computation
 * (including the name -> legacy-id reverse lookup) server-side; same status /
 * owner_action_required / snoozed filters, same shape.
 */
export async function loadOwnerActionCounts(): Promise<Record<string, number>> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from('work_slips')
    .select('property_id, properties!inner(name)')
    .in('status', ['open', 'in_progress', 'scheduled'])
    .eq('owner_action_required', true)
    .or(`snoozed_until.is.null,snoozed_until.lte.${todayIso}`);
  if (error) return {};

  const nameToLegacy = new Map<string, string>();
  for (const [legacyId, p] of Object.entries(PROPERTIES)) {
    nameToLegacy.set(p.name.toLowerCase().trim(), legacyId);
  }

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ properties: { name: string } | { name: string }[] | null }>) {
    const pname = Array.isArray(row.properties) ? row.properties[0]?.name : row.properties?.name;
    if (!pname) continue;
    const legacyId = nameToLegacy.get(pname.toLowerCase().trim());
    if (!legacyId) continue;
    counts[legacyId] = (counts[legacyId] ?? 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Statements-cluster reads/writes moved off the browser anon client. Each
// action mirrors the exact query the dashboard used to run client-side; the
// tables (statement_periods, property_statements, reservations,
// cleaning_events, data_gaps, guesty_reservations, bank_deposit_attributions,
// close_tasks, sync_status, repair_events) are being revoked from anon as
// part of the RLS lockdown, so the service role is the only path. Access
// control is unchanged: server actions POST to /statements, which proxy.ts
// gates behind staff Google SSO by default-deny.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/**
 * Pending bank-review rows for the month, counted per property_id.
 * `known:false` means the read failed -- the caller must render "unknown",
 * never an all-clear zero. Absence of data is not a fact.
 */
export async function loadDepositReviewCounts(month: string): Promise<{ known: boolean; counts: Record<string, number> }> {
  const { data, error } = await supabaseAdmin
    .from('bank_deposit_attributions')
    .select('property_id')
    .eq('month', month)
    .eq('status', 'pending');
  if (error) return { known: false, counts: {} };
  const counts: Record<string, number> = {};
  (data || []).forEach((r: { property_id: string }) => {
    counts[r.property_id] = (counts[r.property_id] || 0) + 1;
  });
  return { known: true, counts };
}

/**
 * The dashboard's main period load: the statement_periods row for the month,
 * its property_statements, and the per-statement enrichment (reservations,
 * cleaning events, repair events, data gaps, plus the guesty_reservations
 * drift probe for paid bookings that appeared after ingest). Identical
 * queries and drift logic to the old client-side version, one round trip.
 */
export async function loadPeriodData(month: string): Promise<
  { error: string } | { period: Row; props: Row[] }
> {
  const { data: periodData, error: periodError } = await supabaseAdmin
    .from('statement_periods').select('*').eq('month', month).single();
  if (periodError) return { error: periodError.message || JSON.stringify(periodError) };

  const { data: props, error: propsError } = await supabaseAdmin
    .from('property_statements').select('*').eq('period_id', periodData.id).order('property_name');
  if (propsError) return { error: propsError.message || JSON.stringify(propsError) };

  const monthStart = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const monthEndExclusive = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

  const enriched = await Promise.all(
    (props || []).map(async (prop: { id: string; property_id: string }) => {
      const [resResult, cleanResult, repairResult, gapResult, guestyResResult] = await Promise.all([
        supabaseAdmin.from('reservations').select('*').eq('property_statement_id', prop.id).order('check_out'),
        supabaseAdmin.from('cleaning_events').select('*').eq('property_statement_id', prop.id),
        supabaseAdmin.from('repair_events').select('*').eq('property_statement_id', prop.id).order('bank_charge_date'),
        supabaseAdmin.from('data_gaps').select('*').eq('property_statement_id', prop.id),
        supabaseAdmin
          .from('guesty_reservations')
          // Revenue candidacy is any of the three signal columns, not
          // total_paid alone: an SCA direct stay has total_paid NULL
          // (Guesty never saw the money) and PostgREST's .gt() drops NULL,
          // so a total_paid filter hid every one of them from this banner.
          .select(`confirmation_code, guest_name, check_out, ${REVENUE_SIGNAL_COLUMNS}`)
          .eq('property_id', prop.property_id)
          .gte('check_out', monthStart)
          .lt('check_out', monthEndExclusive)
          .or(REVENUE_SIGNAL_OR),
      ]);
      // A failed reservations read would empty existingCodes and make every
      // Guesty row look like drift, so both reads must have succeeded before
      // any drift number is believable. Absence of data is not a fact:
      // unknown drift renders as a warning, never as a confident zero.
      const driftKnown = !guestyResResult.error && !resResult.error;
      if (guestyResResult.error || resResult.error) {
        console.error(
          `drift probe unusable for ${prop.property_id}:`,
          guestyResResult.error?.message || resResult.error?.message,
        );
      }
      const existingCodes = new Set(
        (resResult.data || []).map((r: { confirmation_code: string | null }) => r.confirmation_code).filter(Boolean),
      );
      const guestyRows = driftKnown ? (guestyResResult.data || []) : [];
      const driftBookings = guestyRows.filter(
        (g: { confirmation_code: string | null }) => g.confirmation_code && !existingCodes.has(g.confirmation_code),
      );
      // Revenue-bearing Guesty rows with NO confirmation code. Nothing can
      // match or add these -- both the drift filter above and every
      // code-keyed matcher skip them -- so without this count they are
      // money that is simply invisible. Live check 2026-09-01 found ~$52k
      // of them across 7 properties in August alone.
      const driftUnmatchable = guestyRows.filter(
        (g: { confirmation_code: string | null }) => !g.confirmation_code,
      ).length;
      // The gap list is the delivery channel for every warning the pipeline
      // raises (missing Stripe key, unreadable fee, unpriceable booking,
      // post-send override). A discarded error here would render an empty
      // Data Gaps section on a statement that actually has critical flags --
      // the fail-open failure mode this whole phase exists to retire.
      if (gapResult.error) {
        console.error(`data_gaps read failed for ${prop.property_id}:`, gapResult.error.message);
      }
      return {
        ...prop,
        reservations: resResult.data || [],
        cleaning_events: cleanResult.data || [],
        repair_events: repairResult.data || [],
        data_gaps: gapResult.data || [],
        gaps_known: !gapResult.error,
        drift_bookings: driftBookings,
        drift_known: driftKnown,
        drift_unmatchable: driftUnmatchable,
      };
    })
  );

  return { period: periodData as Row, props: enriched as Row[] };
}

/** The month picker's period list, newest first. */
export async function loadPeriodsList(): Promise<
  { error: string } | { periods: Array<{ month: string; status: string }> }
> {
  const { data, error } = await supabaseAdmin
    .from('statement_periods')
    .select('month, status')
    .order('month', { ascending: false })
    .limit(24);
  if (error) return { error: error.message || JSON.stringify(error) };
  return { periods: (data || []) as Array<{ month: string; status: string }> };
}

export type SyncHealthRow = {
  last_synced_at: string | null;
  last_attempted_at: string | null;
  last_status: 'ok' | 'error' | null;
  last_error: string | null;
};

/**
 * Sync freshness AND health per source for the Sync menu. last_synced_at
 * alone is a known-misleading signal: a cron that runs and fails keeps the
 * timestamp looking recent while statement inputs quietly rot (the
 * reservations feed once froze for six days behind a fresh-looking chip).
 * last_status / last_error are what actually say whether the feed works.
 */
export async function loadLastSyncMap(): Promise<Record<string, SyncHealthRow>> {
  const { data } = await supabaseAdmin
    .from('sync_status')
    .select('source, last_synced_at, last_attempted_at, last_status, last_error');
  const map: Record<string, SyncHealthRow> = {};
  (data || []).forEach((r: { source: string } & SyncHealthRow) => {
    map[r.source] = {
      last_synced_at: r.last_synced_at ?? null,
      last_attempted_at: r.last_attempted_at ?? null,
      last_status: r.last_status ?? null,
      last_error: r.last_error ?? null,
    };
  });
  return map;
}

export type MonthDataStatus = {
  platform_csv: { on_file: boolean; filename: string | null; uploaded_at: string | null };
  booking_activity: { known: boolean; rows: number; latest: string | null };
};

/**
 * Are the month's two must-do uploads actually on file? The per-statement
 * source chips are ingest-time snapshots; this is the live answer for the
 * close-review strip, so "Month is clear" can never assert itself while a
 * required input was simply never uploaded.
 */
export async function loadMonthDataStatus(month: string): Promise<MonthDataStatus> {
  const [y, m] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const monthEndExclusive = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

  const [cached, activity] = await Promise.all([
    getCachedPlatformCSV(supabaseAdmin, month).catch(() => null),
    (async () => {
      const { data, error, count } = await supabaseAdmin
        .from('booking_account_activity')
        .select('posting_date', { count: 'exact' })
        .gte('posting_date', monthStart)
        .lt('posting_date', monthEndExclusive)
        .order('posting_date', { ascending: false })
        .limit(1);
      // known:false = the read failed; render "unknown", never "missing".
      if (error) return { known: false, rows: 0, latest: null };
      return { known: true, rows: count ?? 0, latest: (data?.[0]?.posting_date as string | undefined) ?? null };
    })(),
  ]);

  return {
    platform_csv: {
      on_file: !!cached,
      filename: cached?.original_filename ?? null,
      uploaded_at: cached?.uploaded_at ?? null,
    },
    booking_activity: activity,
  };
}

/** Close-checklist rows plus the period's funds-sent date. */
export async function loadCloseState(periodId: string): Promise<{ tasks: Row[]; funds_sent_date: string | null }> {
  const [{ data: tasks }, { data: periodRow }] = await Promise.all([
    supabaseAdmin.from('close_tasks').select('*').eq('period_id', periodId),
    supabaseAdmin.from('statement_periods').select('funds_sent_date').eq('id', periodId).single(),
  ]);
  return { tasks: (tasks || []) as Row[], funds_sent_date: (periodRow?.funds_sent_date as string | null) ?? null };
}

/** Persist the funds-sent date on the period. */
export async function saveFundsSentDateAction(periodId: string, iso: string): Promise<void> {
  await supabaseAdmin.from('statement_periods').update({ funds_sent_date: iso }).eq('id', periodId);
}

/**
 * Flip the period's status. 'final' freezes every statement in the month:
 * all twelve payout writers check it via statement-finality and demand an
 * explicit, recorded force. 'draft' reopens the month. The schema has had
 * this state machine since day one; this is the first code to drive it.
 */
export async function setPeriodStatusAction(
  periodId: string,
  status: 'draft' | 'final',
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabaseAdmin
    .from('statement_periods')
    .update({ status })
    .eq('id', periodId);
  return { ok: !error, error: error?.message ?? null };
}

/** Upsert one property's close-task row (merged client-side, same as before). */
export async function upsertCloseTask(merged: Row): Promise<void> {
  await supabaseAdmin.from('close_tasks').upsert(merged, { onConflict: 'period_id,property_id' });
}

/**
 * Every slip the operator could put in front of this owner this month, with
 * its generated paragraph. Same loader /api/draft-email uses, so what the
 * preview curates is exactly what the Gmail draft says.
 */
export async function loadOwnerRequestCandidatesAction(
  propertyId: string,
  propertyName: string,
  month: string,
): Promise<PropertyRequestCandidates> {
  return loadOwnerRequestCandidates({ propertyId, propertyName, month });
}

/**
 * Persist the per-item picks for one property-month. Written on every tick
 * and every edit, because the draft route reads THESE -- never anything the
 * browser hands it -- so an unsaved edit would silently not ship.
 */
export async function saveOwnerRequestSelectionsAction(
  periodId: string,
  propertyId: string,
  selections: OwnerRequestSelections,
): Promise<void> {
  await supabaseAdmin
    .from('close_tasks')
    .upsert(
      { period_id: periodId, property_id: propertyId, owner_request_items: selections },
      { onConflict: 'period_id,property_id' },
    );
}

/**
 * Add a request that has no slip behind it yet.
 *
 * It files a real work_slip rather than a statement-only line: the ask then
 * lives on the Work board, shows up in the owner-action rail, and its answer
 * is recorded in the same place as every other ask. A statement-only note
 * would be a second, invisible source of truth for the same conversation.
 */
export async function addOwnerRequestSlipAction(args: {
  propertyId: string;
  title: string;
  notes: string;
  actionType: WorkSlipOwnerActionType;
  location?: string | null;
}): Promise<{ ok: true; slipId: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const title = args.title.trim();
  if (!title) return { ok: false, error: 'Give the request a title' };

  const { data, error } = await supabaseAdmin
    .from('work_slips')
    .insert({
      property_id: args.propertyId,
      title,
      category: 'owner',
      status: 'open',
      priority: 'normal',
      location: args.location?.trim() || null,
      owner_action_required: true,
      owner_action_type: args.actionType,
      owner_action_notes: args.notes.trim() || null,
      owner_status: 'not_sent',
      created_by_email: session.user.email,
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message || 'Could not create the request' };
  return { ok: true, slipId: data.id as string };
}

export type GuestyFinanceRow = {
  confirmation_code: string;
  total_paid: number | null;
  total_taxes: number | null;
  channel_commission: number | null;
};

/** Tax/commission columns for the given confirmation codes; shared by the
 *  remittance sheet and the Booking.com deposit-routing sheet. */
export async function loadGuestyRowsByCodes(codes: string[]): Promise<GuestyFinanceRow[]> {
  if (codes.length === 0) return [];
  const { data } = await supabaseAdmin
    .from('guesty_reservations')
    .select('confirmation_code, total_paid, total_taxes, channel_commission')
    .in('confirmation_code', codes);
  return (data || []) as GuestyFinanceRow[];
}

/**
 * The accountant's remittance sheet for one month. Computed entirely
 * server-side in lib/remittance.ts: it reads guesty_reservations.folio_items
 * (a heavy per-booking JSON blob) to get tax and pre-tax guest totals that
 * the scalar total_taxes / total_paid columns get wrong or leave NULL, and
 * that blob has no business crossing to the browser.
 */
export async function loadRemittanceSheet(month: string): Promise<RemittanceSheet> {
  return buildRemittanceSheet(supabaseAdmin, month);
}

export type BankReviewRow = Row & { id: string };

/** The per-card bank review queue: pending + attributed rows for one
 *  property-month. Preserves the old client's error triage by returning the
 *  supabase error code/message for the caller's PGRST205 / missing-table
 *  special cases. */
export async function loadBankDepositReview(propertyId: string, month: string): Promise<
  { rows: BankReviewRow[] } | { error: { code: string | null; message: string } }
> {
  const { data, error } = await supabaseAdmin
    .from('bank_deposit_attributions')
    .select('id, deposit_date, amount, description, source, suggested_reservation_code, direction, status, attributed_reservation_code, label')
    .eq('property_id', propertyId)
    .eq('month', month)
    .in('status', ['pending', 'attributed'])
    .order('deposit_date', { ascending: true });
  if (error) return { error: { code: error.code ?? null, message: error.message || '' } };
  return { rows: (data || []) as BankReviewRow[] };
}
