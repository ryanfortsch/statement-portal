/**
 * Partner home setup: the listing bar, pure.
 *
 * A partner home is a Cape Ann home its own host runs and lists on
 * staycapeann.com for a fee (src/lib/property-scope.ts isPartnerHome). The
 * office builds it in Helm, and an owner lists it once it clears every line
 * below. Listed, staycapeann.com shows it within minutes and takes booking
 * requests for it (GET /api/pms/properties?include=partner names only listed
 * partner homes, and POST /api/pms/requests refuses any other). Taking it off
 * is one click and immediate.
 *
 * The bar is the plan's six (a walk that passed, STR insurance, the MA
 * certificate and city permit, photos to our standard, a cancellation policy
 * and house rules, a signed listing agreement) plus what the booking path
 * needs to work: a host we can reach, a pin on the map, listing copy, rooms,
 * a nightly rate, the host's calendars read in, our calendar read out by
 * every channel the host lists on, and card payments.
 *
 * Most lines are read off the record; four are a person's word (the walk,
 * the insurance proof, the agreement, the photos), kept in partner_listings
 * with the date and who said so. No Next or database imports (the one import
 * is the pure calendar rules): the tests load it offline
 * (src/lib/__tests__/partner-listing.test.ts).
 */

import { feedIsFresh } from './partner-calendar.ts';

/** A listing photo set below this is not a listing. */
export const MIN_PHOTOS = 5;
/** An OTA that has not pulled our export for this long no longer counts as reading it. */
export const EXPORT_PULL_STALE_MS = 3 * 24 * 60 * 60_000;

/** The person-checked lines, and the dates on them. */
export type PartnerListingRow = {
  property_id: string;
  walked_on: string | null;
  walked_by: string | null;
  insurance_checked_on: string | null;
  insurance_expires_on: string | null;
  insurance_checked_by: string | null;
  agreement_signed_on: string | null;
  agreement_recorded_by: string | null;
  photos_ok_on: string | null;
  photos_ok_by: string | null;
  listed_at: string | null;
  listed_by: string | null;
  unlisted_at: string | null;
  unlisted_by: string | null;
  unlisted_reason: string | null;
};

export const PARTNER_LISTING_COLS =
  'property_id, walked_on, walked_by, insurance_checked_on, insurance_expires_on, insurance_checked_by, agreement_signed_on, agreement_recorded_by, photos_ok_on, photos_ok_by, listed_at, listed_by, unlisted_at, unlisted_by, unlisted_reason';

export type ListingState = 'not_listed' | 'listed' | 'taken_off';

/** On staycapeann.com: listed and not taken off since. */
export function isListed(row: Pick<PartnerListingRow, 'listed_at' | 'unlisted_at'> | null | undefined): boolean {
  return !!row?.listed_at && !row.unlisted_at;
}

export function listingState(row: Pick<PartnerListingRow, 'listed_at' | 'unlisted_at'> | null | undefined): ListingState {
  if (isListed(row)) return 'listed';
  return row?.unlisted_at ? 'taken_off' : 'not_listed';
}

/** The four lines a person vouches for. */
export const PERSON_CHECKS = ['walk', 'insurance', 'agreement', 'photos'] as const;
export type PersonCheck = (typeof PERSON_CHECKS)[number];

/** The columns each person check writes: the date, and who. */
export const CHECK_COLUMNS: Record<PersonCheck, { on: keyof PartnerListingRow; by: keyof PartnerListingRow }> = {
  walk: { on: 'walked_on', by: 'walked_by' },
  insurance: { on: 'insurance_checked_on', by: 'insurance_checked_by' },
  agreement: { on: 'agreement_signed_on', by: 'agreement_recorded_by' },
  photos: { on: 'photos_ok_on', by: 'photos_ok_by' },
};

export function isPersonCheck(s: unknown): s is PersonCheck {
  return typeof s === 'string' && (PERSON_CHECKS as readonly string[]).includes(s);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD that is a real date, or null. */
export function isoDay(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!ISO_DAY.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

/** What the setup screen knows about the home, gathered by partner-listing-db. */
export type PartnerSetupFacts = {
  property: {
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
    owner_full: string | null;
    owner_emails: string[];
    owner_phone: string | null;
    tax_cert_id: string | null;
    str_registration_id: string | null;
    str_insurance_carrier: string | null;
    default_checkout_time: string | null;
    cancellation_policy: string | null;
    house_rules: string | null;
    calendar_authority: string | null;
  };
  /** The listing as staycapeann.com would show it (listing-content toScaListing). */
  listing: {
    hasOwnTitle: boolean;
    title: string;
    tagline: string;
    description: string;
    photoCount: number;
    bedrooms: number;
    bathrooms: number;
    accommodates: number;
    basePrice: number;
  } | null;
  feeds: Array<{ channel: string; last_synced_at: string | null; last_error: string | null }>;
  /** Newest pull of our export per channel; null for a channel that never pulled. Absent: unread. */
  exportPulls: Partial<Record<string, string | null>> | null;
  paymentsReady: boolean;
  feeSet: boolean;
  checks: PartnerListingRow | null;
};

export type SetupItem = {
  key: string;
  label: string;
  ok: boolean;
  /** One line: what is there, or what is missing. */
  detail: string;
  /** Where it is fixed: a tab or page of Helm, or this panel. */
  fix: 'facts' | 'listing' | 'rates' | 'calendars' | 'checks' | 'payments';
};

const blank = (s: string | null | undefined): boolean => !s || !s.trim();

function missing(parts: Array<[string, boolean]>): string[] {
  return parts.filter(([, has]) => !has).map(([name]) => name);
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function checkedLine(on: string | null, by: string | null): string {
  return on ? `${by ? `${shortName(by)}, ` : ''}${on}` : '';
}

/** "dotti@risingtidestr.com" reads as "dotti". */
export function shortName(email: string): string {
  return email.split('@')[0] || email;
}

const CHANNEL_WORD: Record<string, string> = { airbnb: 'Airbnb', vrbo: 'Vrbo', booking_com: 'Booking.com', other: 'their software' };

export function channelWord(ch: string): string {
  return CHANNEL_WORD[ch] ?? ch;
}

/**
 * Every line of the bar, in the order the office works it. `now` decides
 * what is stale (a feed, an export pull) and expired (the insurance).
 */
export function setupItems(f: PartnerSetupFacts, now: Date): SetupItem[] {
  const p = f.property;
  const c = f.checks;
  const l = f.listing;
  const today = now.toISOString().slice(0, 10);
  const items: SetupItem[] = [];

  const hostMissing = missing([
    ['a name', !blank(p.owner_full)],
    ['an email', p.owner_emails.some((e) => !blank(e))],
    ['a phone', !blank(p.owner_phone)],
  ]);
  items.push({
    key: 'host',
    label: 'The host',
    ok: hostMissing.length === 0,
    detail: hostMissing.length === 0 ? `${p.owner_full} · ${p.owner_emails[0]} · ${p.owner_phone}` : `Needs ${joinWords(hostMissing)}`,
    fix: 'facts',
  });

  const placeMissing = missing([
    ['the street address', !blank(p.address)],
    ['the town', !blank(p.city)],
    ['the map pin', p.latitude != null && p.longitude != null],
  ]);
  items.push({
    key: 'location',
    label: 'Address and map pin',
    ok: placeMissing.length === 0,
    detail: placeMissing.length === 0 ? `${p.address}, ${p.city}` : `Needs ${joinWords(placeMissing)}`,
    fix: 'facts',
  });

  const copyMissing = l
    ? missing([
        ['a title', l.hasOwnTitle && !blank(l.title)],
        ['a summary', !blank(l.tagline)],
        ['a description', !blank(l.description)],
      ])
    : ['a title', 'a summary', 'a description'];
  items.push({
    key: 'listing',
    label: 'Listing copy',
    ok: copyMissing.length === 0,
    detail: copyMissing.length === 0 ? (l?.title ?? '') : `Needs ${joinWords(copyMissing)}`,
    fix: 'listing',
  });

  const photos = l?.photoCount ?? 0;
  const photosOk = photos >= MIN_PHOTOS && !!c?.photos_ok_on;
  items.push({
    key: 'photos',
    label: 'Photos to our standard',
    ok: photosOk,
    detail:
      photos < MIN_PHOTOS
        ? `${photos} of at least ${MIN_PHOTOS}`
        : c?.photos_ok_on
          ? `${photos} photos · checked ${checkedLine(c.photos_ok_on, c.photos_ok_by)}`
          : `${photos} photos · not checked yet`,
    fix: photos < MIN_PHOTOS ? 'listing' : 'checks',
  });

  const roomsMissing = l
    ? missing([
        ['bedrooms', l.bedrooms > 0],
        ['bathrooms', l.bathrooms > 0],
        ['how many guests', l.accommodates > 0],
      ])
    : ['bedrooms', 'bathrooms', 'how many guests'];
  items.push({
    key: 'rooms',
    label: 'Rooms and guests',
    ok: roomsMissing.length === 0,
    detail: roomsMissing.length === 0 && l ? `${l.bedrooms} bed · ${l.bathrooms} bath · sleeps ${l.accommodates}` : `Needs ${joinWords(roomsMissing)}`,
    fix: roomsMissing.includes('how many guests') ? 'facts' : 'listing',
  });

  items.push({
    key: 'rates',
    label: 'A nightly rate',
    ok: !!l && l.basePrice > 0 && p.calendar_authority === 'helm',
    detail: p.calendar_authority !== 'helm' ? 'Helm does not hold this calendar' : l && l.basePrice > 0 ? `From $${l.basePrice.toLocaleString('en-US')} a night` : 'No rate plan saved',
    fix: 'rates',
  });

  const policyMissing = missing([
    ['a cancellation policy', !blank(p.cancellation_policy)],
    ['house rules', !blank(p.house_rules)],
    ['a checkout time', !blank(p.default_checkout_time)],
  ]);
  items.push({
    key: 'policy',
    label: 'Cancellation policy and house rules',
    ok: policyMissing.length === 0,
    detail: policyMissing.length === 0 ? `Checkout ${p.default_checkout_time}` : `Needs ${joinWords(policyMissing)}`,
    fix: 'facts',
  });

  const permitMissing = missing([
    ['the MA certificate', !blank(p.tax_cert_id)],
    ['the city permit', !blank(p.str_registration_id)],
  ]);
  items.push({
    key: 'permits',
    label: 'MA certificate and city permit',
    ok: permitMissing.length === 0,
    detail: permitMissing.length === 0 ? `MA ${p.tax_cert_id} · city ${p.str_registration_id}` : `Needs ${joinWords(permitMissing)}`,
    fix: 'facts',
  });

  const insExpired = !!c?.insurance_expires_on && c.insurance_expires_on < today;
  const insOk = !blank(p.str_insurance_carrier) && !!c?.insurance_checked_on && !!c.insurance_expires_on && !insExpired;
  items.push({
    key: 'insurance',
    label: 'Short-term rental insurance',
    ok: insOk,
    detail: blank(p.str_insurance_carrier)
      ? 'No carrier on file'
      : !c?.insurance_checked_on
        ? `${p.str_insurance_carrier} · proof not seen yet`
        : insExpired
          ? `${p.str_insurance_carrier} · expired ${c.insurance_expires_on}`
          : !c.insurance_expires_on
            ? `${p.str_insurance_carrier} · no expiry date`
            : `${p.str_insurance_carrier} · good until ${c.insurance_expires_on}`,
    fix: blank(p.str_insurance_carrier) ? 'facts' : 'checks',
  });

  items.push({
    key: 'walk',
    label: 'Walked and passed',
    ok: !!c?.walked_on,
    detail: c?.walked_on ? `Passed ${checkedLine(c.walked_on, c.walked_by)}` : 'Not walked yet',
    fix: 'checks',
  });

  items.push({
    key: 'agreement',
    label: 'Listing agreement signed',
    ok: !!c?.agreement_signed_on,
    detail: c?.agreement_signed_on ? `Signed ${c.agreement_signed_on}` : 'Not signed yet',
    fix: 'checks',
  });

  const fresh = (iso: string | null, staleMs: number) => !!iso && now.getTime() - Date.parse(iso) <= staleMs;
  const staleFeeds = f.feeds.filter((x) => !feedIsFresh(x.last_synced_at, now));
  items.push({
    key: 'calendar_in',
    label: "The host's calendars read in",
    ok: f.feeds.length > 0 && staleFeeds.length === 0,
    detail:
      f.feeds.length === 0
        ? 'No calendar added'
        : staleFeeds.length === 0
          ? `${joinWords(f.feeds.map((x) => channelWord(x.channel)))}, read in the last six hours`
          : `${joinWords(staleFeeds.map((x) => channelWord(x.channel)))} not read lately${staleFeeds[0].last_error ? `: ${staleFeeds[0].last_error}` : ''}`,
    fix: 'calendars',
  });

  // Every channel the host sells on must import ours, or a stay booked
  // here stays open there. Their own software cannot be told apart by its
  // pulls, so an 'other' feed is the office's word, not a check.
  const channels = [...new Set(f.feeds.map((x) => x.channel).filter((ch) => ch !== 'other'))];
  const notReading = f.exportPulls == null ? channels : channels.filter((ch) => !fresh(f.exportPulls?.[ch] ?? null, EXPORT_PULL_STALE_MS));
  items.push({
    key: 'calendar_out',
    label: 'Our calendar read by each of them',
    ok: channels.length > 0 && notReading.length === 0,
    detail:
      channels.length === 0
        ? 'Add the host’s calendars first'
        : f.exportPulls == null
          ? 'The export log could not be read'
          : notReading.length === 0
            ? `${joinWords(channels.map(channelWord))} read it in the last three days`
            : `${joinWords(notReading.map(channelWord))} ${notReading.length === 1 ? 'has' : 'have'} not read it yet`,
    fix: 'calendars',
  });

  items.push({
    key: 'payments',
    label: 'Card payments',
    ok: f.paymentsReady,
    detail: f.paymentsReady ? 'The host’s Stripe takes cards' : !f.feeSet ? 'Our fee is not set' : 'The host has not finished Stripe',
    fix: 'payments',
  });

  return items;
}

export function readyToList(items: readonly SetupItem[]): boolean {
  return items.length > 0 && items.every((i) => i.ok);
}

// ─── A new partner home ─────────────────────────────────────────────────────

export type NewPartnerHome = {
  address: string;
  city: string;
  host_name: string;
  host_email: string;
  host_phone: string | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The add form, checked. A street address starts with a house number. */
export function parseNewPartnerHome(raw: Record<string, unknown>): { ok: true; home: NewPartnerHome } | { ok: false; error: string } {
  const s = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string).replace(/\s+/g, ' ').trim() : '');
  const address = s('address').replace(/,.*$/, '').trim();
  const city = s('city');
  const hostName = s('host_name');
  const hostEmail = s('host_email').toLowerCase();
  const hostPhone = s('host_phone');
  if (!/^\d+[A-Za-z]?\s+\S/.test(address)) return { ok: false, error: 'The street address starts with the house number, like 12 Main Street.' };
  if (address.length > 120) return { ok: false, error: 'That street address is too long.' };
  if (!city || city.length > 60) return { ok: false, error: 'Add the town.' };
  if (!hostName || hostName.length > 120) return { ok: false, error: 'Add the host’s name.' };
  if (!EMAIL.test(hostEmail) || hostEmail.length > 200) return { ok: false, error: 'Add the host’s email.' };
  if (hostPhone && !/^[+\d][\d\s().-]{6,24}$/.test(hostPhone)) return { ok: false, error: 'That phone number does not look right.' };
  return { ok: true, home: { address, city, host_name: hostName, host_email: hostEmail, host_phone: hostPhone || null } };
}

const STREET_SUFFIX = /\b(st|rd|ave|lane|ln|way|road|street|avenue|drive|dr|circle|cir|court|ct|place|pl|terrace|ter|boulevard|blvd)\b/gi;

/** "12 Main Street" -> "12 Main", the house's internal name (CLAUDE.md, Naming convention). */
export function internalNameFromAddress(address: string): string {
  const cleaned = address.replace(/,.*$/, '').replace(/[.'’]/g, '').replace(STREET_SUFFIX, '').replace(/\s+/g, ' ').trim();
  return cleaned || address.trim();
}

/** "12 Main Street" -> "12_main", the convention every home's id follows. */
export function propertyIdBase(address: string): string {
  return address
    .toLowerCase()
    .replace(/,.*$/, '')
    .replace(/[.'’]/g, '')
    .replace(STREET_SUFFIX, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join('_');
}

/** The owner columns every properties row requires, filled with the host. */
export function hostNameParts(fullName: string): { owner_full: string; owner_last: string; owner_greeting: string } {
  const words = fullName.trim().split(/\s+/);
  return { owner_full: fullName.trim(), owner_last: words[words.length - 1] ?? fullName, owner_greeting: words[0] ?? fullName };
}
