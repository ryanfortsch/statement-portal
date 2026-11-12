/**
 * Partner home payments: the reads and writes. The rules are
 * src/lib/partner-payments.ts; the bridge routes are /api/pms/connect and
 * /api/pms/requests/settle; the office's screen is /guests/requests.
 *
 * Helm holds no Stripe secret and makes no Stripe call. staycapeann.com
 * creates the host's account, places and settles card holds, and tells Helm
 * what happened; every write here is a record of that, guarded so a late or
 * repeated report can never move a hold backwards.
 */
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { getBridgeProperty, listBridgeProperties, type BridgeProperty } from '@/lib/pms-bridge';
import { isPartnerHome } from '@/lib/property-scope';
import { sendRequestConfirmation } from '@/lib/booking-request-email';
import { BOOKING_REQUEST_COLS, OUTCOME_RETRY_DAYS, type BookingRequestRow } from '@/lib/booking-requests';
import {
  PARTNER_PAYMENT_COLS,
  hashSetupToken,
  holdStatusAfter,
  isSetupToken,
  newSetupToken,
  setupTokenExpiry,
  settleQueue,
  shapeAccount,
  type AccountStatusReport,
  type PartnerPaymentAccount,
  type SettleItem,
  type SettleReport,
  type SettleRow,
} from '@/lib/partner-payments';

const ACCOUNTS = 'partner_payment_accounts';
const REQUESTS = 'booking_requests';

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === '42P01' || err.code === 'PGRST205' || /could not find the table|does not exist/i.test(err.message ?? '');
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function getPaymentAccount(propertyId: string): Promise<PartnerPaymentAccount | null> {
  if (!isServiceConfigured) return null;
  const { data, error } = await supabaseAdmin.from(ACCOUNTS).select(PARTNER_PAYMENT_COLS).eq('property_id', propertyId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(`partner_payment_accounts read failed: ${error.message}`);
  }
  return data ? shapeAccount(data as Record<string, unknown>) : null;
}

export type PartnerHomePayments = { home: BridgeProperty; account: PartnerPaymentAccount | null };

/** Every partner home with its payments record, for the office's screen. */
export async function listPartnerHomePayments(): Promise<PartnerHomePayments[]> {
  if (!isServiceConfigured) return [];
  const homes = (await listBridgeProperties('all', { includePartners: true })).filter(isPartnerHome);
  if (homes.length === 0) return [];
  const { data, error } = await supabaseAdmin.from(ACCOUNTS).select(PARTNER_PAYMENT_COLS).in('property_id', homes.map((h) => h.id));
  if (error && !isMissingTable(error)) throw new Error(`partner_payment_accounts read failed: ${error.message}`);
  const byId = new Map(((data ?? []) as Array<Record<string, unknown>>).map((r) => [String(r.property_id), shapeAccount(r)]));
  return homes.map((home) => ({ home, account: byId.get(home.id) ?? null }));
}

// ─── The office's writes ────────────────────────────────────────────────────

async function requirePartner(propertyId: string): Promise<BridgeProperty | { error: string }> {
  const home = await getBridgeProperty(propertyId);
  if (!home) return { error: 'No such home.' };
  if (!isPartnerHome(home)) return { error: 'Only a partner home is paid through its host’s Stripe.' };
  return home;
}

/** Seed the row so an update below always has one to match. */
async function ensureRow(propertyId: string): Promise<string | null> {
  const { error } = await supabaseAdmin.from(ACCOUNTS).upsert({ property_id: propertyId }, { onConflict: 'property_id', ignoreDuplicates: true });
  return error ? error.message : null;
}

/** A fresh setup link. The old one stops working; the token is returned once. */
export async function makeSetupLink(propertyId: string, by: string, now: Date = new Date()): Promise<{ ok: true; token: string; expiresAt: string } | { ok: false; reason: string }> {
  if (!isServiceConfigured) return { ok: false, reason: 'Helm is not connected to its database.' };
  const home = await requirePartner(propertyId);
  if ('error' in home) return { ok: false, reason: home.error };
  const seeded = await ensureRow(propertyId);
  if (seeded) return { ok: false, reason: seeded };
  const token = newSetupToken();
  const expiresAt = setupTokenExpiry(now);
  const { error } = await supabaseAdmin
    .from(ACCOUNTS)
    .update({ setup_token_hash: hashSetupToken(token), setup_token_expires_at: expiresAt, setup_token_created_by: by })
    .eq('property_id', propertyId);
  if (error) return { ok: false, reason: error.message };
  return { ok: true, token, expiresAt };
}

export async function setFeePct(propertyId: string, pct: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isServiceConfigured) return { ok: false, reason: 'Helm is not connected to its database.' };
  const home = await requirePartner(propertyId);
  if ('error' in home) return { ok: false, reason: home.error };
  const seeded = await ensureRow(propertyId);
  if (seeded) return { ok: false, reason: seeded };
  const { error } = await supabaseAdmin.from(ACCOUNTS).update({ fee_pct: pct }).eq('property_id', propertyId);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

// ─── The bridge: the host's setup link ──────────────────────────────────────

export type ResolvedSetup = {
  property_id: string;
  title: string;
  host_email: string | null;
  stripe_account_id: string | null;
  details_submitted: boolean;
  expires_at: string;
};

/** The home a live setup link belongs to, or null (unknown, replaced, expired). */
export async function resolveSetupToken(token: string, now: Date = new Date()): Promise<ResolvedSetup | null> {
  if (!isServiceConfigured || !isSetupToken(token)) return null;
  const { data, error } = await supabaseAdmin
    .from(ACCOUNTS)
    .select(`${PARTNER_PAYMENT_COLS}, setup_token_hash`)
    .eq('setup_token_hash', hashSetupToken(token))
    .gt('setup_token_expires_at', now.toISOString())
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(`partner_payment_accounts read failed: ${error.message}`);
  }
  if (!data) return null;
  const account = shapeAccount(data as Record<string, unknown>);
  const home = await getBridgeProperty(account.property_id);
  if (!home || !isPartnerHome(home)) return null;
  const { data: owner } = await supabaseAdmin.from('properties').select('owner_emails').eq('id', home.id).maybeSingle();
  const emails = Array.isArray((owner as { owner_emails?: unknown } | null)?.owner_emails) ? ((owner as { owner_emails: string[] }).owner_emails ?? []).filter(Boolean) : [];
  return {
    property_id: home.id,
    title: home.title || home.name,
    host_email: emails[0] ?? null,
    stripe_account_id: account.stripe_account_id,
    details_submitted: account.details_submitted,
    expires_at: account.setup_token_expires_at as string,
  };
}

/**
 * The account the site created for this home. Written once: a second report
 * (two tabs, a retry) gets back the account already on file, and the site
 * uses that one.
 */
export async function recordStripeAccount(token: string, accountId: string, now: Date = new Date()): Promise<{ ok: true; stripe_account_id: string } | { ok: false; reason: 'not_found' | 'error' }> {
  const setup = await resolveSetupToken(token, now);
  if (!setup) return { ok: false, reason: 'not_found' };
  if (setup.stripe_account_id) return { ok: true, stripe_account_id: setup.stripe_account_id };
  const { data, error } = await supabaseAdmin
    .from(ACCOUNTS)
    .update({ stripe_account_id: accountId })
    .eq('property_id', setup.property_id)
    .is('stripe_account_id', null)
    .select('stripe_account_id')
    .maybeSingle();
  if (error) {
    // The unique index: the account is already another home's.
    console.error('[partner-payments] record account failed:', error.message);
    return { ok: false, reason: 'error' };
  }
  if (data) return { ok: true, stripe_account_id: String((data as { stripe_account_id: string }).stripe_account_id) };
  const again = await getPaymentAccount(setup.property_id);
  return again?.stripe_account_id ? { ok: true, stripe_account_id: again.stripe_account_id } : { ok: false, reason: 'error' };
}

/** What Stripe last said about a home's account. Only for the account on file. */
export async function recordAccountStatus(r: AccountStatusReport, now: Date = new Date()): Promise<boolean> {
  if (!isServiceConfigured) return false;
  const { data, error } = await supabaseAdmin
    .from(ACCOUNTS)
    .update({
      charges_enabled: r.charges_enabled,
      payouts_enabled: r.payouts_enabled,
      details_submitted: r.details_submitted,
      requirements_due: r.requirements_due,
      status_checked_at: now.toISOString(),
    })
    .eq('property_id', r.property_id)
    .eq('stripe_account_id', r.stripe_account_id)
    .select('property_id')
    .maybeSingle();
  if (error) throw new Error(`partner_payment_accounts update failed: ${error.message}`);
  return !!data;
}

// ─── The bridge: settling holds ─────────────────────────────────────────────

export type SettlementQueue = {
  actions: SettleItem[];
  /** Every live hold Helm knows of, so the site can release one Helm never recorded. */
  holds: Array<{ request_key: string; payment_intent_id: string; stripe_account_id: string }>;
  /** Every connected account, so the site can refresh what Stripe says about it. */
  accounts: Array<{ property_id: string; stripe_account_id: string }>;
};

export async function settlementQueue(now: Date = new Date()): Promise<SettlementQueue> {
  const empty: SettlementQueue = { actions: [], holds: [], accounts: [] };
  if (!isServiceConfigured) return empty;
  const [held, accounts] = await Promise.all([
    supabaseAdmin
      .from(REQUESTS)
      .select('request_key, status, respond_by, hold_status, stripe_account_id, payment_intent_id, hold_cents')
      .eq('hold_status', 'held')
      .order('created_at', { ascending: true })
      .limit(500),
    supabaseAdmin.from(ACCOUNTS).select('property_id, stripe_account_id').not('stripe_account_id', 'is', null).limit(500),
  ]);
  if (held.error) {
    if (isMissingTable(held.error)) return empty;
    throw new Error(`booking_requests read failed: ${held.error.message}`);
  }
  if (accounts.error && !isMissingTable(accounts.error)) throw new Error(`partner_payment_accounts read failed: ${accounts.error.message}`);
  const rows = (held.data ?? []) as SettleRow[];
  return {
    actions: settleQueue(rows, now),
    holds: rows
      .filter((r) => r.payment_intent_id && r.stripe_account_id)
      .map((r) => ({ request_key: r.request_key, payment_intent_id: r.payment_intent_id as string, stripe_account_id: r.stripe_account_id as string })),
    accounts: ((accounts.data ?? []) as Array<{ property_id: string; stripe_account_id: string }>).map((a) => ({ property_id: a.property_id, stripe_account_id: a.stripe_account_id })),
  };
}

export type SettleResult = { ok: true; applied: boolean; emailed: boolean } | { ok: false; reason: 'not_found' | 'mismatch' | 'error'; detail?: string };

/**
 * Record what the site did with a hold. Forward only: the update matches
 * the request only while its hold is 'held' and on this payment intent, so a
 * repeat or a late report changes nothing. A capture needs an accepted
 * request (the database says so too) and the amount Helm held, to the cent.
 */
export async function recordSettlement(r: SettleReport, now: Date = new Date()): Promise<SettleResult> {
  if (!isServiceConfigured) return { ok: false, reason: 'error', detail: 'not configured' };
  const { data: row, error } = await supabaseAdmin.from(REQUESTS).select(BOOKING_REQUEST_COLS).eq('request_key', r.request_key).maybeSingle();
  if (error) return { ok: false, reason: 'error', detail: error.message };
  if (!row) return { ok: false, reason: 'not_found' };
  const req = row as BookingRequestRow;
  if (req.payment_intent_id !== r.payment_intent_id) return { ok: false, reason: 'mismatch', detail: 'another payment intent' };
  if (req.hold_status !== 'held') return { ok: true, applied: false, emailed: false };
  if (r.outcome === 'captured' && (req.status !== 'accepted' || r.amount_cents !== req.hold_cents)) {
    return { ok: false, reason: 'mismatch', detail: req.status !== 'accepted' ? 'the request is not accepted' : 'the charge is not the amount held' };
  }

  const stamp = now.toISOString();
  const patch: Record<string, unknown> = { hold_status: holdStatusAfter(r.outcome), hold_error: r.outcome === 'capture_failed' ? r.detail ?? 'Stripe refused the charge' : null };
  if (r.outcome === 'captured') {
    patch.captured_at = stamp;
    patch.charge_id = r.charge_id;
  }
  if (r.outcome === 'released') patch.released_at = stamp;

  let q = supabaseAdmin.from(REQUESTS).update(patch).eq('id', req.id).eq('hold_status', 'held').eq('payment_intent_id', r.payment_intent_id);
  if (r.outcome === 'captured') q = q.eq('status', 'accepted');
  const { data: updated, error: upErr } = await q.select(BOOKING_REQUEST_COLS).maybeSingle();
  if (upErr) return { ok: false, reason: 'error', detail: upErr.message };
  if (!updated) return { ok: true, applied: false, emailed: false };

  const after = updated as BookingRequestRow;
  const emailed = after.hold_status === 'captured' ? await emailConfirmation(after) : false;
  return { ok: true, applied: true, emailed };
}

async function emailConfirmation(row: BookingRequestRow): Promise<boolean> {
  try {
    const home = await getBridgeProperty(row.property_id);
    if (!(await sendRequestConfirmation(row, home?.title ?? null))) return false;
    await supabaseAdmin.from(REQUESTS).update({ confirmation_emailed_at: new Date().toISOString() }).eq('id', row.id).is('confirmation_emailed_at', null);
    return true;
  } catch (err) {
    console.warn('[partner-payments] confirmation email failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** The hourly cron's share: retry a confirmation that did not send, for a few days. */
export async function retryConfirmations(now: Date = new Date()): Promise<number> {
  if (!isServiceConfigured) return 0;
  const since = new Date(now.getTime() - OUTCOME_RETRY_DAYS * 86_400_000).toISOString();
  const { data } = await supabaseAdmin
    .from(REQUESTS)
    .select(BOOKING_REQUEST_COLS)
    .eq('status', 'accepted')
    .eq('hold_status', 'captured')
    .is('confirmation_emailed_at', null)
    .gte('captured_at', since)
    .limit(100);
  let sent = 0;
  for (const row of (data ?? []) as BookingRequestRow[]) {
    if (await emailConfirmation(row)) sent++;
  }
  return sent;
}
