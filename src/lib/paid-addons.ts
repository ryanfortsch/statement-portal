/**
 * Reads for paid-addons-core: the paid links Helm minted and the stays they
 * were minted for. See the core for the rules.
 *
 * Fails open to no add-ons, logged. The Revenue page and the forecast ran
 * without these until 2026-10-22, so a failed read costs exactly what the
 * estimates were already missing and never more; it must not take the page
 * down with it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isStayPrincipalLink,
  reservationIdFor,
  toPaidAddOn,
  type LinkStay,
  type PaidAddOn,
  type PaidLinkRow,
} from './paid-addons-core';

export async function loadPaidAddOns(supabase: SupabaseClient): Promise<PaidAddOn[]> {
  try {
    const { data, error } = await supabase
      .from('payment_link_requests')
      .select('request_key, label, property_id, amount_cents, base_cents, tax_cents, paid_at, reservation_id')
      .not('paid_at', 'is', null)
      .order('paid_at', { ascending: true })
      .limit(5000);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as PaidLinkRow[];

    const ids = [
      ...new Set(
        rows
          .filter((r) => !isStayPrincipalLink(r.request_key))
          .map((r) => reservationIdFor(r))
          .filter((id): id is string => !!id),
      ),
    ];
    const stays = new Map<string, LinkStay>();
    if (ids.length > 0) {
      const { data: stayRows, error: stayErr } = await supabase
        .from('guesty_reservations')
        .select('guesty_reservation_id, check_in, check_out, channel')
        .in('guesty_reservation_id', ids);
      if (stayErr) throw new Error(stayErr.message);
      for (const s of (stayRows ?? []) as Array<{
        guesty_reservation_id: string | null;
        check_in: string | null;
        check_out: string | null;
        channel: string | null;
      }>) {
        if (!s.guesty_reservation_id || !s.check_out) continue;
        stays.set(s.guesty_reservation_id, {
          checkIn: (s.check_in || '').slice(0, 10),
          checkOut: s.check_out.slice(0, 10),
          channel: s.channel,
        });
      }
    }

    const out: PaidAddOn[] = [];
    for (const r of rows) {
      const id = reservationIdFor(r);
      const addOn = toPaidAddOn(r, id ? stays.get(id) ?? null : null);
      if (addOn) out.push(addOn);
    }
    return out;
  } catch (err) {
    console.error(
      '[paid-addons] read failed; estimates run without paid payment links:',
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

/** By property, for the per-home loops. */
export function byProperty(addOns: readonly PaidAddOn[]): Map<string, PaidAddOn[]> {
  const out = new Map<string, PaidAddOn[]>();
  for (const a of addOns) {
    const arr = out.get(a.propertyId) ?? [];
    arr.push(a);
    out.set(a.propertyId, arr);
  }
  return out;
}
