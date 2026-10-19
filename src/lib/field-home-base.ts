/**
 * Where a contractor starts from, for "work near you": the marketplace ranks
 * packets and the new-work text picks recipients by distance from
 * contractors.home_lat / home_lng.
 *
 * Onboarding derives it from the W-9 city, state and ZIP; the profile's Edit
 * details lets a contractor who moves change it without touching the W-9.
 * Town-level on purpose: coarse coordinates are all ranking needs, and no
 * house-precision location is stored on the contractor row.
 */
import 'server-only';
import { fieldDb } from '@/lib/field-db';
import { geocodeAddress, type Coords } from '@/lib/geocode';
import { haversineMiles } from '@/lib/proximity';

const HQ = { lat: 42.6209, lng: -70.645 };
// An implausible hit (a bare town name landing in the wrong state; one real
// inspector's landed 472 mi away) stores nothing rather than an absurd
// distance.
const PLAUSIBLE_COMMUTE_MILES = 150;

/** Town-level coordinates for a typed town, or null when it cannot be placed
 *  within a plausible commute of Gloucester. */
export async function homeBaseFor(town: string): Promise<Coords | null> {
  if (!town.trim()) return null;
  const best = await geocodeAddress(town);
  if (!best || haversineMiles(HQ, best) > PLAUSIBLE_COMMUTE_MILES) return null;
  return best;
}

/**
 * The town a contractor last gave as home: the latest one set on the
 * profile (its details_changed event), else the W-9 city and state the
 * onboarding geocoded. Null when neither is on file; a failed read is
 * also null, so the form shows an empty field rather than a wrong town.
 */
export async function loadHomeTown(contractorId: string): Promise<string | null> {
  try {
    const [{ data: ev }, { data: w9 }] = await Promise.all([
      fieldDb()
        .from('packet_events')
        .select('payload, created_at')
        .eq('contractor_id', contractorId)
        .eq('event_type', 'details_changed')
        .order('created_at', { ascending: false })
        .limit(20),
      fieldDb().from('contractor_w9').select('city, state').eq('contractor_id', contractorId).maybeSingle(),
    ]);
    const typed = ((ev ?? []) as Array<{ payload: { home_town?: string } | null }>)
      .map((e) => e.payload?.home_town)
      .find((t) => typeof t === 'string' && t.trim());
    if (typed && typed.trim()) return typed.trim();
    const row = w9 as { city: string | null; state: string | null } | null;
    const fromW9 = [row?.city?.trim(), row?.state?.trim()].filter(Boolean).join(', ');
    return fromW9 || null;
  } catch {
    return null;
  }
}
