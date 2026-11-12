/**
 * Today's departures, arrivals and finished walks for the home page's
 * cleanings strip (home-houses.ts folds them into its Today column). The
 * same reads the daily brief makes: canonical bookings (confirmed or
 * completed, duplicate_of null) and inspections completed on today's
 * Gloucester date. Fails soft to nothing, so the strip still prints the
 * crew's route when this read fails.
 */
import 'server-only';
import { cache } from 'react';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { operatingDate } from '@/lib/operating-date';
import { isPartnerHome } from '@/lib/property-scope';

export type TodayStay = { propertyId: string; propertyName: string; guestName: string | null };
export type TodayWalk = { id: string; propertyId: string; propertyName: string };
export type TodayAtTheHouses = { checkouts: TodayStay[]; checkins: TodayStay[]; walks: TodayWalk[] };

const EMPTY: TodayAtTheHouses = { checkouts: [], checkins: [], walks: [] };

export const loadTodayAtTheHouses = cache(async (): Promise<TodayAtTheHouses> => {
  try {
    const today = operatingDate();
    const walkCutoffIso = new Date(Date.now() - 36 * 3_600_000).toISOString();
    const stays = (column: 'check_in' | 'check_out') =>
      supabase
        .from('bookings')
        .select('property_id, guest_name')
        .in('status', ['confirmed', 'completed'])
        .is('duplicate_of', null)
        .eq(column, today);
    const [props, outs, ins, walks] = await Promise.all([
      supabase.from('properties').select('id, name, kind').limit(500),
      stays('check_out'),
      stays('check_in'),
      supabase
        .from('inspections')
        .select('id, property_id, completed_at')
        .gte('completed_at', walkCutoffIso)
        .order('completed_at', { ascending: false }),
    ]);
    if (props.error || outs.error || ins.error) return EMPTY;
    const homes = (props.data ?? []) as Array<{ id: string; name: string | null; kind: string | null }>;
    const names = new Map(homes.map((p) => [p.id, p.name ?? p.id]));
    // A partner home's host runs its stays: none of them are at our houses.
    const partner = new Set(homes.filter(isPartnerHome).map((p) => p.id));
    const ours = (r: { property_id: string }) => !partner.has(r.property_id);
    const toStay = (r: { property_id: string; guest_name: string | null }): TodayStay => ({
      propertyId: r.property_id,
      propertyName: names.get(r.property_id) ?? r.property_id,
      guestName: r.guest_name?.trim() || null,
    });
    return {
      checkouts: (outs.data ?? []).filter(ours).map(toStay),
      checkins: (ins.data ?? []).filter(ours).map(toStay),
      walks: ((walks.data ?? []) as Array<{ id: string; property_id: string; completed_at: string | null }>)
        .filter((w) => ours(w) && w.completed_at && operatingDate(new Date(w.completed_at)) === today)
        .map((w) => ({ id: w.id, propertyId: w.property_id, propertyName: names.get(w.property_id) ?? w.property_id })),
    };
  } catch {
    return EMPTY;
  }
});
