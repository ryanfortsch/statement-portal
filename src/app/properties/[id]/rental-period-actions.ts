'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { getServiceClient } from '@/lib/supabase-admin';

/**
 * Server action for the Rental season panel (/properties/[id], Operations).
 *
 * The whole window set is replaced on every save: the form posts the rows the
 * operator sees, so a delete is simply a row that did not come back. Deleting
 * all of them returns the property to open year-round, which is what the
 * projection assumes for an un-stamped home.
 *
 * Service-role because property_rental_periods is RLS-on with no policies.
 */

export type SaveRentalPeriodsState = { error: string | null; ok?: boolean };

const MONTH_LENGTHS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function intAt(fd: FormData, key: string, min: number, max: number): number | null {
  const raw = (fd.get(key) ?? '').toString().trim();
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

export async function saveRentalPeriods(
  propertyId: string,
  _prev: SaveRentalPeriodsState,
  fd: FormData,
): Promise<SaveRentalPeriodsState> {
  const session = await auth();
  if (!session?.user?.email) return { error: 'Not signed in' };

  const yearRound = fd.get('year_round') === 'on' || fd.get('year_round') === 'true';

  type Row = {
    property_id: string;
    start_month: number;
    start_day: number;
    end_month: number;
    end_day: number;
    note: string | null;
  };
  const rows: Row[] = [];

  if (!yearRound) {
    const count = intAt(fd, 'window_count', 0, 24) ?? 0;
    for (let i = 0; i < count; i++) {
      // A removed row leaves its indexed fields behind; skip rather than
      // renumber on the client.
      if (fd.get(`w${i}_present`) !== '1') continue;
      const startMonth = intAt(fd, `w${i}_start_month`, 1, 12);
      const startDay = intAt(fd, `w${i}_start_day`, 1, 31);
      const endMonth = intAt(fd, `w${i}_end_month`, 1, 12);
      const endDay = intAt(fd, `w${i}_end_day`, 1, 31);
      if (startMonth == null || startDay == null || endMonth == null || endDay == null) {
        return { error: 'Every window needs a start and end date.' };
      }
      if (startDay > MONTH_LENGTHS[startMonth - 1] || endDay > MONTH_LENGTHS[endMonth - 1]) {
        return { error: 'One of those days does not exist in the month you picked.' };
      }
      rows.push({
        property_id: propertyId,
        start_month: startMonth,
        start_day: startDay,
        end_month: endMonth,
        end_day: endDay,
        note: (fd.get(`w${i}_note`) ?? '').toString().trim() || null,
      });
    }
    if (rows.length === 0) {
      return {
        error:
          'Add at least one window, or tick "Open year-round" to clear the season entirely.',
      };
    }
  }

  try {
    const supabase = getServiceClient();
    const { error: delErr } = await supabase
      .from('property_rental_periods')
      .delete()
      .eq('property_id', propertyId);
    if (delErr) throw delErr;
    if (rows.length > 0) {
      const { error: insErr } = await supabase.from('property_rental_periods').insert(rows);
      if (insErr) throw insErr;
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save the rental season.' };
  }

  revalidatePath(`/properties/${propertyId}`);
  revalidatePath('/revenue');
  return { error: null, ok: true };
}
