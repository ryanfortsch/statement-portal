/**
 * Partner home setup: create the home, gather what the listing bar reads,
 * record the checks a person makes, and list it on staycapeann.com or take
 * it off (the rules are src/lib/partner-listing.ts).
 *
 * A new partner home is born kind 'partner', inactive and not ours (the
 * database holds all three), with Helm holding its calendar so the site can
 * price it and the host can import Helm's export. Its host fills the owner
 * columns; a partner home has no management fee, and nothing that bills or
 * pays out reads it (src/lib/property-scope.ts).
 */

import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { geocodeAddress } from '@/lib/geocode';
import { getListingRecord, toScaListing } from '@/lib/listing-content';
import { loadPricingBundle } from '@/lib/property-rates';
import { lastPullsByProperty } from '@/lib/ical-export-pulls';
import { todayInEastern } from '@/lib/sca-quotes-types';
import { getPaymentAccount } from '@/lib/partner-payments-db';
import { paymentsReady } from '@/lib/partner-payments';
import { listPartnerFeeds, type PartnerFeed } from '@/lib/partner-calendar-db';
import { helmOrigin } from '@/lib/pms-bridge';
import { CAPE_ANN_REGION, PARTNER_KIND } from '@/lib/property-scope';
import {
  CHECK_COLUMNS,
  hostNameParts,
  internalNameFromAddress,
  listingState,
  PARTNER_LISTING_COLS,
  propertyIdBase,
  readyToList,
  setupItems,
  type ListingState,
  type NewPartnerHome,
  type PartnerListingRow,
  type PartnerSetupFacts,
  type PersonCheck,
  type SetupItem,
} from '@/lib/partner-listing';

const LISTINGS = 'partner_listings';

const PROPERTY_FACT_COLS =
  'id, name, title, kind, address, city, latitude, longitude, owner_full, owner_emails, owner_phone, tax_cert_id, str_registration_id, str_insurance_carrier, default_checkout_time, cancellation_policy, house_rules, calendar_authority, ical_export_token';

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === '42P01' || err.code === 'PGRST205' || /could not find the table|does not exist/i.test(err.message ?? '');
}

// ─── Create ─────────────────────────────────────────────────────────────────

async function freePropertyId(address: string): Promise<string> {
  const base = propertyIdBase(address);
  if (!base) throw new Error('Could not make an id from that address.');
  const { data, error } = await supabaseAdmin.from('properties').select('id').ilike('id', `${base}%`);
  if (error) throw new Error(error.message);
  const taken = new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
  throw new Error(`No free id for ${base}.`);
}

/** A new partner home. Returns its id; the office finishes it on its property page. */
export async function createPartnerHome(home: NewPartnerHome, by: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  if (!isServiceConfigured) return { ok: false, reason: 'Helm is not connected to its database.' };
  let id: string;
  try {
    id = await freePropertyId(home.address);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  const coords = await geocodeAddress(`${home.address}, ${home.city}, MA`).catch(() => null);
  const { error } = await supabaseAdmin.from('properties').insert({
    id,
    name: internalNameFromAddress(home.address),
    address: home.address,
    city: home.city,
    latitude: coords?.lat ?? null,
    longitude: coords?.lng ?? null,
    region: CAPE_ANN_REGION,
    kind: PARTNER_KIND,
    is_active: false,
    is_rising_tide_owned: false,
    calendar_authority: 'helm',
    ...hostNameParts(home.host_name),
    owner_emails: [home.host_email],
    owner_phone: home.host_phone,
    management_fee_pct: 0,
  });
  if (error) return { ok: false, reason: error.code === '23505' ? 'A home with that id already exists.' : error.message };
  const seeded = await supabaseAdmin.from(LISTINGS).upsert({ property_id: id }, { onConflict: 'property_id', ignoreDuplicates: true });
  if (seeded.error && !isMissingTable(seeded.error)) console.error('[partner-listing] seed failed', id, seeded.error.message);
  console.info('[partner-listing] created', id, 'by', by);
  return { ok: true, id };
}

// ─── Read ───────────────────────────────────────────────────────────────────

export type PartnerSetup = {
  propertyId: string;
  /** The home's name as the office says it. */
  name: string;
  row: PartnerListingRow | null;
  state: ListingState;
  items: SetupItem[];
  ready: boolean;
  feeds: PartnerFeed[] | null;
  /** Helm's export of this home's calendar, the line the host pastes into each channel. */
  exportBase: string | null;
};

async function getListingRow(propertyId: string): Promise<PartnerListingRow | null> {
  const { data, error } = await supabaseAdmin.from(LISTINGS).select(PARTNER_LISTING_COLS).eq('property_id', propertyId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(`partner_listings read failed: ${error.message}`);
  }
  return (data as PartnerListingRow | null) ?? null;
}

const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const numOrNull = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Everything the setup panel shows for one partner home, or null when it is not one. */
export async function loadPartnerSetup(propertyId: string, now: Date = new Date()): Promise<PartnerSetup | null> {
  if (!isServiceConfigured) return null;
  const { data: p, error } = await supabaseAdmin.from('properties').select(PROPERTY_FACT_COLS).eq('id', propertyId).maybeSingle();
  if (error) throw new Error(`properties read failed: ${error.message}`);
  if (!p || (p as { kind?: string }).kind !== PARTNER_KIND) return null;
  const prop = p as Record<string, unknown>;
  const today = todayInEastern(now);

  const [row, record, bundle, feeds, pulls, account] = await Promise.all([
    getListingRow(propertyId),
    getListingRecord(propertyId),
    loadPricingBundle(propertyId, today, today),
    listPartnerFeeds(propertyId),
    lastPullsByProperty([propertyId]),
    getPaymentAccount(propertyId).catch(() => null),
  ]);

  const sca = record ? toScaListing(record, bundle.plan) : null;
  const pullList = pulls.get(propertyId);
  const exportPulls: PartnerSetupFacts['exportPulls'] = pullList
    ? Object.fromEntries(
        ['airbnb', 'vrbo', 'booking_com', 'other'].map((ch) => [ch, pullList.find((x) => x.channel_guess === ch)?.pulled_at ?? null]),
      )
    : null;

  const facts: PartnerSetupFacts = {
    property: {
      id: propertyId,
      name: String(prop.name ?? propertyId),
      address: strOrNull(prop.address),
      city: strOrNull(prop.city),
      latitude: numOrNull(prop.latitude),
      longitude: numOrNull(prop.longitude),
      owner_full: strOrNull(prop.owner_full),
      owner_emails: Array.isArray(prop.owner_emails) ? (prop.owner_emails as unknown[]).filter((e): e is string => typeof e === 'string') : [],
      owner_phone: strOrNull(prop.owner_phone),
      tax_cert_id: strOrNull(prop.tax_cert_id),
      str_registration_id: strOrNull(prop.str_registration_id),
      str_insurance_carrier: strOrNull(prop.str_insurance_carrier),
      default_checkout_time: strOrNull(prop.default_checkout_time),
      cancellation_policy: strOrNull(prop.cancellation_policy),
      house_rules: strOrNull(prop.house_rules),
      calendar_authority: strOrNull(prop.calendar_authority),
    },
    listing: sca
      ? {
          hasOwnTitle: !!record?.content?.title?.trim(),
          title: sca.title,
          tagline: sca.tagline,
          description: sca.description,
          photoCount: sca.photos.length,
          bedrooms: sca.bedrooms,
          bathrooms: sca.bathrooms,
          accommodates: sca.accommodates,
          basePrice: sca.basePrice,
        }
      : null,
    feeds: (feeds ?? []).map((f) => ({ channel: f.channel, last_synced_at: f.last_synced_at, last_error: f.last_error })),
    exportPulls,
    paymentsReady: paymentsReady(account),
    feeSet: account?.fee_pct != null,
    checks: row,
  };
  const items = setupItems(facts, now);
  const token = strOrNull(prop.ical_export_token);
  return {
    propertyId,
    name: facts.property.name,
    row,
    state: listingState(row),
    items,
    ready: readyToList(items),
    feeds,
    exportBase: token ? `${helmOrigin()}/api/channels/ical/${token}` : null,
  };
}

// ─── The office's writes ────────────────────────────────────────────────────

async function requirePartnerHome(propertyId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('properties').select('kind').eq('id', propertyId).maybeSingle();
  if (error) return error.message;
  if (!data) return 'No such home.';
  return (data as { kind?: string }).kind === PARTNER_KIND ? null : 'Only a partner home has a listing bar.';
}

async function seedRow(propertyId: string): Promise<string | null> {
  const { error } = await supabaseAdmin.from(LISTINGS).upsert({ property_id: propertyId }, { onConflict: 'property_id', ignoreDuplicates: true });
  return error ? error.message : null;
}

/**
 * A person's word on one line of the bar: the date it happened, and who
 * said so. Insurance also takes the date the policy runs to. A null date
 * clears the line.
 */
export async function recordPartnerCheck(
  propertyId: string,
  check: PersonCheck,
  on: string | null,
  by: string,
  extra: { insuranceExpiresOn?: string | null } = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isServiceConfigured) return { ok: false, reason: 'Helm is not connected to its database.' };
  const notPartner = await requirePartnerHome(propertyId);
  if (notPartner) return { ok: false, reason: notPartner };
  const seedErr = await seedRow(propertyId);
  if (seedErr) return { ok: false, reason: seedErr };
  const cols = CHECK_COLUMNS[check];
  const patch: Record<string, unknown> = { [cols.on]: on, [cols.by]: on ? by : null };
  if (check === 'insurance') patch.insurance_expires_on = on ? (extra.insuranceExpiresOn ?? null) : null;
  const { error } = await supabaseAdmin.from(LISTINGS).update(patch).eq('property_id', propertyId);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

/**
 * Put the home on staycapeann.com. The bar is read again here, never taken
 * from the button: a line that went bad since the page loaded stops it.
 */
export async function listPartnerHome(propertyId: string, by: string, now: Date = new Date()): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isServiceConfigured) return { ok: false, reason: 'Helm is not connected to its database.' };
  const setup = await loadPartnerSetup(propertyId, now);
  if (!setup) return { ok: false, reason: 'Only a partner home is listed this way.' };
  if (!setup.ready) {
    const open = setup.items.filter((i) => !i.ok).map((i) => i.label.toLowerCase());
    return { ok: false, reason: `Not yet: ${open.join(', ')}.` };
  }
  const seedErr = await seedRow(propertyId);
  if (seedErr) return { ok: false, reason: seedErr };
  const { error } = await supabaseAdmin
    .from(LISTINGS)
    .update({ listed_at: now.toISOString(), listed_by: by, unlisted_at: null, unlisted_by: null, unlisted_reason: null })
    .eq('property_id', propertyId);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

/** Take the home off staycapeann.com now. Open requests stay open; nothing new comes in. */
export async function unlistPartnerHome(propertyId: string, by: string, reason: string, now: Date = new Date()): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isServiceConfigured) return { ok: false, reason: 'Helm is not connected to its database.' };
  const why = reason.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!why) return { ok: false, reason: 'Say why it comes off, for the record.' };
  const { data, error } = await supabaseAdmin
    .from(LISTINGS)
    .update({ unlisted_at: now.toISOString(), unlisted_by: by, unlisted_reason: why })
    .eq('property_id', propertyId)
    .not('listed_at', 'is', null)
    .is('unlisted_at', null)
    .select('property_id');
  if (error) return { ok: false, reason: error.message };
  return (data ?? []).length > 0 ? { ok: true } : { ok: false, reason: 'It is not on the site.' };
}

// ─── Every partner home, for the office's list ──────────────────────────────

export type PartnerHomeSummary = { propertyId: string; state: ListingState; done: number; total: number; listedAt: string | null };

/** The setup progress of each of these partner homes. A home whose read fails is left out. */
export async function summarizePartnerHomes(ids: readonly string[], now: Date = new Date()): Promise<Map<string, PartnerHomeSummary>> {
  const out = new Map<string, PartnerHomeSummary>();
  for (const id of ids) {
    try {
      const s = await loadPartnerSetup(id, now);
      if (!s) continue;
      out.set(id, { propertyId: id, state: s.state, done: s.items.filter((i) => i.ok).length, total: s.items.length, listedAt: s.row?.listed_at ?? null });
    } catch (err) {
      console.error('[partner-listing] summary failed', id, err instanceof Error ? err.message : err);
    }
  }
  return out;
}
