'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { getPropertyAccess } from '@/lib/property-access';
import { resolveGuestyListingId } from '@/lib/guesty-listing-id';
import { civicForProperty } from '@/lib/civic';
import type { HelmPropertyRow } from '@/lib/properties';
import {
  getGuestyListing,
  guestFieldsOf,
  updateListingGuestFields,
  GUESTY_GUEST_FIELD_KEYS,
  type GuestyGuestFields,
} from '@/lib/guesty';
import {
  PULL_FIELDS,
  guestyPullValues,
  helmPullValues,
  pullStatus,
  pullUpdates,
  type PullKey,
  type PullStatus,
} from '@/lib/guesty-fields';

/**
 * Server actions backing /properties/[id]/sync-guesty, the Guesty fields
 * screen: one table, both directions, an arrow per field.
 *
 *   loadGuestyFieldsAction - read Helm's values and the listing's CURRENT
 *                            values (one Guesty read), diffed per field.
 *   pushGuestyFieldsAction - Helm to Guesty: write ONLY the ticked
 *                            guest-facing fields (Wi-Fi, parking, trash).
 *   pullGuestyFieldsAction - Guesty to Helm: fill ONLY Helm's blanks among
 *                            the ticked house fields (size, type, map pin).
 *
 * Every write is one explicit click. Helm to Guesty preselects fill-empty
 * only and overwrites a differing field on a tick. Guesty to Helm never
 * overwrites: the writer itself refuses a column that is no longer blank.
 */

export type FieldKey = keyof GuestyGuestFields;

/** helm-empty: nothing to push. same: Helm matches Guesty. guesty-empty:
 *  Helm has a value, Guesty is blank (the safe fill). differs: both set but
 *  not equal (ticking this overwrites Guesty). */
export type FieldStatus = 'helm-empty' | 'same' | 'guesty-empty' | 'differs';

export type FieldRow = {
  key: FieldKey;
  label: string;
  sensitive: boolean;
  helmValue: string;
  guestyValue: string;
  status: FieldStatus;
  /** Default checkbox state: true only for the safe fill (guesty-empty). */
  recommend: boolean;
};

/** One Guesty to Helm row: what Helm holds, what Guesty holds, what a tick does. */
export type PullRow = {
  key: PullKey;
  label: string;
  helmValue: string;
  guestyValue: string;
  status: PullStatus;
  /** Preselected: only the safe fill (Helm blank, Guesty has it). */
  recommend: boolean;
};

export type LoadFieldsResult =
  | { ok: true; listingId: string; propertyName: string; rows: FieldRow[]; pull: PullRow[] }
  | { ok: false; error: string; needsListing?: boolean };

export type PullFieldsResult = { ok: true; filled: string[] } | { ok: false; error: string };

export type PushFieldsResult =
  | { ok: true; pushed: FieldKey[] }
  | { ok: false; error: string };

type PropertyRow = { id: string; name: string; guesty_listing_id: string | null };

const FIELD_META: { key: FieldKey; label: string; sensitive: boolean }[] = [
  { key: 'wifiName', label: 'Wi-Fi name', sensitive: false },
  { key: 'wifiPassword', label: 'Wi-Fi password', sensitive: true },
  { key: 'parkingInstructions', label: 'Parking instructions', sensitive: false },
  { key: 'trashCollectedOn', label: 'Trash pickup', sensitive: false },
];

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Join the Helm columns that feed one Guesty field, dropping blanks. */
function compose(parts: Array<string | null | undefined>, sep: string): string {
  return parts.map((p) => (p ?? '').trim()).filter(Boolean).join(sep);
}

/** Loose equality so trivial whitespace/case differences don't read as a diff. */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Shared guard: require a signed-in user and a property linked to Guesty. */
async function requireLinkedProperty(
  propertyId: string,
): Promise<
  | { ok: true; property: PropertyRow; listingId: string }
  | { ok: false; error: string; needsListing?: boolean }
> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const { data, error } = await supabase
    .from('properties')
    .select('id, name, guesty_listing_id')
    .eq('id', propertyId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Property not found' };

  const property = data as PropertyRow;
  const listingId = await resolveGuestyListingId(propertyId, property.guesty_listing_id);
  if (!listingId) {
    return {
      ok: false,
      needsListing: true,
      error:
        'This home is not linked to a Guesty listing yet, so there is nothing to compare.',
    };
  }
  return { ok: true, property, listingId };
}

/** Read Helm's values for the four pushable fields. */
async function loadHelmFields(propertyId: string): Promise<GuestyGuestFields> {
  const { data } = await supabase
    .from('properties')
    .select('wifi_name, city, address, trash_day, recycling_day, trash_notes, parking, parking_regulations')
    .eq('id', propertyId)
    .maybeSingle();
  const p = (data ?? {}) as {
    wifi_name?: string | null;
    city?: string | null;
    address?: string | null;
    trash_day?: string | null;
    recycling_day?: string | null;
    trash_notes?: string | null;
    parking?: string | null;
    parking_regulations?: string | null;
  };
  // wifi_password is the one sensitive value — it lives in the RLS-locked
  // property_access table, read here via the service-role helper.
  const access = await getPropertyAccess(propertyId);
  const civic = civicForProperty(p as unknown as HelmPropertyRow);
  return {
    wifiName: (p.wifi_name ?? '').trim(),
    wifiPassword: (access.wifi_password ?? '').trim(),
    parkingInstructions: compose([p.parking, p.parking_regulations], '\n'),
    // Composed, not the raw column. This string lands on the live Airbnb and
    // VRBO listing where nothing downstream filters it, so it has to stand
    // alone. trash_notes carries only where the bins and carts live; the day
    // and the city rule come from civic.ts.
    trashCollectedOn: compose(
      [
        civic.trashDay ? `Collection is ${civic.trashDay}, recycling the same day.` : null,
        p.trash_notes,
        civic.receptacleRule,
      ],
      ' ',
    ),
  };
}

export async function loadGuestyFieldsAction(propertyId: string): Promise<LoadFieldsResult> {
  const guard = await requireLinkedProperty(propertyId);
  if (!guard.ok) return { ok: false, error: guard.error, needsListing: guard.needsListing };

  const helm = await loadHelmFields(propertyId);

  // One read of the listing feeds both directions.
  let listing: Record<string, unknown>;
  try {
    listing = (await getGuestyListing(guard.listingId)) as unknown as Record<string, unknown>;
  } catch (err) {
    return { ok: false, error: `Couldn't read the Guesty listing: ${errMsg(err)}` };
  }
  const guesty = guestFieldsOf(listing);

  const rows: FieldRow[] = FIELD_META.map((m) => {
    const helmValue = helm[m.key];
    const guestyValue = guesty[m.key];
    let status: FieldStatus;
    if (!helmValue) status = 'helm-empty';
    else if (norm(helmValue) === norm(guestyValue)) status = 'same';
    else if (!guestyValue) status = 'guesty-empty';
    else status = 'differs';
    return {
      ...m,
      helmValue,
      guestyValue,
      status,
      recommend: status === 'guesty-empty',
    };
  });

  const { data: house } = await supabase
    .from('properties')
    .select('bedrooms, bathrooms, square_feet, type_of_unit, latitude, longitude')
    .eq('id', propertyId)
    .maybeSingle();
  const helmHouse = helmPullValues((house ?? {}) as Record<string, unknown>);
  const guestyHouse = guestyPullValues(listing);
  const pull: PullRow[] = PULL_FIELDS.map((f) => {
    const status = pullStatus(helmHouse[f.key], guestyHouse[f.key]);
    return { key: f.key, label: f.label, helmValue: helmHouse[f.key], guestyValue: guestyHouse[f.key], status, recommend: status === 'fill' };
  });

  return { ok: true, listingId: guard.listingId, propertyName: guard.property.name, rows, pull };
}

/**
 * Guesty to Helm: fill Helm's blank house fields from the live listing.
 * Re-reads both sides at write time, and each column's update is guarded on
 * the column still being blank, so a value typed on Facts meanwhile is never
 * replaced.
 */
export async function pullGuestyFieldsAction(propertyId: string, keys: PullKey[]): Promise<PullFieldsResult> {
  const guard = await requireLinkedProperty(propertyId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const { data: house, error } = await supabase
    .from('properties')
    .select('bedrooms, bathrooms, square_feet, type_of_unit, latitude, longitude')
    .eq('id', propertyId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  let listing: Record<string, unknown>;
  try {
    listing = (await getGuestyListing(guard.listingId)) as unknown as Record<string, unknown>;
  } catch (err) {
    return { ok: false, error: `Couldn't read the Guesty listing: ${errMsg(err)}` };
  }
  const updates = pullUpdates(keys, (house ?? {}) as Record<string, unknown>, listing);
  const filled: string[] = [];
  for (const f of PULL_FIELDS) {
    const patch = Object.fromEntries(f.columns.filter((c) => c in updates).map((c) => [c, updates[c]]));
    if (Object.keys(patch).length !== f.columns.length) continue;
    let q = supabase.from('properties').update({ ...patch, last_synced_at: new Date().toISOString() }).eq('id', propertyId);
    for (const c of f.columns) q = c === 'type_of_unit' ? q.or(`${c}.is.null,${c}.eq.`) : q.is(c, null);
    const { data, error: writeError } = await q.select('id');
    if (writeError) return { ok: false, error: `Saving ${f.label.toLowerCase()} failed: ${writeError.message}` };
    if (data && data.length > 0) filled.push(f.label);
  }
  if (filled.length) {
    revalidatePath(`/properties/${propertyId}`);
    revalidatePath(`/properties/${propertyId}/edit`);
  }
  return { ok: true, filled };
}

export async function pushGuestyFieldsAction(
  propertyId: string,
  selections: Array<{ key: FieldKey; value: string }>,
): Promise<PushFieldsResult> {
  const guard = await requireLinkedProperty(propertyId);
  if (!guard.ok) return { ok: false, error: guard.error };

  const allowed = new Set<string>(GUESTY_GUEST_FIELD_KEYS);
  const fields: Partial<GuestyGuestFields> = {};
  const pushed: FieldKey[] = [];
  for (const s of selections) {
    if (!allowed.has(s.key)) continue;
    // Skip blanks: this tool fills/updates fields, it never clears one. An
    // empty value would wipe whatever is live in Guesty, so we drop it.
    const value = (s.value ?? '').trim();
    if (!value) continue;
    fields[s.key] = value;
    pushed.push(s.key);
  }
  if (pushed.length === 0) return { ok: false, error: 'Nothing to push (all selected fields were empty).' };

  try {
    await updateListingGuestFields(guard.listingId, fields);
  } catch (err) {
    return { ok: false, error: `Guesty write failed: ${errMsg(err)}` };
  }
  return { ok: true, pushed };
}
