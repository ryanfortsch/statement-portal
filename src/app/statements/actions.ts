'use server';

import { supabaseAdmin } from '@/lib/supabase-admin';
import { PROPERTIES } from '@/lib/properties';
import { buildRemittanceSheet, type RemittanceSheet } from '@/lib/remittance';
import { loadStatementWorkNotes } from '@/lib/statement-work-notes';
import type { PropertyWorkNotes } from '@/lib/email-templates';

export type OwnerConfigRow = {
  name: string;
  owner_greeting: string;
  owner_full: string;
  owner_emails: string[];
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
    .select('id, name, owner_greeting, owner_full, owner_emails');
  const map: Record<string, OwnerConfigRow> = {};
  (data || []).forEach((r: { id: string; name: string | null; owner_greeting: string | null; owner_full: string | null; owner_emails: string[] | null }) => {
    map[r.id] = {
      name: r.name || '',
      owner_greeting: r.owner_greeting || '',
      owner_full: r.owner_full || '',
      owner_emails: Array.isArray(r.owner_emails) ? r.owner_emails : [],
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

/** Pending bank-review rows for the month, counted per property_id. */
export async function loadDepositReviewCounts(month: string): Promise<Record<string, number>> {
  const { data, error } = await supabaseAdmin
    .from('bank_deposit_attributions')
    .select('property_id')
    .eq('month', month)
    .eq('status', 'pending');
  if (error) return {};
  const counts: Record<string, number> = {};
  (data || []).forEach((r: { property_id: string }) => {
    counts[r.property_id] = (counts[r.property_id] || 0) + 1;
  });
  return counts;
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
          .select('confirmation_code, guest_name, check_out, total_paid')
          .eq('property_id', prop.property_id)
          .gte('check_out', monthStart)
          .lt('check_out', monthEndExclusive)
          .gt('total_paid', 0),
      ]);
      const existingCodes = new Set(
        (resResult.data || []).map((r: { confirmation_code: string | null }) => r.confirmation_code).filter(Boolean),
      );
      const driftBookings = (guestyResResult.data || []).filter(
        (g: { confirmation_code: string | null }) => g.confirmation_code && !existingCodes.has(g.confirmation_code),
      );
      return {
        ...prop,
        reservations: resResult.data || [],
        cleaning_events: cleanResult.data || [],
        repair_events: repairResult.data || [],
        data_gaps: gapResult.data || [],
        drift_bookings: driftBookings,
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

/** Last-sync timestamps per source for the header chips. */
export async function loadLastSyncMap(): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin.from('sync_status').select('source, last_synced_at');
  const map: Record<string, string> = {};
  (data || []).forEach((r: { source: string; last_synced_at: string }) => { map[r.source] = r.last_synced_at; });
  return map;
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

/** Upsert one property's close-task row (merged client-side, same as before). */
export async function upsertCloseTask(merged: Row): Promise<void> {
  await supabaseAdmin.from('close_tasks').upsert(merged, { onConflict: 'period_id,property_id' });
}

/**
 * The polished work-notes groups for one property-month, for the email
 * preview modal. Same loader /api/draft-email uses, so what the preview
 * shows is what the Gmail draft says.
 */
export async function loadStatementWorkNotesAction(
  propertyId: string,
  propertyName: string,
  month: string,
): Promise<PropertyWorkNotes> {
  return loadStatementWorkNotes({ propertyId, propertyName, month });
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
