/**
 * Server-side reader for a property's rental periods.
 *
 * The arithmetic lives in src/lib/rental-periods.ts (pure, unit-tested); this
 * is only the database edge. Service-role because property_rental_periods has
 * RLS on with no policies, like every Helm table.
 */
import 'server-only';
import { getServiceClient } from './supabase-admin';
import { normalizePeriod, type RentalPeriodRow } from './rental-periods';

export type { RentalPeriodRow };

export async function getRentalPeriods(propertyId: string): Promise<RentalPeriodRow[]> {
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('property_rental_periods')
      .select('id, start_month, start_day, end_month, end_day, note')
      .eq('property_id', propertyId)
      .order('start_month', { ascending: true })
      .order('start_day', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: String(r.id),
      ...normalizePeriod({
        startMonth: r.start_month,
        startDay: r.start_day,
        endMonth: r.end_month,
        endDay: r.end_day,
        note: r.note,
      }),
    }));
  } catch {
    // Non-fatal: an unreadable table means the home shows as year-round,
    // which is the default the projection already assumes.
    return [];
  }
}
