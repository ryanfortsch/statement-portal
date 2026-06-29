'use server';

import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import { getPropertyAccess } from '@/lib/property-access';
import { resolveGuestyListingId } from '@/lib/guesty-listing-id';
import {
  getListingGuestFields,
  updateListingGuestFields,
  GUESTY_GUEST_FIELD_KEYS,
  type GuestyGuestFields,
} from '@/lib/guesty';

/**
 * Server actions backing /properties/[id]/sync-guesty — the tool that pushes
 * Helm's structured property data (wifi, parking, trash) into the matching
 * guest-facing fields on the live Guesty listing.
 *
 * Two operations:
 *   loadGuestyFieldsAction — read Helm's values + the listing's CURRENT Guesty
 *                            values, diff them per field for review.
 *   pushGuestyFieldsAction — write ONLY the operator-approved fields to Guesty.
 *
 * Every write is one explicit click. The default selection is fill-empty-only
 * (a field already set in Guesty is never auto-overwritten); the operator can
 * opt in to overwriting a differing field by ticking it.
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

export type LoadFieldsResult =
  | { ok: true; listingId: string; propertyName: string; rows: FieldRow[] }
  | { ok: false; error: string; needsListing?: boolean };

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
        'This property is not linked to a Guesty listing yet. Add its Guesty listing ID (or run Sync Guesty), then come back.',
    };
  }
  return { ok: true, property, listingId };
}

/** Read Helm's values for the four pushable fields. */
async function loadHelmFields(propertyId: string): Promise<GuestyGuestFields> {
  const { data } = await supabase
    .from('properties')
    .select('wifi_name, trash_day, trash_notes, parking, parking_regulations')
    .eq('id', propertyId)
    .maybeSingle();
  const p = (data ?? {}) as {
    wifi_name?: string | null;
    trash_day?: string | null;
    trash_notes?: string | null;
    parking?: string | null;
    parking_regulations?: string | null;
  };
  // wifi_password is the one sensitive value — it lives in the RLS-locked
  // property_access table, read here via the service-role helper.
  const access = await getPropertyAccess(propertyId);
  return {
    wifiName: (p.wifi_name ?? '').trim(),
    wifiPassword: (access.wifi_password ?? '').trim(),
    parkingInstructions: compose([p.parking, p.parking_regulations], '\n'),
    trashCollectedOn: compose([p.trash_day, p.trash_notes], ' — '),
  };
}

export async function loadGuestyFieldsAction(propertyId: string): Promise<LoadFieldsResult> {
  const guard = await requireLinkedProperty(propertyId);
  if (!guard.ok) return { ok: false, error: guard.error, needsListing: guard.needsListing };

  const helm = await loadHelmFields(propertyId);

  let guesty: GuestyGuestFields;
  try {
    guesty = await getListingGuestFields(guard.listingId);
  } catch (err) {
    return { ok: false, error: `Couldn't read the Guesty listing: ${errMsg(err)}` };
  }

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

  return { ok: true, listingId: guard.listingId, propertyName: guard.property.name, rows };
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
