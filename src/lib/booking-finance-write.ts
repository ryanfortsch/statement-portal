/**
 * The permitted writer of booking_finance for DIRECT bookings.
 *
 * booking_finance is the per-booking money layer beside `bookings`. Its
 * only writer until now was finance-backfill.ts (Guesty API mirror,
 * money_source guesty_legacy). Helm-native direct stays, a manual entry on
 * /channels/bookings/new or an SCA payment, have nothing to backfill from,
 * so this module records what the operator typed or what Stripe settled.
 *
 * Scope, deliberately narrow:
 *   - money_source is 'stripe' or 'manual' and nothing else. OTA emails
 *     and bank CSVs have their own readers.
 *   - the booking's channel must be direct or manual. An Airbnb stay's
 *     money comes from the OTA, never from a form.
 *   - the confidence ladder from the migration holds: stripe > ota_email >
 *     bank_csv > manual > guesty_legacy. A lower source never overwrites a
 *     higher one; the write is skipped and says so.
 *   - rental_income and channel_commission are never written here. That
 *     is payout math, owned by the statements pipeline, which does not read
 *     this table.
 */
import 'server-only';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import type { BookingMoneyConfidence, BookingMoneySource } from '@/lib/channels-types';

export type DirectMoneySource = Extract<BookingMoneySource, 'stripe' | 'manual'>;

export type DirectFinanceInput = {
  gross_amount?: number | null;
  taxes?: number | null;
  cleaning_fee?: number | null;
  stripe_fee?: number | null;
  payout?: number | null;
  currency?: string | null;
  money_source: DirectMoneySource;
  /** Defaults: stripe -> high, manual -> low. */
  confidence?: BookingMoneyConfidence;
  notes?: string | null;
};

export type DirectFinanceResult = {
  written: boolean;
  /** Present when the write was skipped. */
  reason?: string;
};

/** Lower is more trusted. Mirrors the comment block in 20260521b_booking_finance.sql. */
const SOURCE_RANK: Record<BookingMoneySource, number> = {
  stripe: 0,
  ota_email: 1,
  bank_csv: 2,
  manual: 3,
  guesty_legacy: 4,
};

const DIRECT_CHANNELS: ReadonlySet<string> = new Set(['direct', 'manual']);

function money(v: number | null | undefined): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

/**
 * Upsert the direct booking's money. Only the keys present on `input` are
 * written, so a manual update of the cleaning fee does not null a gross
 * that Stripe already set.
 */
export async function writeDirectBookingFinance(bookingId: string, input: DirectFinanceInput): Promise<DirectFinanceResult> {
  if (!isServiceConfigured) throw new Error('Supabase service role is not configured.');
  if (!bookingId) throw new Error('Missing booking id.');
  if (input.money_source !== 'stripe' && input.money_source !== 'manual') {
    throw new Error(`booking_finance direct writer: money_source must be stripe or manual, got ${String(input.money_source)}`);
  }

  const { data: booking, error: bErr } = await supabaseAdmin
    .from('bookings')
    .select('id, channel')
    .eq('id', bookingId)
    .maybeSingle();
  if (bErr) throw new Error(`read booking: ${bErr.message}`);
  if (!booking) throw new Error('Booking not found.');
  const channel = (booking as { channel: string }).channel;
  if (!DIRECT_CHANNELS.has(channel)) {
    throw new Error(`booking_finance direct writer: only direct or manual bookings, this one is ${channel}`);
  }

  const { data: existing, error: fErr } = await supabaseAdmin
    .from('booking_finance')
    .select('money_source')
    .eq('booking_id', bookingId)
    .maybeSingle();
  if (fErr) throw new Error(`read booking_finance: ${fErr.message}`);
  const existingSource = (existing as { money_source: BookingMoneySource } | null)?.money_source ?? null;
  if (existingSource && SOURCE_RANK[existingSource] < SOURCE_RANK[input.money_source]) {
    return { written: false, reason: `kept ${existingSource}: it outranks ${input.money_source}` };
  }

  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    booking_id: bookingId,
    money_source: input.money_source,
    confidence: input.confidence ?? (input.money_source === 'stripe' ? 'high' : 'low'),
    updated_at: now,
  };
  const gross = money(input.gross_amount);
  if (gross !== undefined) row.gross_amount = gross;
  const taxes = money(input.taxes);
  if (taxes !== undefined) row.taxes = taxes;
  const cleaning = money(input.cleaning_fee);
  if (cleaning !== undefined) row.cleaning_fee = cleaning;
  const stripeFee = money(input.stripe_fee);
  if (stripeFee !== undefined) row.stripe_fee = stripeFee;
  const payout = money(input.payout);
  if (payout !== undefined) row.payout = payout;
  if (input.currency) row.currency = input.currency;
  if (input.notes !== undefined) row.notes = input.notes?.trim() || null;
  if (input.money_source === 'stripe') row.reconciled_at = now;

  const { error } = await supabaseAdmin.from('booking_finance').upsert(row, { onConflict: 'booking_id' });
  if (error) throw new Error(`write booking_finance: ${error.message}`);
  return { written: true };
}
