'use server';

import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * Server-side reads/writes for the multi-month installment suggester
 * (MultiMonthBookingsSection). Was a browser-side read of
 * guesty_reservations / reservation_installments /
 * installment_suggestion_dismissals via the anon key; those tables are
 * losing their anon policies in the RLS lockdown, so the queries move
 * behind server actions. Identical queries, same shapes. Access control
 * is proxy.ts's default-deny staff SSO on the property pages, unchanged.
 */

export type MultiMonthGuestyRow = {
  confirmation_code: string;
  guest_name: string | null;
  check_in: string;
  check_out: string;
  nights: number | null;
  channel: string | null;
  guesty_channel_id: string | null;
  total_paid: number | null;
  total_taxes: number | null;
  channel_commission: number | null;
  owner_net_revenue_guesty: number | null;
};

export type InstallmentRow = {
  id: string;
  confirmation_code: string;
  property_id: string;
  month: string;
  installment_revenue: number;
  installment_nights: number | null;
  is_final_month: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
};

/** Future-checkout bookings for the property plus any existing installment
 *  splits and team-wide suggestion dismissals for those codes. */
export async function loadMultiMonthData(propertyId: string): Promise<{
  rows: MultiMonthGuestyRow[];
  installments: InstallmentRow[];
  dismissedCodes: string[];
}> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data: rows } = await supabaseAdmin
    .from('guesty_reservations')
    .select('confirmation_code, guest_name, check_in, check_out, nights, channel, guesty_channel_id, total_paid, total_taxes, channel_commission, owner_net_revenue_guesty')
    .eq('property_id', propertyId)
    .gte('check_out', todayIso)
    .order('check_in', { ascending: true });

  const codes = ((rows || []) as MultiMonthGuestyRow[]).map(r => r.confirmation_code).filter(Boolean);
  if (codes.length === 0) {
    return { rows: (rows || []) as MultiMonthGuestyRow[], installments: [], dismissedCodes: [] };
  }

  const [{ data: installRows }, { data: dismissRows }] = await Promise.all([
    supabaseAdmin
      .from('reservation_installments')
      .select('id, confirmation_code, property_id, month, installment_revenue, installment_nights, is_final_month, note, created_at, updated_at')
      .in('confirmation_code', codes),
    supabaseAdmin
      .from('installment_suggestion_dismissals')
      .select('confirmation_code')
      .in('confirmation_code', codes),
  ]);

  return {
    rows: (rows || []) as MultiMonthGuestyRow[],
    installments: (installRows || []) as InstallmentRow[],
    dismissedCodes: ((dismissRows || []) as { confirmation_code: string }[]).map(d => d.confirmation_code),
  };
}

/** Dismiss the installment suggestion for one booking (team-wide). */
export async function dismissInstallmentSuggestion(code: string, propertyId: string): Promise<void> {
  await supabaseAdmin
    .from('installment_suggestion_dismissals')
    .upsert({ confirmation_code: code, property_id: propertyId }, { onConflict: 'confirmation_code' });
}

/** Restore a dismissed suggestion by deleting its dismissal row. */
export async function restoreInstallmentSuggestion(code: string): Promise<void> {
  await supabaseAdmin.from('installment_suggestion_dismissals').delete().eq('confirmation_code', code);
}
