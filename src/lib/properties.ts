/**
 * Single source of truth for Rising Tide STR property config.
 *
 * Before this module existed, each of `/api/ingest/route.ts`,
 * `/src/app/statements/render/page.tsx`, and `/src/app/statements/upload/page.tsx`
 * kept a slightly different version of the PROPERTIES list. When an owner's
 * email changed or a new listing came online, you had to patch three places.
 * Now they all import from here.
 */

export type Property = {
  id: string;
  // Naming convention (set 2026-05-01):
  //   name    = INTERNAL  — street address WITHOUT suffix, e.g. "20 Enon"
  //   address = FULL      — full street with suffix, e.g. "20 Enon Road"
  //   (separately, the `properties` table also stores `title` for the
  //   EXTERNAL marketing name used on Airbnb/stay-cape-ann, e.g.
  //   "Stay at Beverly Shops". `title` is not on this Property type.)
  name: string;               // internal short name, no suffix, e.g. "20 Enon"
  address: string;            // full street address with suffix, e.g. "20 Enon Road"
  city: string;               // "Beverly, MA"
  owner_last: string;         // "Snyder" -- short for summary rows
  owner_full: string;         // "The Snyder Family" -- for statement "Prepared for"
  owner_greeting: string;     // "Kathleen and Robert" -- for email "Hi ___,"
  owner_emails: string[];     // all addresses we've sent to
  fee_pct: number;            // management fee percentage
  bank_last4: string | null;  // Chase account last 4, null if not applicable
  listing_match: string;      // lowercase substring used to match Guesty listings
  /**
   * MassTaxConnect occupancy-tax certificate. Per Allie's Apr 29 note from
   * Supporting Strategies, this is the per-property cert ID we file under
   * when remitting the tax-account (*9928) balance to the state. Surfaces
   * on the Remittance modal so the accountant has it next to the dollar
   * amount they're sending. null for properties that don't file directly
   * (e.g. 17 Beach Rd, where Airbnb collects + remits on our behalf).
   *
   * Where two certs were listed in the source doc, we use the post-CIF
   * (Community Impact Fee removed) version where applicable.
   */
  tax_cert_id: string | null;
};

// Emails pulled from confirmed statement sends in the Apr 2026 audit.
// Four properties are still missing emails -- Ryan to confirm.
export const PROPERTIES: Record<string, Property> = {
  '3_south_st': {
    id: '3_south_st', name: '3 South', address: '3 South Street', city: 'Rockport, MA',
    owner_last: 'Bailey', owner_full: 'Marci & Paul Bailey', owner_greeting: 'Marci and Paul',
    owner_emails: ['baileynrma@comcast.net', 'paulbailey2006@yahoo.com'],
    fee_pct: 25, bank_last4: '5622', listing_match: '3 south',
    tax_cert_id: 'C0335252520',
  },
  '21_horton': {
    id: '21_horton', name: '21 Horton', address: '21 Horton Street', city: 'Gloucester, MA',
    owner_last: 'Kittredge', owner_full: 'Claudia Kittredge', owner_greeting: 'Claudia and Vicente',
    owner_emails: ['ckittred1@gmail.com', 'claudia.kittredge@gmail.com'],
    fee_pct: 22, bank_last4: '1323', listing_match: '21 horton',
    // Updated cert (CIF removed). Original C0444061070 also still on file.
    tax_cert_id: 'C0537511070',
  },
  '53_rocky_neck': {
    id: '53_rocky_neck', name: '53 Rocky Neck', address: '53 Rocky Neck Avenue', city: 'Gloucester, MA',
    owner_last: 'Prudenzi', owner_full: 'Simon Prudenzi', owner_greeting: 'Simon',
    // Primary confirmed as prudenziwelding@yahoo.com (2026-06-01). The
    // senecalglenn@gmail.com on file from earlier sends has been retired.
    owner_emails: ['prudenziwelding@yahoo.com'],
    fee_pct: 25, bank_last4: '9910', listing_match: '53 rocky neck',
    // Newer cert from Allie's Apr 29 doc; older C053801070 also listed there.
    tax_cert_id: 'C0554181070',
  },
  '4_brier_neck': {
    id: '4_brier_neck', name: '4 Brier Neck', address: '4 Brier Neck Road', city: 'Gloucester, MA',
    owner_last: 'Armstrong', owner_full: 'The Armstrong Family', owner_greeting: 'Jane',
    owner_emails: ['jane@independent-thinking.com'],
    fee_pct: 20, bank_last4: '7876', listing_match: '4 brier neck',
    // Files under the Rising Tide STR umbrella (ROC-21760774-002).
    tax_cert_id: 'C0497021070',
  },
  '30_woodward': {
    id: '30_woodward', name: '30 Woodward', address: '30 Woodward Avenue', city: 'Gloucester, MA',
    owner_last: 'McWethy', owner_full: 'The McWethy Family', owner_greeting: 'Jim and Stephanie',
    owner_emails: ['mcwethycottages@gmail.com'],
    fee_pct: 25, bank_last4: '8221', listing_match: '30 woodward',
    // Updated cert (CIF removed). Original C0287531070 also still on file.
    tax_cert_id: 'C0539611070',
  },
  '20_hammond': {
    id: '20_hammond', name: '20 Hammond', address: '20 Hammond Street', city: 'Gloucester, MA',
    owner_last: 'Ramsey', owner_full: 'The Ramsey Family', owner_greeting: 'Danielle and Mark',
    // Apr 2026 reconcile audit confirmed Mark's mramsey8@hotmail.com is on
    // RTC's send list alongside Danielle's dfry0404 -- both belong on
    // Helm-portal sends so neither owner is left off.
    owner_emails: ['dfry0404@yahoo.com', 'mramsey8@hotmail.com'],
    fee_pct: 25, bank_last4: '9969', listing_match: '20 hammond',
    tax_cert_id: 'C0548731070',
  },
  '20_enon': {
    id: '20_enon', name: '20 Enon', address: '20 Enon Road', city: 'Beverly, MA',
    owner_last: 'Snyder', owner_full: 'The Snyder Family', owner_greeting: 'Kathleen and Robert',
    owner_emails: ['katsnyder21@gmail.com', 'robertsnyder99@gmail.com'],
    fee_pct: 25, bank_last4: '1307', listing_match: '20 enon',
    // Beverly is a different MA jurisdiction than Gloucester (cert ends 0300
    // not 1070), but MassTaxConnect handles that automatically off the cert ID.
    tax_cert_id: 'C0515350300',
  },
  '73_rocky_neck': {
    id: '73_rocky_neck', name: '73 Rocky Neck', address: '73 Rocky Neck Avenue', city: 'Gloucester, MA',
    owner_last: 'Moynahan', owner_full: 'The Moynahan Family', owner_greeting: 'Matt and Laila',
    owner_emails: ['matthewmoynahan@yahoo.com', 'lailarocha@gmail.com'],
    fee_pct: 25, bank_last4: '3227', listing_match: '73 rocky neck',
    tax_cert_id: 'C0538941070',
  },
  '17_beach_rd': {
    id: '17_beach_rd', name: '17 Beach', address: '17 Beach Road', city: 'Gloucester, MA',
    owner_last: 'Nolan', owner_full: 'Susan & London Nolan', owner_greeting: 'Susan and London',
    // London's email still pending; using Susan's until we have both.
    owner_emails: ['jupitersusan153@gmail.com'],
    fee_pct: 22, bank_last4: '5621', listing_match: '17 beach',
    // MassTaxConnect cert added 2026-05-29. Airbnb collects + remits its own
    // stays' MA occupancy tax directly; this cert covers VRBO / Manual /
    // Booking stays that we file on the *9928 tax account.
    tax_cert_id: 'C0585051070',
  },
  '3_locust': {
    id: '3_locust', name: '3 Locust', address: '3 Locust Lane', city: 'Gloucester, MA',
    owner_last: 'Lucas', owner_full: 'The Lucas Family', owner_greeting: 'Lucas',
    owner_emails: [],
    fee_pct: 25, bank_last4: null, listing_match: '3 locust',
    tax_cert_id: null,
  },
};

// 65 Calderwood Ln and 3246 NE 27th Ave are Ryan's personal properties and
// intentionally excluded from the portal.

export const PROPERTY_IDS = Object.keys(PROPERTIES);

export function getProperty(id: string): Property | undefined {
  return PROPERTIES[id];
}

/**
 * DB-backed source of truth for the Statements module. Returns every
 * active property in the Helm-native `public.properties` table, shaped
 * as the legacy `Property` type so existing call sites (ingest /
 * upload / render) can switch over without changing their downstream
 * code.
 *
 * Before this existed, the Statements module read from the hardcoded
 * PROPERTIES const above. New properties added via the Prospects flow
 * silently failed to appear in the next monthly statement cycle until
 * an engineer hand-edited the const and shipped a code change.
 *
 * Now: promote a prospect in Helm, and the next monthly upload sees
 * the new property automatically.
 */
export async function getActivePropertiesForStatements(): Promise<Property[]> {
  const { supabase, isConfigured } = await import('@/lib/supabase');
  if (!isConfigured) return Object.values(PROPERTIES);
  const { data, error } = await supabase
    .from('properties')
    .select('id, name, address, city, owner_last, owner_full, owner_greeting, owner_emails, management_fee_pct, bank_last4, listing_match, tax_cert_id, is_active')
    .eq('is_active', true)
    .order('name');
  if (error || !data) return Object.values(PROPERTIES);
  return (data as Array<{
    id: string;
    name: string;
    address: string;
    city: string;
    owner_last: string | null;
    owner_full: string | null;
    owner_greeting: string | null;
    owner_emails: string[] | null;
    management_fee_pct: number | null;
    bank_last4: string | null;
    listing_match: string | null;
    tax_cert_id: string | null;
  }>).map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    city: r.city,
    owner_last: r.owner_last ?? '',
    owner_full: r.owner_full ?? '',
    owner_greeting: r.owner_greeting ?? '',
    owner_emails: r.owner_emails ?? [],
    fee_pct: Number(r.management_fee_pct ?? 0),
    bank_last4: r.bank_last4,
    listing_match: (r.listing_match ?? '').toLowerCase(),
    tax_cert_id: r.tax_cert_id,
  }));
}

/** Single-property DB lookup with the same legacy Property shape.
 *  Used by the statement renderer to hydrate `property_id → Property`
 *  without pulling every active row. */
export async function getActivePropertyForStatements(id: string): Promise<Property | null> {
  const { supabase, isConfigured } = await import('@/lib/supabase');
  if (!isConfigured) return PROPERTIES[id] ?? null;
  const { data, error } = await supabase
    .from('properties')
    .select('id, name, address, city, owner_last, owner_full, owner_greeting, owner_emails, management_fee_pct, bank_last4, listing_match, tax_cert_id')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return PROPERTIES[id] ?? null;
  const r = data as {
    id: string; name: string; address: string; city: string;
    owner_last: string | null; owner_full: string | null;
    owner_greeting: string | null; owner_emails: string[] | null;
    management_fee_pct: number | null; bank_last4: string | null;
    listing_match: string | null; tax_cert_id: string | null;
  };
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    city: r.city,
    owner_last: r.owner_last ?? '',
    owner_full: r.owner_full ?? '',
    owner_greeting: r.owner_greeting ?? '',
    owner_emails: r.owner_emails ?? [],
    fee_pct: Number(r.management_fee_pct ?? 0),
    bank_last4: r.bank_last4,
    listing_match: (r.listing_match ?? '').toLowerCase(),
    tax_cert_id: r.tax_cert_id,
  };
}

/**
 * Row shape from Helm's `properties` table. Mirrors the SQL schema 1:1.
 * Used by /properties pages and the home dashboard.
 */
/**
 * Stay Cape Ann "Welcome Home" guide customization model.
 *
 * The rendered guide has six cells in a 2x3 grid. Slots 1-4 are FIXED to
 * the universal essentials (Wi-Fi, Climate, Parking, Trash & Recycling)
 * because every guest needs them and the auto-populated content comes
 * straight from per-property structured columns. Slots 5-6 are
 * PICKER-DRIVEN: staff picks each one from the HOME_GUIDE_CATALOG below
 * (Bathrooms, Kitchen, Hot Tub, Pets, Quiet Hours, etc.) so the
 * variability that's actually different per home can land in those two
 * slots instead of being hardcoded.
 *
 * For each cell that ends up in the guide, the body either uses the
 * catalog's default prose OR an operator-provided free-form override.
 * For 'custom' the operator also provides the title.
 *
 * Backwards compat: the original schema had top-level `bathrooms` and
 * `kitchen` keys; the renderer + editor both fall back to those values
 * when reading old rows so existing data keeps rendering until staff
 * touches the editor next.
 */
export type HomeGuideOverrides = {
  // Free-form body overrides for the four fixed essential cells.
  wifi?: string;
  climate?: string;
  parking?: string;
  trash?: string;

  // Legacy keys from the initial (PR #477) schema — read by the renderer
  // for backwards compat, never written by the new editor.
  bathrooms?: string;
  kitchen?: string;

  // Picker slots 5 and 6. Each picks a catalog key and optionally
  // overrides the body / title. Missing = use the default
  // (slot5='bathrooms', slot6='kitchen').
  slot5?: HomeGuideSlot;
  slot6?: HomeGuideSlot;
};

/** One configurable slot in the home guide grid. */
export type HomeGuideSlot = {
  /** Catalog key. 'custom' means the operator brings their own title. */
  key: HomeGuideCatalogKey;
  /** Optional body override. Empty / missing falls back to catalog default. */
  body?: string;
  /** Operator-provided title. Only used when key === 'custom'. */
  customTitle?: string;
};

export const HOME_GUIDE_CATALOG_KEYS = [
  'bathrooms',
  'kitchen',
  'hot_tub',
  'outdoor',
  'pets',
  'quiet_hours',
  'wood_stove',
  'smart_tv',
  'laundry',
  'custom',
] as const;
export type HomeGuideCatalogKey = (typeof HOME_GUIDE_CATALOG_KEYS)[number];

/**
 * Catalog of optional cells operators can drop into slots 5-6. Each entry
 * carries a display title and a default body. An empty defaultBody means
 * the cell is property-specific enough that we don't ship a default —
 * the renderer skips the cell if no override is provided.
 *
 * Prose conventions in defaultBody:
 *   - Blank line separates paragraphs.
 *   - A paragraph leading with "Note:" or "Aside:" renders in the
 *     smaller italic aside style (matches the rest of the guide).
 */
export const HOME_GUIDE_CATALOG: Record<
  HomeGuideCatalogKey,
  { title: string; defaultBody: string }
> = {
  bathrooms: {
    title: 'Bathrooms',
    defaultBody:
      'Use the bathroom fan while showering. The button may not depress, but the fan still runs and shuts off automatically.\n\nNote: Please limit any flushed items to toilet paper.',
  },
  kitchen: {
    title: 'Kitchen',
    defaultBody:
      'Coffee: fill the water tank, insert a pod, choose your size, brew.\n\nCooktop: slide out the hood to operate the fan; use only the pans we’ve provided on the burners.\n\nNote: Counter tops stain easily, so please blot dark drinks and oils right away.',
  },
  hot_tub: {
    title: 'Hot Tub',
    defaultBody: '',
  },
  outdoor: {
    title: 'Outdoor Space',
    defaultBody: '',
  },
  pets: {
    title: 'Pets',
    defaultBody: '',
  },
  quiet_hours: {
    title: 'Quiet Hours',
    defaultBody:
      'Quiet hours are 10pm to 8am, per neighborhood expectations. Please keep music, voices, and outdoor activity to a minimum during those hours.',
  },
  wood_stove: {
    title: 'Wood Stove',
    defaultBody: '',
  },
  smart_tv: {
    title: 'TV & Streaming',
    defaultBody: '',
  },
  laundry: {
    title: 'Laundry',
    defaultBody: '',
  },
  custom: {
    title: 'Custom',
    defaultBody: '',
  },
};

export type HelmPropertyRow = {
  id: string;
  perfection_id: string | null;
  name: string;
  nickname: string | null;
  title: string | null;
  code: string | null;
  address: string;
  city: string;
  type_of_unit: string | null;
  tags: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  is_active: boolean;
  is_rising_tide_owned: boolean;
  activated_at: string | null;
  deactivated_at: string | null;
  deactivated_reason: string | null;
  cleaning_cost_estimate: number | null;
  guesty_listing_id: string | null;
  source: string | null;
  owner_last: string;
  owner_full: string;
  owner_greeting: string;
  owner_emails: string[];
  owner_phone: string | null;
  owner_mailing_address: string | null;
  owner_preferred_contact: string | null;
  owner_last_contacted_at: string | null;
  owner_last_contacted_via: string | null;
  owner_last_contacted_by_email: string | null;
  /** Structured owner cards used by the Owner Messaging pipeline.
   * Each entry: { first_name, last_name, email, phone, is_primary, role, notes }.
   * Additive to owner_full / owner_emails (which stay the source of truth
   * for statements + contracts). See OwnersEditor on the property detail
   * page. Defaults to [] for properties that haven't been migrated yet. */
  owners: unknown[] | null;
  management_fee_pct: number;
  bank_last4: string | null;
  tax_cert_id: string | null;

  // Property characteristics (from onboarding intake)
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  livable_floors: number | null;
  basement: string | null;
  parking: string | null;
  hoa: string | null;

  // Utilities
  electricity_provider: string | null;
  heating: string | null;
  cooling: string | null;
  internet_provider: string | null;
  cable_provider: string | null;
  wifi_name: string | null;
  wifi_password: string | null;
  // Dual-network support (two-unit homes: main house + guest/boat
  // house each on their own router). Labels name the unit a network
  // belongs to ("Main House", "Boat House"); all four null on
  // single-network properties.
  wifi_label: string | null;
  wifi_name_2: string | null;
  wifi_password_2: string | null;
  wifi_label_2: string | null;
  // Smart thermostat — parallel to smart_lock_brand/code. Added so the
  // Nest/ecobee PIN that gets traded around in Slack has a home.
  thermostat_brand: string | null;
  thermostat_code: string | null;
  num_tvs: number | null;
  smart_tv: string | null;

  // STR setup
  currently_listed: string | null;
  existing_listing_urls: string | null;
  str_registration_id: string | null;
  str_insurance_carrier: string | null;
  guest_access_method: string | null;
  smart_lock_brand: string | null;
  smart_lock_code: string | null;
  security_cameras: string | null;

  // Property access & notes
  key_code_location: string | null;
  alarm_system: string | null;
  // Driveway / community gate code if any.
  gate_code: string | null;
  // Numeric keypad code for the garage door if any.
  garage_code: string | null;
  known_issues: string | null;
  upcoming_maintenance: string | null;
  // NOTE: the legacy `property_notes` single-text column was migrated to
  // the public.property_notes table (one row per discrete note) in
  // migration 20260528. See src/lib/property-notes.ts for the helpers.

  // Emergency contact
  emergency_contact_name: string | null;
  emergency_contact_relationship: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_email: string | null;

  // Inspection & safety (Gloucester STR permit Information Note)
  trash_day: string | null;
  recycling_day: string | null;
  trash_notes: string | null;
  parking_regulations: string | null;
  gas_shutoff_location: string | null;
  water_shutoff_location: string | null;
  electrical_panel_location: string | null;
  fire_extinguisher_locations: string | null;
  smoke_detector_locations: string | null;
  fire_exit_locations: string | null;
  str_permit_expires: string | null;

  // Per-cell free-form overrides for the Stay Cape Ann home guide.
  // Each key (wifi/climate/bathrooms/parking/kitchen/trash) is optional;
  // when present, the renderer drops the auto-populated cell body and
  // prints the override prose. See 20260527_home_guide_overrides.sql.
  home_guide_overrides: HomeGuideOverrides | null;

  // Funnel link: which prospect record promoted into this property
  projection_id: string | null;

  // Owner onboarding intake link (analogous to projections.onboarding_token).
  // Null until an operator clicks "Generate onboarding link" on the
  // property page. Submissions land back in the first-class columns above
  // (wifi_name, gas_shutoff_location, etc.) — no JSONB blob.
  onboarding_token: string | null;
  onboarding_submitted_at: string | null;

  // Channels module: per-property iCal export token used to authenticate
  // outbound master-availability subscriptions from Airbnb / VRBO / Booking.com.
  // Added by 20260507c_channels_extras.sql.
  ical_export_token: string | null;

  created_at: string | null;
  updated_at: string | null;
  last_synced_at: string | null;
};

/** Emails always CC'd when a statement is sent out from the portal. */
export const ALWAYS_CC = [
  'allie@risingtidestr.com',
  'ryan@risingtidestr.com',
];

/**
 * 24-hour local contacts posted on every property's Information Note.
 *
 * Gloucester's STR ordinance (and most STR licensing jurisdictions) require
 * a posted operator + an additional 24-hour reachable contact. These are
 * company-wide for Rising Tide, so they live here as constants rather than
 * per-property columns. Override at render time if a specific property
 * eventually needs a different second contact.
 */
export const LOCAL_CONTACTS_24HR = {
  operator: {
    name: 'Allie O\'Brien',
    role: 'Operations',
    phone: '(978) 865-2387',
    email: 'allie@risingtidestr.com',
  },
  backup: {
    name: 'Dotti Maguire',
    role: 'Owner / 24-hour contact',
    // TODO: confirm the right number to post here. Email-only for now.
    phone: '',
    email: 'dotti@risingtidestr.com',
  },
};

/** Sender identity used in drafts. */
export const SEND_FROM = {
  // Drafts appear to come from the Rising Tide Statements group mailbox.
  // This is a label-only field; the actual MIME sender/mailbox depends
  // on whose Gmail OAuth token created the draft. If that mailbox has
  // `statements@risingtidestr.com` configured as a "Send mail as" alias,
  // Gmail will honor this header when the owner sends.
  name: 'Rising Tide',
  email: 'statements@risingtidestr.com',
  signoff_default: 'Allie & Ryan',
  signoff_year_end: 'Allie & Ryan',
};

/** Lowercase-substring lookup used by the statement's "listing_match" matcher. */
export function propertyFromListing(listing: string): Property | undefined {
  const h = listing.toLowerCase();
  for (const p of Object.values(PROPERTIES)) {
    if (p.listing_match && h.includes(p.listing_match)) return p;
  }
  return undefined;
}

/**
 * Match a free-text cleaner / vendor message to a property.
 *
 * propertyFromListing expects the full Guesty listing name as a
 * substring ("73 rocky neck") — fine for platform notifications, useless
 * for how cleaners actually text: "Hi Allie the house 73 it's ready",
 * "53 rock neck done", "20 hammond all set". This matcher is tolerant of
 * shorthand and typos:
 *   - the bare street number when it uniquely identifies a property and
 *     is ≥2 digits ("73" -> 73 Rocky Neck). Single digits ("3"/"4") are
 *     too easy to hit by accident in free text, so they require a street
 *     word.
 *   - street number + a shortened / misspelled street word ("53 rock
 *     neck" -> 53 Rocky Neck; "rock" stems to "rocky").
 *   - the full listing_match substring (back-compat).
 *
 * Returns a property ONLY when the match is unambiguous. If nothing
 * matches, or two properties could plausibly match, returns undefined —
 * we never want to mis-attribute a cleaning to the wrong owner.
 */
export function matchPropertyFromCleanerText(body: string): Property | undefined {
  if (!body) return undefined;
  const text = ` ${body.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const all = Object.values(PROPERTIES);

  // How many properties share each leading street number (ambiguity guard
  // for "20" = Hammond or Enon, "3" = South or Locust).
  const numberCounts = new Map<string, number>();
  for (const p of all) {
    const num = p.name.match(/^(\d+)/)?.[1];
    if (num) numberCounts.set(num, (numberCounts.get(num) ?? 0) + 1);
  }

  const matched = new Set<string>();
  for (const p of all) {
    // 1. Full listing name present (back-compat).
    if (p.listing_match && text.includes(` ${p.listing_match} `)) { matched.add(p.id); continue; }
    if (p.listing_match && text.includes(p.listing_match)) { matched.add(p.id); continue; }

    const num = p.name.match(/^(\d+)/)?.[1] ?? '';
    if (!num) continue;
    if (!new RegExp(`(^| )${num}( |$)`).test(text)) continue;

    // Street words after the number: "73 Rocky Neck" -> ["rocky","neck"].
    const streetWords = p.name
      .replace(/^\d+\s*/, '')
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    const wordPresent = streetWords.some((w) => text.includes(` ${w.slice(0, 4)}`));

    // 2. number + a street word (typo/shorthand tolerant).
    if (wordPresent) { matched.add(p.id); continue; }

    // 3. bare number, only when ≥2 digits AND unique across the portfolio.
    if (num.length >= 2 && numberCounts.get(num) === 1) matched.add(p.id);
  }

  if (matched.size === 1) {
    const id = [...matched][0];
    return all.find((p) => p.id === id);
  }
  return undefined;
}
