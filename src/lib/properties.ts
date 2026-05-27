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
    // Apr 2026 reconcile audit confirmed prudenziwelding@yahoo.com is the
    // address Melissa @ RTC has been using; senecalglenn@gmail.com is on
    // file from earlier sends -- keeping both until we confirm with Simon
    // which he prefers as primary.
    owner_emails: ['prudenziwelding@yahoo.com', 'senecalglenn@gmail.com'],
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
    owner_last: 'McWethy', owner_full: 'The McWethy Family', owner_greeting: 'Jim',
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
    // Airbnb collects + remits MA occupancy tax on our behalf for this
    // listing -- no direct MassTaxConnect filing required.
    tax_cert_id: null,
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
 * Row shape from Helm's `properties` table. Mirrors the SQL schema 1:1.
 * Used by /properties pages and the home dashboard.
 */
/**
 * Free-form per-cell overrides for the Stay Cape Ann "Welcome Home" guide
 * (renderer at /properties/<id>/home-guide). Each value is plain text;
 * blank lines split paragraphs at render time. An empty / missing key
 * means "use the auto-populated default".
 */
export type HomeGuideOverrides = {
  wifi?: string;
  climate?: string;
  bathrooms?: string;
  parking?: string;
  kitchen?: string;
  trash?: string;
};

export const HOME_GUIDE_CELL_KEYS = ['wifi', 'climate', 'bathrooms', 'parking', 'kitchen', 'trash'] as const;
export type HomeGuideCellKey = (typeof HOME_GUIDE_CELL_KEYS)[number];

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
  known_issues: string | null;
  upcoming_maintenance: string | null;
  property_notes: string | null;

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
