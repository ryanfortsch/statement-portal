/**
 * Populates `booking_finance` from the Guesty API mirror (`guesty_reservations`).
 *
 * Phase 2 transition bridge: every canonical booking that matches a Guesty
 * reservation gets its money (gross, taxes, channel commission, payout, and a
 * rental_income figure) at money_source='guesty_legacy', confidence='medium'.
 * Higher-confidence sources (Stripe real fees, parsed payout emails) are added
 * by later units and are never overwritten by this backfill.
 *
 * Matching keys, in order: external_booking_id (= guesty_reservation_id, the
 * strongest), then external_confirmation_code (= confirmation_code). Both are
 * reliably present now that the Guesty per-listing iCal feed stamps a
 * confirmation code on every stay.
 *
 * Runs nightly right after the bookings backfill, and on demand. Idempotent.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _service: SupabaseClient | null = null;
function getServiceClient(): SupabaseClient {
  if (_service) return _service;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Supabase service-role env vars not configured');
  _service = createClient(url, key, { auth: { persistSession: false } });
  return _service;
}

export type FinanceBackfillResult = {
  ok: true;
  canonical_bookings: number;
  matched: number;
  written: number;
  skipped_higher_confidence: number;
  unmatched: number;
};

type GuestyMoney = {
  guesty_reservation_id: string;
  confirmation_code: string | null;
  host_payout: number | null;
  total_paid: number | null;
  total_taxes: number | null;
  channel_commission: number | null;
  owner_net_revenue_guesty: number | null;
};

/**
 * Resolve the per-stay rental income (the figure that splits into management
 * fee + owner payout). Mirrors resolveGrossPayout in lib/revenue-snapshot.ts
 * so booking_finance stays consistent with how Revenue already reads Guesty's
 * money: host_payout if present, else owner_net backed out by the mgmt %,
 * else total_paid.
 */
function resolveRentalIncome(m: GuestyMoney, mgmtFraction: number): number | null {
  const hp = Number(m.host_payout ?? 0);
  if (hp > 0) return hp;
  const own = Number(m.owner_net_revenue_guesty ?? 0);
  if (own > 0) {
    if (mgmtFraction <= 0 || mgmtFraction >= 1) return own;
    return Math.round((own / (1 - mgmtFraction)) * 100) / 100;
  }
  const tp = Number(m.total_paid ?? 0);
  if (tp > 0) return tp;
  return null;
}

export async function backfillBookingFinance(): Promise<FinanceBackfillResult> {
  const sb = getServiceClient();

  // Canonical bookings only -- money attaches to the row downstream reads.
  const { data: bookingRows, error: bErr } = await sb
    .from('bookings')
    .select('id, property_id, external_booking_id, external_confirmation_code')
    .is('duplicate_of', null)
    .neq('status', 'cancelled');
  if (bErr) throw new Error(`read bookings: ${bErr.message}`);
  const bookings = bookingRows ?? [];

  const { data: grRows, error: grErr } = await sb
    .from('guesty_reservations')
    .select('guesty_reservation_id, confirmation_code, host_payout, total_paid, total_taxes, channel_commission, owner_net_revenue_guesty');
  if (grErr) throw new Error(`read guesty_reservations: ${grErr.message}`);

  const byResId = new Map<string, GuestyMoney>();
  const byConfCode = new Map<string, GuestyMoney>();
  for (const r of (grRows ?? []) as GuestyMoney[]) {
    if (r.guesty_reservation_id) byResId.set(r.guesty_reservation_id, r);
    if (r.confirmation_code) byConfCode.set(r.confirmation_code, r);
  }

  const { data: propRows, error: pErr } = await sb
    .from('properties')
    .select('id, management_fee_pct');
  if (pErr) throw new Error(`read properties: ${pErr.message}`);
  const mgmtFractionByProp = new Map<string, number>();
  for (const p of (propRows ?? []) as Array<{ id: string; management_fee_pct: number | null }>) {
    mgmtFractionByProp.set(p.id, (Number(p.management_fee_pct ?? 0)) / 100);
  }

  // Don't clobber higher-confidence money already on a booking.
  const { data: finRows, error: fErr } = await sb
    .from('booking_finance')
    .select('booking_id, money_source');
  if (fErr) throw new Error(`read booking_finance: ${fErr.message}`);
  const protectedIds = new Set(
    (finRows ?? [])
      .filter((r) => r.money_source === 'stripe' || r.money_source === 'ota_email')
      .map((r) => r.booking_id as string),
  );

  type FinanceRow = {
    booking_id: string;
    gross_amount: number | null;
    channel_commission: number | null;
    taxes: number | null;
    payout: number | null;
    rental_income: number | null;
    money_source: 'guesty_legacy';
    confidence: 'medium';
    reconciled_at: string;
  };

  const toWrite: FinanceRow[] = [];
  let matched = 0;
  let skippedHigher = 0;
  let unmatched = 0;
  const now = new Date().toISOString();

  for (const b of bookings) {
    const extId = b.external_booking_id as string | null;
    const conf = b.external_confirmation_code as string | null;
    const m = (extId && byResId.get(extId)) || (conf && byConfCode.get(conf)) || null;
    if (!m) { unmatched++; continue; }
    matched++;
    if (protectedIds.has(b.id as string)) { skippedHigher++; continue; }

    const mgmtFraction = mgmtFractionByProp.get(b.property_id as string) ?? 0;
    toWrite.push({
      booking_id: b.id as string,
      gross_amount: m.total_paid != null ? Number(m.total_paid) : null,
      channel_commission: m.channel_commission != null ? Number(m.channel_commission) : null,
      taxes: m.total_taxes != null ? Number(m.total_taxes) : null,
      payout: m.host_payout != null ? Number(m.host_payout) : null,
      rental_income: resolveRentalIncome(m, mgmtFraction),
      money_source: 'guesty_legacy',
      confidence: 'medium',
      reconciled_at: now,
    });
  }

  let written = 0;
  const chunkSize = 500;
  for (let i = 0; i < toWrite.length; i += chunkSize) {
    const chunk = toWrite.slice(i, i + chunkSize);
    const { error: upErr } = await sb
      .from('booking_finance')
      .upsert(chunk, { onConflict: 'booking_id' });
    if (upErr) throw new Error(`upsert booking_finance chunk ${i / chunkSize}: ${upErr.message}`);
    written += chunk.length;
  }

  return {
    ok: true,
    canonical_bookings: bookings.length,
    matched,
    written,
    skipped_higher_confidence: skippedHigher,
    unmatched,
  };
}
