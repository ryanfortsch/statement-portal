'use server';

import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { getPropertyAccess } from '@/lib/property-access';
import { resolveGuestyListingId } from '@/lib/guesty-listing-id';
import { civicForProperty, receptacleRuleFor, GLOUCESTER_CART_CUTOVER } from '@/lib/civic';
import type { HelmPropertyRow } from '@/lib/properties';
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

/**
 * The receptacle rule as it will be true from 2026-10-01 onward, rather than
 * as it is on the day of the push. See the note in loadHelmFields: a Guesty
 * listing field never re-syncs, so it wants the durable answer.
 */
function durableReceptacleRule(city: string | null | undefined): string | null {
  const cityShort = (city || '').split(',')[0].trim();
  return receptacleRuleFor(cityShort, new Date(`${GLOUCESTER_CART_CUTOVER}T12:00:00Z`));
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
    //
    // Deliberately NOT the date-resolved rule. A Guesty listing field is
    // write-once from Helm's side: we push it and nothing ever re-syncs, so
    // whatever is pushed sits on the listing indefinitely. Pushing the
    // pre-cutover bag wording during the last week of September would freeze
    // a retired program onto the listing for good. For a durable field the
    // correct content is the durable rule, so Gloucester always gets the cart
    // text here even while civic.ts is still serving bags to the live pages.
    trashCollectedOn: compose(
      [
        civic.trashDay ? `Collection is ${civic.trashDay}, recycling the same day.` : null,
        p.trash_notes,
        durableReceptacleRule(p.city),
      ],
      ' ',
    ),
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
