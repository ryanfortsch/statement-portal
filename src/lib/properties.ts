/**
 * Single source of truth for Rising Tide STR property config.
 *
 * Before this module existed, each of `/api/ingest/route.ts`,
 * `/src/app/statement/page.tsx`, and `/src/app/upload/page.tsx` kept a
 * slightly different version of the PROPERTIES list. When an owner's email
 * changed or a new listing came online, you had to patch three places.
 * Now they all import from here.
 */

export type Property = {
  id: string;
  name: string;               // short, e.g. "20 Enon Rd"
  address: string;            // long, e.g. "20 Enon Road"
  city: string;               // "Beverly, MA"
  owner_last: string;         // "Snyder" -- short for summary rows
  owner_full: string;         // "The Snyder Family" -- for statement "Prepared for"
  owner_greeting: string;     // "Kathleen and Robert" -- for email "Hi ___,"
  owner_emails: string[];     // all addresses we've sent to
  fee_pct: number;            // management fee percentage
  bank_last4: string | null;  // Chase account last 4, null if not applicable
  listing_match: string;      // lowercase substring used to match Guesty listings
};

// Emails pulled from confirmed statement sends in the Apr 2026 audit.
// Four properties are still missing emails -- Ryan to confirm.
export const PROPERTIES: Record<string, Property> = {
  '3_south_st': {
    id: '3_south_st', name: '3 South St', address: '3 South Street', city: 'Rockport, MA',
    owner_last: 'Bailey', owner_full: 'Marci & Paul Bailey', owner_greeting: 'Marci and Paul',
    owner_emails: ['baileynrma@comcast.net', 'paulbailey2006@yahoo.com'],
    fee_pct: 25, bank_last4: '5622', listing_match: '3 south',
  },
  '21_horton': {
    id: '21_horton', name: '21 Horton St', address: '21 Horton Street', city: 'Gloucester, MA',
    owner_last: 'Kittredge', owner_full: 'Claudia Kittredge', owner_greeting: 'Claudia and Vicente',
    owner_emails: ['ckittred1@gmail.com', 'claudia.kittredge@gmail.com'],
    fee_pct: 22, bank_last4: '1323', listing_match: '21 horton',
  },
  '53_rocky_neck': {
    id: '53_rocky_neck', name: '53 Rocky Neck Ave', address: '53 Rocky Neck Avenue', city: 'Gloucester, MA',
    owner_last: 'Prudenzi', owner_full: 'Mark Prudenzi', owner_greeting: 'Dennis',
    owner_emails: ['senecalglenn@gmail.com'],
    fee_pct: 25, bank_last4: '9910', listing_match: '53 rocky neck',
  },
  '4_brier_neck': {
    id: '4_brier_neck', name: '4 Brier Neck Rd', address: '4 Brier Neck Road', city: 'Gloucester, MA',
    owner_last: 'Armstrong', owner_full: 'The Armstrong Family', owner_greeting: 'Jane',
    owner_emails: ['jane@independent-thinking.com'],
    fee_pct: 20, bank_last4: '7876', listing_match: '4 brier neck',
  },
  '30_woodward': {
    id: '30_woodward', name: '30 Woodward Ave', address: '30 Woodward Avenue', city: 'Gloucester, MA',
    owner_last: 'McWethy', owner_full: 'The McWethy Family', owner_greeting: 'Jim',
    owner_emails: ['mcwethycottages@gmail.com'],
    fee_pct: 25, bank_last4: '8221', listing_match: '30 woodward',
  },
  '20_hammond': {
    id: '20_hammond', name: '20 Hammond St', address: '20 Hammond Street', city: 'Gloucester, MA',
    owner_last: 'Ramsey', owner_full: 'The Ramsey Family', owner_greeting: 'Danielle and Mark',
    owner_emails: ['dfry0404@yahoo.com'],
    fee_pct: 25, bank_last4: '9969', listing_match: '20 hammond',
  },
  '20_enon': {
    id: '20_enon', name: '20 Enon Rd', address: '20 Enon Road', city: 'Beverly, MA',
    owner_last: 'Snyder', owner_full: 'The Snyder Family', owner_greeting: 'Kathleen and Robert',
    owner_emails: ['katsnyder21@gmail.com', 'robertsnyder99@gmail.com'],
    fee_pct: 25, bank_last4: '1307', listing_match: '20 enon',
  },
  '73_rocky_neck': {
    id: '73_rocky_neck', name: '73 Rocky Neck Ave', address: '73 Rocky Neck Avenue', city: 'Gloucester, MA',
    owner_last: 'Moynahan', owner_full: 'The Moynahan Family', owner_greeting: 'Matt and Laila',
    owner_emails: ['matthewmoynahan@yahoo.com', 'lailarocha@gmail.com'],
    fee_pct: 25, bank_last4: '3227', listing_match: '73 rocky neck',
  },
  '17_beach_rd': {
    id: '17_beach_rd', name: '17 Beach Rd', address: '17 Beach Road', city: 'Gloucester, MA',
    owner_last: 'Nolan', owner_full: 'Susan & London Nolan', owner_greeting: 'Susan and London',
    owner_emails: [], // TODO: need from Ryan
    fee_pct: 22, bank_last4: '5621', listing_match: '17 beach',
  },
};

// 65 Calderwood Ln, 3 Locust St, and 3246 NE 27th Ave are Ryan's personal
// properties and intentionally excluded from the portal.

export const PROPERTY_IDS = Object.keys(PROPERTIES);

export function getProperty(id: string): Property | undefined {
  return PROPERTIES[id];
}

/** Emails always CC'd when a statement is sent out from the portal. */
export const ALWAYS_CC = [
  'allie@risingtidestr.com',
  'ryan@risingtidestr.com',
];

/** Sender identity used in drafts. */
export const SEND_FROM = {
  name: 'Allie Fortsch',
  email: 'allie@risingtidestr.com',          // current mailbox the OAuth token authenticates
  reply_to: 'statements@risingtidestr.com',  // group address once it's receiving mail
  signoff_default: 'Allie',
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
