import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseChaseBankCsv } from '@/lib/chase-csv';
import { PROPERTIES } from '@/lib/properties';

/**
 * Central "Bookingcom Deposits" Chase account (...5623) activity.
 *
 * Booking.com pays every property's payouts into this one account, then the
 * money moves to the property's own checking as a plain "Online Transfer to
 * CHK ...last4" -- so the property's bank CSV never shows a Booking.com-
 * labeled deposit, and Booking.com stays had no bank corroboration.
 *
 * The operator uploads this account's activity CSV once a month from the
 * Statements page. Rows accumulate in booking_account_activity (idempotent
 * via dedupe_hash), and /api/ingest reads the transfers-out to corroborate
 * Booking.com reservations per property.
 */

export type BookingAccountRow = {
  posting_date: string;
  description: string;
  amount: number;
  txn_type: string | null;
  kind: 'booking_credit' | 'property_transfer' | 'other';
  payout_ref: string | null;
  transfer_last4: string | null;
  property_id: string | null;
  uploaded_month: string;
  dedupe_hash: string;
};

function dedupeHash(postingDate: string, amount: number, description: string): string {
  const normalizedDesc = description.replace(/\s+/g, ' ').trim().toLowerCase();
  return createHash('sha256')
    .update(`${postingDate}|${amount.toFixed(2)}|${normalizedDesc}`)
    .digest('hex');
}

function propertyForLast4(last4: string): string | null {
  const prop = Object.values(PROPERTIES).find(p => p.bank_last4 === last4);
  return prop ? prop.id : null;
}

export function parseBookingAccountCsv(text: string, uploadedMonth: string): BookingAccountRow[] {
  const txns = parseChaseBankCsv(text);
  return txns.map(t => {
    const descUpper = t.description.toUpperCase();
    let kind: BookingAccountRow['kind'] = 'other';
    let payoutRef: string | null = null;
    let transferLast4: string | null = null;
    let propertyId: string | null = null;

    const transferMatch = t.description.match(/TRANSFER TO CHK\s*\.*\s*(\d{4})/i);
    if (t.amount > 0 && (descUpper.includes('BOOKING.COM') || descUpper.includes('BOOKING COM'))) {
      kind = 'booking_credit';
      payoutRef = t.description.match(/IND ID:\s*(\S+)/i)?.[1] ?? null;
    } else if (t.amount < 0 && transferMatch) {
      kind = 'property_transfer';
      transferLast4 = transferMatch[1];
      propertyId = propertyForLast4(transferLast4);
    }

    return {
      posting_date: t.posting_date,
      description: t.description,
      amount: t.amount,
      txn_type: t.raw_type,
      kind,
      payout_ref: payoutRef,
      transfer_last4: transferLast4,
      property_id: propertyId,
      uploaded_month: uploadedMonth,
      dedupe_hash: dedupeHash(t.posting_date, t.amount, t.description),
    };
  });
}

export async function ingestBookingAccountCsv(
  supabase: SupabaseClient,
  text: string,
  uploadedMonth: string,
): Promise<{
  rows_parsed: number;
  booking_credits: number;
  property_transfers: number;
  unmapped_transfers: number;
  inserted: number;
  skipped_duplicates: number;
}> {
  const rows = parseBookingAccountCsv(text, uploadedMonth);
  let inserted = 0;
  if (rows.length > 0) {
    const { data, error } = await supabase
      .from('booking_account_activity')
      .upsert(rows, { onConflict: 'dedupe_hash', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(`booking_account_activity write failed: ${error.message}`);
    inserted = (data ?? []).length;
  }
  return {
    rows_parsed: rows.length,
    booking_credits: rows.filter(r => r.kind === 'booking_credit').length,
    property_transfers: rows.filter(r => r.kind === 'property_transfer').length,
    unmapped_transfers: rows.filter(r => r.kind === 'property_transfer' && !r.property_id).length,
    inserted,
    skipped_duplicates: rows.length - inserted,
  };
}
